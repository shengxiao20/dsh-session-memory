// Optional integration smoke test: installed DSH, isolated context, no active-profile access.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recallMemory, fetchSession } from '../src/memory.js';
import * as MemoryPlugin from '../index.js';

if (!process.env.DSH_CHECKOUT) throw new Error('Set DSH_CHECKOUT to the inspected DSH installation/checkout directory.');
const requireDSH = createRequire(pathToFileURL(resolve(process.env.DSH_CHECKOUT, 'package.json')));
const load = name => import(pathToFileURL(requireDSH.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { default: Sessions } = await load('@deepseek-ai/dsh-session');
const { default: Query } = await load('@deepseek-ai/dsh-session-query-sqlite');
const { default: Tools } = await load('@deepseek-ai/dsh-tools');
const { default: Commands } = await load('@deepseek-ai/dsh-commands');
const { default: SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt');
const ctx = new Context();
const append = (session, text) => session.append('user/message', {
  id: `${session.id}-message-${session.seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' },
}, { surfaceOp: 'append' });
try {
  await ctx.plugin(Sessions);
  await ctx.plugin(Query, { path: ':memory:', openAt: 'first-search' });
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(Tools, {});
  await ctx.plugin(Commands, {});
  await ctx.plugin(MemoryPlugin);
  assert.ok(ctx.tools.get('recall_memory'));
  assert.ok(ctx.tools.get('fetch_session'));
  const main = ctx.sessions.create('memory-smoke-main', { meta: { cwd: '/fixture/project' } });
  append(main, 'database migration plan database');
  append(main, 'database connection pool');
  const other = ctx.sessions.create('memory-smoke-other', { meta: { cwd: '/fixture/other' } });
  append(other, 'database schema');
  const child = ctx.sessions.create('memory-smoke-child', { meta: { cwd: '/fixture/project', origin: 'subagent', delegationDepth: 1 } });
  append(child, 'database child transcript');
  const fork = ctx.sessions.fork(main, undefined, 'memory-smoke-fork');
  append(fork, 'database fork detail');

  const global = await recallMemory(ctx.sessionQuery, { query: 'database', limit: 50 });
  const executed = await ctx.tools.execute({ callId: 'memory-smoke-call', name: 'recall_memory', arguments: { query: 'database', session_id: null, cwd: null, limit: 50, cursor: null }, signal: new AbortController().signal });
  assert.equal(executed.isError, false, JSON.stringify(executed));
  assert.equal(executed.value.source, 'dsh');
  assert.ok(executed.content[0].text.includes('DSH session search'));
  assert.equal(global.source, 'dsh');
  assert.equal(global.excluded_subagent_sessions, 1);
  assert.deepEqual(new Set(global.results.map(x => x.session_id)), new Set([main.id, other.id, fork.id]));
  const scoped = await recallMemory(ctx.sessionQuery, { query: 'database', cwd: '/fixture/project' });
  assert.ok(scoped.results.every(x => x.cwd === '/fixture/project'), JSON.stringify(scoped));
  const first = await recallMemory(ctx.sessionQuery, { query: 'database', session_id: main.id, limit: 1 });
  assert.equal(first.results.length, 1);
  assert.ok(first.next_cursor);
  const second = await recallMemory(ctx.sessionQuery, { query: 'database', session_id: main.id, limit: 1, cursor: first.next_cursor });
  assert.notEqual(first.results[0].seq, second.results[0].seq);
  const read = await fetchSession(ctx.sessionQuery, { session_id: main.id, seq: first.results[0].seq });
  assert.ok(read.events.find(x => x.seq === read.target_seq).text.includes('database'));
  assert.ok(read.events.reduce((n, x) => n + x.text.length, 0) <= 12000);
  await assert.rejects(fetchSession(ctx.sessionQuery, { session_id: child.id, seq: 0 }), /Subagent/);
  await assert.rejects(recallMemory(ctx.sessionQuery, { query: 'database', session_id: child.id }), /Subagent/);
  append(main, 'database updated');
  await assert.rejects(recallMemory(ctx.sessionQuery, { query: 'database', session_id: main.id, limit: 1, cursor: first.next_cursor }), error => error.code === 'SESSION_QUERY_STALE_CURSOR');
  append(other, 'BRAID');
  const token = await recallMemory(ctx.sessionQuery, { query: 'AI' });
  assert.equal(token.results.length, 0);
  console.log('Native DSH smoke PASS: global/exact-CWD/event search, fork retention, subagent exclusion, pagination, bounded reads, stale cursors, token semantics.');
} finally { await ctx.fiber.dispose(); }
