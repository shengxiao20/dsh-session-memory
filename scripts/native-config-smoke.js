// Real DSH Loader + Settings contract, isolated in memory; no active-profile writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as MemoryPlugin from '../index.js';

if (!process.env.DSH_CHECKOUT) throw new Error('Set DSH_CHECKOUT to an inspected DSH installation.');
const requireDSH = createRequire(pathToFileURL(resolve(process.env.DSH_CHECKOUT, 'package.json')));
const load = name => import(pathToFileURL(requireDSH.resolve(name)).href);
const { Context, Service, resolveConfig } = await load('@deepseek-ai/cordis');
const { default: Loader } = await load('@deepseek-ai/cordis-plugin-loader');
const { default: Settings } = await load('@deepseek-ai/dsh-settings');
const { default: Sessions } = await load('@deepseek-ai/dsh-session');
const { default: Agents } = await load('@deepseek-ai/dsh-agent');
const Persistence = await load('@deepseek-ai/dsh-session-persistence-jsonl');
const { default: Tools } = await load('@deepseek-ai/dsh-tools');
const { default: Commands } = await load('@deepseek-ai/dsh-commands');
const { default: SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt');
const { ClientModuleRegistry } = await load('@deepseek-ai/dsh-client-modules');
const ctx = new Context();
const dir = await mkdtemp(join(tmpdir(), 'dsh-config-contract-'));
const oldHome = process.env.HOME, oldDshHome = process.env.DSH_HOME;
process.env.HOME = dir; process.env.DSH_HOME = join(dir, '.dsh');
let writes = 0;
try {
  await ctx.plugin(Sessions);
  await ctx.plugin(Agents);
  await ctx.plugin(Persistence, { root: join(process.env.DSH_HOME, 'sessions'), compression: 'none' });
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(Tools, {});
  await ctx.plugin(Commands, {});
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(resolve('index.js')).href });
  ctx.loader.builtins.memory = MemoryPlugin;
  const id = await ctx.loader.create({ id: 'dsh-session-memory', name: './index.js', config: {} });
  await ctx.loader.await();
  const entry = ctx.loader.resolve(id);
  const original = entry.fiber;
  await ctx.plugin(context => { new Service(context, 'profileContext'); context.profileContext.home = dir; });
  // Test adapter holds the profile layer in memory; real Settings and Loader do validation/update.
  await ctx.plugin(context => {
    const service = new Service(context, 'configEditor');
    service.entries = () => [entry];
    service.configuration = () => [{ entry, inherited: {}, override: entry.options.config }];
    service.edit = async (target, change) => {
      const next = change(target.options.config, {});
      const fiber = target.fiber;
      resolveConfig(fiber.runtime, fiber.ctx.waterfall(fiber, 'internal/config', next, () => next));
      writes++;
      await ctx.loader.update(id, { config: next });
      await ctx.loader.await();
    };
  });
  await ctx.plugin(Settings);
  await ctx.registry.get(Settings).fibers[0]?.await();
  const descriptor = () => ctx.settings.describe().find(row => row.ns === id);
  assert.ok(descriptor());
  assert.equal(descriptor().autoGenerate, false);
  assert.equal(descriptor().value.jev.enabled, false);
  const revision = descriptor().revision;
  await ctx.settings.mutate(id, [
    { op: 'set', path: ['jev', 'enabled'], value: true },
    { op: 'set', path: ['jev', 'contextWindow'], value: 8192 },
  ], revision);
  assert.equal(entry.fiber, original, 'volatile update must not remount Host registrations');
  const readStatus = () => {
    const text = ctx.commands.find({}, 'memory-status').handler({}).text;
    assert.doesNotMatch(text, /^DSH Session Memory/);
    const value = JSON.parse(text);
    assert.equal(Object.hasOwn(value, 'version'), false);
    return value;
  };
  let status = readStatus();
  assert.equal(status.jev.enabled, true);
  assert.ok(['idle', 'reconfiguring'].includes(status.jev.state));
  await assert.rejects(ctx.settings.mutate(id, [{ op: 'set', path: ['jev', 'model'], value: 'stale' }], revision), error => error.code === 'SETTINGS_CONFLICT');
  const writeCount = writes;
  await assert.rejects(ctx.settings.mutate(id, [{ op: 'set', path: ['jev', 'baseURL'], value: 'https://remote.invalid' }], descriptor().revision), /apiKeyEnv/);
  assert.equal(writes, writeCount);
  assert.equal(descriptor().value.jev.baseURL, 'http://127.0.0.1:11434');
  await ctx.settings.mutate(id, [
    { op: 'set', path: ['jev', 'baseURL'], value: 'https://remote.invalid' },
    { op: 'set', path: ['jev', 'apiKeyEnv'], value: 'DSH_JEV_KEY' },
    { op: 'set', path: ['jev', 'model'], value: 'remote-explicit' },
  ], descriptor().revision);
  assert.equal(entry.fiber, original);
  assert.equal(descriptor().value.jev.apiKeyEnv, 'DSH_JEV_KEY');
  status = readStatus();
  assert.ok(['idle', 'reconfiguring'].includes(status.jev.state));
  await ctx.settings.mutate(id, [{ op: 'unset', path: ['jev'] }, { op: 'unset', path: ['obsidian'] }], descriptor().revision);
  const session = ctx.sessions.create('config-live', { meta: { cwd: '/fixture' } });
  await ctx.sessionPersistence.create(session.header);
  session.append('user/message', { id: 'config-message', role: 'user', content: [{ type: 'text', text: 'config-token history' }], source: { kind: 'user' } }, { surfaceOp: 'append' });
  await ctx.sessions.flush(session);
  const result = await ctx.tools.execute({ callId: 'config-test', name: 'recall_memory', arguments: { entities: ['config-token', 'history'], question: 'Find config history' }, signal: new AbortController().signal });
  assert.equal(result.isError, false, JSON.stringify(result));
  status = readStatus();
  assert.equal(status.jev.state, 'disabled');
  assert.equal(result.value.results.length, 1);
  await ctx.plugin(ClientModuleRegistry);
  const graph = ctx.clientModules.graph();
  const client = graph.entries.find(row => row.id === '@shengxiao04/dsh-session-memory');
  assert.ok(client, JSON.stringify(graph));
  const response = await ctx.clientModules.fetchBundle(new Request(new URL(client.url, 'http://localhost')));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /plugins.row.config/);
  await ctx.loader.remove(id);
  await ctx.loader.await();
  assert.equal(ctx.tools.get('recall_memory'), undefined);
  assert.equal(descriptor(), undefined);
  console.log('Native config PASS: real Loader/Settings volatile projection, exact row namespace, atomic mutation, revision conflict, invalid candidate rejection, explicit remote API-key-variable save without model startup, live reset/search and client artifact discovery. Profile editor is an in-memory test adapter.');
} finally {
  await ctx.fiber.dispose(); await rm(dir, { recursive: true, force: true });
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldDshHome;
}
