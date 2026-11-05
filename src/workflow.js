import { normalizeConfig } from './config.js';
import { renderSearch } from './memory.js';
import { LocalJevRuntime } from './jev-runtime.js';
import { judgeSourceTurns } from './jev-review.js';
import { NativeHistoryIndex } from './history-index.js';
import { normalizeEntitySearch, recallEntities, boundRecall, normalizeTurnRead, readTurns } from './entity-recall.js';
import { exportSearch } from './obsidian-export.js';

// Tools and commands share one workflow; DSH persistence remains authoritative.
export class MemoryWorkflow {
  constructor(historySource, config, index) {
    this.historySource = historySource;
    this.ownsIndex = index === undefined;
    this.index = index ?? new NativeHistoryIndex(historySource);
    this.config = normalizeConfig(config);
    this.runtime = new LocalJevRuntime(this.config.jev);
    this.pending = new Set();
  }
  track(operation, signal) {
    signal = this.runtime.signal(signal);
    const task = Promise.resolve().then(() => { signal.throwIfAborted(); return operation(signal); });
    this.pending.add(task);
    task.then(() => this.pending.delete(task), () => this.pending.delete(task));
    return task;
  }
  search(input, signal, review = false) {
    return this.track(async signal => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected an argument object.');
      const { question, ...entityInput } = input;
      if (typeof question !== 'string' || !question.trim() || question.length > 1000) throw new Error('Entity recall requires question: nonempty complete user text of at most 1000 characters.');
      if (review && !this.config.jev.enabled) throw new Error('Jev is disabled; enable it in plugin config before reviewing filtered hits.');
      const args = normalizeEntitySearch({ ...entityInput, limit: entityInput.limit ?? this.config.recall.limit });
      await this.index.synchronize(signal);
      const judge = candidates => judgeSourceTurns(this.runtime, question.trim(), candidates, signal);
      const value = boundRecall(await recallEntities(this.index, args, question.trim(), judge, signal, review));
      signal.throwIfAborted();
      if (this.config.obsidian.enabled) value.export_path = await exportSearch(this.config.obsidian, value, renderSearch(value), signal);
      return value;
    }, signal);
  }
  read(input, signal) {
    return this.track(async signal => {
      const args = normalizeTurnRead(input);
      await this.index.synchronize(signal);
      await this.index.settled(signal);
      return readTurns(this.index, args);
    }, signal);
  }
  statistics(input = {}, signal) { return this.historyOperation(input, signal, false); }
  backfill(input = {}, signal) { return this.historyOperation(input, signal, true); }
  historyOperation(input, signal, force) {
    return this.track(async signal => {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('History statistics/backfill accepts an empty argument object only.');
      const synchronized = await this.index.synchronize(signal, force);
      await this.index.settled(signal);
      return force ? synchronized : this.index.statistics();
    }, signal);
  }
  status() {
    return {
      sources: ['dsh'],
      jev: { ...this.config.jev, state: this.runtime.state, ...(this.runtime.contextWindow ? { effectiveContextWindow: this.runtime.contextWindow } : {}), ...(this.runtime.reason ? { reason: this.runtime.reason } : {}) },
      obsidian: this.config.obsidian,
      recall: this.config.recall,
      history: { state: this.index.db ? 'ready' : 'idle', storage: this.index.storage, path: this.index.path },
      scope: 'Persisted DSH main-session source turns only; global then entity-discovered stored-CWD project recall. No foreign-history access or session migration.',
    };
  }
  async shutdown() {
    await this.runtime.shutdown();
    await Promise.allSettled([...this.pending]);
    if (this.ownsIndex) await this.index.shutdown();
  }
}
