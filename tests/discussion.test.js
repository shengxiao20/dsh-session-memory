import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscussionRuntime, normalizeDiscussion, renderDiscussion } from '../src/discussion.js';

const sourceEvents = session => [
  { seq: 0, time: 100, type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text: `${session} database decision` }] } },
  { seq: 1, time: 101, type: 'assistant/message', surfaceOp: 'append', data: { message: { role: 'assistant', content: [{ type: 'text', text: `${session} chose sqlite` }] } } },
  { seq: 2, time: 102, type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text: `${session} follow-up` }] } },
  { seq: 3, time: 103, type: 'assistant/message', surfaceOp: 'append', data: { message: { role: 'assistant', content: [{ type: 'text', text: `${session} confirmed` }] } } },
];

function fixture() {
  const stored = new Map([
    ['history-a', { header: { id: 'history-a', cwd: '/a', createdAt: 1 }, events: sourceEvents('history-a') }],
    ['history-b', { header: { id: 'history-b', cwd: '/b', createdAt: 2 }, events: sourceEvents('history-b') }],
  ]);
  const original = structuredClone([...stored]);
  const calls = [];
  let active = 0;
  const agents = {
    async create(options) {
      assert.equal(active, 0, 'participants must run sequentially');
      active++;
      const scoped = { restrictions: [], sections: [], suppressed: 0 };
      options.setup({
        tools: { restrict: value => scoped.restrictions.push(value) },
        systemPrompt: {
          suppressRuntimeContext: () => scoped.suppressed++,
          section: value => scoped.sections.push(value),
        },
      });
      const events = [];
      const agent = {
        options: options.agentOptions,
        session: {
          id: options.sessionId,
          header: options.meta,
          get seq() { return events.length; },
          snapshotEvents: () => [...events],
        },
        followup(message) {
          events.push({ seq: events.length, type: 'user/message', data: message });
          const source = message.content[0].text.match(/Historical source session: ([^\n]+)/u)?.[1];
          events.push({ seq: events.length, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: `private answer from ${source} citing dsh:${source}:0` }] } } });
        },
        whenIdle: async () => {},
        cancel: () => {},
      };
      calls.push({ options, scoped, agent });
      return { agent, async dispose() { active--; } };
    },
  };
  const historySource = {
    async observeSession(id) {
      const value = stored.get(id);
      if (!value) throw new Error(`missing ${id}`);
      return { header: value.header, events: value.events, [Symbol.dispose]() {} };
    },
  };
  return { runtime: new DiscussionRuntime(agents, historySource), calls, stored, original };
}

const mainAgent = {
  options: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'low' },
  session: { id: 'current-main', header: { id: 'current-main' } },
};

const input = {
  participants: [
    { session_id: 'history-a', from_turn_index: 0, to_turn_index: 1 },
    { session_id: 'history-b', from_turn_index: 0, to_turn_index: 0 },
  ],
  question: 'What database decision did we make?',
};

test('multi-agent Discussion runs confirmed historical participants sequentially and tool-free', async () => {
  const { runtime, calls, stored, original } = fixture();
  const value = await runtime.discuss(input, { agent: mainAgent, signal: new AbortController().signal });
  assert.equal(value.participant_count, 2);
  assert.equal(value.execution, 'sequential');
  assert.equal(value.privacy, 'isolated');
  assert.equal(value.consensus_is_verification, false);
  assert.deepEqual(value.answers.map(answer => answer.session_id), ['history-a', 'history-b']);
  assert.deepEqual(value.answers[0].evidence_turn_ids, ['dsh:history-a:0', 'dsh:history-a:2']);
  assert.match(value.answers[0].answer, /private answer from history-a/);
  assert.equal(calls.length, 2);
  for (const { options, scoped } of calls) {
    assert.equal(options.parentAgent, mainAgent);
    assert.equal(options.meta.origin, 'subagent');
    assert.equal(options.meta.delegationDepth, 1);
    assert.deepEqual(options.agentOptions, { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'low' });
    assert.deepEqual(scoped.restrictions, [{ allow: [] }]);
    assert.equal(scoped.suppressed, 1);
    assert.equal(scoped.sections.length, 1);
    assert.equal(scoped.sections[0].complete, true);
    assert.match(scoped.sections[0].text, /untrusted evidence/);
  }
  assert.deepEqual([...stored], original, 'source sessions must remain unchanged');
  const rendered = renderDiscussion(value);
  assert.match(rendered, /Participant agreement is not fact verification/);
  assert.match(rendered, /fetch_session/);
});

test('Discussion validates participant confirmation, bounds and initiating-agent isolation', async () => {
  assert.throws(() => normalizeDiscussion({ participants: [], question: 'q' }), /1–3/);
  assert.throws(() => normalizeDiscussion({ participants: [
    { session_id: 'history-a', from_turn_index: 0, to_turn_index: 0 },
    { session_id: 'history-a', from_turn_index: 0, to_turn_index: 0 },
  ], question: 'q' }), /Duplicate/);
  assert.throws(() => normalizeDiscussion({ participants: [{ session_id: 'history-a', from_turn_index: 0, to_turn_index: 20 }], question: 'q' }), /at most 20/);
  const { runtime } = fixture();
  await assert.rejects(runtime.discuss({ participants: [{ session_id: 'current-main', from_turn_index: 0, to_turn_index: 0 }], question: 'q' }, { agent: mainAgent }), /active main session/);
  await assert.rejects(runtime.discuss(input, {}), /initiating main DSH agent/);
});

test('Discussion rejects incomplete source ranges instead of silently reducing evidence', async () => {
  const { runtime } = fixture();
  await assert.rejects(runtime.discuss({ participants: [{ session_id: 'history-a', from_turn_index: 0, to_turn_index: 2 }], question: 'q' }, { agent: mainAgent }), /evidence range is incomplete/);
});
