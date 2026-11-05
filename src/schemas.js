const string = description => ({ type: 'string', ...(description ? { description } : {}) });
const integer = description => ({ type: 'integer', ...(description ? { description } : {}) });
const optional = schema => ({ oneOf: [schema, { type: 'null' }] });
const boolean = { type: 'boolean' };
const nullableString = optional(string());
const array = items => ({ type: 'array', items });
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });

export const searchParameters = obj({
  entities: { ...array(string()), description: 'Required: 2–8 literal topic entities. Substring OR over persisted DSH source turns, global first then entity-discovered stored CWD basenames; no current-session/project/time scope.' },
  question: string('Required complete user question, at most 1000 characters.'),
  limit: optional(integer('Top K per stage. 1–50; default plugin recall.limit (20). Jev filtering/deduplication never refills.')),
}, ['entities', 'question']);
export const reviewParameters = searchParameters;
const discussionParticipant = obj({
  session_id: string('Exact persisted DSH main-session ID returned by recall_memory. The user must confirm this participant.'),
  from_turn_index: integer('Inclusive first evidence turn for this participant.'),
  to_turn_index: integer('Inclusive last evidence turn; the range can contain at most 20 turns.'),
});
export const discussionParameters = obj({
  participants: { type: 'array', minItems: 1, maxItems: 3, items: discussionParticipant, description: 'One to three user-confirmed historical DSH participants. They run sequentially and never see each other’s answers.' },
  question: string('Complete question for every historical participant, at most 1000 characters.'),
  max_chars: optional(integer('Visible evidence budget per participant, 100–24000; default 12000. Truncation is explicit.')),
}, ['participants', 'question']);
export const readParameters = obj({
  session_id: string('Exact persisted DSH session ID returned by recall_memory.'),
  from_turn_index: integer('Inclusive start of a source-turn read.'),
  to_turn_index: integer('Inclusive end of a source-turn read, at most 20 turns. Use the hit turn_index for both bounds to read one turn.'),
  max_chars: optional(integer('Total visible text budget, 100–24000; default 12000. Truncation is explicit.')),
}, ['session_id', 'from_turn_index', 'to_turn_index']);
const source = { type: 'string', const: 'dsh' };
const match = obj({
  source, coordinate_kind: { type: 'string', const: 'native-event' },
  session_id: string(), cwd: nullableString, created_at: integer(), live: boolean, persisted: boolean,
  seq: integer(), type: string(), time: integer(), surface: string(), snippet: string(), snippet_truncated: boolean,
  retrieval_unit: { type: 'string', const: 'turn' }, turn_id: string(), turn_index: integer(), end_seq: integer(),
  score: integer(), matching_entities: array(string()), tool_names: nullableString,
  user_text: string(), reply_text: string(), user_text_truncated: boolean, reply_text_truncated: boolean,
  noul: { type: 'number', description: 'Maximum segment probability in [0, 1], validated before exposure.' },
}, ['session_id', 'cwd', 'created_at', 'seq', 'type', 'time', 'surface', 'snippet', 'snippet_truncated']);
const jevStats = obj({
  status: { type: 'string', enum: ['filtered', 'disabled', 'unavailable'] }, model: string(), context_window: integer(),
  reviewed: integer(), retained: integer(), filtered: integer(), segmented: integer(),
  threshold: { type: 'number', const: 0.5 }, evidence: { type: 'string', const: 'source-turns' },
  reason: string(),
}, ['status', 'model', 'reviewed', 'retained', 'filtered', 'segmented', 'threshold', 'evidence']);
const projectSession = obj({ source, session_id: string(), cwd: nullableString, created_at: integer(), turn_count: integer(), first_user_text: string() });
const stage = obj({ results: array(match), sessions: array(projectSession), literal_count: integer(), matched_sessions: integer(), duplicates_removed: integer(), jev: jevStats }, ['results', 'literal_count']);
export const searchOutput = obj({
  source: { type: 'string', const: 'dsh' }, query: string(), scope: { type: 'string', enum: ['all', 'cwd', 'session', 'global-project'] },
  entities: array(string()), retrieval_unit: { type: 'string', const: 'turn' }, limit_per_stage: integer(),
  global: stage, project: stage, audit: string(), reviewed_ids: integer(), text_truncated: boolean,
  results: array(match), excluded_subagent_sessions: integer(),
  question: string(), mode: { type: 'string', enum: ['recall', 'filtered-out'] }, jev: jevStats, export_path: string(),
}, ['source', 'query', 'scope', 'results', 'excluded_subagent_sessions']);
const turn = obj({ turn_id: string(), turn_index: integer(), seq: integer(), end_seq: integer(), time: integer(),
  user_text: string(), reply_text: string(), tool_names: nullableString, user_text_truncated: boolean, reply_text_truncated: boolean });
export const readOutput = obj({
  source, session_id: string(), cwd: nullableString, created_at: integer(),
  read_mode: { type: 'string', const: 'turns' }, from_turn_index: integer(), to_turn_index: integer(), turns: array(turn),
  truncated: boolean,
}, ['source', 'session_id', 'cwd', 'created_at', 'truncated']);
const discussionAnswer = obj({
  session_id: string(), from_turn_index: integer(), to_turn_index: integer(), evidence_turn_ids: array(string()),
  evidence_truncated: boolean, answer: string(),
});
export const discussionOutput = obj({
  source, question: string(), participant_count: integer(), execution: { type: 'string', const: 'sequential' },
  privacy: { type: 'string', const: 'isolated' }, consensus_is_verification: { type: 'boolean', const: false }, answers: array(discussionAnswer),
});
export const emptyParameters = obj({});
export const historyOutput = obj({
  source: { type: 'string', const: 'dsh' }, storage: { type: 'string', enum: ['context-owned-memory-sqlite', 'plugin-owned-durable-sqlite'] },
  sessions: integer(), events: integer(), turns: integer(), oldest_ts: optional(integer()), newest_ts: optional(integer()),
  excluded_subagent_sessions: integer(), indexed: integer(), unchanged: integer(), removed: integer(),
}, ['source', 'storage', 'sessions', 'events', 'turns', 'oldest_ts', 'newest_ts', 'excluded_subagent_sessions']);
