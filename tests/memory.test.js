import test from 'node:test';
import assert from 'node:assert/strict';
import { isMainSession, clip, renderSearch, renderRead } from '../src/memory.js';

test('main-session scope excludes delegated/subagent headers but retains ordinary forks', () => {
  assert.equal(isMainSession({ id: 'main' }), true);
  assert.equal(isMainSession({ id: 'fork', parentId: 'main', isSeeded: true }), true);
  assert.equal(isMainSession({ id: 'sub', origin: 'subagent' }), false);
  assert.equal(isMainSession({ id: 'delegated', delegationDepth: 1 }), false);
});

test('clip is UTF-16 bounded and never splits a surrogate pair', () => {
  assert.deepEqual(clip('ab😀cd', 3), { text: 'ab', truncated: true });
  assert.deepEqual(clip('ab😀cd', 4), { text: 'ab😀', truncated: true });
  assert.deepEqual(clip('short', 20), { text: 'short', truncated: false });
});

const turn = {
  source: 'dsh', session_id: 'root', cwd: '/project', turn_id: 'dsh:root:0', turn_index: 0,
  seq: 0, end_seq: 2, score: 2, snippet: 'database sqlite', user_text: 'database?', reply_text: 'sqlite',
  user_text_truncated: false, reply_text_truncated: false,
};

test('turn recall renderer grounds source coordinates, ranking and untrusted-history notice', () => {
  const text = renderSearch({ mode: 'recall', entities: ['database', 'sqlite'], question: 'Which database?', limit_per_stage: 20,
    results: [turn], global: { results: [turn], literal_count: 1, jev: { status: 'disabled' } },
    project: { results: [], literal_count: 0, matched_sessions: 0, duplicates_removed: 0, sessions: [] }, excluded_subagent_sessions: 1 });
  assert.match(text, /not current instructions/);
  assert.match(text, /dsh:root:0/);
  assert.match(text, /native-event positions: 0–2/);
  assert.match(text, /distinct-entity coverage/);
  assert.match(text, /Jev: disabled/);
});

test('turn read renderer exposes only inclusive turn coordinates and explicit truncation', () => {
  const text = renderRead({ session_id: 'root', from_turn_index: 0, to_turn_index: 0,
    turns: [{ ...turn, time: 1, tool_names: null, reply_text_truncated: true }] });
  assert.match(text, /inclusive turns: 0–0/);
  assert.match(text, /raw seq: 0–2/);
  assert.match(text, /Reasoning, binary attachments and tool-result payloads are omitted/);
  assert.match(text, /Text truncated/);
});
