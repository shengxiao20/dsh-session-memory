import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_SUMMARY_PREFIX, formatToolConfigSummary, withToolConfigSummary } from '../src/tool-config-summary.js';

function status(overrides = {}) {
  return {
    discussion: { enabled: false },
    recall: { limit: 20 },
    jev: {
      enabled: false,
      model: 'nimble',
      baseURL: 'http://127.0.0.1:11434',
      manageOllama: true,
      state: 'disabled',
    },
    obsidian: { enabled: true, vaultPath: '/secret/vault' },
    history: { state: 'ready', path: '/secret/history.sqlite' },
    ...overrides,
  };
}

test('tool config summary mirrors Pi switches without exposing paths or credential values', () => {
  const summary = formatToolConfigSummary(status(), { DSH_HOME: '  ' });
  assert.equal(summary, 'Config · Discussion=off · Jev=off (nimble; disabled) · Obsidian=on · manageOllama=on · limit=20\nEnv · DSH_HOME=unset · API key=local-placeholder');
  assert.doesNotMatch(summary, /secret|history\.sqlite|127\.0\.0\.1/);
});

test('remote Jev summary reports only configured environment variable state and normalizes labels', () => {
  const remote = status({
    discussion: { enabled: true },
    recall: { limit: 40 },
    jev: { enabled: true, model: ' remote\n model ', baseURL: 'https://private.example', apiKeyEnv: 'DSH_JEV_API_KEY', manageOllama: false, state: 'ready' },
    obsidian: { enabled: false, vaultPath: '/private/vault' },
  });
  const set = formatToolConfigSummary(remote, { DSH_HOME: '/private/dsh', DSH_JEV_API_KEY: 'super-secret' });
  assert.equal(set, 'Config · Discussion=on · Jev=on (remote model; ready) · Obsidian=off · manageOllama=off · limit=40\nEnv · DSH_HOME=set · DSH_JEV_API_KEY=set');
  assert.doesNotMatch(set, /super-secret|private\.example|private\/vault|private\/dsh/);
  assert.match(formatToolConfigSummary(remote, {}), /DSH_JEV_API_KEY=unset$/);
});

test('render decorator appends an invocation-time snapshot without mutating original content or value', () => {
  let current = status();
  const workflow = { status: () => current };
  const original = [{ type: 'text', text: 'evidence' }];
  const value = { result: 'unchanged' };
  const render = withToolConfigSummary(workflow, (_args, actual) => {
    assert.equal(actual, value);
    return original;
  }, {});
  const first = render({}, value);
  assert.deepEqual(first, [original[0], { type: 'text', text: formatToolConfigSummary(current, {}) }]);
  assert.deepEqual(original, [{ type: 'text', text: 'evidence' }]);
  assert.equal(first[1].text.startsWith(CONFIG_SUMMARY_PREFIX), true);

  current = status({ discussion: { enabled: true }, jev: { enabled: true, model: 'new-model', manageOllama: false, state: 'idle' }, obsidian: { enabled: false }, recall: { limit: 7 } });
  const second = render({}, value);
  assert.match(second[1].text, /Discussion=on.*Jev=on \(new-model; idle\).*Obsidian=off.*manageOllama=off.*limit=7/);
  assert.notEqual(second[1].text, first[1].text);
});

test('render decorator propagates status errors instead of hiding invalid lifecycle state', () => {
  const render = withToolConfigSummary({ status: () => { throw new Error('status failed'); } }, () => [{ type: 'text', text: 'evidence' }]);
  assert.throws(() => render({}, {}), /status failed/);
});
