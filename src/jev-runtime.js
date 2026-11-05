import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { apiRoot } from './config.js';

// Own only processes started by this plugin. Existing Ollama services are never stopped.
export class JevConfigurationError extends Error {}

export class JevRuntime {
  constructor(config) {
    this.config = config;
    this.baseURL = apiRoot(config.baseURL);
    this.controller = new AbortController();
    this.children = new Map();
    this.state = config.enabled ? 'idle' : 'disabled';
  }
  credentials() {
    if (this.config.apiKeyEnv === undefined) return 'ollama';
    const key = process.env[this.config.apiKeyEnv];
    if (typeof key !== 'string' || !key.trim()) throw new JevConfigurationError(`Missing Jev API key in Host environment variable ${this.config.apiKeyEnv}.`);
    return key;
  }
  markUnavailable(reason) { this.state = 'unavailable'; this.reason = reason; }
  signal(signal) { return signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal; }
  async ready(signal) {
    signal = this.signal(signal);
    signal.throwIfAborted();
    if (!this.config.enabled) throw new Error('Jev is disabled; enable it in the plugin config before reviewing filtered hits.');
    const apiKey = this.credentials();
    if (!this.startup) this.startup = this.start(signal, apiKey);
    await this.startup;
    signal.throwIfAborted();
    return this;
  }
  async start(signal, apiKey) {
    this.state = 'starting';
    try {
      let contextWindow = this.config.contextWindow;
      if (this.config.manageOllama) {
        if (!await this.healthy(signal)) {
          await this.spawnServer(signal);
          for (let attempt = 0; ; attempt++) {
            if (await this.healthy(signal)) break;
            if (attempt === 49) throw new Error('Ollama did not become healthy after starting ollama serve.');
            await delay(100, undefined, { signal });
          }
        }
        const output = await this.run(['--version'], signal);
        const version = output.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
        if (!version) throw new Error(`Could not determine Ollama version: ${output.trim()}`);
        if (version[0] === 0 && version[1] < 35) throw new Error('Local Jev requires Ollama 0.35.0 or newer.');
        await this.run(['pull', this.config.model], signal);
        const response = await fetch(`${this.baseURL}/api/show`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: this.config.model }) });
        if (!response.ok) throw new Error(`Could not inspect local Jev model: HTTP ${response.status}`);
        const details = await response.json();
        const detected = Number(details.parameters?.match(/^num_ctx\s+(\d+)$/m)?.[1]);
        if (!Number.isSafeInteger(detected) || detected < 1024) throw new Error('Local Jev model must declare a valid num_ctx >= 1024.');
        contextWindow = Math.min(contextWindow ?? detected, detected);
      }
      this.contextWindow = contextWindow;
      // Explicit transport config overrides SDK ambient remote defaults; redirects are prohibited.
      this.client = new TypeSafeClient({ apiKey, baseURL: this.baseURL, defaultModel: this.config.model, logLevel: 'off', timeout: 30000, retry: { maxRetries: 0 }, fetch: (url, init) => fetch(url, { ...init, redirect: 'error' }) });
      this.state = 'ready';
    } catch (error) { this.state = 'failed'; await this.stopChildren(); throw error; }
  }
  async healthy(signal) {
    try {
      const response = await fetch(`${this.baseURL}/api/tags`, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]) });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`Local Ollama health probe failed: HTTP ${response.status}`);
      return true;
    } catch (error) {
      signal.throwIfAborted();
      // Only an explicit manageOllama health probe permits starting a local process.
      if (error.cause?.code === 'ECONNREFUSED') return false;
      throw error;
    }
  }
  child(args, stdio) {
    const child = spawn('ollama', args, { stdio, env: { ...process.env, OLLAMA_HOST: new URL(this.baseURL).host } });
    const closed = new Promise(resolve => child.once('close', resolve));
    this.children.set(child, closed);
    closed.then(() => this.children.delete(child));
    return child;
  }
  spawnServer(signal) {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const child = this.child(['serve'], 'ignore');
      child.once('error', reject);
      child.once('spawn', () => { if (signal.aborted) reject(signal.reason); else resolve(); });
    });
  }
  run(args, signal) {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const child = this.child(args, ['ignore', 'pipe', 'pipe']);
      let output = '', stderr = '', failure, killTimer;
      const abort = () => {
        failure = signal.reason;
        child.kill();
        killTimer = setTimeout(() => { if (this.children.has(child)) child.kill('SIGKILL'); }, 2000);
      };
      signal.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', data => { output = (output + data).slice(-16000); });
      child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
      child.once('error', error => { failure = error; });
      child.once('close', code => {
        signal.removeEventListener('abort', abort);
        clearTimeout(killTimer);
        if (failure) reject(failure);
        else if (code !== 0) reject(new Error(`ollama ${args[0]} failed (${code}): ${stderr.trim()}`));
        else resolve(args[0] === '--version' ? `${output}\n${stderr}` : output);
      });
    });
  }
  async stopChildren() {
    const children = [...this.children.keys()];
    const closed = [...this.children.values()];
    for (const child of children) child.kill();
    const timer = setTimeout(() => { for (const child of children) if (this.children.has(child)) child.kill('SIGKILL'); }, 2000);
    try { await Promise.all(closed); }
    finally { clearTimeout(timer); }
  }
  async shutdown() {
    this.controller.abort(new Error('DSH Session Memory disposed.'));
    await this.stopChildren();
    if (this.startup) await Promise.allSettled([this.startup]);
    this.state = 'disposed';
  }
}
export { JevRuntime as LocalJevRuntime };
