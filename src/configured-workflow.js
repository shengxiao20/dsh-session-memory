import { MemoryWorkflow } from './workflow.js';
import { NativeHistoryIndex } from './history-index.js';
import { normalizeConfig } from './config.js';

// The Host owns live configuration replacement, independent of UI/transport details.
export class ConfiguredWorkflow {
  constructor(historySource, config, index = new NativeHistoryIndex(historySource), synchronizeOnReconfigure = false) {
    this.historySource = historySource;
    this.config = normalizeConfig(config);
    this.index = index;
    this.synchronizeOnReconfigure = synchronizeOnReconfigure;
    this.background = Promise.resolve();
    this.current = new MemoryWorkflow(historySource, this.config, this.index);
    this.transition = Promise.resolve();
    this.disposed = false;
    this.failure = undefined;
    this.revision = 0;
    this.appliedRevision = 0;
  }
  reconfigure(config) {
    const next = normalizeConfig(config);
    if (this.disposed) throw new Error('DSH Session Memory disposed.');
    this.config = next;
    const revision = ++this.revision;
    this.current.runtime.controller.abort(new Error('DSH Session Memory configuration changed.'));
    const transition = this.transition.then(async () => {
      await this.current.shutdown();
      if (!this.disposed) {
        this.current = new MemoryWorkflow(this.historySource, next, this.index);
        this.appliedRevision = revision;
        if (this.synchronizeOnReconfigure) this.refresh();
      }
    });
    this.transition = transition;
    // Event dispatch does not await promises. Keep failure observable to every later call/status.
    transition.catch(error => { this.failure = error; });
  }
  refresh() { return this.refreshAfter(Promise.resolve()); }
  refreshAfter(prerequisite) {
    const task = this.transition.then(async () => {
      await prerequisite;
      if (this.disposed) return;
      const runtime = this.current.runtime;
      const work = this.current.statistics({}, undefined);
      work.catch(error => { if (!this.disposed && !runtime.controller.signal.aborted) this.failure = error; });
      return work;
    });
    this.background = task;
    task.catch(error => { if (!this.disposed) this.failure = error; });
    return task;
  }
  async invoke(method, ...args) {
    await this.transition;
    if (this.disposed) throw new Error('DSH Session Memory disposed.');
    return this.current[method](...args);
  }
  search(...args) { return this.invoke('search', ...args); }
  read(...args) { return this.invoke('read', ...args); }
  statistics(...args) { return this.invoke('statistics', ...args); }
  backfill(...args) { return this.invoke('backfill', ...args); }
  status() {
    if (this.failure) throw this.failure;
    const status = this.current.status();
    return { ...status, discussion: this.config.discussion, recall: this.config.recall, jev: { ...status.jev, ...this.config.jev, state: this.appliedRevision === this.revision ? status.jev.state : 'reconfiguring' }, obsidian: this.config.obsidian };
  }
  async shutdown() {
    this.disposed = true;
    this.current.runtime.controller.abort(new Error('DSH Session Memory disposed.'));
    await Promise.allSettled([this.transition]);
    await this.current.shutdown();
    await Promise.allSettled([this.background]);
    await this.index.shutdown();
  }
}
