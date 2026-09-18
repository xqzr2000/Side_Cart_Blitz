const test = require('node:test');
const assert = require('node:assert/strict');
const { buildToolContext, executeTool } = require('./tools');

const NOW = new Date('2026-09-18T12:00:00Z');

function demoState() {
  return {
    settings: {
      budget: 900,
      currency: 'CAD',
      bills: [
        { name: 'Phone', amount: 45, dueDate: '2026-09-28' },
        { name: 'Streaming plus', amount: 16, dueDate: '2026-09-22' },
        { name: 'Campus gym', amount: 25, dueDate: '2026-10-01' },
        { name: 'Textbook rental', amount: 39, dueDate: '2026-10-05' },
      ],
    },
    items: [
      { title: 'Intro to Econ textbook', price: 189, status: 'bought', currency: 'CAD', fingerprint: 'b1' },
      { title: 'Dorm bedding set', price: 96, status: 'bought', currency: 'CAD', fingerprint: 'b2' },
      { title: 'Grocery run', price: 88, status: 'bought', currency: 'CAD', fingerprint: 'b3' },
      { title: 'Desk lamp', price: 42, status: 'bought', currency: 'CAD', fingerprint: 'b4' },
      { title: 'Wired headphones', price: 60, status: 'bought', currency: 'CAD', fingerprint: 'b5' },
      { title: 'Switch 2 bundle', price: 529, status: 'considering', currency: 'CAD', fingerprint: 'c1' },
      { title: 'Air fryer', price: 119, status: 'considering', intent: 'buying', currency: 'CAD', fingerprint: 'c2' },
    ],
    goals: [],
  };
}

test('cost estimation falls back to the grounded reference library and totals server-side', () => {
  const ctx = buildToolContext(demoState(), NOW);
  const result = executeTool('estimate_goal_costs', { goal: 'Coachella 2027' }, ctx);

  assert.equal(result.ok, true);
  assert.equal(result.currency, 'CAD');
  assert.equal(result.source, 'reference-library');
  assert.ok(result.lineItems.length >= 5);
  assert.match(result.disclaimer, /not a live price quote/);
  assert.equal(result.total, result.lineItems.reduce((sum, item) => sum + item.amount, 0));
  assert.ok(result.total > 1500 && result.total < 3500, `unexpected CAD total: ${result.total}`);
});

test('an unknown goal with no line items is refused rather than guessed at', () => {
  const ctx = buildToolContext(demoState(), NOW);
  const result = executeTool('estimate_goal_costs', { goal: 'a trip to Neptune' }, ctx);
  assert.equal(result.ok, false);
  assert.match(result.error, /No built-in reference/);
});

test('agent-supplied line items are totalled by code, not by the model', () => {
  const ctx = buildToolContext(demoState(), NOW);
  const result = executeTool('estimate_goal_costs', {
    goal: 'Coachella',
    lineItems: [
      { label: 'Pass', amount: 900 },
      { label: 'Flight', amount: 520 },
      { label: 'Food', amount: 240 },
    ],
  }, ctx);
  assert.equal(result.source, 'agent');
  assert.equal(result.total, 1660);
});

test('a plan reuses the estimate and is bounded by real budget capacity', () => {
  const ctx = buildToolContext(demoState(), NOW);
  executeTool('estimate_goal_costs', { goal: 'Coachella 2027' }, ctx);
  const result = executeTool('draft_savings_plan', { targetDate: '2027-04-09' }, ctx);

  assert.equal(result.ok, true);
  assert.equal(result.budgetPicture.comfortableMonthlyCapacity, 150);
  assert.equal(result.plan.monthlyContribution, 150);
  assert.equal(result.plan.onTime, false, 'six months is not enough runway at this capacity');
  assert.ok(result.plan.requiredForDeadline > result.plan.monthlyContribution);
  assert.ok(result.redirectableFromCart.oneTime > 0);
});

test('draft_savings_plan refuses to invent a target out of thin air', () => {
  const ctx = buildToolContext(demoState(), NOW);
  const result = executeTool('draft_savings_plan', {}, ctx);
  assert.equal(result.ok, false);
});

test('creating a goal emits an action and reserves the monthly amount', () => {
  const ctx = buildToolContext(demoState(), NOW);
  executeTool('estimate_goal_costs', { goal: 'Coachella 2027' }, ctx);
  const result = executeTool('create_savings_goal', {
    name: 'Coachella Fund',
    emoji: '🎪',
    targetAmount: 2124,
    monthlyContribution: 150,
    targetDate: '2027-04-09',
    rationale: 'Lean student trip, reserved from free money only.',
  }, ctx);

  assert.equal(result.ok, true);
  assert.equal(ctx.actions.length, 1);

  const [action] = ctx.actions;
  assert.equal(action.type, 'create_goal');
  assert.equal(action.goal.name, 'Coachella Fund');
  assert.equal(action.goal.monthlyContribution, 150);
  assert.equal(action.goal.currency, 'CAD');
  assert.equal(action.goal.saved, 0);
  assert.equal(action.goal.status, 'active');
  assert.ok(action.goal.breakdown.length >= 5, 'the estimate breakdown rides along onto the card');
  assert.equal(ctx.reserved, 150);
});

test('duplicate goal names are rejected so the agent updates instead of stacking cards', () => {
  const ctx = buildToolContext(demoState(), NOW);
  executeTool('create_savings_goal', { name: 'Coachella Fund', targetAmount: 2000 }, ctx);
  const again = executeTool('create_savings_goal', { name: 'coachella fund', targetAmount: 2000 }, ctx);
  assert.equal(again.ok, false);
  assert.match(again.error, /already exists/);
});

test('contributions accumulate, clamp at the target, and report progress', () => {
  const ctx = buildToolContext(demoState(), NOW);
  const created = executeTool('create_savings_goal', { name: 'Coachella Fund', targetAmount: 300, monthlyContribution: 150 }, ctx);
  executeTool('contribute_to_goal', { goal: created.goalId, amount: 100 }, ctx);
  const result = executeTool('contribute_to_goal', { goal: 'Coachella Fund', amount: 900 }, ctx);

  assert.equal(result.saved, 300);
  assert.equal(result.remaining, 0);
  assert.equal(result.percent, 100);
  assert.equal(result.reached, true);
});

test('savings suggestions are filtered against what is really in the cart', () => {
  const ctx = buildToolContext(demoState(), NOW);
  executeTool('create_savings_goal', { name: 'Coachella Fund', targetAmount: 2124, monthlyContribution: 150 }, ctx);

  const candidates = executeTool('list_savings_candidates', {}, ctx);
  assert.ok(candidates.candidates.some((entry) => entry.label === 'Switch 2 bundle'));

  const result = executeTool('suggest_savings_opportunities', {
    suggestions: [
      { label: 'Switch 2 bundle', amount: 529, reason: 'Still in considering, not charged yet.' },
      { label: 'Daily oat latte habit', amount: 90, reason: 'Invented out of nowhere.' },
    ],
  }, ctx);

  assert.equal(result.ok, true);
  assert.equal(result.attached, 1);
  assert.deepEqual(result.rejected, ['Daily oat latte habit']);

  const action = ctx.actions.at(-1);
  assert.equal(action.type, 'set_opportunities');
  assert.equal(action.opportunities[0].fingerprint, 'c1');
});

test('suggestions need a goal to hang off', () => {
  const ctx = buildToolContext(demoState(), NOW);
  const result = executeTool('suggest_savings_opportunities', { suggestions: [{ label: 'Air fryer', amount: 119, reason: 'x' }] }, ctx);
  assert.equal(result.ok, false);
});

test('updating a goal recomputes the timeline instead of trusting the patch', () => {
  const ctx = buildToolContext(demoState(), NOW);
  const created = executeTool('create_savings_goal', { name: 'Coachella Fund', targetAmount: 1200, monthlyContribution: 100 }, ctx);
  const result = executeTool('update_savings_goal', { goal: created.goalId, monthlyContribution: 200 }, ctx);

  assert.equal(result.ok, true);
  assert.equal(result.goal.monthlyContribution, 200);
  assert.equal(result.goal.months, 6);
  assert.equal(ctx.actions.at(-1).type, 'update_goal');
});

test('malformed tool arguments fail closed', () => {
  const ctx = buildToolContext(demoState(), NOW);
  assert.equal(executeTool('create_savings_goal', '{not json', ctx).ok, false);
  assert.equal(executeTool('no_such_tool', {}, ctx).ok, false);
  assert.equal(executeTool('create_savings_goal', { name: 'X', targetAmount: 0 }, ctx).ok, false);
});
