const test = require('node:test');
const assert = require('node:assert/strict');
const { buildToolContext, executeTool } = require('./tools');
const { REFERENCE_AS_OF_LABEL } = require('./cost-library');

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

// Stands in for the user tapping "Create it" on the confirmation card: the
// proposed goal becomes a real one the later tools can act on.
function proposeAndAccept(ctx, args) {
  const result = executeTool('propose_savings_goal', args, ctx);
  assert.equal(result.ok, true, result.error);
  ctx.pendingGoals = ctx.pendingGoals.filter((goal) => goal.id !== result.goal.id);
  ctx.goals.push(result.goal);
  ctx.actions.length = 0;
  return { goalId: result.goal.id, goal: result.goal };
}

test('cost estimation falls back to the grounded reference library and totals server-side', () => {
  const ctx = buildToolContext(demoState(), NOW);
  const result = executeTool('estimate_goal_costs', { goal: 'Coachella 2027' }, ctx);

  assert.equal(result.ok, true);
  assert.equal(result.currency, 'CAD');
  assert.equal(result.source, 'reference-library');
  assert.ok(result.lineItems.length >= 5);
  assert.ok(result.disclaimer.includes(REFERENCE_AS_OF_LABEL), 'the estimate says how old its figures are');
  assert.match(result.disclaimer, /not a live quote/);
  assert.match(result.disclaimer, /static reference rate/, 'a converted estimate says the rate is static');
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

test('proposing a goal emits an offer and changes nothing yet', () => {
  const ctx = buildToolContext(demoState(), NOW);
  executeTool('estimate_goal_costs', { goal: 'Coachella 2027' }, ctx);
  const result = executeTool('propose_savings_goal', {
    name: 'Coachella Fund',
    emoji: '🎪',
    targetAmount: 2124,
    monthlyContribution: 150,
    targetDate: '2027-04-09',
    rationale: 'Lean student trip, reserved from free money only.',
  }, ctx);

  assert.equal(result.ok, true);
  assert.equal(result.proposed, true);
  assert.equal(ctx.actions.length, 1);

  const [action] = ctx.actions;
  assert.equal(action.type, 'propose_goal');
  assert.equal(action.proposal.status, 'pending');
  assert.equal(action.proposal.confirmLabel, 'Create it');

  const { goal } = action.proposal;
  assert.equal(goal.name, 'Coachella Fund');
  assert.equal(goal.monthlyContribution, 150);
  assert.equal(goal.currency, 'CAD');
  assert.equal(goal.saved, 0);
  assert.ok(goal.breakdown.length >= 5, 'the estimate breakdown rides along onto the card');

  // Nothing is committed until the user taps through.
  assert.deepEqual(ctx.goals, [], 'no goal exists yet');
  assert.equal(ctx.reserved, 0, 'no budget is reserved yet');
  assert.match(result.note, /NOTHING HAS BEEN CREATED/);
});

test('duplicate goal names are rejected so the agent updates instead of stacking cards', () => {
  const ctx = buildToolContext(demoState(), NOW);
  proposeAndAccept(ctx, { name: 'Coachella Fund', targetAmount: 2000 });
  const again = executeTool('propose_savings_goal', { name: 'coachella fund', targetAmount: 2000 }, ctx);
  assert.equal(again.ok, false);
  assert.match(again.error, /already exists/);
});

test('the same card is not offered twice in one turn', () => {
  const ctx = buildToolContext(demoState(), NOW);
  executeTool('propose_savings_goal', { name: 'Coachella Fund', targetAmount: 2000 }, ctx);
  const again = executeTool('propose_savings_goal', { name: 'Coachella Fund', targetAmount: 2000 }, ctx);
  assert.equal(again.ok, false);
  assert.match(again.error, /already put a/);
  assert.equal(ctx.actions.length, 1);
});

test('contributions accumulate, clamp at the target, and report progress', () => {
  const ctx = buildToolContext(demoState(), NOW);
  const created = proposeAndAccept(ctx, { name: 'Coachella Fund', targetAmount: 300, monthlyContribution: 150 });
  executeTool('contribute_to_goal', { goal: created.goalId, amount: 100 }, ctx);
  const result = executeTool('contribute_to_goal', { goal: 'Coachella Fund', amount: 900 }, ctx);

  assert.equal(result.saved, 300);
  assert.equal(result.remaining, 0);
  assert.equal(result.percent, 100);
  assert.equal(result.reached, true);
});

test('savings suggestions are filtered against what is really in the cart', () => {
  const ctx = buildToolContext(demoState(), NOW);
  proposeAndAccept(ctx, { name: 'Coachella Fund', targetAmount: 2124, monthlyContribution: 150 });

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
  const created = proposeAndAccept(ctx, { name: 'Coachella Fund', targetAmount: 1200, monthlyContribution: 100 });
  const result = executeTool('update_savings_goal', { goal: created.goalId, monthlyContribution: 200 }, ctx);

  assert.equal(result.ok, true);
  assert.equal(result.goal.monthlyContribution, 200);
  assert.equal(result.goal.months, 6);
  assert.equal(ctx.actions.at(-1).type, 'update_goal');
});

test('malformed tool arguments fail closed', () => {
  const ctx = buildToolContext(demoState(), NOW);
  assert.equal(executeTool('propose_savings_goal', '{not json', ctx).ok, false);
  assert.equal(executeTool('no_such_tool', {}, ctx).ok, false);
  assert.equal(executeTool('propose_savings_goal', { name: 'X', targetAmount: 0 }, ctx).ok, false);
});

test('a library-sourced goal carries the dated disclaimer onto the card', () => {
  const ctx = buildToolContext(demoState(), NOW);
  executeTool('estimate_goal_costs', { goal: 'Coachella 2027' }, ctx);
  const created = executeTool('propose_savings_goal', {
    name: 'Coachella Fund',
    targetAmount: 2124,
    monthlyContribution: 150,
  }, ctx).goal;

  assert.ok(created.estimateNote.includes(REFERENCE_AS_OF_LABEL));
  assert.equal(created.estimateNote, ctx.scratch.estimate.disclaimer);
});

test("the agent's own researched figures are not stamped with the library's date", () => {
  const ctx = buildToolContext(demoState(), NOW);
  executeTool('estimate_goal_costs', {
    goal: 'Coachella',
    lineItems: [{ label: 'Pass', amount: 900 }, { label: 'Flight', amount: 500 }],
  }, ctx);
  const created = executeTool('propose_savings_goal', {
    name: 'Coachella Fund',
    targetAmount: 1400,
    monthlyContribution: 150,
    breakdown: [{ label: 'Pass', amount: 900 }, { label: 'Flight', amount: 500 }],
  }, ctx).goal;

  assert.equal(created.estimateNote, '', 'no inherited date when the figures are the agent own');
});

test('a currency that needs no conversion does not claim a conversion happened', () => {
  const state = demoState();
  state.settings.currency = 'USD';
  const ctx = buildToolContext(state, NOW);
  const result = executeTool('estimate_goal_costs', { goal: 'Coachella 2027' }, ctx);

  assert.ok(result.disclaimer.includes(REFERENCE_AS_OF_LABEL));
  assert.doesNotMatch(result.disclaimer, /reference rate/);
});

test('suggestions can attach to a goal the user has not confirmed yet', () => {
  const ctx = buildToolContext(demoState(), NOW);
  const offer = executeTool('propose_savings_goal', { name: 'Coachella Fund', targetAmount: 2124, monthlyContribution: 150 }, ctx);

  const result = executeTool('suggest_savings_opportunities', {
    suggestions: [{ label: 'Switch 2 bundle', amount: 529, reason: 'Not charged yet.' }],
  }, ctx);

  assert.equal(result.ok, true);
  assert.equal(result.attachedToUnconfirmedGoal, true);
  assert.equal(result.attached, 1);

  // They ride inside the offer rather than as a separate write.
  assert.equal(ctx.actions.length, 1, 'still just the one proposal');
  assert.equal(ctx.actions[0].proposal.goal.opportunities.length, 1);
  assert.equal(offer.goal.opportunities[0].fingerprint, 'c1');
});

test('a cart cleanup offer only lists items that are really in the cart', () => {
  const ctx = buildToolContext(demoState(), NOW);
  const result = executeTool('propose_cart_cleanup', {
    headline: 'Drop these to get back under budget?',
    items: [
      { item: 'Switch 2 bundle', reason: 'Biggest single thing in the cart.' },
      { item: 'Air fryer', reason: 'The dorm kitchen already has one.', recommended: false },
      { item: 'A yacht', reason: 'Made up.' },
    ],
  }, ctx);

  assert.equal(result.ok, true);
  assert.equal(result.proposed, true);
  assert.equal(result.offered, 2, 'the invented item was dropped');
  assert.deepEqual(result.rejected, ['A yacht']);
  assert.match(result.note, /NOTHING HAS BEEN REMOVED/);

  const { proposal } = ctx.actions[0];
  assert.equal(ctx.actions[0].type, 'propose_removal');
  assert.equal(proposal.status, 'pending');
  assert.equal(proposal.items[0].fingerprint, 'c1');
  assert.equal(proposal.items[0].recommended, true);
  assert.equal(proposal.items[1].recommended, false, 'borderline calls arrive unticked');
  assert.equal(result.recommendedTotal, 529, 'only the ticked ones are totalled');
});

test('a cleanup offer matching nothing shows no card and says why', () => {
  const ctx = buildToolContext(demoState(), NOW);
  const result = executeTool('propose_cart_cleanup', {
    items: [{ item: 'a private jet', reason: 'Nope.' }],
  }, ctx);

  assert.equal(result.ok, false);
  assert.equal(ctx.actions.length, 0);
  assert.ok(result.cartTitles.includes('Switch 2 bundle'), 'the agent is shown what is actually there');
});

test('the same item cannot be offered twice on one cleanup card', () => {
  const ctx = buildToolContext(demoState(), NOW);
  const result = executeTool('propose_cart_cleanup', {
    items: [
      { item: 'Switch 2 bundle', reason: 'First.' },
      { item: 'switch 2 bundle', reason: 'Same thing again.' },
    ],
  }, ctx);

  assert.equal(result.offered, 1);
});

test('a cleanup offer needs a non-empty cart', () => {
  const state = demoState();
  state.items = [];
  const ctx = buildToolContext(state, NOW);
  const result = executeTool('propose_cart_cleanup', { items: [{ item: 'anything', reason: 'x' }] }, ctx);
  assert.equal(result.ok, false);
  assert.match(result.error, /nothing in the cart/);
});
