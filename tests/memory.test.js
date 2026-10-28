import test from 'node:test';
import assert from 'node:assert/strict';
import { recallMemory, fetchSession, normalizeSearch, normalizeRead, isMainSession, renderSearch, renderRead } from '../src/memory.js';

const header = (id = 'root', extra = {}) => ({ id, version: 1, createdAt: 123, isSeeded: false, ...extra });
const match = (seq = 5, snippet = 'database evidence') => ({ sessionId: 'root', seq, type: 'assistant/message', time: 456, surface: 'current', snippet });
const hit = (id, extra = {}) => ({ header: header(id), live: true, persisted: false, bestMatch: match(), ...extra });
const event = (seq, text) => ({ seq, type: 'user/message', time: seq + 100, data: { role: 'user', content: [{ type: 'text', text }] } });
const window = (events = [event(5, 'target')], extra = {}) => ({ session: header(), target: events.find(e => e.seq === 5) ?? events[0], events, startSeq: events[0]?.seq ?? 5, endSeq: events.at(-1)?.seq ?? 5, inheritedEventCount: 0, ...extra });
function fake(handlers = {}) {
  const calls = [];
  const service = Object.fromEntries(['searchSessions', 'searchEvents', 'observeSession', 'readEvent', 'listSessions', 'readSession', 'traceSession'].map(name => [name, async (...args) => {
    calls.push([name, ...args]);
    if (name === 'searchSessions') {
      assert.ok(Object.hasOwn(args[0], 'sessionFilters'), 'Native searchSessions requires sessionFilters');
      assert.equal(Object.hasOwn(args[0], 'filters'), false, 'filters belongs to event search, not session search');
    }
    if (!handlers[name]) throw new Error(`Unexpected service call: ${name}`);
    return handlers[name](...args);
  }]));
  return { calls, service };
}

test('global search uses native searchSessions without implicit cwd, lineage or full-read calls', async () => {
  const { calls, service } = fake({ searchSessions: () => ({ items: [], nextCursor: 'opaque-next' }) });
  const signal = new AbortController().signal;
  const result = await recallMemory(service, { query: '  data\n base\t ', cursor: 'cursor-1', limit: 7 }, signal);
  assert.deepEqual(calls, [['searchSessions', { query: 'data base', limit: 7, cursor: 'cursor-1', sessionFilters: [] }, { signal }]]);
  assert.deepEqual(result, { source: 'dsh', query: 'data base', scope: 'all', results: [], excluded_subagent_sessions: 0, next_cursor: 'opaque-next' });
  assert.match(renderSearch(result), /repeat the same search arguments/);
});

test('cwd is an explicit exact native metadata filter; opaque cursor propagates on every page', async () => {
  const { calls, service } = fake({ searchSessions: () => ({ items: [], nextCursor: 'next-2' }) });
  const first = await recallMemory(service, { query: 'term', cwd: ' /project/not-basename ', limit: 2 });
  await recallMemory(service, { query: 'term', cwd: '/project/not-basename', limit: 2, cursor: first.next_cursor });
  assert.deepEqual(calls.map(c => c[1]), [
    { query: 'term', limit: 2, sessionFilters: [{ kind: 'cwd', values: ['/project/not-basename'] }] },
    { query: 'term', limit: 2, cursor: 'next-2', sessionFilters: [{ kind: 'cwd', values: ['/project/not-basename'] }] },
  ]);
  assert.equal(first.scope, 'cwd');
});

test('session scope calls only searchEvents with exact id, cursor and signal; root forks remain visible', async () => {
  const signal = new AbortController().signal;
  const { calls, service } = fake({ searchEvents: () => ({ session: header('exact', { parentSession: 'parent', isSeeded: true }), items: [match()], nextCursor: 'events-next' }) });
  const result = await recallMemory(service, { query: 'term', session_id: 'exact', limit: 3, cursor: 'events-current' }, signal);
  assert.deepEqual(calls, [['searchEvents', { query: 'term', limit: 3, cursor: 'events-current', sessionId: 'exact' }, { signal }]]);
  assert.equal(result.results[0].session_id, 'exact');
  assert.equal(result.results[0].cwd, null);
  assert.equal(result.scope, 'session');
  assert.equal(result.next_cursor, 'events-next');
  assert.equal('live' in result.results[0], false);
});

test('authoritative observations exclude origin and depth, retain root forks, and dispose every lease', async () => {
  const disposed = [];
  const signal = new AbortController().signal;
  const headers = {
    origin: header('origin', { origin: 'subagent' }),
    depth: header('depth', { delegationDepth: 2 }),
    fork: header('fork', { parentSession: 'parent', isSeeded: true, delegationDepth: 0, cwd: '/authoritative' }),
  };
  const { calls, service } = fake({
    searchSessions: () => ({ items: [hit('origin'), hit('depth'), hit('fork', { header: header('fork', { cwd: '/stale', origin: 'subagent' }) })], nextCursor: 'more' }),
    observeSession: id => ({ header: headers[id], [Symbol.dispose]: () => disposed.push(id) }),
  });
  const result = await recallMemory(service, { query: 'term' }, signal);
  assert.deepEqual(result.results.map(x => x.session_id), ['fork']);
  assert.equal(result.results[0].cwd, '/authoritative');
  assert.equal(result.results[0].live, true);
  assert.equal(result.excluded_subagent_sessions, 2);
  assert.equal(result.next_cursor, 'more');
  assert.deepEqual(disposed, ['origin', 'depth', 'fork']);
  assert.deepEqual(calls.slice(1), Object.keys(headers).map(id => ['observeSession', id, { signal, projectionMode: 'none' }]));
});

test('observation leases are disposed on header/snippet errors and prior leases on later observation failure', async () => {
  for (const failure of ['header', 'snippet']) {
    let disposed = 0;
    const observation = { [Symbol.dispose]: () => disposed++ };
    Object.defineProperty(observation, 'header', { get() { if (failure === 'header') throw new Error('header broken'); return header(); } });
    const { service } = fake({ searchSessions: () => ({ items: [hit('root', failure === 'snippet' ? { bestMatch: { ...match(), snippet: null } } : {})] }), observeSession: () => observation });
    await assert.rejects(recallMemory(service, { query: 'term' }));
    assert.equal(disposed, 1, failure);
  }
  const disposed = [];
  const { service } = fake({ searchSessions: () => ({ items: [hit('first'), hit('second')] }), observeSession: id => {
    if (id === 'second') throw new Error('missing session');
    return { header: header(id), [Symbol.dispose]: () => disposed.push(id) };
  } });
  await assert.rejects(recallMemory(service, { query: 'term' }), /missing session/);
  assert.deepEqual(disposed, ['first']);
});

test('origin/depth exclusion also applies to exact search and read, without excluding forks', async () => {
  assert.equal(isMainSession(header('fork', { parentSession: 'parent', isSeeded: true })), true);
  for (const extra of [{ origin: 'subagent' }, { delegationDepth: 1 }]) {
    const { service } = fake({ searchEvents: () => ({ session: header('child', extra), items: [] }), readEvent: () => window(undefined, { session: header('child', extra) }) });
    await assert.rejects(recallMemory(service, { query: 'term', session_id: 'child' }), /Subagent sessions/);
    await assert.rejects(fetchSession(service, { session_id: 'child', seq: 5 }), /Subagent sessions/);
  }
});

test('search validation rejects invalid shapes, keys, text, mixed scope and page sizes before calls', async () => {
  const { service, calls } = fake();
  const invalid = [null, [], 'query', {}, { query: '' }, { query: 'x'.repeat(1001) }, { query: 'x', limit: 0 }, { query: 'x', limit: 51 }, { query: 'x', limit: 1.2 }, { query: 'x', limit: '2' }, { query: 'x', session_id: 'a', cwd: '/a' }, { query: 'x', cursor: '' }, { query: 'x', source: 'codex' }, { query: 'x', entities: ['x'] }, { query: 'x', cwd: 3 }, { query: 'x', session_id: 's'.repeat(2001) }, { query: 'x', cwd: 'c'.repeat(4001) }, { query: 'x', cursor: 'c'.repeat(16001) }];
  for (const input of invalid) await assert.rejects(recallMemory(service, input));
  assert.deepEqual(calls, []);
  assert.deepEqual(normalizeSearch({ query: '中 文' }), { query: '中 文', limit: 20 });
  assert.equal(normalizeSearch({ query: 'x', limit: 50 }).limit, 50);
});

test('read validation rejects unsafe seq, budgets/context and migration keys before calls', async () => {
  const { service, calls } = fake();
  const invalid = [null, [], {}, { session_id: '', seq: 0 }, { session_id: 's' }, ...[-1, 0.2, Number.MAX_SAFE_INTEGER + 1, '0', null].map(seq => ({ session_id: 's', seq })), ...[{ before: -1 }, { before: 21 }, { after: 21 }, { max_chars: 99 }, { max_chars: 24001 }, { resume: true }].map(extra => ({ session_id: 's', seq: 0, ...extra }))];
  for (const input of invalid) await assert.rejects(fetchSession(service, input));
  assert.deepEqual(calls, []);
  assert.deepEqual(normalizeRead({ session_id: ' s ', seq: 0 }), { session_id: 's', seq: 0, before: 4, after: 4, max_chars: 12000 });
  assert.equal(normalizeRead({ session_id: 's', seq: Number.MAX_SAFE_INTEGER, before: 20, after: 0, max_chars: 24000 }).max_chars, 24000);
});

test('pre-aborted search/read do no backend work; post-await cancellations reject results', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled');
  controller.abort(reason);
  const { service, calls } = fake();
  await assert.rejects(recallMemory(service, { query: 'term' }, controller.signal), error => error === reason);
  await assert.rejects(fetchSession(service, { session_id: 's', seq: 5 }, controller.signal), error => error === reason);
  assert.deepEqual(calls, []);
  for (const mode of ['search', 'read', 'exact']) {
    const c = new AbortController();
    const { service: backend } = fake({ searchSessions: () => { c.abort(reason); return { items: [] }; }, searchEvents: () => { c.abort(reason); return { session: header(), items: [] }; }, readEvent: () => { c.abort(reason); return window(); } });
    const result = mode === 'read' ? fetchSession(backend, { session_id: 's', seq: 5 }, c.signal) : recallMemory(backend, { query: 'term', ...(mode === 'exact' ? { session_id: 's' } : {}) }, c.signal);
    await assert.rejects(result, error => error === reason);
  }
});

test('cancellation during authoritative observation disposes lease and prevents subsequent observation', async () => {
  const c = new AbortController();
  const reason = new Error('cancel observation');
  let disposed = 0;
  const { service, calls } = fake({ searchSessions: () => ({ items: [hit('one'), hit('two')] }), observeSession: () => {
    c.abort(reason);
    return { header: header('one'), [Symbol.dispose]: () => disposed++ };
  } });
  await assert.rejects(recallMemory(service, { query: 'term' }, c.signal), error => error === reason);
  assert.equal(disposed, 1);
  assert.equal(calls.filter(call => call[0] === 'observeSession').length, 1);
});

test('backend errors/stale cursors propagate without retrying or broadening scope', async () => {
  const error = new Error('stale cursor');
  const { service, calls } = fake({ searchEvents: () => { throw error; }, readEvent: () => { throw error; } });
  await assert.rejects(recallMemory(service, { query: 'term', session_id: 's', cursor: 'stale' }), e => e === error);
  await assert.rejects(fetchSession(service, { session_id: 's', seq: 5 }), e => e === error);
  assert.deepEqual(calls.map(c => c[0]), ['searchEvents', 'readEvent']);
});

test('readEvent receives exact raw-window request/signal and preserves inherited fork metadata', async () => {
  const signal = new AbortController().signal;
  const { service, calls } = fake({ readEvent: () => window([event(4, 'before'), event(5, 'target'), event(6, 'after')], { session: header('fork', { parentSession: 'parent', isSeeded: true }), inheritedEventCount: 4 }) });
  const result = await fetchSession(service, { session_id: 'fork', seq: 5, before: 1, after: 2, max_chars: 100 }, signal);
  assert.deepEqual(calls, [['readEvent', { sessionId: 'fork', seq: 5, before: 1, after: 2 }, signal]]);
  assert.deepEqual([result.target_seq, result.start_seq, result.end_seq, result.inherited_event_count], [5, 4, 6, 4]);
  assert.equal(result.session_id, 'fork');
  assert.equal(result.truncated, false);
  assert.match(renderRead(result), /inherited.*4/i);
});

test('budget prioritizes target then nearest preceding tie; returns ascending seq without mutation', async () => {
  const events = [event(3, 'far'), event(4, 'B'.repeat(70)), event(5, 'T'.repeat(80)), event(6, 'A'.repeat(70)), event(7, 'far')];
  const before = structuredClone(events);
  const { service } = fake({ readEvent: () => window(events) });
  const result = await fetchSession(service, { session_id: 'root', seq: 5, max_chars: 100 });
  assert.deepEqual(result.events.map(e => [e.seq, e.text.length, e.text_truncated]), [[3, 0, true], [4, 20, true], [5, 80, false], [6, 0, true], [7, 0, true]]);
  assert.equal(result.events.reduce((sum, e) => sum + e.text.length, 0), 100);
  assert.equal(result.truncated, true);
  assert.deepEqual(events, before);
});

test('search snippets/read text never split supplementary Unicode surrogate pairs', async () => {
  const { service } = fake({ searchEvents: () => ({ session: header(), items: [match(5, 'x'.repeat(499) + '😀tail')] }), readEvent: () => window([event(5, 'x'.repeat(99) + '😀tail')]) });
  const search = await recallMemory(service, { query: 'term', session_id: 'root' });
  assert.equal(search.results[0].snippet, 'x'.repeat(499));
  assert.equal(search.results[0].snippet_truncated, true);
  const read = await fetchSession(service, { session_id: 'root', seq: 5, max_chars: 100 });
  assert.equal(read.events[0].text, 'x'.repeat(99));
  assert.equal(read.events[0].text_truncated, true);
  assert.equal(read.events[0].text.isWellFormed(), true);
});

test('reasoning/replay/stream/binary/control payloads are omitted; text/tool evidence remains with explicit notice', async () => {
  const events = [
    { seq: 4, type: 'request/header', time: 1, data: { secret: 'CONTROL_SECRET' } },
    { seq: 5, type: 'assistant/message', time: 2, data: { message: { content: [
      { type: 'reasoning', text: 'REASONING_SECRET' }, { type: 'text', text: 'visible answer' },
      { type: 'tool-call', name: 'bash', arguments: '{"command":"pwd"}' },
      { type: 'file', attachment: { name: 'report.txt', bytes: 123, payload: 'BINARY_SECRET' } },
      { type: 'image', attachment: { payload: 'IMAGE_SECRET' } }, { type: 'replay', text: 'REPLAY_BLOCK_SECRET' },
    ], source: { replayState: 'REPLAY_SECRET' } }, stream: ['STREAM_SECRET'], usage: { inputTokens: 999 } } },
    { seq: 6, type: 'tool/call', time: 3, data: { name: 'read', arguments: '{"path":"source.js"}' } },
    { seq: 7, type: 'tool/result', time: 4, data: { message: { content: [{ type: 'text', text: 'visible result' }] }, meta: 'META_SECRET' } },
  ];
  const { service } = fake({ readEvent: () => window(events) });
  const result = await fetchSession(service, { session_id: 'root', seq: 5 });
  assert.equal(result.events[0].text, '');
  assert.equal(result.events[1].text, 'visible answer\n[tool call: bash] {"command":"pwd"}\n[file: report.txt]\n[image attachment]');
  assert.equal(result.events[2].text, '[tool call: read] {"path":"source.js"}');
  assert.equal(result.events[3].text, 'visible result');
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  const rendered = renderRead(result);
  assert.match(rendered, /not current instructions/);
  assert.match(rendered, /reasoning.*omitted/i);
  assert.match(rendered, /replay/);
});

test('bounded renders identify exact ids/seq, continuation, scope and truncation', async () => {
  const { service } = fake({ searchEvents: () => ({ session: header('bounded'), items: Array.from({ length: 50 }, (_, i) => match(i, 'x'.repeat(20000))), nextCursor: 'continuation' }), readEvent: () => window(Array.from({ length: 41 }, (_, i) => event(i, 'y'.repeat(30000))), { session: header('bounded'), target: event(20, 'target'), startSeq: 0, endSeq: 40 }) });
  const search = await recallMemory(service, { query: 'term', session_id: 'bounded', limit: 50 });
  const renderedSearch = renderSearch(search);
  assert.ok(search.results.every(x => x.snippet.length <= 500));
  assert.ok(renderedSearch.length < 40000);
  assert.match(renderedSearch, /Session: bounded \| seq: 0/);
  assert.match(renderedSearch, /Snippet shortened/);
  assert.match(renderedSearch, /Next cursor.*continuation/);
  const read = await fetchSession(service, { session_id: 'bounded', seq: 20, before: 20, after: 20, max_chars: 24000 });
  const renderedRead = renderRead(read);
  assert.ok(read.events.reduce((n, e) => n + e.text.length, 0) <= 24000);
  assert.ok(renderedRead.length < 35000);
  assert.match(renderedRead, /\[20\].*\(target\)/);
  assert.match(renderedRead, /Text truncated/);
});
