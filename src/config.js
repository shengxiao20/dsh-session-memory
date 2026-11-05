import Schema from '@deepseek-ai/schemastery';
import { isAbsolute } from 'node:path';
import { isVolatile } from '@deepseek-ai/cosmokit';
import { validateConfig } from './config-values.js';
export { localRoot, apiRoot } from './config-values.js';

export const Config = Schema.object({
  discussion: Schema.object({
    enabled: Schema.boolean().default(false).description('Enable sequential multi-agent Discussion for user-confirmed historical DSH evidence.'),
  }).volatile(),
  recall: Schema.object({ limit: Schema.number().step(1).min(1).max(50).default(20).description('Default top K per entity stage. No refill.') }).volatile(),
  jev: Schema.object({
    enabled: Schema.boolean().default(false).description('Enable System One relevance filtering; entity mode reports model unavailability explicitly.'),
    model: Schema.string().default('nimble').description('Explicit local or remote System One model name.'),
    baseURL: Schema.string().default('http://127.0.0.1:11434').description('HTTP(S) API root; managed Ollama requires a local HTTP loopback root.'),
    apiKeyEnv: Schema.string().description('Host environment variable holding an unmanaged/remote API key; never the secret itself.'),
    manageOllama: Schema.boolean().default(false).description('Explicitly allow starting local Ollama and pulling the selected model.'),
    contextWindow: Schema.number().step(1).min(1024).max(1048576).description('Input budget; required with enabled unmanaged Ollama, a cap when managed.'),
  }).volatile(),
  obsidian: Schema.object({
    enabled: Schema.boolean().default(false).description('Write every completed search/review to a new Markdown note.'),
    vaultPath: Schema.string().description('Existing absolute Obsidian vault directory; required when export is enabled.'),
  }).volatile(),
});

// Direct unit callers use plain values; Loader supplies stable group references.
export function normalizeConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return validateConfig(input, isAbsolute);
  return validateConfig({
    ...input,
    ...(Object.hasOwn(input, 'discussion') ? { discussion: isVolatile(input.discussion) ? input.discussion.get() : input.discussion } : {}),
    ...(Object.hasOwn(input, 'recall') ? { recall: isVolatile(input.recall) ? input.recall.get() : input.recall } : {}),
    ...(Object.hasOwn(input, 'jev') ? { jev: isVolatile(input.jev) ? input.jev.get() : input.jev } : {}),
    ...(Object.hasOwn(input, 'obsidian') ? { obsidian: isVolatile(input.obsidian) ? input.obsidian.get() : input.obsidian } : {}),
  }, isAbsolute);
}
