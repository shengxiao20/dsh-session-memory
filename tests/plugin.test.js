import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, inject, name } from '../index.js';
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
  const tools = new Map(), effects = [], removed = [], listeners = new Map();
  const register = (map, kind) => definition => {
    assert.equal(map.has(definition.name), false);
    map.set(definition.name, definition);
    let disposed = false;
    return () => { if (!disposed) { map.delete(definition.name); removed.push(`${kind}:${definition.name}`); disposed = true; } };
  };
  const host = services(overrides);
  apply({ sessions: host.sessions, sessionPersistence: host.persistence,
    agents: { create: async () => { throw new Error('Unexpected Discussion model call in plugin contract test.'); } },
    tools: { register: register(tools, 'tool') },
    on: (event, listener) => listeners.set(event, listener), inject: () => {},
    effect: factory => { const dispose = factory(); assert.equal(typeof dispose, 'function'); effects.push(dispose); } }, config);
  return { tools, effects, removed, listeners, ...host, dispose: async () => { for (const dispose of effects.toReversed()) await dispose(); } };
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

test('bundle requires DSH persistence contracts and owns tool registrations plus runtime cleanup effects', async () => {
  assert.equal(name, 'dsh-session-memory');
  assert.deepEqual(inject, ['sessions', 'sessionPersistence', 'agents', 'tools']);
  const mounted = mount();
  assert.deepEqual([...mounted.tools.keys()], ['recall_memory', 'discuss_memory', 'review_jev_filtered', 'fetch_session', 'get_memory_stats', 'backfill_memory']);
  assert.equal(mounted.effects.length, 7);
  for (const definition of mounted.tools.values()) assert.ok(definition.description.trim());
  await mounted.dispose(); await mounted.dispose();
  assert.equal(mounted.tools.size, 0); assert.equal(mounted.removed.length, 6);
});

test('Plugin Manager Discussion switch gates calls and applies live', async () => {
  const config = {};
  const mounted = mount({}, config);
  const args = { participants: [{ session_id: 'root', from_turn_index: 0, to_turn_index: 0 }], question: 'Which database?' };
  const exec = { agent: { session: { id: 'current', header: {} }, options: { provider: 'fixture', model: 'fixture' } } };
  await assert.rejects(mounted.tools.get('discuss_memory').execute(args, exec), /disabled.*Plugin Manager/i);

  config.discussion = { enabled: true };
  mounted.listeners.get('loader/volatile-update')();
  await assert.rejects(mounted.tools.get('discuss_memory').execute(args, exec), /Unexpected Discussion model call/);

  config.discussion.enabled = false;
  mounted.listeners.get('loader/volatile-update')();
  await assert.rejects(mounted.tools.get('discuss_memory').execute(args, exec), /disabled.*Plugin Manager/i);
  await mounted.dispose();
});

test('tool schemas expose bounded DSH recall, Discussion and source-read inputs without legacy fields', () => {
  const { tools, dispose } = mount();
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
  dispose();
});

test('tools use persisted entity search and source reads with exact turn coordinates', async () => {
  const { tools, dispose } = mount();
  const signal = new AbortController().signal;
  const searchValue = await tools.get('recall_memory').execute(searchArgs, { signal });
  validate(searchOutput, searchValue);
  assert.equal(searchValue.results[0].turn_id, 'dsh:root:0');
  const readValue = await tools.get('fetch_session').execute(readArgs, { signal });
  validate(readOutput, readValue);
  assert.equal(readValue.turns[0].seq, 0); assert.equal(readValue.turns[0].end_seq, 1);
  await dispose();
});

test('every tool render appends a redacted invocation-time config snapshot', async () => {
  const { tools, dispose } = mount();
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
    assert.match(content[1].text, /^Config · Discussion=off · Jev=off \(nimble; disabled\) · Obsidian=off · manageOllama=off · limit=20\nEnv · DSH_HOME=(?:set|unset) · API key=local-placeholder$/);
    assert.doesNotMatch(content[1].text, /history\.sqlite|vaultPath|baseURL/);
  }
  await dispose();
});

test('tools reject removed legacy query and seq fields and preserve caller cancellation', async () => {
  const { tools, dispose } = mount();
  const signal = new AbortController().signal;
  await assert.rejects(tools.get('recall_memory').execute({ query: 'x', question: 'q' }, { signal }), /Unknown parameter/);
  await assert.rejects(tools.get('fetch_session').execute({ session_id: 'root', seq: 0 }, { signal }), /Unknown parameter/);
  const cancelled = new AbortController(); cancelled.abort(new Error('cancelled by user'));
  await assert.rejects(tools.get('recall_memory').execute(searchArgs, { signal: cancelled.signal }), /cancelled by user/);
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

test('surface is tool-only and excludes legacy command and sessionQuery dependencies', async () => {
  const { tools, dispose } = mount();
  assert.equal(inject.includes('commands'), false);
  assert.equal(inject.includes('sessionQuery'), false);
  assert.equal(tools.has('discuss_memory'), true);
  for (const command of ['memory-search', 'memory-review', 'memory-read', 'memory-stats', 'memory-backfill', 'memory-status', 'memory-help', 'memory-discuss']) {
    assert.equal(tools.has(command), false);
  }
  await dispose();
});
