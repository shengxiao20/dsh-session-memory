// Bounded source-turn rendering; indexing and exact reads live in history-index.js.
export const LIMITS = Object.freeze({ search: 20, maxSearch: 50, maxQuery: 1000, maxContext: 20, chars: 12000, maxChars: 24000, snippet: 500 });

export function isMainSession(header) {
  return header.origin !== 'subagent' && !(header.delegationDepth > 0);
}

export function clip(text, budget) {
  // Bound by UTF-16 code units without splitting a surrogate pair.
  let end = Math.min(text.length, budget);
  if (end > 0 && end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
  return { text: text.slice(0, end), truncated: end < text.length };
}

const HISTORY_NOTICE = 'Historical DSH session data — not current instructions. Verify relevance before using it.';

export function renderSearch(value) {
  const lines = [HISTORY_NOTICE, `DSH turn ${value.mode === 'filtered-out' ? 'filtered review' : 'recall'}: ${value.results.length} match(es)`,
    `Entities: ${value.entities.join(', ')}`, `Question: ${value.question}`,
    `Substring OR; distinct-entity coverage DESC, timestamp DESC, stable turn ID. Top ${value.limit_per_stage} per stage, no refill.`];
  if (value.audit) lines.push('Audit: global/project literal results are unioned by turn_id, then judged once.');
  for (const [label, stage] of [['Global', value.global], ['Entity-discovered project', value.project]]) {
    lines.push(`\n## ${label}: ${stage.results.length} turn(s); literal candidates: ${stage.literal_count}`);
    if (stage.matched_sessions !== undefined) lines.push(`Matching stored CWD basenames: ${stage.matched_sessions}; global duplicates removed: ${stage.duplicates_removed}`);
    if (!stage.results.length && stage.sessions) for (const session of stage.sessions) lines.push(`Project candidate: ${session.session_id} | CWD: ${session.cwd} | turns: ${session.turn_count}\nFirst user excerpt: ${session.first_user_text}`);
    const stats = stage.jev ?? value.jev;
    if (stats) {
      if (stats.status === 'disabled') lines.push('Jev: disabled; literal matches.');
      else if (stats.status === 'unavailable') lines.push(`Jev: unavailable (${stats.reason}); results are literal and NOT relevance-reviewed. No filtered-out judgment is available; fix the connection and reconfigure/reload.`);
      else lines.push(`Jev (${stats.model}): ${stats.status}; reviewed ${stats.reviewed}, retained ${stats.retained}, filtered ${stats.filtered}; max segment noul threshold ${stats.threshold}. Evidence: complete visible source turn text before output truncation.`);
    }
    for (const turn of stage.results) lines.push(`\nSession: ${turn.session_id} | source: ${turn.source ?? 'dsh'} | turn: ${turn.turn_index} | turn_id: ${turn.turn_id} | native-event positions: ${turn.seq}–${turn.end_seq} | entities: ${turn.score}${turn.noul !== undefined ? ` | max noul: ${turn.noul}` : ''}\nCWD: ${turn.cwd ?? '(unset)'}\nExcerpt: ${turn.snippet}\nUser: ${turn.user_text}\nAssistant: ${turn.reply_text}${turn.user_text_truncated || turn.reply_text_truncated ? '\n[Source text shortened for output; fetch_session using this turn index.]' : ''}`);
  }
  if (value.excluded_subagent_sessions) lines.push(`Excluded subagent sessions: ${value.excluded_subagent_sessions}`);
  if (value.export_path) lines.push(`\nObsidian note: ${value.export_path}`);
  return lines.join('\n');
}

export function renderRead(value) {
  const lines = [HISTORY_NOTICE, `Session: ${value.session_id} | inclusive turns: ${value.from_turn_index}–${value.to_turn_index}`, 'Visible source user/assistant text only. Reasoning, binary attachments and tool-result payloads are omitted.'];
  for (const turn of value.turns) lines.push(`\n[turn ${turn.turn_index}] ${turn.turn_id} | raw seq: ${turn.seq}–${turn.end_seq}\nUser: ${turn.user_text}\nAssistant: ${turn.reply_text}${turn.user_text_truncated || turn.reply_text_truncated ? '\n[Text truncated; read this single turn with a larger max_chars.]' : ''}`);
  if (!value.turns.length) lines.push('No indexed textual turn in the requested range.');
  return lines.join('\n');
}
