import { APIError, APIConnectionError } from '@typesafe-ai/sdk';
import { JevConfigurationError } from './jev-runtime.js';
import { filterWithJev } from './jev-filter.js';

/** Pi-style explicit availability state, not a silent success or hidden retry. */
export async function judgeSourceTurns(runtime, question, candidates, signal) {
  signal.throwIfAborted();
  if (!runtime.config.enabled) return literalState(runtime, candidates, 'disabled');
  // Credential/configuration mistakes must throw rather than return literal results.
  runtime.credentials();
  if (runtime.state === 'unavailable') return literalState(runtime, candidates, 'unavailable');
  try {
    return await filterWithJev(runtime, question, candidates, signal);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof JevConfigurationError) throw error;
    const reason = error instanceof APIError ? `${error.name}: HTTP ${error.status}`
      : error instanceof APIConnectionError ? `${error.name}: model connection unavailable`
      : String(error.message).slice(0, 500);
    runtime.markUnavailable(reason);
    return literalState(runtime, candidates, 'unavailable');
  }
}
function literalState(runtime, candidates, status) {
  return { results: candidates, filteredOut: [], stats: { status, model: runtime.config.model,
    ...(runtime.contextWindow ? { context_window: runtime.contextWindow } : {}),
    reviewed: 0, retained: candidates.length, filtered: 0, segmented: 0, threshold: 0.5, evidence: 'source-turns',
    ...(status === 'unavailable' ? { reason: runtime.reason } : {}),
  } };
}
