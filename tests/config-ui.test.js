import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Config, normalizeConfig } from '../src/config.js';
import { ConfiguredWorkflow } from '../src/configured-workflow.js';
import { FIELDS, createDraft, editDraft, resetDraft, draftValue, saveDraft } from '../client/config-editor.js';
import { ConfigPage } from '../client/config-page.js';
import en from '../locale/en.json' with { type: 'json' };

const t = key => en.config[key];
const field = key => FIELDS.find(field => field.key === key);
function form() {
  const value = structuredClone(normalizeConfig());
  return { state: { status: 'ready', writable: true, revision: 4, value, base: structuredClone(value) }, mutate: async () => true };
}

test('Config exposes volatile groups while retaining strict normalization', () => {
  const config = Config({});
  assert.equal(Config.dict.discussion.meta.volatile, true);
  assert.equal(Config.dict.jev.meta.volatile, true);
  assert.equal(Config.dict.obsidian.meta.volatile, true);
  assert.equal(config.discussion.get().enabled, false);
  assert.equal(config.jev.get().enabled, false);
  assert.equal(normalizeConfig(config).discussion.enabled, false);
  assert.equal(normalizeConfig(config).jev.enabled, false);
  assert.throws(() => normalizeConfig(Config({ jev: { baseURL: 'https://user:secret@remote.invalid' } })), /without credentials/);
});

test('draft edits are atomic, revision fenced, and validate before crossing transport', async () => {
  const target = form();
  const calls = [];
  target.mutate = async (...args) => { calls.push(args); return true; };
  let draft = editDraft(createDraft(target.state), field('jev.enabled'), true);
  await assert.rejects(saveDraft(target, draft), /contextWindow/);
  assert.equal(calls.length, 0);
  draft = editDraft(draft, field('jev.contextWindow'), '8192');
  assert.equal(await saveDraft(target, draft), true);
  assert.deepEqual(calls, [[[
    { op: 'set', path: ['jev', 'enabled'], value: true },
    { op: 'set', path: ['jev', 'contextWindow'], value: 8192 },
  ], 4]]);
  assert.equal(target.state.value.jev.enabled, false);
  target.state = { ...target.state, revision: 9 };
  await saveDraft(target, draft);
  assert.equal(calls[1][1], 4); // Never silently use the latest revision to overwrite other edits.
  await assert.rejects(saveDraft(target, editDraft(draft, field('jev.baseURL'), 'http://remote.invalid')), /apiKeyEnv/);
  target.state = { ...target.state, writable: false };
  await assert.rejects(saveDraft(target, draft), /read-only/);
});

test('blank optional fields and staged reset inherit the Host composition, not hardcoded defaults', async () => {
  const target = form();
  target.state.base.jev.contextWindow = 4096;
  target.state.base.jev.model = 'inherited-model';
  const draft = editDraft(createDraft(target.state), field('jev.contextWindow'), '');
  assert.equal(draftValue(draft).jev.contextWindow, 4096);
  const reset = resetDraft(draft);
  assert.equal(draftValue(reset).jev.model, 'inherited-model');
  target.mutate = async (ops, revision) => { assert.deepEqual(ops, [{ op: 'unset', path: ['discussion'] }, { op: 'unset', path: ['recall'] }, { op: 'unset', path: ['jev'] }, { op: 'unset', path: ['obsidian'] }]); assert.equal(revision, 4); return true; };
  assert.equal(await saveDraft(target, reset), true);
});

test('Plugin Manager stages and saves the Discussion switch explicitly', async () => {
  const target = form();
  const calls = [];
  target.mutate = async (...args) => { calls.push(args); return true; };
  let page;
  await act(async () => { page = Renderer.create(React.createElement(ConfigPage, { view: 'page', form: target, t })); });
  const toggle = () => page.root.findByProps({ name: 'discussion.enabled' });
  assert.equal(toggle().props.checked, false);
  await act(async () => toggle().props.onChange({ target: { checked: true } }));
  assert.equal(toggle().props.checked, true);
  assert.equal(calls.length, 0);
  await act(async () => page.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(calls, [[[ { op: 'set', path: ['discussion', 'enabled'], value: true } ], 4]]);
  await act(async () => page.unmount());
});

test('React page writes only on Save, preserves refused/transport-failed draft, and discards edits', async () => {
  const target = form();
  const calls = [];
  target.mutate = async (...args) => { calls.push(args); return false; };
  let page;
  await act(async () => { page = Renderer.create(React.createElement(ConfigPage, { view: 'page', form: target, t })); });
  const input = () => page.root.findByProps({ name: 'jev.model' });
  await act(async () => input().props.onChange({ target: { value: 'draft-model' } }));
  assert.equal(calls.length, 0);
  target.state = { ...target.state, revision: 5 };
  await act(async () => page.update(React.createElement(ConfigPage, { view: 'page', form: target, t })));
  await act(async () => page.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(calls[0][1], 4);
  assert.equal(input().props.value, 'draft-model');
  assert.equal(page.root.findByProps({ role: 'status' }).children[0], t('refused'));
  target.mutate = async () => { throw new Error('wire refused'); };
  await act(async () => page.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(input().props.value, 'draft-model');
  assert.equal(page.root.findByProps({ role: 'status' }).children[0], 'wire refused');
  await act(async () => page.root.findAllByType('button').find(button => button.children[0] === t('discard')).props.onClick());
  assert.equal(input().props.value, 'nimble');
  await act(async () => page.unmount());
  assert.equal(calls.length, 1);
});

test('React unavailable/summary/read-only states and enabled validation never silently write', async () => {
  let page;
  await act(async () => { page = Renderer.create(React.createElement(ConfigPage, { view: 'summary', t })); });
  assert.equal(page.toJSON(), t('summary'));
  await act(async () => page.update(React.createElement(ConfigPage, { view: 'page', t })));
  assert.equal(page.root.findByProps({ role: 'status' }).children[0], t('unavailable'));
  const target = form();
  target.state.writable = false;
  await act(async () => page.update(React.createElement(ConfigPage, { view: 'page', t, form: target })));
  assert.ok(page.root.findAllByType('button').every(button => button.props.disabled));
  await act(async () => page.unmount());
});

test('built client registers lazy DSH factory and lifecycle-owned exact row config, without Host imports', async () => {
  const script = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8');
  let record;
  runInNewContext(script, { window: { __ModuleLoader__: { load: value => { record = value; } } } });
  assert.equal(record.id, '@shengxiao04/dsh-session-memory');
  const client = record.factory(spec => { assert.equal(spec, 'react'); return React; });
  assert.deepEqual([...client.inject], ['locale', 'slots', 'configForms']);
  const effects = [], registrations = [];
  client.apply({
    effect: factory => effects.push(factory()),
    locale: { register: (ns, dictionaries) => { assert.equal(ns, 'dshSessionMemory'); assert.equal(dictionaries.zh.save, '保存'); return () => registrations.push('locale-disposed'); } },
    configForms: { whileServed: (namespaces, register) => { assert.equal(namespaces[0], 'dsh-session-memory'); return register(); } },
    slots: { inject: (name, register) => { assert.equal(name, 'plugins.row.config'); return register(); }, register: (spec, component) => { assert.equal(spec.key, '@shengxiao04/dsh-session-memory#dsh-session-memory'); assert.equal(typeof component, 'function'); return () => registrations.push('slot-disposed'); } },
  });
  for (const dispose of effects.toReversed()) dispose();
  assert.deepEqual(registrations, ['slot-disposed', 'locale-disposed']);
});

test('live workflow replacement cancels and drains old work without starting a model, serializes rapid saves', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const historySource = { listSessions: signal => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => setTimeout(() => reject(signal.reason), 10), { once: true });
    started();
  }) };
  const workflow = new ConfiguredWorkflow(historySource, {});
  const previous = workflow.current;
  const task = workflow.search({ entities: ['history', 'database'], question: 'question' });
  const rejected = assert.rejects(task, /configuration changed/);
  await ready;
  workflow.reconfigure({ jev: { enabled: true, contextWindow: 8192 } });
  assert.equal(workflow.status().jev.state, 'reconfiguring');
  assert.equal(workflow.status().discussion.enabled, false);
  workflow.reconfigure({ discussion: { enabled: true }, jev: { enabled: false, model: 'new-model' } });
  await workflow.transition;
  await rejected;
  assert.equal(previous.runtime.state, 'disposed');
  assert.equal(previous.pending.size, 0);
  assert.equal(workflow.status().discussion.enabled, true);
  assert.equal(workflow.status().jev.model, 'new-model');
  assert.equal(workflow.status().jev.state, 'disabled');
  assert.equal(workflow.current.runtime.startup, undefined);
  await workflow.shutdown();
  await assert.rejects(workflow.search({ entities: ['history', 'database'], question: 'question' }), /disposed/);
});
