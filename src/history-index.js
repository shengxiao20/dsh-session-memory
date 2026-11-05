import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { isMainSession, LIMITS, clip } from './memory.js';

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY, cwd TEXT, created_at INTEGER NOT NULL,
  live INTEGER NOT NULL, persisted INTEGER NOT NULL, fingerprint TEXT NOT NULL,
  event_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS turns (
  turn_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL, seq INTEGER NOT NULL, end_seq INTEGER NOT NULL, ts INTEGER NOT NULL,
  user_text TEXT NOT NULL, reply_text TEXT NOT NULL, tool_names TEXT
);
CREATE INDEX IF NOT EXISTS turns_session ON turns(session_id, turn_index);
CREATE INDEX IF NOT EXISTS turns_time ON turns(ts DESC);
`;

export function defaultIndexPath(home = homedir(), env = process.env) {
  const root = env.DSH_HOME == null || !env.DSH_HOME.trim() ? join(home, '.dsh') : env.DSH_HOME;
  const expanded = root === '~' ? home : /^~[\\/]/u.test(root) ? join(home, root.slice(2)) : root;
  return join(resolve(expanded), 'dsh-session-memory', 'history.sqlite');
}

/** Visible source text only: no reasoning, binary attachments or tool-result payloads. */
function visibleText(message) {
  if (typeof message.content === 'string') return message.content.trim();
  if (!Array.isArray(message.content)) throw new Error('Invalid conversation content: expected text or content blocks.');
  return message.content.filter(block => block.type === 'text').map(block => {
    if (typeof block.text !== 'string') throw new Error('Invalid text content block.');
    return block.text.trim();
  }).filter(Boolean).join('\n');
}

/** Stable user-message slices over an immutable persisted DSH log, including unanswered users. */
export function buildDshTurns(sessionId, events) {
  const turns = [];
  let owner;
  let index = 0;
  for (const event of events) {
    if (event.surfaceOp && event.surfaceOp !== 'append') { if (owner) owner.end_seq = event.seq; continue; }
    if (event.type === 'user/message') {
      if (owner) owner.end_seq = event.seq - 1;
      owner = undefined;
      const turnIndex = index++;
      const userText = visibleText(event.data);
      if (userText) {
        owner = { turn_id: `dsh:${sessionId}:${event.seq}`, session_id: sessionId, turn_index: turnIndex,
          seq: event.seq, end_seq: event.seq, ts: event.time, user_text: userText, reply_text: '', tools: new Set() };
        turns.push(owner);
      }
    } else if (event.type === 'assistant/message' && owner) {
      const message = event.data.message;
      const text = visibleText(message);
      if (text) owner.reply_text += (owner.reply_text ? '\n' : '') + text;
      if (Array.isArray(message.content)) for (const block of message.content) {
        if (block.type === 'tool-call') owner.tools.add(block.name);
      }
    } else if (event.type === 'tool/call' && owner) {
      owner.tools.add(event.data.name);
    }
    if (owner) owner.end_seq = event.seq;
  }
  return turns.map(({ tools, ...turn }) => ({ ...turn, tool_names: tools.size ? JSON.stringify([...tools]) : null }));
}

/** Same normalized token-sequence containment rule as Pi project discovery. */
export function matchesProject(cwd, entities) {
  if (typeof cwd !== 'string' || !cwd.trim()) return false;
  const tokenize = value => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const basename = cwd.replace(/[\\/]+$/u, '').split(/[\\/]/u).at(-1);
  const project = tokenize(basename);
  return entities.some(entity => {
    const tokens = tokenize(entity);
    return tokens.length > 0 && project.some((_, start) => tokens.every((token, offset) => project[start + offset] === token));
  });
}

/** Context-owned, rebuildable SQLite materialization; authoritative history stays in DSH. */
export class NativeHistoryIndex {
  constructor(historySource, path = ':memory:') {
    this.historySource = historySource;
    this.path = path;
    this.storage = path === ':memory:' ? 'context-owned-memory-sqlite' : 'plugin-owned-durable-sqlite';
    this.queue = Promise.resolve();
    this.db = undefined;
    this.disposed = false;
    this.excluded = 0;
  }
  synchronize(signal, force = false) {
    const task = this.queue.then(() => this.sync(signal, force), () => this.sync(signal, force));
    this.queue = task;
    // Keep rejection observable to the caller, without an unhandled queue rejection.
    task.catch(() => {});
    return task;
  }
  async settled(signal) {
    let observed;
    do {
      observed = this.queue;
      await observed;
      signal.throwIfAborted();
    } while (observed !== this.queue);
  }
  async sync(signal, force) {
    signal.throwIfAborted();
    if (this.disposed) throw new Error('DSH history index disposed.');
    if (!this.db) {
      const { DatabaseSync } = await import('node:sqlite');
      signal.throwIfAborted();
      if (this.path !== ':memory:') {
        const { mkdir } = await import('node:fs/promises');
        const { dirname } = await import('node:path');
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        signal.throwIfAborted();
      }
      if (this.disposed) throw new Error('DSH history index disposed.');
      const db = new DatabaseSync(this.path);
      try {
        if (this.path !== ':memory:') {
          const { chmod } = await import('node:fs/promises');
          await chmod(this.path, 0o600);
        }
        const { user_version: version } = db.prepare('PRAGMA user_version').get();
        if (![0, 2].includes(version)) throw new Error(`Unsupported DSH memory index schema version: ${version}`);
        db.exec(`${SCHEMA}\nPRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA user_version = 2;`);
        if (this.path !== ':memory:') {
          const { chmod } = await import('node:fs/promises');
          for (const suffix of ['-wal', '-shm']) await chmod(this.path + suffix, 0o600);
        }
        this.db = db;
      } catch (error) { db.close(); throw error; }
      signal.throwIfAborted();
      if (this.disposed) throw new Error('DSH history index disposed.');
    }
    const records = await this.historySource.listSessions(signal);
    signal.throwIfAborted();
    const retained = new Set();
    let indexed = 0, unchanged = 0, excluded = 0;
    this.db.exec('BEGIN');
    try {
      for (const record of records) {
        signal.throwIfAborted();
        const observation = await this.historySource.observeSession(record.header.id, { signal });
        try {
          const header = observation.header;
          if (!isMainSession(header)) { excluded++; continue; }
          retained.add(header.id);
          // Hash the immutable cut as well as metadata: reset/replay can reuse a seq.
          const events = observation.events;
          const fingerprint = createHash('sha256').update(JSON.stringify([header, events])).digest('hex');
          const previous = this.db.prepare('SELECT fingerprint FROM sessions WHERE session_id = ?').get(header.id);
          if (!force && previous?.fingerprint === fingerprint) {
            this.db.prepare('UPDATE sessions SET live = ?, persisted = ? WHERE session_id = ?').run(Number(record.live), Number(record.persisted), header.id);
            unchanged++;
            continue;
          }
          const turns = buildDshTurns(header.id, events);
          this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(header.id);
          this.db.prepare('INSERT INTO sessions (session_id, cwd, created_at, live, persisted, fingerprint, event_count) VALUES (?, ?, ?, ?, ?, ?, ?)').run(header.id, header.cwd ?? null, header.createdAt, Number(record.live), Number(record.persisted), fingerprint, events.length);
          const insert = this.db.prepare('INSERT INTO turns VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
          for (const turn of turns) insert.run(turn.turn_id, turn.session_id, turn.turn_index, turn.seq, turn.end_seq, turn.ts, turn.user_text, turn.reply_text, turn.tool_names);
          indexed++;
        } finally { observation[Symbol.dispose](); }
      }
      let removed = 0;
      for (const row of this.db.prepare('SELECT session_id FROM sessions').all()) {
        if (!retained.has(row.session_id)) { this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(row.session_id); removed++; }
      }
      signal.throwIfAborted();
      this.db.exec('COMMIT');
      this.excluded = excluded;
      return { indexed, unchanged, removed, excluded_subagent_sessions: excluded, ...this.statistics() };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  search(entities, limit, sessionIds) {
    const clauses = entities.map(() => "instr(lower(t.user_text || ' ' || t.reply_text), ?) > 0");
    const score = clauses.map(clause => `CASE WHEN ${clause} THEN 1 ELSE 0 END`).join(' + ');
    const filters = [`(${clauses.join(' OR ')})`];
    const parameters = [...entities, ...entities];
    if (sessionIds !== undefined) {
      if (!sessionIds.length) return [];
      filters.push('t.session_id IN (SELECT value FROM json_each(?))');
      parameters.push(JSON.stringify(sessionIds));
    }
    const rows = this.db.prepare(`SELECT t.*, s.cwd, s.created_at, s.live, s.persisted, (${score}) AS score
      FROM turns t JOIN sessions s USING (session_id) WHERE ${filters.join(' AND ')}
      ORDER BY score DESC, t.ts DESC, t.turn_id LIMIT ?`).all(...parameters, limit);
    return rows.map(({ ts, end_seq, tool_names, ...row }) => {
      const text = `${row.user_text} ${row.reply_text}`;
      // Match SQLite's built-in lower(): ASCII case folding, Unicode otherwise literal.
      const lower = text.replace(/[A-Z]/gu, character => character.toLowerCase());
      const matched = entities.filter(entity => lower.includes(entity));
      const positions = matched.map(entity => lower.indexOf(entity));
      const start = Math.max(0, Math.min(...positions) - 120);
      const excerpt = clip(text.slice(start), LIMITS.snippet);
      return { ...row, live: Boolean(row.live), persisted: Boolean(row.persisted), time: ts, end_seq, tool_names,
        source: 'dsh', retrieval_unit: 'turn', coordinate_kind: 'native-event', type: 'user/turn', surface: 'raw-log', snippet: excerpt.text,
        snippet_truncated: start > 0 || excerpt.truncated, matching_entities: matched };
    });
  }
  projects(entities) {
    return this.db.prepare(`SELECT 'dsh' AS source, s.session_id, s.cwd, s.created_at,
      (SELECT count(*) FROM turns t WHERE t.session_id = s.session_id) AS turn_count,
      (SELECT substr(t.user_text, 1, 500) FROM turns t WHERE t.session_id = s.session_id ORDER BY t.turn_index LIMIT 1) AS first_user_text
      FROM sessions s WHERE EXISTS (SELECT 1 FROM turns WHERE turns.session_id = s.session_id)
      ORDER BY s.created_at DESC, s.session_id`).all().filter(session => matchesProject(session.cwd, entities));
  }
  read(sessionId, from, to) {
    const session = this.db.prepare('SELECT session_id, cwd, created_at FROM sessions WHERE session_id = ?').get(sessionId);
    if (!session) throw new Error(`History session not found: ${sessionId}`);
    const turns = this.db.prepare('SELECT turn_id, turn_index, seq, end_seq, ts, user_text, reply_text, tool_names FROM turns WHERE session_id = ? AND turn_index BETWEEN ? AND ? ORDER BY turn_index').all(sessionId, from, to);
    return { ...session, turns };
  }
  statistics() {
    if (!this.db) throw new Error('DSH history index has not been synchronized.');
    const sessions = this.db.prepare('SELECT count(*) AS sessions, coalesce(sum(event_count), 0) AS events FROM sessions').get();
    const turns = this.db.prepare('SELECT count(*) AS turns, min(ts) AS oldest_ts, max(ts) AS newest_ts FROM turns').get();
    return { source: 'dsh', storage: this.storage, ...sessions, ...turns, excluded_subagent_sessions: this.excluded };
  }
  async shutdown() {
    this.disposed = true;
    await Promise.allSettled([this.queue]);
    this.db?.close();
    this.db = undefined;
  }
}
