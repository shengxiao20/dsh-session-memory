import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeHistoryIndex, defaultIndexPath } from '../src/history-index.js';
import { DshHistorySource } from '../src/dsh-history-source.js';
import { DatabaseSync } from 'node:sqlite';
import { ConfiguredWorkflow } from '../src/configured-workflow.js';
import { normalizeConfig } from '../src/config.js';
import { apply } from '../index.js';
const signal = () => new AbortController().signal;
const event = { type: 'user/message', seq: 0, time: 1, surfaceOp: 'append', data: { content: 'database sqlite' } };
const header = { id: 'persisted-index', cwd: '/project/sqlite', createdAt: 1, isSeeded: false };
function source() { return { listSessions: async () => [{ header, live: true, persisted: true }],
  observeSession: async () => ({ header, events: [event], [Symbol.dispose]() {} }) }; }

test('plugin-owned durable SQLite survives reopen, hashes unchanged persisted cuts and never uses Pi memory.db', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-durable-index-')), path = join(dir, 'plugin', 'history.sqlite');
  t.after(() => rm(dir, { recursive: true, force: true }));
  let index = new NativeHistoryIndex(source(), path);
  await index.synchronize(signal()); assert.equal(index.statistics().storage, 'plugin-owned-durable-sqlite');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(path + '-wal')).mode & 0o777, 0o600);
  await index.shutdown();
  index = new NativeHistoryIndex(source(), path);
  try {
    const reopened = await index.synchronize(signal()); assert.equal(reopened.unchanged, 1); assert.equal(reopened.turns, 1);
    assert.equal(index.search(['database', 'sqlite'], 1)[0].score, 2);
  } finally { await index.shutdown(); }
  assert.equal(defaultIndexPath('/user', { DSH_HOME: '/explicit/dsh' }), '/explicit/dsh/dsh-session-memory/history.sqlite');
  assert.equal(defaultIndexPath('/user', {}), '/user/.dsh/dsh-session-memory/history.sqlite');
});

test('DSH-only index refuses the withdrawn mixed-source schema without reading or deleting its rows', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-schema-refusal-')), path = join(dir, 'history.sqlite');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const old = new DatabaseSync(path);
  old.exec("PRAGMA user_version = 1; CREATE TABLE foreign_poison (text TEXT); INSERT INTO foreign_poison VALUES ('must stay unread and unchanged');");
  old.close();
  let listed = false;
  const index = new NativeHistoryIndex({ listSessions: async () => { listed = true; return []; } }, path);
  try {
    await assert.rejects(index.synchronize(signal()), /Unsupported.*schema version: 1/);
    assert.equal(listed, false); assert.equal(index.db, undefined);
    const verify = new DatabaseSync(path);
    try { assert.equal(verify.prepare('SELECT text FROM foreign_poison').get().text, 'must stay unread and unchanged'); }
    finally { verify.close(); }
  } finally { await index.shutdown(); }
});

test('public DSH persistence adapter lists, reads and closes exact stored sessions and requires a flush participant', async () => {
  let closed = 0, flushed = 0;
  const persistence = { list: async () => [{ header, revision: 'r1', eventCount: 1 }], open: async () => ({ header,
    read: async () => ({ eventState: 'owned', events: [event] }), close: async () => { closed++; } }) };
  const sessions = { get: id => id === header.id ? {} : undefined, flush: async () => { flushed++; return true; } };
  const history = new DshHistorySource(sessions, persistence);
  assert.deepEqual(await history.listSessions(signal()), [{ header, live: true, persisted: true }]);
  const observed = await history.observeSession(header.id, { signal: signal() });
  assert.deepEqual(observed.events, [event]); assert.equal(closed, 1);
  await history.flush({}); assert.equal(flushed, 1);
  sessions.flush = async () => false;
  await assert.rejects(history.flush({}), /did not participate/);
  persistence.open = async () => ({ header, read: async () => { throw new Error('bad stored log'); }, close: async () => { closed++; } });
  await assert.rejects(history.observeSession(header.id, { signal: signal() }), /bad stored log/);
  assert.equal(closed, 2);
});

test('volatile recall limit applies to entity recall and staged config errors do not silently clamp', async () => {
  const configured = new ConfiguredWorkflow(source(), { recall: { limit: 1 } });
  try {
    const first = await configured.search({ entities: ['database', 'sqlite'], question: 'question' }, signal()); assert.equal(first.limit_per_stage, 1);
    configured.reconfigure({ recall: { limit: 3 } });
    const next = await configured.search({ entities: ['database', 'sqlite'], question: 'question' }, signal()); assert.equal(next.limit_per_stage, 3);
    assert.equal(configured.status().recall.limit, 3);
    assert.throws(() => normalizeConfig({ recall: { limit: 0 } }), /1 and 50/);
  } finally { await configured.shutdown(); }
});

test('native settled-turn hook refreshes owned index without starting Jev/export, unload drains and closes database', async t => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-index-hooks-')), original = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(async () => { if (original === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = original; await rm(home, { recursive: true, force: true }); });
  const listeners = new Map(), effects = [];
  let listings = 0;
  const persistence = { list: async () => { listings++; return [{ header, revision: 'r', eventCount: 1 }]; },
    open: async () => ({ header, read: async () => ({ eventState: 'owned', events: [event] }), close: async () => {} }) };
  const sessions = { get: () => ({}), flush: async () => true };
  apply({ sessions, sessionPersistence: persistence, tools: { register: () => () => {} }, commands: { register: () => () => {} },
    effect: factory => effects.push(factory()), on: (name, callback) => listeners.set(name, callback), inject: () => {} });
  listeners.get('session/event')({}, { type: 'user/message' }); assert.equal(listings, 0);
  listeners.get('session/event')({}, { type: 'turn/end' });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(listings, 1); assert.ok((await stat(defaultIndexPath())).size > 0);
  for (const dispose of effects.toReversed()) await dispose();
});
