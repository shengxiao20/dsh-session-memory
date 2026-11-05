// Installed DSH integration smoke: public persistence services only, isolated HOME.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as MemoryPlugin from '../index.js';

if (!process.env.DSH_CHECKOUT) throw new Error('Set DSH_CHECKOUT to the inspected DSH installation/checkout directory.');
const requireDSH = createRequire(pathToFileURL(resolve(process.env.DSH_CHECKOUT, 'package.json')));
const load = name => import(pathToFileURL(requireDSH.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { default: Sessions } = await load('@deepseek-ai/dsh-session');
const { default: Agents } = await load('@deepseek-ai/dsh-agent');
const Persistence = await load('@deepseek-ai/dsh-session-persistence-jsonl');
const { default: SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt');
const { default: Tools } = await load('@deepseek-ai/dsh-tools');
const ctx = new Context();
const vaultPath = await mkdtemp(join(tmpdir(), 'dsh-native-memory-'));
const originalHome = process.env.HOME, originalDshHome = process.env.DSH_HOME;
process.env.DSH_HOME = join(vaultPath, '.dsh'); process.env.HOME = vaultPath;
const requests = [];
const localServer = createServer(async (req, res) => {
  let text = ''; for await (const part of req) text += part;
  const payload = JSON.parse(text); requests.push([req.url, payload]);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ answers: Object.fromEntries(Object.entries(payload.questions).map(([key, value]) => [key, { type: 'noul', noul: value.instructions.includes('KEEP') ? 0.8 : 0.2 }])) }));
});
localServer.listen(0, '127.0.0.1'); await once(localServer, 'listening');
const create = async (id, cwd, extra = {}) => {
  const session = ctx.sessions.create(id, { meta: { cwd, ...extra } });
  await ctx.sessionPersistence.create(session.header);
  return session;
};
const append = (session, text) => session.append('user/message', {
  id: `${session.id}-message-${session.seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' },
}, { surfaceOp: 'append' });
const flush = (...sessions) => Promise.all(sessions.map(session => ctx.sessions.flush(session)));
try {
  await ctx.plugin(Sessions);
  await ctx.plugin(Agents);
  await ctx.plugin(Persistence, { root: join(process.env.DSH_HOME, 'sessions'), compression: 'none' });
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(Tools, {});
  assert.deepEqual(MemoryPlugin.inject, ['sessions', 'sessionPersistence', 'agents', 'tools']);
  const baselinePlugin = ctx.plugin(MemoryPlugin); await baselinePlugin;
  for (const name of ['recall_memory', 'discuss_memory', 'review_jev_filtered', 'fetch_session', 'get_memory_stats', 'backfill_memory']) assert.ok(ctx.tools.get(name));

  const main = await create('memory-smoke-main', '/fixture/project');
  append(main, 'database sqlite migration plan'); append(main, 'database connection pool');
  const other = await create('memory-smoke-other', '/fixture/other');
  append(other, 'BRAID AI database schema');
  const child = await create('memory-smoke-child', '/fixture/project', { origin: 'subagent', delegationDepth: 1 });
  append(child, 'database sqlite child transcript');
  await flush(main, other, child);

  const entityArgs = { entities: ['AI', 'BRAID'], question: 'Where did we discuss BRAID?', limit: 3 };
  const entities = await ctx.tools.execute({ callId: 'native-entities', name: 'recall_memory', arguments: entityArgs, signal: new AbortController().signal });
  assert.equal(entities.isError, false, JSON.stringify(entities));
  assert.equal(entities.value.results.length, 1, JSON.stringify(entities.value));
  assert.equal(entities.value.retrieval_unit, 'turn'); assert.equal(entities.value.results[0].score, 2);
  assert.equal(entities.value.results[0].session_id, other.id);
  assert.ok(entities.value.results.every(turn => turn.session_id !== child.id));
  const turnRead = await ctx.tools.execute({ callId: 'native-turn-read', name: 'fetch_session', arguments: {
    session_id: other.id, from_turn_index: entities.value.results[0].turn_index, to_turn_index: entities.value.results[0].turn_index,
  }, signal: new AbortController().signal });
  assert.equal(turnRead.isError, false, JSON.stringify(turnRead)); assert.equal(turnRead.value.turns[0].user_text, 'BRAID AI database schema');
  assert.match(turnRead.content[0].text, /inclusive turns/);
  const removedLegacy = await ctx.tools.execute({ callId: 'removed-query', name: 'recall_memory', arguments: { query: 'database', question: 'q' }, signal: new AbortController().signal });
  assert.equal(removedLegacy.isError, true); assert.match(removedLegacy.content[0].text, /Unknown parameter/);

  for (const name of ['get_memory_stats', 'backfill_memory']) {
    const output = await ctx.tools.execute({ callId: `native-${name}`, name, arguments: {}, signal: new AbortController().signal });
    assert.equal(output.isError, false, JSON.stringify(output)); assert.equal(output.value.sessions, 2); assert.equal(output.value.excluded_subagent_sessions, 1);
    assert.ok(output.value.turns >= 3); assert.equal(output.value.storage, 'plugin-owned-durable-sqlite');
  }
  const extraProject = await create('memory-smoke-project-entities', '/fixture/database'); append(extraProject, 'database archived project');
  const extraGlobal = await create('memory-smoke-global-entities', '/fixture/unrelated'); append(extraGlobal, 'database shared global decision');
  await flush(extraProject, extraGlobal);
  const staged = await ctx.tools.execute({ callId: 'native-serial-project', name: 'recall_memory', arguments: { entities: ['database', 'shared'], question: 'What database work?', limit: 1 }, signal: new AbortController().signal });
  assert.equal(staged.isError, false, JSON.stringify(staged)); assert.equal(staged.value.global.results[0].session_id, extraGlobal.id); assert.equal(staged.value.project.results[0].session_id, extraProject.id);

  const poison = 'FOREIGN_ONLY_TOKEN sqlite';
  const foreignPaths = ['.pi/agent/sessions', '.claude/projects', '.codex/sessions'].map(root => join(vaultPath, root, 'poison.jsonl'));
  for (const path of foreignPaths) { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, `${poison}\nnot-valid-jsonl`); }
  const isolated = await ctx.tools.execute({ callId: 'native-dsh-only', name: 'recall_memory', arguments: { entities: ['FOREIGN_ONLY_TOKEN', 'NEVER_DSH_TOKEN'], question: 'Do foreign files leak?' }, signal: new AbortController().signal });
  assert.equal(isolated.isError, false, JSON.stringify(isolated)); assert.equal(isolated.value.results.length, 0);
  for (const path of foreignPaths) assert.equal(await readFile(path, 'utf8'), `${poison}\nnot-valid-jsonl`);
  for (const directory of ['.pi', '.claude', '.codex']) await rm(join(vaultPath, directory), { recursive: true });

  await baselinePlugin.dispose(); assert.equal(ctx.tools.get('recall_memory'), undefined);
  const configuredPlugin = ctx.plugin(MemoryPlugin, { jev: { enabled: true, baseURL: `http://127.0.0.1:${localServer.address().port}`, contextWindow: 8192 }, obsidian: { enabled: true, vaultPath } });
  await configuredPlugin;
  const evidence = await create('memory-native-jev', '/fixture/jev');
  append(evidence, 'audit-token KEEP database decision'); append(evidence, 'audit-token DROP unrelated note'); await flush(evidence);
  const args = { entities: ['audit-token', 'database'], question: 'What database decision did we make?', limit: 2 };
  const call = name => ctx.tools.execute({ callId: `native-${name}`, name, arguments: args, signal: new AbortController().signal });
  const retained = await call('recall_memory'), rejected = await call('review_jev_filtered');
  for (const output of [retained, rejected]) assert.equal(output.isError, false, JSON.stringify(output));
  assert.equal(retained.value.results.length, 1, JSON.stringify({value: retained.value, requests})); assert.equal(retained.value.results[0].noul, 0.8);
  assert.ok(rejected.value.results.length >= 1); assert.ok(rejected.value.results.every(result => result.noul === 0.2)); assert.ok(rejected.value.results.some(result => result.user_text.includes('DROP'))); assert.equal(rejected.value.mode, 'filtered-out');
  assert.notEqual(retained.value.export_path, rejected.value.export_path); assert.match(await readFile(rejected.value.export_path, 'utf8'), /max noul: 0.2/);
  assert.equal(requests.length, 3); assert.ok(requests.every(([url, payload]) => url === '/v1/systemone' && payload.model === 'nimble'));
  assert.equal((await readdir(vaultPath)).filter(file => file.endsWith('.md')).length, 2);
  await configuredPlugin.dispose();
  console.log('Native DSH smoke PASS: public sessionPersistence only (no sessionQuery/FTS), durability barriers, plugin-owned SQLite turn recall/read/stats/backfill, project dedup, foreign-root isolation, Jev/Obsidian and unload. Local classifier is a fixture.');
} finally {
  await ctx.fiber.dispose(); await new Promise(resolve => { localServer.close(resolve); localServer.closeAllConnections(); });
  await rm(vaultPath, { recursive: true, force: true });
  if (originalDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalDshHome;
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
}
