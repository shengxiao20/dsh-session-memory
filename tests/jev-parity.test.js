import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { normalizeConfig } from '../src/config.js';
import { LocalJevRuntime } from '../src/jev-runtime.js';
import { judgeSourceTurns } from '../src/jev-review.js';
import { filterWithJev } from '../src/jev-filter.js';
import { createDraft, editDraft, FIELDS, saveDraft } from '../client/config-editor.js';
import { boundRecall } from '../src/entity-recall.js';

const signal = () => new AbortController().signal;
const turn = { session_id: 'source', turn_id: 'dsh:source:0', turn_index: 0, seq: 0, type: 'user/turn', snippet: 'irrelevant bounded excerpt', user_text: 'user topic', reply_text: 'source KEEP decision' };
async function endpoint(t, handler) {
  const server = createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}/remote`;
}

test('remote config requires explicit environment-variable name and input budget; managed remote is prohibited', () => {
  const input = { enabled: true, baseURL: 'https://decision.example/api', model: 'selected-model', apiKeyEnv: 'DSH_TEST_JEV_KEY', contextWindow: 8192 };
  assert.equal(normalizeConfig({ jev: input }).jev.baseURL, input.baseURL);
  assert.throws(() => normalizeConfig({ jev: { ...input, apiKeyEnv: undefined } }), /apiKeyEnv/);
  assert.throws(() => normalizeConfig({ jev: { ...input, contextWindow: undefined } }), /contextWindow/);
  assert.throws(() => normalizeConfig({ jev: { ...input, manageOllama: true } }), /local HTTP loopback/);
  assert.throws(() => normalizeConfig({ jev: { ...input, apiKeyEnv: 'actual-secret-key' } }), /environment-variable name/);
});

test('real SDK uses the explicit remote-prefix endpoint/model/key and classifies full source text, not the snippet', async t => {
  const received = [];
  const baseURL = await endpoint(t, async (req, res) => {
    let text = ''; for await (const part of req) text += part;
    const payload = JSON.parse(text); received.push([req.url, req.headers.authorization, payload]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ answers: Object.fromEntries(Object.keys(payload.questions).map(key => [key, { type: 'noul', noul: 0.8 }])) }));
  });
  process.env.DSH_MEMORY_FIXTURE_KEY = 'fixture-secret';
  t.after(() => delete process.env.DSH_MEMORY_FIXTURE_KEY);
  const runtime = new LocalJevRuntime(normalizeConfig({ jev: { enabled: true, baseURL, apiKeyEnv: 'DSH_MEMORY_FIXTURE_KEY', model: 'explicit-remote-model', contextWindow: 8192 } }).jev);
  t.after(() => runtime.shutdown());
  const result = await judgeSourceTurns(runtime, 'complete question', [turn], signal());
  assert.equal(result.stats.evidence, 'source-turns'); assert.equal(result.results[0].noul, 0.8);
  assert.equal(received.length, 1); assert.equal(received[0][0], '/remote/v1/systemone'); assert.equal(received[0][1], 'Bearer fixture-secret');
  assert.equal(received[0][2].model, 'explicit-remote-model');
  assert.match(JSON.stringify(received[0][2]), /source KEEP decision/);
  assert.doesNotMatch(JSON.stringify(received[0][2]), /irrelevant bounded excerpt|fixture-secret/);
  assert.equal(runtime.children.size, 0);
});

test('source-turn review surfaces unavailable literal results, caches unavailability without retry, and never leaks server error bodies', async t => {
  let requests = 0;
  const baseURL = await endpoint(t, (_req, res) => { requests++; res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'private-server-body' } })); });
  process.env.DSH_MEMORY_FIXTURE_KEY = 'fixture-secret'; t.after(() => delete process.env.DSH_MEMORY_FIXTURE_KEY);
  const runtime = new LocalJevRuntime(normalizeConfig({ jev: { enabled: true, baseURL, apiKeyEnv: 'DSH_MEMORY_FIXTURE_KEY', contextWindow: 4096 } }).jev);
  t.after(() => runtime.shutdown());
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await judgeSourceTurns(runtime, 'question', [turn], signal());
    assert.deepEqual(result.results, [turn]); assert.deepEqual(result.filteredOut, []);
    assert.equal(result.stats.status, 'unavailable'); assert.match(result.stats.reason, /HTTP 503/);
    assert.doesNotMatch(JSON.stringify(result.stats), /private-server-body|fixture-secret/);
  }
  assert.equal(requests, 1); assert.equal(runtime.state, 'unavailable');
});

test('missing remote credentials and caller cancellation throw rather than enter unavailable/literal mode', async () => {
  const runtime = new LocalJevRuntime(normalizeConfig({ jev: { enabled: true, baseURL: 'https://decision.example', apiKeyEnv: 'DSH_MEMORY_MISSING_KEY', contextWindow: 4096 } }).jev);
  try {
    await assert.rejects(judgeSourceTurns(runtime, 'question', [turn], signal()), /Missing Jev API key/);
    assert.equal(runtime.state, 'idle'); assert.equal(runtime.startup, undefined);
    const controller = new AbortController(); controller.abort(new Error('cancelled review'));
    await assert.rejects(judgeSourceTurns(runtime, 'question', [turn], controller.signal), /cancelled review/);
    assert.equal(runtime.state, 'idle');
  } finally { await runtime.shutdown(); }
});

test('full source turns are segmented without losing a relevant suffix beyond the native excerpt', async () => {
  const payloads = [];
  const runtime = { config: { model: 'fixture' }, contextWindow: 2048, ready: async () => {}, signal: value => value,
    client: { systemOne: async payload => {
      payloads.push(payload);
      return { answers: Object.fromEntries(Object.entries(payload.questions).map(([key, value]) => [key, { noul: value.instructions.includes('KEEP') ? 0.9 : 0.1 }])) };
    } } };
  const result = await filterWithJev(runtime, 'question', [{ ...turn, reply_text: 'DROP '.repeat(1000) + 'KEEP' }], signal());
  assert.equal(result.results[0].noul, 0.9); assert.equal(result.stats.segmented, 1); assert.ok(payloads.length > 1);
  assert.ok(payloads.every(payload => Buffer.byteLength(JSON.stringify(payload)) <= 1792));
});

test('remote API-key variable UI is optional, validated and sent only as a staged name on Save', async () => {
  const value = structuredClone(normalizeConfig());
  const state = { status: 'ready', writable: true, revision: 1, value, base: structuredClone(value) };
  const calls = [];
  const form = { state, mutate: async (...args) => { calls.push(args); return true; } };
  let draft = createDraft(state);
  for (const [key, input] of [['jev.enabled', true], ['jev.baseURL', 'https://decision.example'], ['jev.apiKeyEnv', 'DSH_JEV_KEY'], ['jev.contextWindow', '8192']]) draft = editDraft(draft, FIELDS.find(field => field.key === key), input);
  assert.equal(calls.length, 0); await saveDraft(form, draft);
  assert.deepEqual(calls[0][0].find(op => op.path.at(-1) === 'apiKeyEnv'), { op: 'set', path: ['jev', 'apiKeyEnv'], value: 'DSH_JEV_KEY' });
});

test('recall text budget spans both stages and preserves surrogate pairs and exact source coordinates', () => {
  const global = { ...turn, user_text: '😀'.repeat(20000) }, project = { ...turn, turn_id: 'dsh:project:0', user_text: 'next source' };
  const value = boundRecall({ results: [global, project], global: { results: [global] }, project: { results: [project] } });
  assert.equal(value.text_truncated, true);
  assert.ok(value.results.reduce((sum, item) => sum + item.user_text.length + item.reply_text.length, 0) <= 24000);
  assert.equal(value.global.results[0], value.results[0]); assert.equal(value.project.results[0], value.results[1]);
  assert.equal(value.results[1].turn_id, 'dsh:project:0'); assert.equal(value.results[1].user_text_truncated, true);
  assert.ok(!/[\uD800-\uDBFF]$/u.test(value.results[0].user_text));
});
