import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeHistoryIndex, buildDshTurns, matchesProject } from '../src/history-index.js';
import { MemoryWorkflow } from '../src/workflow.js';
import { ConfiguredWorkflow } from '../src/configured-workflow.js';
import { recallEntities, normalizeEntitySearch } from '../src/entity-recall.js';

const user = (seq, text, time = seq + 100) => ({ seq, time, type: 'user/message', data: { role: 'user', content: [{ type: 'text', text }] } });
const reply = (seq, text) => ({ seq, time: seq + 100, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text }] } } });
function corpus() {
  let released = 0;
  const sessions = new Map([
    ['global', { header: { id: 'global', cwd: '/work/other', createdAt: 10 }, events: [user(0, 'database sqlite', 300), reply(1, 'database database database'), user(2, 'database only', 400)] }],
    ['project', { header: { id: 'project', cwd: '/work/sqlite-database', createdAt: 20 }, events: [user(0, 'database sqlite', 200), reply(1, 'sqlite selected')] }],
    ['child', { header: { id: 'child', cwd: '/work/sqlite-database', createdAt: 30, origin: 'subagent' }, events: [user(0, 'database sqlite', 500)] }],
  ]);
  const service = {
    async listSessions(signal) { signal.throwIfAborted(); return [...sessions.values()].map(({ header }) => ({ header, live: true, persisted: false })); },
    async observeSession(id, { signal }) { signal.throwIfAborted(); return { ...sessions.get(id), [Symbol.dispose]() { released++; } }; },
  };
  return { sessions, service, releases: () => released };
}
const signal = () => new AbortController().signal;

test('native turn builder owns visible assistants, stable indices and exact raw seq ranges', () => {
  const events = [user(0, 'first'), reply(1, 'answer'), { seq: 2, time: 102, type: 'tool/call', data: { name: 'read' } },
    { seq: 3, time: 103, type: 'user/message', data: { content: [{ type: 'image' }] } }, reply(4, 'image answer'), user(5, 'last')];
  const turns = buildDshTurns('s', events);
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map(turn => [turn.turn_id, turn.turn_index, turn.seq, turn.end_seq]), [['dsh:s:0', 0, 0, 2], ['dsh:s:5', 2, 5, 5]]);
  assert.deepEqual(buildDshTurns('replacement', [user(0, 'original'), { ...user(1, 'model-only replacement'), surfaceOp: { op: 'replace', from: 0, to: 0 } }, reply(2, 'answer')]).map(turn => turn.user_text), ['original']);
  assert.equal(turns[0].reply_text, 'answer');
  assert.equal(turns[0].tool_names, '["read"]');
  assert.throws(() => buildDshTurns('s', [user(0, 'x'), { ...reply(1, 'x'), data: { message: { content: [{ type: 'text', text: 4 }] } } }]), /Invalid text/);
});

test('project discovery matches normalized basename sequences, not path parents/current cwd or substrings', () => {
  assert.equal(matchesProject('C:\\work\\pi-session-memory\\', ['session memory', 'database']), true);
  assert.equal(matchesProject('/sqlite/another', ['sqlite', 'database']), false);
  assert.equal(matchesProject('/work/wildcard', ['card', 'database']), false);
  assert.equal(matchesProject('/work/记忆-检索', ['记忆 检索', '数据库']), true);
});

test('entity arguments require distinct literals and forbid query/scope/cursor mixing', () => {
  assert.deepEqual(normalizeEntitySearch({ entities: [' SQLite ', 'DATABASE', 'sqlite'], limit: 1 }), { entities: ['sqlite', 'database'], limit: 1 });
  for (const input of [{ entities: ['x', 'X'] }, { entities: ['x'] }, { entities: ['x', 'y'], cwd: '/tmp' }, { entities: ['x', 'y'], query: 'x' }, { entities: ['x', 'y'], cursor: 'x' }, { entities: ['!', '.'] }]) assert.throws(() => normalizeEntitySearch(input));
});

test('SQLite substring OR ranking counts distinct entities once, then timestamp, and refreshes changed history', async () => {
  const { service, sessions, releases } = corpus();
  const index = new NativeHistoryIndex(service);
  try {
    assert.equal(index.db, undefined);
    const first = await index.synchronize(signal());
    assert.equal(first.sessions, 2); assert.equal(first.turns, 3); assert.equal(first.indexed, 2); assert.equal(first.excluded_subagent_sessions, 1);
    assert.equal(releases(), 3);
    assert.deepEqual(index.search(['database', 'sqlite'], 20).map(turn => [turn.turn_id, turn.score]), [['dsh:global:0', 2], ['dsh:project:0', 2], ['dsh:global:2', 1]]);
    assert.equal((await index.synchronize(signal())).unchanged, 2);
    // Same event count/seq, different replay bytes must not be mistaken for unchanged.
    sessions.get('global').events[0] = user(0, 'replayed decision', 300);
    assert.equal((await index.synchronize(signal())).indexed, 1);
    assert.equal(index.search(['sqlite', 'database'], 20)[0].turn_id, 'dsh:project:0');
    sessions.delete('project');
    assert.equal((await index.synchronize(signal())).removed, 1);
    assert.equal(index.statistics().sessions, 1);
  } finally { await index.shutdown(); }
});

test('incremental refresh rolls back atomically and releases leases after bad content or cancellation', async () => {
  const { service, sessions, releases } = corpus();
  const index = new NativeHistoryIndex(service);
  try {
    await index.synchronize(signal());
    sessions.get('global').events[0] = user(0, 'changed');
    sessions.get('project').events[0] = { ...user(0, 'bad'), data: { content: 7 } };
    await assert.rejects(index.synchronize(signal()), /Invalid conversation content/);
    assert.equal(index.read('global', 0, 0).turns[0].user_text, 'database sqlite');
    assert.equal(releases(), 5);
    sessions.get('project').events[0] = user(0, 'restored');
    assert.equal((await index.synchronize(signal())).indexed, 2);
    const controller = new AbortController(); controller.abort(new Error('cancelled index'));
    await assert.rejects(index.synchronize(controller.signal), /cancelled index/);
    assert.equal(index.statistics().turns, 3);
  } finally { await index.shutdown(); }
});

test('ordinary recall judges serial stages and deduplicates only global actually-retained IDs; audit unions first', async () => {
  const { service } = corpus();
  const index = new NativeHistoryIndex(service);
  try {
    await index.synchronize(signal());
    const calls = [];
    const judge = async turns => {
      calls.push(turns.map(turn => turn.turn_id));
      const rejected = calls.length === 1 ? turns.filter(turn => turn.session_id === 'project') : [];
      return { results: turns.filter(turn => !rejected.includes(turn)), filteredOut: rejected, stats: { status: 'filtered' } };
    };
    const value = await recallEntities(index, { entities: ['database', 'sqlite'], limit: 2 }, 'previous decision?', judge, signal());
    assert.deepEqual(calls, [['dsh:global:0', 'dsh:project:0'], ['dsh:project:0']]);
    assert.deepEqual(value.results.map(turn => turn.turn_id), ['dsh:global:0', 'dsh:project:0']);
    assert.equal(value.project.duplicates_removed, 0);
    const auditCalls = [];
    const audit = await recallEntities(index, { entities: ['database', 'sqlite'], limit: 2 }, 'previous decision?', async turns => {
      auditCalls.push(turns.map(turn => turn.turn_id));
      return { results: [], filteredOut: turns, stats: { status: 'filtered' } };
    }, signal(), true);
    assert.deepEqual(auditCalls, [['dsh:global:0', 'dsh:project:0']]);
    assert.equal(audit.project.duplicates_removed, 1); assert.equal(audit.results.length, 2);
  } finally { await index.shutdown(); }
});

test('workflow routes entities through turn index; bounded read, stats and explicit backfill share it', async () => {
  const { service } = corpus();
  const workflow = new MemoryWorkflow(service, {});
  try {
    await assert.rejects(workflow.search({ entities: ['database', 'sqlite'] }, signal()), /requires question/);
    const value = await workflow.search({ entities: ['database', 'sqlite'], question: 'What was selected?', limit: 1 }, signal());
    assert.equal(value.global.results[0].turn_id, 'dsh:global:0');
    assert.equal(value.project.results[0].turn_id, 'dsh:project:0');
    assert.equal(value.retrieval_unit, 'turn'); assert.equal(value.global.jev.status, 'disabled');
    const read = await workflow.read({ session_id: 'global', from_turn_index: 0, to_turn_index: 0, max_chars: 100 }, signal());
    assert.equal(read.turns[0].reply_text, 'database database database'); assert.equal(read.read_mode, 'turns');
    assert.equal((await workflow.statistics({}, signal())).turns, 3);
    assert.equal((await workflow.backfill({}, signal())).indexed, 2);
    await assert.rejects(workflow.statistics({ cwd: '/tmp' }, signal()), /empty argument/);
    await assert.rejects(workflow.read({ session_id: 'global', from_turn_index: 0, to_turn_index: 21 }, signal()), /at most 20/);
  } finally { await workflow.shutdown(); }
});

test('live Jev reconfiguration reuses the context-owned turn index and disposes it only at plugin shutdown', async () => {
  const { service } = corpus();
  const configured = new ConfiguredWorkflow(service, {});
  await configured.statistics({}, signal());
  const db = configured.index.db;
  configured.reconfigure({ jev: { model: 'other' } });
  await configured.statistics({}, signal());
  assert.equal(configured.index.db, db); assert.equal(configured.current.index.db, db);
  await configured.shutdown();
  assert.equal(configured.index.db, undefined);
});

test('project stage waits for a concurrent source transaction instead of reading half-rebuilt tables', async () => {
  const { service, sessions } = corpus();
  const index = new NativeHistoryIndex(service);
  let releaseSync, releaseJudge, enteredSync;
  const syncing = new Promise(resolve => { enteredSync = resolve; });
  const syncGate = new Promise(resolve => { releaseSync = resolve; });
  const judgeGate = new Promise(resolve => { releaseJudge = resolve; });
  try {
    await index.synchronize(signal());
    let calls = 0;
    const recall = recallEntities(index, { entities: ['database', 'sqlite'], limit: 2 }, 'question', async turns => {
      calls++;
      if (calls === 1) await judgeGate;
      return { results: turns, filteredOut: [], stats: { status: 'disabled' } };
    }, signal());
    await new Promise(resolve => setImmediate(resolve));
    sessions.get('global').events[0] = user(0, 'changed database');
    const observe = service.observeSession;
    service.observeSession = async (...args) => {
      if (args[0] === 'project') { enteredSync(); await syncGate; }
      return observe(...args);
    };
    const refresh = index.synchronize(signal());
    await syncing;
    releaseJudge();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1, 'project must not inspect the still-open source transaction');
    releaseSync();
    await refresh; await recall;
    assert.equal(calls, 2);
  } finally { releaseJudge?.(); releaseSync?.(); await index.shutdown(); }
});

test('project-name-only discovery exposes bounded exact session candidates even with no literal transcript hit', async () => {
  const { service, sessions } = corpus();
  sessions.get('project').events = [user(0, 'unrelated discussion '.repeat(100))];
  const workflow = new MemoryWorkflow(service, {});
  try {
    const result = await workflow.search({ entities: ['sqlite-database', 'missing-literal'], question: 'Find that project' }, signal());
    assert.equal(result.project.results.length, 0);
    assert.equal(result.project.matched_sessions, 1);
    assert.equal(result.project.sessions[0].session_id, 'project');
    assert.equal(result.project.sessions[0].turn_count, 1);
    assert.ok(result.project.sessions[0].first_user_text.length <= 500);
  } finally { await workflow.shutdown(); }
});
