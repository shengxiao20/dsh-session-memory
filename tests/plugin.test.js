import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, HELP, inject, name } from '../index.js';
import { searchParameters, readParameters, discussionParameters, searchOutput, readOutput, discussionOutput } from '../src/schemas.js';

const header = { id: 'root', createdAt: 123, cwd: '/project/database', isSeeded: false };
const events = [
  { seq: 0, time: 100, type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text: 'database sqlite decision' }] } },
  { seq: 1, time: 101, type: 'assistant/message', surfaceOp: 'append', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'use sqlite' }] } } },
];

function services(overrides = {}) {
  const corpus = overrides.corpus ?? [{ header, events }];
  return {
    sessions: {
      get: id => corpus.find(item => item.header.id === id)?.live ? {} : undefined,
      flush: overrides.flush ?? (async () => true),
    },
    persistence: {
      list: overrides.list ?? (async () => corpus.map(item => ({ header: item.header, revision: Symbol(item.header.id), eventCount: item.events.length }))),
      open: overrides.open ?? (async id => {
        const item = corpus.find(candidate => candidate.header.id === id);
        if (!item) throw new Error(`missing ${id}`);
        return { header: item.header, read: async () => ({ eventState: 'owned', events: item.events }), close: async () => {} };
      }),
    },
  };
}

function mount(overrides = {}, config = {}) {
  const tools = new Map(), commands = new Map(), effects = [], removed = [], listeners = new Map();
  const register = (map, kind) => definition => {
    assert.equal(map.has(definition.name), false);
    map.set(definition.name, definition);
    let disposed = false;
    return () => { if (!disposed) { map.delete(definition.name); removed.push(`${kind}:${definition.name}`); disposed = true; } };
  };
  const host = services(overrides);
  apply({ sessions: host.sessions, sessionPersistence: host.persistence,
    agents: { create: async () => { throw new Error('Unexpected Discussion model call in plugin contract test.'); } },
    tools: { register: register(tools, 'tool') }, commands: { register: register(commands, 'command') },
    on: (event, listener) => listeners.set(event, listener), inject: () => {},
    effect: factory => { const dispose = factory(); assert.equal(typeof dispose, 'function'); effects.push(dispose); } }, config);
  return { tools, commands, effects, removed, listeners, ...host, dispose: async () => { for (const dispose of effects.toReversed()) await dispose(); } };
}

// Validate the subset of JSON Schema this bundle declares.
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

const searchArgs = { entities: ['database', 'sqlite'], question: 'Which database?', limit: 3 };
const readArgs = { session_id: 'root', from_turn_index: 0, to_turn_index: 0, max_chars: 100 };
const discussionValue = { source: 'dsh', question: 'Which database?', participant_count: 1, execution: 'sequential', privacy: 'isolated', consensus_is_verification: false,
  answers: [{ session_id: 'root', from_turn_index: 0, to_turn_index: 0, evidence_turn_ids: ['dsh:root:0'], evidence_truncated: false, answer: 'SQLite.' }] };

test('bundle requires DSH persistence contracts and owns registrations plus runtime cleanup effects', async () => {
  assert.equal(name, 'dsh-session-memory');
  assert.deepEqual(inject, ['sessions', 'sessionPersistence', 'agents', 'tools', 'commands']);
  const mounted = mount();
  assert.deepEqual([...mounted.tools.keys()], ['recall_memory', 'discuss_memory', 'review_jev_filtered', 'fetch_session', 'get_memory_stats', 'backfill_memory']);
  assert.deepEqual([...mounted.commands.keys()], ['memory-stats', 'memory-backfill', 'memory-search', 'memory-review', 'memory-read', 'memory-status', 'memory-help']);
  assert.equal(mounted.effects.length, 14);
  for (const definition of [...mounted.tools.values(), ...mounted.commands.values()]) assert.ok(definition.description.trim());
  await mounted.dispose(); await mounted.dispose();
  assert.equal(mounted.tools.size, 0); assert.equal(mounted.commands.size, 0); assert.equal(mounted.removed.length, 13);
});

test('tool schemas expose bounded DSH recall, Discussion and source-read inputs without legacy fields', () => {
  const { tools, commands, dispose } = mount();
  assert.equal(tools.get('recall_memory').parameters, searchParameters);
  assert.equal(tools.get('discuss_memory').parameters, discussionParameters);
  assert.equal(tools.get('fetch_session').parameters, readParameters);
  assert.equal(tools.get('recall_memory').output.schema, searchOutput);
  assert.equal(tools.get('discuss_memory').output.schema, discussionOutput);
  assert.equal(tools.get('fetch_session').output.schema, readOutput);
  assert.deepEqual(Object.keys(searchParameters.properties), ['entities', 'question', 'limit']);
  assert.deepEqual(Object.keys(discussionParameters.properties), ['participants', 'question', 'max_chars']);
  assert.deepEqual(Object.keys(discussionParameters.properties.participants.items.properties), ['session_id', 'from_turn_index', 'to_turn_index']);
  assert.equal(discussionParameters.properties.participants.minItems, 1);
  assert.equal(discussionParameters.properties.participants.maxItems, 3);
  assert.deepEqual(Object.keys(readParameters.properties), ['session_id', 'from_turn_index', 'to_turn_index', 'max_chars']);
  assert.deepEqual(searchParameters.required, ['entities', 'question']);
  assert.deepEqual(discussionParameters.required, ['participants', 'question']);
  assert.deepEqual(readParameters.required, ['session_id', 'from_turn_index', 'to_turn_index']);
  assert.equal(searchParameters.additionalProperties, false);
  assert.equal(discussionParameters.additionalProperties, false);
  assert.equal(readParameters.additionalProperties, false);
  assert.equal(commands.has('memory-discuss'), false);
  dispose();
});

test('commands and tools share persisted entity search/read and render exact turn coordinates', async () => {
  const { tools, commands, dispose } = mount();
  const signal = new AbortController().signal;
  const searchValue = await tools.get('recall_memory').execute(searchArgs, { signal });
  validate(searchOutput, searchValue);
  const searchContent = tools.get('recall_memory').output.render(searchArgs, searchValue);
  assert.deepEqual(await commands.get('memory-search').handler({ rawInput: JSON.stringify(searchArgs), signal }), { kind: 'success', text: searchContent[0].text });
  assert.equal(searchValue.results[0].turn_id, 'dsh:root:0');
  const readValue = await tools.get('fetch_session').execute(readArgs, { signal });
  validate(readOutput, readValue);
  const readContent = tools.get('fetch_session').output.render(readArgs, readValue);
  assert.deepEqual(await commands.get('memory-read').handler({ rawInput: JSON.stringify(readArgs), signal }), { kind: 'success', text: readContent[0].text });
  assert.equal(readValue.turns[0].seq, 0); assert.equal(readValue.turns[0].end_seq, 1);
  await dispose();
});

test('every tool render appends a redacted invocation-time config snapshot without changing command text', async () => {
  const { tools, commands, dispose } = mount();
  const signal = new AbortController().signal;
  const searchValue = await tools.get('recall_memory').execute(searchArgs, { signal });
  const readValue = await tools.get('fetch_session').execute(readArgs, { signal });
  const statsValue = await tools.get('get_memory_stats').execute({}, { signal });
  const backfillValue = await tools.get('backfill_memory').execute({}, { signal });
  const values = new Map([
    ['recall_memory', searchValue], ['discuss_memory', discussionValue], ['review_jev_filtered', searchValue], ['fetch_session', readValue],
    ['get_memory_stats', statsValue], ['backfill_memory', backfillValue],
  ]);
  for (const [toolName, value] of values) {
    const content = tools.get(toolName).output.render({}, value);
    assert.equal(content.length, 2, toolName);
    assert.match(content[1].text, /^Config · Jev=off \(nimble; disabled\) · Obsidian=off · manageOllama=off · limit=20\nEnv · DSH_HOME=(?:set|unset) · API key=local-placeholder$/);
    assert.doesNotMatch(content[1].text, /history\.sqlite|vaultPath|baseURL/);
  }
  const command = await commands.get('memory-search').handler({ rawInput: JSON.stringify(searchArgs), signal });
  assert.doesNotMatch(command.text, /^Config · /m);
  await dispose();
});

test('commands and tools reject removed legacy query/seq fields and preserve caller cancellation', async () => {
  const { commands, tools, dispose } = mount();
  const signal = new AbortController().signal;
  for (const [command, rawInput, pattern] of [
    ['memory-search', '', /Provide/], ['memory-search', 'plain text', /Invalid JSON/], ['memory-search', '{bad', /Invalid JSON/],
    ['memory-search', '{"query":"x"}', /requires question/], ['memory-read', '', /Provide/], ['memory-read', '{}', /session_id/],
    ['memory-read', '{"session_id":"root","seq":0}', /Unknown parameter/], ['memory-read', '[]', /argument object/],
  ]) {
    const result = await commands.get(command).handler({ rawInput, signal });
    assert.equal(result.kind, 'error'); assert.match(result.text, pattern); assert.ok(result.text.length < 500);
  }
  await assert.rejects(tools.get('recall_memory').execute({ query: 'x', question: 'q' }, { signal }), /Unknown parameter/);
  await assert.rejects(tools.get('fetch_session').execute({ session_id: 'root', seq: 0 }, { signal }), /Unknown parameter/);
  const cancelled = new AbortController(); cancelled.abort(new Error('cancelled by user'));
  assert.deepEqual(await commands.get('memory-search').handler({ rawInput: JSON.stringify(searchArgs), signal: cancelled.signal }), { kind: 'error', text: 'cancelled by user' });
  await dispose();
});

test('turn/end waits for persistence durability before refreshing the plugin index', async () => {
  let flushed = 0, listed = 0;
  const mounted = mount({ flush: async () => { flushed++; return true; }, list: async () => { assert.equal(flushed, 1); listed++; return [{ header, revision: Symbol('r'), eventCount: events.length }]; } });
  mounted.listeners.get('session/event')({}, { type: 'user/message' });
  assert.equal(flushed, 0); assert.equal(listed, 0);
  mounted.listeners.get('session/event')({}, { type: 'turn/end' });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(flushed, 1); assert.equal(listed, 1);
  await mounted.dispose();
});

test('help/status describe persistence-only scope without sessionQuery, legacy APIs or duplicated version text', async () => {
  const { commands, dispose } = mount();
  assert.deepEqual(commands.get('memory-help').handler({}), { kind: 'success', text: HELP });
  assert.match(HELP, /^DSH Session Memory\n/);
  assert.doesNotMatch(HELP, /\b\d+\.\d+\.\d+\b/);
  assert.match(HELP, /plugin-owned durable SQLite/);
  assert.equal(inject.includes('sessionQuery'), false);
  assert.doesNotMatch(HELP, /Compatibility|cursor|seq window/);
  assert.equal([...commands.keys()].filter(command => command === 'memory-status').length, 1);
  const status = commands.get('memory-status').handler({}).text;
  assert.doesNotMatch(status, /^DSH Session Memory/);
  const parsed = JSON.parse(status);
  assert.equal(Object.hasOwn(parsed, 'version'), false);
  assert.match(parsed.scope, /Persisted DSH main-session/);
  assert.equal(parsed.history.storage, 'plugin-owned-durable-sqlite');
  assert.ok(HELP.length < 2000);
  await dispose();
});
