import { LIMITS, clip } from './memory.js';

export function normalizeEntitySearch(input) {
  for (const key of Object.keys(input)) if (!['entities', 'limit'].includes(key)) throw new Error(`Unknown parameter: ${key}`);
  if (!Array.isArray(input.entities) || input.entities.length < 2 || input.entities.length > 8) throw new Error('entities must contain 2–8 literal topic strings.');
  const entities = input.entities.map(entity => {
    if (typeof entity !== 'string' || !entity.trim() || entity.length > LIMITS.maxQuery) throw new Error('Each entity must be nonempty text of at most 1000 characters.');
    return entity.trim().toLowerCase();
  });
  const distinct = [...new Set(entities)];
  if (distinct.length < 2) throw new Error('Provide at least two distinct entities.');
  if (!distinct.some(entity => /[\p{L}\p{N}]/u.test(entity))) throw new Error('Entities must contain at least one letter or number.');
  const limit = input.limit == null ? LIMITS.search : input.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > LIMITS.maxSearch) throw new Error('limit must be an integer between 1 and 50.');
  return { entities: distinct, limit };
}

/** Serial ordinary stages; audit merges literal stages before judging once, as in Pi. */
export async function recallEntities(index, args, question, judge, signal, review = false) {
  await index.settled(signal);
  const globalLiteral = index.search(args.entities, args.limit);
  signal.throwIfAborted();
  if (review) {
    const sessions = index.projects(args.entities);
    const projectLiteral = index.search(args.entities, args.limit, sessions.map(session => session.session_id));
    const globalIds = new Set(globalLiteral.map(turn => turn.turn_id));
    const projectUnique = projectLiteral.filter(turn => !globalIds.has(turn.turn_id));
    const judged = await judge([...globalLiteral, ...projectUnique]);
    signal.throwIfAborted();
    const rejectedIds = new Set(judged.filteredOut.map(turn => turn.turn_id));
    return envelope(args, question, 'filtered-out', {
      global: { results: judged.filteredOut.filter(turn => globalIds.has(turn.turn_id)), literal_count: globalLiteral.length },
      project: { results: judged.filteredOut.filter(turn => !globalIds.has(turn.turn_id)), sessions: projectCandidates(sessions, projectLiteral, args.limit), literal_count: projectLiteral.length, matched_sessions: sessions.length, duplicates_removed: projectLiteral.length - projectUnique.length },
      results: judged.filteredOut, jev: judged.stats, audit: 'literal-union-before-review',
      excluded_subagent_sessions: index.excluded,
      reviewed_ids: rejectedIds.size,
    });
  }
  const global = await judge(globalLiteral);
  await index.settled(signal);
  const sessions = index.projects(args.entities);
  const projectLiteral = index.search(args.entities, args.limit, sessions.map(session => session.session_id));
  const project = await judge(projectLiteral);
  signal.throwIfAborted();
  const globalIds = new Set(global.results.map(turn => turn.turn_id));
  const uniqueProject = project.results.filter(turn => !globalIds.has(turn.turn_id));
  return envelope(args, question, 'recall', {
    global: { results: global.results, literal_count: globalLiteral.length, jev: global.stats },
    project: { results: uniqueProject, sessions: projectCandidates(sessions, projectLiteral, args.limit), literal_count: projectLiteral.length, matched_sessions: sessions.length,
      duplicates_removed: project.results.length - uniqueProject.length, jev: project.stats },
    results: [...global.results, ...uniqueProject], excluded_subagent_sessions: index.excluded,
  });
}
function projectCandidates(sessions, turns, limit) {
  const ids = new Set(turns.map(turn => turn.session_id));
  const selected = turns.length ? sessions.filter(session => ids.has(session.session_id)) : sessions.slice(0, limit);
    return selected.map(({ first_user_text, ...session }) => ({ ...session, first_user_text: clip(first_user_text, LIMITS.snippet).text }));
}
function envelope(args, question, mode, fields) {
  return { source: 'dsh', query: args.entities.join(' | '), entities: args.entities, question,
    scope: 'global-project', mode, retrieval_unit: 'turn', limit_per_stage: args.limit, ...fields };
}

/** One output text budget shared across both stage arrays and their flattened results. */
export function boundRecall(value) {
  let remaining = LIMITS.maxChars;
  const replacements = new Map();
  for (const turn of value.results) {
    const user = clip(turn.user_text, remaining);
    remaining -= user.text.length;
    const reply = clip(turn.reply_text, remaining);
    remaining -= reply.text.length;
    replacements.set(turn.turn_id, { ...turn, user_text: user.text, reply_text: reply.text,
      user_text_truncated: user.truncated, reply_text_truncated: reply.truncated });
  }
  value.results = value.results.map(turn => replacements.get(turn.turn_id));
  for (const stage of [value.global, value.project]) stage.results = stage.results.map(turn => replacements.get(turn.turn_id));
  value.text_truncated = value.results.some(turn => turn.user_text_truncated || turn.reply_text_truncated);
  return value;
}

export function normalizeTurnRead(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected an argument object.');
  for (const key of Object.keys(input)) if (!['session_id', 'from_turn_index', 'to_turn_index', 'max_chars'].includes(key)) throw new Error(`Unknown parameter: ${key}`);
  if (typeof input.session_id !== 'string' || !input.session_id.trim() || input.session_id.length > 2000) throw new Error('session_id must be nonempty text of at most 2000 characters.');
  const from = input.from_turn_index, to = input.to_turn_index;
  if (!Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(to) || to < from || to - from >= LIMITS.maxContext) throw new Error('Provide inclusive from_turn_index and to_turn_index: nonnegative integers spanning at most 20 turns.');
  const maxChars = input.max_chars == null ? LIMITS.chars : input.max_chars;
  if (!Number.isSafeInteger(maxChars) || maxChars < 100 || maxChars > LIMITS.maxChars) throw new Error('max_chars must be an integer between 100 and 24000.');
  return { session_id: input.session_id.trim(), from, to, maxChars };
}
export function readTurns(index, args) {
  const source = index.read(args.session_id, args.from, args.to);
  let remaining = args.maxChars;
  const turns = source.turns.map(({ ts, ...turn }) => {
    const user = clip(turn.user_text, remaining); remaining -= user.text.length;
    const reply = clip(turn.reply_text, remaining); remaining -= reply.text.length;
    return { ...turn, time: ts, user_text: user.text, reply_text: reply.text, user_text_truncated: user.truncated, reply_text_truncated: reply.truncated };
  });
  return { source: 'dsh', ...source, turns, read_mode: 'turns', from_turn_index: args.from, to_turn_index: args.to,
    truncated: turns.some(turn => turn.user_text_truncated || turn.reply_text_truncated) };
}
