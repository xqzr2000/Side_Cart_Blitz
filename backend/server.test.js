const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
const { server, runRoom } = require('./server');

const realFetch = globalThis.fetch;
const OPENROUTER = 'https://openrouter.ai/';

function toolCall(id, name, args) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function reply(message) {
  return { model: 'stub/model', choices: [{ message }] };
}

/**
 * Stands in for OpenRouter and replays a scripted agent turn, so the tool loop,
 * the action plumbing and the SSE frames are all exercised without a live model.
 */
function stubOpenRouter(script) {
  const calls = [];
  let index = 0;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith(OPENROUTER)) return realFetch(url, options);
    const body = JSON.parse(options.body);
    calls.push(body);
    const next = script[Math.min(index, script.length - 1)];
    index += 1;
    return new Response(JSON.stringify(next(body)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return calls;
}

const BODY = {
  sessionId: 'test-session',
  messages: [{ role: 'user', content: 'I want to go to Coachella. Can you help me save for it?' }],
  state: {
    settings: {
      budget: 900,
      currency: 'CAD',
      bills: [
        { name: 'Phone plan', amount: 45 },
        { name: 'Streaming plus', amount: 16 },
        { name: 'Campus gym', amount: 25 },
        { name: 'Textbook rental', amount: 39 },
      ],
    },
    items: [
      { title: 'Intro to Economics', price: 189, status: 'bought', currency: 'CAD', fingerprint: 'b1' },
      { title: 'Dorm bedding set', price: 96, status: 'bought', currency: 'CAD', fingerprint: 'b2' },
      { title: 'Grocery run', price: 88, status: 'bought', currency: 'CAD', fingerprint: 'b3' },
      { title: 'LED desk lamp', price: 42, status: 'bought', currency: 'CAD', fingerprint: 'b4' },
      { title: 'Wired earbuds', price: 60, status: 'bought', currency: 'CAD', fingerprint: 'b5' },
      { title: 'Nintendo Switch 2 bundle', price: 529, status: 'considering', currency: 'CAD', fingerprint: 'c1' },
      { title: 'Air fryer, 4L', price: 119, status: 'considering', intent: 'buying', currency: 'CAD', fingerprint: 'c2' },
    ],
    goals: [],
  },
};

const COACHELLA_SCRIPT = [
  () => reply({ role: 'assistant', content: '', tool_calls: [toolCall('t1', 'estimate_goal_costs', { goal: 'Coachella 2027' })] }),
  () => reply({ role: 'assistant', content: '', tool_calls: [toolCall('t2', 'draft_savings_plan', { targetDate: '2027-04-09' })] }),
  () =>
    reply({
      role: 'assistant',
      content: '',
      tool_calls: [
        toolCall('t3', 'create_savings_goal', {
          name: 'Coachella Fund',
          emoji: '🎪',
          targetAmount: 2124,
          monthlyContribution: 150,
          targetDate: '2027-04-09',
          rationale: 'Lean student trip, funded from free money only.',
        }),
        toolCall('t4', 'suggest_savings_opportunities', {
          suggestions: [
            { label: 'Nintendo Switch 2 bundle', amount: 529, reason: 'Still in considering, not charged yet.' },
            { label: 'A latte habit I made up', amount: 60, reason: 'Not real.' },
          ],
        }),
      ],
    }),
  (body) =>
    reply({
      role: 'assistant',
      content: body.messages.some((m) => m.role === 'system' && /You are Mom/.test(m.content))
        ? 'That plan protects your free money. Keep the CA$150 untouchable.'
        : 'Set up the Coachella Fund at CA$150/month.',
    }),
];

test.after(() => {
  globalThis.fetch = realFetch;
  server.close();
});

test('the room runs Bestie tools end to end and returns applyable actions', async () => {
  const calls = stubOpenRouter(COACHELLA_SCRIPT);
  const result = await runRoom({ body: BODY });

  assert.equal(result.replies.length, 2);
  assert.equal(result.replies[0].agent, 'Bestie');
  assert.equal(result.replies[1].agent, 'Mom');
  assert.deepEqual(result.warnings, []);

  const created = result.actions.find((action) => action.type === 'create_goal');
  assert.ok(created, 'the agent actually created a goal');
  assert.equal(created.goal.name, 'Coachella Fund');
  assert.equal(created.goal.monthlyContribution, 150);
  assert.equal(created.goal.currency, 'CAD');
  assert.ok(created.goal.breakdown.length >= 5, 'the researched breakdown rides onto the card');

  const suggestions = result.actions.find((action) => action.type === 'set_opportunities');
  assert.equal(suggestions.opportunities.length, 1, 'the invented expense was dropped');
  assert.equal(suggestions.opportunities[0].fingerprint, 'c1');

  // Only Bestie is handed tools; Mom answers with Bestie's turn already in view.
  const bestieCalls = calls.filter((call) => call.tools);
  assert.ok(bestieCalls.length >= 3);
  const momCall = calls.at(-1);
  assert.equal(momCall.tools, undefined);
  assert.ok(momCall.messages.some((m) => /\[Bestie, in the room\]/.test(m.content || '')));
  assert.ok(momCall.messages.some((m) => /created the savings card "Coachella Fund"/.test(m.content || '')));
});

test('one agent failing does not take the room down', async () => {
  let call = 0;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith(OPENROUTER)) return realFetch(url, options);
    call += 1;
    if (call === 1) return new Response(JSON.stringify({ error: { message: 'upstream exploded' } }), { status: 502 });
    return new Response(JSON.stringify(reply({ role: 'assistant', content: 'I am still here.' })), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await runRoom({ body: BODY });
  assert.equal(result.replies.length, 1);
  assert.equal(result.replies[0].agent, 'Mom');
  assert.ok(result.warnings.some((warning) => /Bestie: upstream exploded/.test(warning)));
});

test('a request with no user message is rejected', async () => {
  stubOpenRouter(COACHELLA_SCRIPT);
  await assert.rejects(() => runRoom({ body: { messages: [] } }), /user message is required/);
});

test('the SSE endpoint streams tool progress, messages and actions in order', async () => {
  stubOpenRouter(COACHELLA_SCRIPT);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const response = await realFetch(`http://127.0.0.1:${port}/api/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(BODY),
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);

  const raw = await response.text();
  const events = raw
    .split('\n\n')
    .filter((frame) => frame.startsWith('event:'))
    .map((frame) => {
      const lines = frame.split('\n');
      return {
        name: lines.find((line) => line.startsWith('event:')).slice(6).trim(),
        data: JSON.parse(lines.find((line) => line.startsWith('data:')).slice(5).trim()),
      };
    });

  const names = events.map((event) => event.name);
  assert.equal(names[0], 'open');
  assert.equal(names.at(-1), 'done');

  const tools = events.filter((event) => event.name === 'tool').map((event) => event.data.tool);
  assert.deepEqual(tools, ['estimate_goal_costs', 'draft_savings_plan', 'create_savings_goal', 'suggest_savings_opportunities']);
  assert.ok(events.filter((event) => event.name === 'tool_result').every((event) => event.data.ok));

  // Progress must reach the panel before the reply it explains.
  assert.ok(names.indexOf('tool') < names.indexOf('message'));

  const actions = events.find((event) => event.name === 'actions');
  assert.ok(actions.data.actions.some((action) => action.type === 'create_goal'));

  const messages = events.filter((event) => event.name === 'message');
  assert.deepEqual(messages.map((event) => event.data.agent), ['Bestie', 'Mom']);
});

test('health reports the tool surface so the options page can verify it', async () => {
  const { port } = server.address();
  const response = await realFetch(`http://127.0.0.1:${port}/health`);
  const data = await response.json();

  assert.equal(data.ok, true);
  assert.equal(data.streaming, true);
  assert.ok(data.tools.includes('create_savings_goal'));
});
