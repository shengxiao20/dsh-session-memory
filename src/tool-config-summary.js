export const CONFIG_SUMMARY_PREFIX = 'Config · ';

// Invocation-time configuration only: never expose credential or filesystem values.
export function formatToolConfigSummary(status, env = process.env) {
  const model = _label(status.jev.model);
  const state = _label(status.jev.state);
  const key = status.jev.apiKeyEnv === undefined
    ? 'API key=local-placeholder'
    : `${status.jev.apiKeyEnv}=${_envState(env[status.jev.apiKeyEnv])}`;
  return `${CONFIG_SUMMARY_PREFIX}Discussion=${_switch(status.discussion.enabled)} · Jev=${_switch(status.jev.enabled)} (${model}; ${state}) · Obsidian=${_switch(status.obsidian.enabled)} · manageOllama=${_switch(status.jev.manageOllama)} · limit=${status.recall.limit}\nEnv · DSH_HOME=${_envState(env.DSH_HOME)} · ${key}`;
}

// Decorate Host rendering without changing the structured tool value or its schema.
export function withToolConfigSummary(workflow, render, env = process.env) {
  return (args, value) => [
    ...render(args, value),
    { type: 'text', text: formatToolConfigSummary(workflow.status(), env) },
  ];
}

function _switch(enabled) { return enabled ? 'on' : 'off'; }
function _envState(value) { return typeof value === 'string' && value.trim() ? 'set' : 'unset'; }
function _label(value) { return String(value).replace(/\s+/gu, ' ').trim(); }
