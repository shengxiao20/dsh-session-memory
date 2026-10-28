const string = description => ({ type: 'string', ...(description ? { description } : {}) });
const integer = description => ({ type: 'integer', ...(description ? { description } : {}) });
const optional = schema => ({ oneOf: [schema, { type: 'null' }] });
const boolean = { type: 'boolean' };
const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] };
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });

export const searchParameters = obj({
  query: string('Literal word or phrase to find. DSH normalizes whitespace; this is token/phrase matching, not substring or FTS syntax. Maximum 1000 characters.'),
  session_id: optional(string('Exact DSH session ID to search within; omit or use null for all main sessions. Cannot combine with cwd.')),
  cwd: optional(string('Explicit exact recorded session directory filter; no implicit current-project scope. Omit or use null for no directory filter. Cannot combine with session_id.')),
  limit: optional(integer('Native page size, 1–50; omit or use null for 20. Excluding subagent sessions can yield fewer matches.')),
  cursor: optional(string('next_cursor from the previous page; repeat the same query, scope and limit. Omit or use null for the first page. If stale, restart without cursor.')),
}, ['query']);
export const readParameters = obj({
  session_id: string('Exact DSH session ID from recall_memory.'),
  seq: integer('Zero-based event sequence from a search hit or a prior read.'),
  before: optional(integer('Number of preceding raw events, 0–20; omit or use null for 4.')),
  after: optional(integer('Number of following raw events, 0–20; omit or use null for 4.')),
  max_chars: optional(integer('Total recalled text budget, 100–24000; omit or use null for 12000. The target event is prioritized.')),
}, ['session_id', 'seq']);
const match = obj({
  session_id: string(), cwd: nullableString, created_at: integer(), live: boolean, persisted: boolean,
  seq: integer(), type: string(), time: integer(), surface: string(), snippet: string(), snippet_truncated: boolean,
}, ['session_id', 'cwd', 'created_at', 'seq', 'type', 'time', 'surface', 'snippet', 'snippet_truncated']);
export const searchOutput = obj({
  source: { type: 'string', const: 'dsh' }, query: string(), scope: { type: 'string', enum: ['all', 'cwd', 'session'] },
  results: { type: 'array', items: match }, excluded_subagent_sessions: integer(), next_cursor: string(),
}, ['source', 'query', 'scope', 'results', 'excluded_subagent_sessions']);
export const readOutput = obj({
  source: { type: 'string', const: 'dsh' }, session_id: string(), cwd: nullableString, created_at: integer(),
  target_seq: integer(), start_seq: integer(), end_seq: integer(), inherited_event_count: integer(),
  events: { type: 'array', items: obj({ seq: integer(), type: string(), time: integer(), text: string(), text_truncated: boolean }) },
  truncated: boolean,
});
