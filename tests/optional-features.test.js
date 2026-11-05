import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config, localRoot, normalizeConfig } from '../src/config.js';
import { filterWithJev } from '../src/jev-filter.js';
import { LocalJevRuntime } from '../src/jev-runtime.js';
import { MemoryWorkflow } from '../src/workflow.js';
import { exportSearch } from '../src/obsidian-export.js';

async function server(t, handler) {
  const instance = createServer(handler);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(() => new Promise(resolve => { instance.close(resolve); instance.closeAllConnections(); }));
  return `http://127.0.0.1:${instance.address().port}`;
}
function json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
async function body(req) { let text = ''; for await (const part of req) text += part; return JSON.parse(text); }
function hit(seq, text = 'history') { return { session_id: 'root', seq, turn_index: seq, type: 'user/message', snippet: text, user_text: text, reply_text: '' }; }
function fakeRuntime(contextWindow, answer) {
  const controller = new AbortController();
  return { contextWindow, config: { enabled: true, model: 'nimble' }, credentials: () => 'ollama', state: 'idle', ready: async () => {}, signal: signal => signal ?? controller.signal, client: { systemOne: answer } };
}
async function vault(t) { const path = await mkdtemp(join(tmpdir(), 'dsh-memory-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }
function historySource(texts = ['history database']) {
  const header = { id: 'root', cwd: '/project/history', createdAt: 1, isSeeded: false };
  const events = texts.map((text, index) => ({ seq: index, time: index + 1, type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text }] } }));
  return { listSessions: async () => [{ header, live: false, persisted: true }], observeSession: async () => ({ header, events, [Symbol.dispose]() {} }) };
}

test('config schema supplies safe defaults and strict normalization rejects invalid settings', () => {
  const defaults = normalizeConfig(Config({}));
  assert.equal(defaults.jev.enabled, false);
  assert.equal(defaults.jev.manageOllama, false);
  assert.equal(defaults.obsidian.enabled, false);
  assert.ok(Object.isFrozen(defaults.jev));
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) assert.equal(localRoot(`http://${host}:11434/`), `http://${host}:11434`);
  for (const url of ['https://127.0.0.1', 'http://example.com', 'http://127.0.0.1/v1', 'http://user:pass@localhost', 'http://localhost?x=1', 'http://localhost/#x']) assert.throws(() => localRoot(url), /local HTTP loopback/);
  for (const config of [{ other: true }, { jev: null }, { jev: { apiKeyEnv: 'not an env name' } }, { jev: { enabled: 'yes' } }, { jev: { model: '' } }, { jev: { contextWindow: 1023 } }, { jev: { contextWindow: 2048.5 } }, { obsidian: { vaultPath: 'relative' } }]) assert.throws(() => normalizeConfig(config));
  assert.throws(() => normalizeConfig({ jev: { enabled: true } }), /explicit contextWindow/);
  assert.throws(() => normalizeConfig({ obsidian: { enabled: true } }), /absolute vaultPath/);
});

test('Jev preserves order, takes segment maxima, applies inclusive threshold and budgets escaped UTF-8 JSON', async () => {
  const requests = [];
  const runtime = fakeRuntime(2048, async request => {
    requests.push(request);
    return { answers: Object.fromEntries(Object.entries(request.questions).map(([key, value]) => [key, { noul: value.instructions.includes('KEEP') ? 0.8 : value.instructions.includes('EDGE') ? 0.5 : 0.2 }])) };
  });
  const candidates = [hit(1, 'DROP'), hit(2, '汉😀"\\\n'.repeat(300) + 'KEEP'), hit(3, 'EDGE')];
  const result = await filterWithJev(runtime, 'What decision was made?', candidates);
  assert.deepEqual(result.results.map(x => [x.seq, x.noul]), [[2, 0.8], [3, 0.5]]);
  assert.deepEqual(result.filteredOut.map(x => x.seq), [1]);
  assert.equal(result.stats.segmented, 1);
  assert.equal(result.stats.reviewed, 3);
  assert.equal(result.stats.evidence, 'source-turns');
  assert.ok(requests.length > 1);
  for (const request of requests) {
    assert.ok(Buffer.byteLength(JSON.stringify(request)) <= 1792);
    assert.equal(request.model, 'nimble');
    assert.equal(request.state.userQuestion, 'What decision was made?');
    assert.match(request.state.notice, /untrusted historical data/);
    assert.ok(!JSON.stringify(request).includes('\\ud83d"'));
  }
  assert.equal(candidates[0].noul, undefined);
});

test('Jev rejects invalid/missing answers, exhausted budgets and API errors without literal fallback', async () => {
  for (const score of [undefined, '0.9', NaN, Infinity, -0.1, 1.1]) {
    await assert.rejects(filterWithJev(fakeRuntime(4096, async () => ({ answers: { item_0: { noul: score } } })), 'question', [hit(1)]), /Invalid Jev noul/);
  }
  await assert.rejects(filterWithJev(fakeRuntime(4096, async () => { throw new Error('model failed'); }), 'question', [hit(1)]), /model failed/);
  await assert.rejects(filterWithJev(fakeRuntime(1024, async () => { assert.fail('must not call'); }), '长'.repeat(1000), [hit(1)]), /insufficient evidence budget/);
  const c = new AbortController();
  const runtime = fakeRuntime(4096, async () => { c.abort(new Error('cancelled')); return { answers: { item_0: { noul: 0.9 } } }; });
  await assert.rejects(filterWithJev(runtime, 'question', [hit(1)], c.signal), /cancelled/);
  const empty = await filterWithJev(fakeRuntime(4096, async () => assert.fail('empty page')), 'question', []);
  assert.equal(empty.stats.reviewed, 0);
});

test('real SDK uses only explicit loopback /v1/systemone model and bearer key; disabled runtime does no work', async t => {
  const requests = [];
  const baseURL = await server(t, async (req, res) => {
    const value = await body(req); requests.push([req.url, req.headers.authorization, value]);
    json(res, { answers: Object.fromEntries(Object.keys(value.questions).map(key => [key, { type: 'noul', noul: 0.75 }])) });
  });
  const runtime = new LocalJevRuntime(normalizeConfig({ jev: { enabled: true, baseURL, contextWindow: 4096 } }).jev);
  t.after(() => runtime.shutdown());
  const result = await filterWithJev(runtime, 'complete question', [hit(1)]);
  assert.equal(result.results[0].noul, 0.75);
  assert.equal(runtime.state, 'ready');
  assert.equal(runtime.children.size, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/v1/systemone');
  assert.equal(requests[0][1], 'Bearer ollama');
  assert.equal(requests[0][2].model, 'nimble');
  const disabled = new LocalJevRuntime(normalizeConfig().jev);
  await assert.rejects(disabled.ready(), /disabled/);
  await disabled.shutdown();
  assert.equal(disabled.state, 'disposed');
});

test('SDK rejects redirects and HTTP errors, never retries nor exposes an unfiltered success', async t => {
  let forwarded = 0, attempts = 0;
  const target = await server(t, (_req, res) => { forwarded++; json(res, {}); });
  const baseURL = await server(t, (_req, res) => { attempts++; res.writeHead(302, { Location: target }); res.end(); });
  const runtime = new LocalJevRuntime(normalizeConfig({ jev: { enabled: true, baseURL, contextWindow: 4096 } }).jev);
  t.after(() => runtime.shutdown());
  await assert.rejects(filterWithJev(runtime, 'question', [hit(1)]));
  assert.equal(forwarded, 0);
  assert.equal(attempts, 1);
  const failedURL = await server(t, (_req, res) => { attempts++; json(res, { error: 'unavailable' }, 503); });
  const failed = new LocalJevRuntime(normalizeConfig({ jev: { enabled: true, baseURL: failedURL, contextWindow: 4096 } }).jev);
  t.after(() => failed.shutdown());
  await assert.rejects(filterWithJev(failed, 'question', [hit(1)]));
  assert.equal(attempts, 2);
});

test('managed runtime reuses service, checks version/pull/context, and propagates probe/startup failures', async t => {
  const seen = [];
  const baseURL = await server(t, async (req, res) => {
    seen.push(req.url);
    if (req.url === '/api/tags') json(res, {});
    else { assert.equal((await body(req)).model, 'nimble'); json(res, { parameters: 'temperature 0\nnum_ctx 8192\n' }); }
  });
  const runtime = new LocalJevRuntime(normalizeConfig({ jev: { enabled: true, manageOllama: true, baseURL, contextWindow: 4096 } }).jev);
  const commands = [];
  runtime.run = async args => { commands.push(args); return args[0] === '--version' ? 'ollama version is 0.35.0' : ''; };
  runtime.spawnServer = () => assert.fail('must not start existing server');
  await runtime.ready();
  assert.deepEqual(commands, [['--version'], ['pull', 'nimble']]);
  assert.deepEqual(seen, ['/api/tags', '/api/show']);
  assert.equal(runtime.contextWindow, 4096);
  await runtime.shutdown();
  const old = new LocalJevRuntime(normalizeConfig({ jev: { enabled: true, manageOllama: true, baseURL } }).jev);
  old.run = async () => '0.34.9';
  await assert.rejects(old.ready(), /0.35.0/);
  assert.equal(old.state, 'failed');
  await old.shutdown();
  const probe = new LocalJevRuntime(normalizeConfig({ jev: { enabled: true, manageOllama: true, baseURL } }).jev);
  const startupCalls = [];
  probe.healthy = async () => { startupCalls.push('probe'); return startupCalls.filter(x => x === 'probe').length > 1; };
  probe.spawnServer = async () => startupCalls.push('spawn');
  probe.run = async args => { startupCalls.push(args[0]); return args[0] === '--version' ? '1.0.0' : ''; };
  await probe.ready();
  assert.deepEqual(startupCalls, ['probe', 'spawn', 'probe', '--version', 'pull']);
  assert.equal(probe.contextWindow, 8192);
  await probe.shutdown();
  const noContextURL = await server(t, (req, res) => json(res, req.url === '/api/show' ? { parameters: 'num_ctx 12' } : {}));
  const noContext = new LocalJevRuntime(normalizeConfig({ jev: { enabled: true, manageOllama: true, baseURL: noContextURL } }).jev);
  noContext.run = async () => '0.35.0';
  await assert.rejects(noContext.ready(), /valid num_ctx/);
  await noContext.shutdown();
  const badURL = await server(t, (_req, res) => json(res, {}, 500));
  const bad = new LocalJevRuntime(normalizeConfig({ jev: { enabled: true, manageOllama: true, baseURL: badURL } }).jev);
  bad.spawnServer = () => assert.fail('HTTP failure must not trigger spawning');
  await assert.rejects(bad.ready(), /health probe failed/);
  await bad.shutdown();
});

test('runtime cancels and waits for owned child processes, and never kills unrelated processes', async () => {
  const runtime = new LocalJevRuntime(normalizeConfig().jev);
  const external = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  try {
    await once(external, 'spawn');
    // Use the real ChildProcess contract with Node as a harmless long-running Ollama fixture.
    runtime.child = function () {
      const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)']);
      const closed = new Promise(resolve => child.once('close', resolve));
      this.children.set(child, closed);
      closed.then(() => this.children.delete(child));
      return child;
    };
    const controller = new AbortController();
    const task = runtime.run(['pull', 'nimble'], runtime.signal(controller.signal));
    const child = [...runtime.children.keys()][0];
    await once(child.stdout, 'data');
    controller.abort(new Error('cancel pull'));
    await assert.rejects(task, /cancel pull/);
    assert.equal(runtime.children.size, 0);
    assert.equal(external.exitCode, null);
    await runtime.shutdown();
  } finally { external.kill('SIGKILL'); await once(external, 'close'); }
});

test('workflow reruns persisted literal turns for audit and automatically exports each completed result', async t => {
  const vaultPath = await vault(t);
  const workflow = new MemoryWorkflow(historySource(['history decision KEEP', 'history decision DROP']), { jev: { enabled: true, contextWindow: 4096 }, obsidian: { enabled: true, vaultPath } });
  workflow.runtime = fakeRuntime(4096, async request => ({ answers: Object.fromEntries(Object.entries(request.questions).map(([key, value]) => [key, { noul: value.instructions.includes('KEEP') ? 0.9 : 0.1 }])) }));
  workflow.runtime.shutdown = async () => {};
  const args = { entities: ['history', 'decision'], question: 'complete user question', limit: 2 };
  const recall = await workflow.search(args);
  const review = await workflow.search(args, undefined, true);
  assert.deepEqual(recall.results.map(x => x.seq), [0]);
  assert.deepEqual(review.results.map(x => [x.seq, x.noul]), [[1, 0.1]]);
  assert.equal(review.mode, 'filtered-out');
  assert.notEqual(recall.export_path, review.export_path);
  const note = await readFile(review.export_path, 'utf8');
  assert.match(note, /created:.*Z/);
  assert.match(note, /historical data, not current instructions/);
  assert.match(note, /dsh:root:1/);
  assert.match(note, /max noul: 0.1/);
  assert.equal((await stat(review.export_path)).mode & 0o777, 0o600);
  assert.equal((await readdir(vaultPath)).length, 2);
  await workflow.shutdown();
});

test('workflow validates required entities/question before persistence reads; disabled audit and export failure throw', async t => {
  let called = 0;
  const source = historySource();
  source.listSessions = async () => { called++; return []; };
  const enabled = new MemoryWorkflow(source, { jev: { enabled: true, contextWindow: 4096 } });
  for (const args of [{ entities: ['history', 'database'] }, { entities: ['history', 'database'], question: null }, { entities: ['history', 'database'], question: '' }, { entities: ['history', 'database'], question: 'q'.repeat(1001) }]) await assert.rejects(enabled.search(args), /question/);
  assert.equal(called, 0);
  await enabled.shutdown();
  const disabled = new MemoryWorkflow(historySource());
  await assert.rejects(disabled.search({ entities: ['history', 'database'], question: 'question' }, undefined, true), /disabled/);
  await disabled.shutdown();
  const path = await vault(t);
  const broken = new MemoryWorkflow(historySource(), { obsidian: { enabled: true, vaultPath: join(path, 'missing') } });
  await assert.rejects(broken.search({ entities: ['history', 'database'], question: 'question' }), /ENOENT/);
  assert.deepEqual(await readdir(path), []);
  await broken.shutdown();
  const file = join(path, 'not-a-directory');
  await writeFile(file, 'fixture');
  await assert.rejects(exportSearch({ vaultPath: file }, { query: 'history', results: [] }, 'text'), /existing directory/);
  const c = new AbortController(); c.abort(new Error('cancel export'));
  await assert.rejects(exportSearch({ vaultPath: path }, { query: 'history' }, 'text', c.signal), /cancel export/);
  assert.deepEqual(await readdir(path), ['not-a-directory']);
});

test('workflow shutdown aborts outstanding persistence reads and waits for owned work; subsequent calls fail', async () => {
  let observedSignal;
  const source = historySource();
  source.listSessions = async signal => {
    observedSignal = signal;
    await new Promise(resolve => signal.addEventListener('abort', () => setTimeout(resolve, 10), { once: true }));
    signal.throwIfAborted();
  };
  const workflow = new MemoryWorkflow(source);
  const pending = workflow.search({ entities: ['history', 'database'], question: 'question' });
  const rejection = assert.rejects(pending, /disposed/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(workflow.pending.size, 1);
  await workflow.shutdown();
  await rejection;
  assert.equal(observedSignal.aborted, true);
  assert.equal(workflow.pending.size, 0);
  await assert.rejects(workflow.search({ entities: ['history', 'database'], question: 'question' }), /disposed/);
});

test('shutdown cancels an in-flight real SDK request without waiting for the HTTP timeout', async t => {
  let started;
  const requestStarted = new Promise(resolve => { started = resolve; });
  const baseURL = await server(t, () => started());
  const workflow = new MemoryWorkflow(historySource(['history database text']), { jev: { enabled: true, baseURL, contextWindow: 4096 } });
  const request = workflow.search({ entities: ['history', 'database'], question: 'question' });
  const rejection = assert.rejects(request);
  await requestStarted;
  await workflow.shutdown();
  await rejection;
  assert.equal(workflow.runtime.state, 'disposed');
  assert.equal(workflow.pending.size, 0);
});
