// Headless browser checks of the built configuration page with a staged Host-form fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

if (!process.env.DSH_BROWSER) throw new Error('Set DSH_BROWSER to the Chrome/Chromium executable.');
const harness = await build({ stdin: { contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
window.__ModuleLoader__ = { load(record) { window.plugin = record.factory(name => { if (name !== 'react') throw Error(name); return React; }); } };
window.start = () => {
  let Component, dict;
  const effects = [];
  window.plugin.apply({ effect: fn => effects.push(fn()), locale: { register(ns, dictionaries) { dict = dictionaries; return () => {}; } },
    configForms: { whileServed(names, register) { return register(); } },
    slots: { inject(name, register) { return register(); }, register(spec, component) { window.slotKey = spec.key; Component = component; return () => {}; } },
  });
  const root = createRoot(document.getElementById('app'));
  const base = { recall: { limit: 20 }, jev: { enabled: false, model: 'nimble', baseURL: 'http://127.0.0.1:11434', manageOllama: false }, obsidian: { enabled: false } };
  const state = { status: 'ready', revision: 1, writable: true, value: structuredClone(base), base: structuredClone(base) };
  window.fixture = { calls: [], accepted: true, state, lang: 'en', discardPage() { root.render(null); }, render() { render(); } };
  const form = { state, async mutate(ops, revision) {
    window.fixture.calls.push({ ops, revision });
    if (!window.fixture.accepted || revision !== state.revision) return false;
    for (const op of ops) {
      const [group, field] = op.path;
      if (!field) state.value[group] = structuredClone(base[group]);
      else if (op.op === 'unset') { if (base[group][field] === undefined) delete state.value[group][field]; else state.value[group][field] = base[group][field]; }
      else state.value[group][field] = op.value;
    }
    state.revision++;
    render();
    return true;
  } };
  function render() { root.render(React.createElement(Component, { view: 'page', form: { ...form, state: { ...state } }, t: key => dict[window.fixture.lang][key] })); }
  render();
};`, resolveDir: process.cwd(), loader: 'js' }, bundle: true, platform: 'browser', format: 'iife', write: false });
const client = await readFile(new URL('../dist/client.js', import.meta.url));
const html = '<!doctype html><html><head><meta charset="utf-8"><title>DSH memory config fixture</title></head><body><main id="app"></main><script src="/harness.js"></script><script src="/client.js"></script><script>start()</script></body></html>';
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/' ? 'text/html; charset=utf-8' : 'text/javascript');
  res.end(req.url === '/' ? html : req.url === '/client.js' ? client : harness.outputFiles[0].text);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const dir = await mkdtemp(join(tmpdir(), 'dsh-config-browser-'));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.DSH_BROWSER, headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(await page.evaluate(() => window.slotKey), '@shengxiao04/dsh-session-memory#dsh-session-memory');
  await page.locator('[name="recall.limit"]').fill('7');
  await page.locator('[name="jev.enabled"]').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'explicit contextWindow' }).waitFor();
  assert.equal(await page.evaluate(() => window.fixture.calls.length), 0);
  await page.locator('[name="jev.contextWindow"]').fill('8192');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Saved;' }).waitFor();
  assert.equal(await page.evaluate(() => window.fixture.state.value.jev.enabled), true);
  assert.equal(await page.evaluate(() => window.fixture.state.value.recall.limit), 7);
  await page.locator('[name="jev.baseURL"]').fill('https://remote.invalid');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'apiKeyEnv' }).waitFor();
  assert.equal(await page.evaluate(() => window.fixture.calls.length), 1);
  await page.locator('[name="jev.apiKeyEnv"]').fill('DSH_JEV_KEY');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Saved;' }).waitFor();
  assert.equal(await page.evaluate(() => window.fixture.state.value.jev.apiKeyEnv), 'DSH_JEV_KEY');
  assert.equal(await page.evaluate(() => window.fixture.state.value.jev.baseURL), 'https://remote.invalid');
  await page.getByRole('button', { name: 'Discard edits', exact: true }).click();
  await page.locator('[name="jev.model"]').fill('draft-model');
  await page.evaluate(() => { window.fixture.state.revision++; window.fixture.render(); });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Save refused' }).waitFor();
  assert.equal(await page.locator('[name="jev.model"]').inputValue(), 'draft-model');
  await page.getByRole('button', { name: 'Discard edits', exact: true }).click();
  assert.equal(await page.locator('[name="jev.model"]').inputValue(), 'nimble');
  await page.getByRole('button', { name: 'Stage inherited defaults', exact: true }).click();
  assert.equal(await page.locator('[name="jev.enabled"]').isChecked(), false);
  assert.equal(await page.locator('[name="recall.limit"]').inputValue(), '20');
  assert.equal(await page.evaluate(() => window.fixture.state.value.jev.enabled), true);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Saved;' }).waitFor();
  await page.evaluate(() => { window.fixture.lang = 'zh'; window.fixture.render(); });
  await page.getByRole('button', { name: '保存', exact: true }).waitFor();
  await page.screenshot({ path: join(dir, 'config-zh.png'), fullPage: true });
  await page.evaluate(() => { window.fixture.state.writable = false; window.fixture.render(); });
  await page.getByRole('status').filter({ hasText: '只读' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.fixture.state.writable = true; window.fixture.render(); });
  await page.locator('[name="jev.model"]').fill('unsaved');
  const writes = await page.evaluate(() => window.fixture.calls.length);
  await page.evaluate(() => window.fixture.discardPage());
  await page.waitForFunction(() => !document.querySelector('form'));
  await page.evaluate(() => window.fixture.render());
  await page.locator('[name="jev.model"]').waitFor();
  assert.equal(await page.locator('[name="jev.model"]').inputValue(), 'nimble');
  assert.equal(await page.evaluate(() => window.fixture.calls.length), writes);
  assert.deepEqual(errors, []);
  console.log('Browser config PASS: built DSH factory/row page, staged save/reset/discard, missing remote key variable/window validation, explicit remote staged save, stale revision retains draft, read-only, Chinese labels and leave-page discard. Host form and manager layout are fixtures, not active-profile UI.');
} finally {
  await browser?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await rm(dir, { recursive: true, force: true });
}
