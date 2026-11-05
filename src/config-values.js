function object(value, label, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} parameter: ${key}`);
}
export function apiRoot(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Jev baseURL must be an HTTP(S) API root.');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Jev baseURL must be an HTTP(S) API root without credentials, query or hash.');
  }
  return url.href.replace(/\/+$/u, '');
}
export function localRoot(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Jev baseURL must be a local HTTP loopback root.');
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Jev baseURL must be a local HTTP loopback root without credentials, path, query or hash; remote Jev is prohibited.');
  }
  return url.origin;
}
export function validateConfig(input, isAbsolute) {
  object(input, 'config', ['discussion', 'jev', 'obsidian', 'recall']);
  if (Object.hasOwn(input, 'discussion')) object(input.discussion, 'discussion', ['enabled']);
  const discussion = { enabled: false, ...input.discussion };
  if (Object.hasOwn(input, 'recall')) object(input.recall, 'recall', ['limit']);
  const recall = { limit: 20, ...input.recall };
  if (!Number.isSafeInteger(recall.limit) || recall.limit < 1 || recall.limit > 50) throw new Error('Recall limit must be an integer between 1 and 50.');
  if (Object.hasOwn(input, 'jev')) object(input.jev, 'jev', ['enabled', 'model', 'baseURL', 'apiKeyEnv', 'manageOllama', 'contextWindow']);
  if (Object.hasOwn(input, 'obsidian')) object(input.obsidian, 'obsidian', ['enabled', 'vaultPath']);
  const jev = { enabled: false, model: 'nimble', baseURL: 'http://127.0.0.1:11434', manageOllama: false, ...input.jev };
  const obsidian = { enabled: false, ...input.obsidian };
  for (const [label, value] of [['discussion.enabled', discussion.enabled], ['jev.enabled', jev.enabled], ['jev.manageOllama', jev.manageOllama], ['obsidian.enabled', obsidian.enabled]]) {
    if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  }
  if (typeof jev.model !== 'string' || !jev.model.trim() || jev.model.length > 200) throw new Error('Jev model must be nonempty text of at most 200 characters.');
  jev.model = jev.model.trim();
  jev.baseURL = apiRoot(jev.baseURL);
  const url = new URL(jev.baseURL);
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.pathname === '/';
  if (jev.manageOllama) localRoot(jev.baseURL);
  if (jev.apiKeyEnv !== undefined && (typeof jev.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,199}$/u.test(jev.apiKeyEnv))) throw new Error('Jev apiKeyEnv must be an environment-variable name, not an API key.');
  if (jev.enabled && !local && jev.apiKeyEnv === undefined) throw new Error('Enabled remote Jev requires apiKeyEnv: the Host environment variable containing its API key.');
  if (jev.contextWindow !== undefined && (!Number.isSafeInteger(jev.contextWindow) || jev.contextWindow < 1024 || jev.contextWindow > 1048576)) {
    throw new Error('Jev contextWindow must be an integer between 1024 and 1048576.');
  }
  if (jev.enabled && !jev.manageOllama && jev.contextWindow === undefined) throw new Error('Enabled unmanaged Jev requires an explicit contextWindow.');
  if (obsidian.vaultPath !== undefined && (typeof obsidian.vaultPath !== 'string' || !isAbsolute(obsidian.vaultPath) || obsidian.vaultPath.length > 4000)) {
    throw new Error('Obsidian vaultPath must be an absolute path of at most 4000 characters.');
  }
  if (obsidian.enabled && obsidian.vaultPath === undefined) throw new Error('Enabled Obsidian export requires an existing absolute vaultPath.');
  return Object.freeze({ discussion: Object.freeze(discussion), recall: Object.freeze(recall), jev: Object.freeze(jev), obsidian: Object.freeze(obsidian) });
}
