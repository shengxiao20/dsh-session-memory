// Canonical DSH history source backed by the public persistence contract.
// Source logs stay authoritative; this adapter never parses or writes JSONL artifacts.
export class DshHistorySource {
  constructor(sessions, persistence) {
    this.sessions = sessions;
    this.persistence = persistence;
  }

  async listSessions(signal) {
    signal?.throwIfAborted();
    const snapshots = await this.persistence.list({ signal });
    signal?.throwIfAborted();
    return snapshots.map(snapshot => ({
      header: snapshot.header,
      live: this.sessions.get(snapshot.header.id) !== undefined,
      persisted: true,
    }));
  }

  async observeSession(sessionId, { signal } = {}) {
    signal?.throwIfAborted();
    const handle = await this.persistence.open(sessionId, 'read', { signal });
    try {
      const result = await handle.read(0, undefined, { signal });
      signal?.throwIfAborted();
      return {
        header: handle.header,
        events: [...result.events],
        [Symbol.dispose]() {},
      };
    } finally {
      await handle.close();
    }
  }

  async flush(session) {
    const participated = await this.sessions.flush(session);
    if (!participated) throw new Error('DSH session persistence did not participate in the durability barrier.');
  }
}
