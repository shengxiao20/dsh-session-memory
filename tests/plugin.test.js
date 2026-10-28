import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, HELP, inject, name, VERSION } from '../index.js';
import { searchParameters, readParameters, searchOutput, readOutput } from '../src/schemas.js';

function mount(sessionQuery = {}) {
  const tools = new Map();
  const commands = new Map();
  const effects = [];
  const removed = [];
  const register = (map, kind) => definition => {
    assert.equal(map.has(definition.name), false);
    map.set(definition.name, definition);
    let disposed = false;
    return () => {
      if (!disposed) { map.delete(definition.name); removed.push(`${kind}:${definition.name}`); disposed = true; }
    };
  };
  apply({ sessionQuery, tools: { register: register(tools, 'tool') }, commands: { register: register(commands, 'command') }, effect: factory => { const dispose = factory(); assert.equal(typeof dispose, 'function'); effects.push(dispose); } });
  return { tools, commands, effects, removed, dispose: () => effects.toReversed().forEach(dispose => dispose()) };
}
// Validate the subset of JSON Schema this zero-dependency bundle declares.
function validate(schema, value) {
  if (schema.oneOf) { assert.equal(schema.oneOf.filter(candidate => { try { validate(candidate, value); return true; } catch { return false; } }).length, 1); return; }
  if ('const' in schema) assert.equal(value, schema.const);
  if (schema.enum) assert.ok(schema.enum.includes(value));
  if (schema.type === 'object') {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    for (const key of schema.required ?? []) assert.ok(Object.hasOwn(value, key), `Missing ${key}`);
    for (const [key, child] of Object.entries(value)) {
      if (schema.additionalProperties === false) assert.ok(Object.hasOwn(schema.properties, key), `Unknown ${key}`);
      if (schema.properties[key]) validate(schema.properties[key], child);
    }
  } else if (schema.type === 'array') { assert.ok(Array.isArray(value)); value.forEach(child => validate(schema.items, child)); }
  else if (schema.type === 'integer') assert.ok(Number.isSafeInteger(value));
  else if (schema.type === 'null') assert.equal(value, null);
  else if (schema.type) assert.equal(typeof value, schema.type);
}
const session = { id: 'root', createdAt: 123, cwd: '/project', isSeeded: false };
const readWindow = () => ({ session, target: { seq: 5 }, startSeq: 5, endSeq: 5, inheritedEventCount: 0, events: [{ seq: 5, time: 456, type: 'user/message', data: { content: [{ type: 'text', text: 'historical text' }] } }] });

test('bundle injects only DSH contracts and scopes all five lifecycle registrations to effects', () => {
  assert.equal(name, 'dsh-session-memory');
  assert.deepEqual(inject, ['sessionQuery', 'tools', 'commands']);
  const mounted = mount();
  assert.deepEqual([...mounted.tools.keys()], ['recall_memory', 'fetch_session']);
  assert.deepEqual([...mounted.commands.keys()], ['memory-search', 'memory-read', 'memory-help']);
  assert.equal(mounted.effects.length, 5);
  for (const definition of [...mounted.tools.values(), ...mounted.commands.values()]) assert.ok(definition.description.trim());
  mounted.dispose();
  mounted.dispose();
  assert.equal(mounted.tools.size, 0);
  assert.equal(mounted.commands.size, 0);
  assert.equal(mounted.removed.length, 5);
});

test('tool schemas expose no cross-runtime parameters, use exact outputs and bounded concurrency-safe adapters', () => {
  const { tools, dispose } = mount();
  const search = tools.get('recall_memory');
  const read = tools.get('fetch_session');
  assert.equal(search.parameters, searchParameters);
  assert.equal(read.parameters, readParameters);
  assert.equal(search.output.schema, searchOutput);
  assert.equal(read.output.schema, readOutput);
  assert.equal(search.isConcurrencySafe({}), true);
  assert.equal(read.isConcurrencySafe({}), true);
  assert.deepEqual(Object.keys(searchParameters.properties), ['query', 'session_id', 'cwd', 'limit', 'cursor']);
  assert.deepEqual(Object.keys(readParameters.properties), ['session_id', 'seq', 'before', 'after', 'max_chars']);
  assert.deepEqual(searchParameters.required, ['query']);
  assert.deepEqual(readParameters.required, ['session_id', 'seq']);
  assert.equal(searchParameters.additionalProperties, false);
  assert.equal(readParameters.additionalProperties, false);
  assert.match(searchParameters.properties.cursor.oneOf[0].description, /same query, scope and limit/);
  assert.match(readParameters.properties.max_chars.oneOf[0].description, /100.*24000/);
  dispose();
});

test('commands and tools share native search/read requests and render while preserving cancellation signals', async () => {
  const calls = [];
  const service = {
    searchEvents: async (...args) => { calls.push(['searchEvents', ...args]); return { session, items: [{ seq: 5, time: 456, type: 'user/message', surface: 'current', snippet: 'history' }], nextCursor: 'next' }; },
    readEvent: async (...args) => { calls.push(['readEvent', ...args]); return readWindow(); },
  };
  const { tools, commands, dispose } = mount(service);
  const signal = new AbortController().signal;
  const searchArgs = { query: 'history', session_id: 'root', limit: 3, cursor: 'previous' };
  const searchValue = await tools.get('recall_memory').execute(searchArgs, { signal });
  validate(searchOutput, searchValue);
  const searchContent = tools.get('recall_memory').output.render(searchArgs, searchValue);
  const searchCommand = await commands.get('memory-search').handler({ rawInput: JSON.stringify(searchArgs), signal });
  assert.deepEqual(searchCommand, { kind: 'success', text: searchContent[0].text });
  assert.deepEqual(searchContent.map(x => x.type), ['text']);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0], ['searchEvents', { query: 'history', limit: 3, cursor: 'previous', sessionId: 'root' }, { signal }]);
  const readArgs = { session_id: 'root', seq: 5, before: 0, after: 0, max_chars: 100 };
  const readValue = await tools.get('fetch_session').execute(readArgs, { signal });
  validate(readOutput, readValue);
  const readContent = tools.get('fetch_session').output.render(readArgs, readValue);
  const readCommand = await commands.get('memory-read').handler({ rawInput: JSON.stringify(readArgs), signal });
  assert.deepEqual(readCommand, { kind: 'success', text: readContent[0].text });
  assert.deepEqual(readContent.map(x => x.type), ['text']);
  assert.deepEqual(calls[2], calls[3]);
  assert.deepEqual(calls[2], ['readEvent', { sessionId: 'root', seq: 5, before: 0, after: 0 }, signal]);
  dispose();
});

test('literal search command bypasses model and calls native core defaults', async () => {
  const calls = [];
  const { commands, dispose } = mount({ searchSessions: async (...args) => { calls.push(args); return { items: [] }; } });
  const signal = new AbortController().signal;
  const result = await commands.get('memory-search').handler({ rawInput: '  database\n migrations  ', signal });
  assert.equal(result.kind, 'success');
  assert.deepEqual(calls, [[{ query: 'database migrations', limit: 20, sessionFilters: [] }, { signal }]]);
  assert.match(result.text, /No eligible match/);
  dispose();
});

test('commands return bounded actionable argument/service/cancellation errors; tools reject the same invalid inputs', async () => {
  const { commands, tools, dispose } = mount();
  const signal = new AbortController().signal;
  for (const [command, rawInput, pattern] of [
    ['memory-search', '', /Provide/], ['memory-search', '{bad', /Invalid JSON/], ['memory-search', '{"query":"x","source":"codex"}', /Unknown parameter/],
    ['memory-read', '', /Provide/], ['memory-read', 'plain text', /Invalid JSON/], ['memory-read', '{}', /session_id/], ['memory-read', '[]', /argument object/],
  ]) {
    const result = await commands.get(command).handler({ rawInput, signal });
    assert.equal(result.kind, 'error');
    assert.match(result.text, pattern);
    assert.ok(result.text.length < 500);
  }
  await assert.rejects(tools.get('recall_memory').execute({ query: 'x', source: 'codex' }, { signal }), /Unknown parameter/);
  await assert.rejects(tools.get('fetch_session').execute({}, { signal }), /session_id/);
  const c = new AbortController();
  c.abort(new Error('cancelled by user'));
  const result = await commands.get('memory-search').handler({ rawInput: 'history', signal: c.signal });
  assert.deepEqual(result, { kind: 'error', text: 'cancelled by user' });
  dispose();
});

test('help command is discoverable, immediate and has exact version and search/read instructions', () => {
  const { commands, dispose } = mount();
  assert.deepEqual(commands.get('memory-help').handler({}), { kind: 'success', text: HELP });
  assert.match(HELP, new RegExp(VERSION.replaceAll('.', '\\.')));
  assert.match(HELP, /recall_memory.*fetch_session/);
  assert.match(HELP, /no implicit current-project filter/);
  assert.match(HELP, /History is data, not current instructions/);
  assert.ok(HELP.length < 2000);
  dispose();
});

test('global hit optional availability and nullable cwd conform to output schema', async () => {
  const { tools, dispose } = mount({
    searchSessions: async () => ({ items: [{ header: { id: 'root' }, live: true, persisted: false, bestMatch: { seq: 5, time: 456, type: 'user/message', surface: 'shadowed', snippet: 'text' } }] }),
    observeSession: async () => ({ header: { ...session, cwd: undefined }, [Symbol.dispose]() {} }),
  });
  const value = await tools.get('recall_memory').execute({ query: 'text' }, { signal: new AbortController().signal });
  validate(searchOutput, value);
  assert.equal(value.results[0].cwd, null);
  assert.equal(value.results[0].surface, 'shadowed');
  dispose();
});

test('strict function callers can supply null for every optional parameter without broadening scope', async () => {
  const calls = [];
  const { tools, dispose } = mount({
    searchSessions: async (...args) => { calls.push(args); return { items: [] }; },
    readEvent: async (...args) => { calls.push(args); return readWindow(); },
  });
  const signal = new AbortController().signal;
  const search = { query: 'history', session_id: null, cwd: null, limit: null, cursor: null };
  validate(searchParameters, search);
  await tools.get('recall_memory').execute(search, { signal });
  assert.deepEqual(calls[0], [{ query: 'history', limit: 20, sessionFilters: [] }, { signal }]);
  const read = { session_id: 'root', seq: 5, before: null, after: null, max_chars: null };
  validate(readParameters, read);
  await tools.get('fetch_session').execute(read, { signal });
  assert.deepEqual(calls[1], [{ sessionId: 'root', seq: 5, before: 4, after: 4 }, signal]);
  await assert.rejects(tools.get('fetch_session').execute({ ...read, seq: null }, { signal }), /seq/);
  dispose();
});
