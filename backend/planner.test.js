const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, estimateCapacity, findSavingsOpportunities, monthsUntil, roundUpTo } = require('./planner');

const NOW = new Date('2026-09-18T12:00:00Z');

test('capacity leaves breathing room instead of claiming every free dollar', () => {
  const capacity = estimateCapacity({ budget: 900, billsTotal: 125, reserved: 0, typicalSpend: 475 });
  assert.equal(capacity.disposable, 300);
  assert.equal(capacity.comfortable, 150);
});

test('capacity never goes negative when the month is already blown', () => {
  const capacity = estimateCapacity({ budget: 400, billsTotal: 300, reserved: 100, typicalSpend: 200 });
  assert.equal(capacity.disposable, 0);
  assert.equal(capacity.comfortable, 0);
});

test('a deadline drives the monthly contribution, rounded up to a clean step', () => {
  const plan = buildPlan({ targetAmount: 2124, targetDate: '2027-04-09', monthlyCapacity: null, now: NOW });
  assert.equal(plan.deadlineMonths, 6);
  assert.equal(plan.monthlyContribution, 355);
  assert.ok(plan.onTime);
  assert.ok(plan.monthlyContribution * plan.months >= plan.remaining);
});

test('an unaffordable deadline is reported honestly, not quietly rounded away', () => {
  const plan = buildPlan({ targetAmount: 2124, targetDate: '2027-04-09', monthlyCapacity: 150, now: NOW });
  assert.equal(plan.monthlyContribution, 150);
  assert.equal(plan.requiredForDeadline, 355);
  assert.equal(plan.monthlyShortfall, 205);
  assert.equal(plan.onTime, false);
  assert.equal(plan.months, 15);
  assert.match(plan.projectedReadyDate, /^2027-12/);
  assert.ok(plan.notes.some((note) => /above what this budget can hold/.test(note)));
});

test('the projected date always covers the full remaining amount', () => {
  const plan = buildPlan({ targetAmount: 1000, alreadySaved: 175, preferredMonthly: 90, now: NOW });
  assert.equal(plan.remaining, 825);
  assert.equal(plan.months, 10);
  assert.ok(plan.monthlyContribution * plan.months >= plan.remaining);
});

test('a funded goal reports as reached rather than asking for more money', () => {
  const plan = buildPlan({ targetAmount: 500, alreadySaved: 500, now: NOW });
  assert.equal(plan.reached, true);
  assert.equal(plan.monthlyContribution, 0);
});

test('a target date in the past is called out instead of producing a plan that cannot work', () => {
  const plan = buildPlan({ targetAmount: 600, targetDate: '2026-01-01', now: NOW });
  assert.equal(plan.onTime, false);
  assert.ok(plan.notes.some((note) => /already in the past/.test(note)));
});

test('no capacity at all is surfaced as a blocker', () => {
  const plan = buildPlan({ targetAmount: 600, monthlyCapacity: 0, now: NOW });
  assert.ok(plan.notes.some((note) => /no free room/.test(note)));
});

test('monthsUntil is positive ahead of the date and negative behind it', () => {
  assert.ok(monthsUntil('2027-04-09', NOW) > 6);
  assert.ok(monthsUntil('2026-01-01', NOW) < 0);
});

test('roundUpTo never rounds a requirement down', () => {
  assert.equal(roundUpTo(151, 5), 155);
  assert.equal(roundUpTo(150, 5), 150);
});

test('savings opportunities come only from the user own cart and bills', () => {
  const opportunities = findSavingsOpportunities({
    currency: 'CAD',
    items: [
      { title: 'Switch 2 bundle', price: 529, status: 'considering', currency: 'CAD', fingerprint: 'a' },
      { title: 'Air fryer', price: 119, status: 'considering', intent: 'buying', currency: 'CAD', fingerprint: 'b' },
      { title: 'Air fryer', price: 119, status: 'considering', currency: 'CAD', fingerprint: 'c' },
      { title: 'Textbooks', price: 189, status: 'bought', currency: 'CAD', fingerprint: 'd' },
      { title: 'Euro gadget', price: 300, status: 'considering', currency: 'EUR', fingerprint: 'e' },
    ],
    bills: [{ name: 'Streaming plus', amount: 16 }, { name: 'Phone', amount: 45 }],
  });

  const labels = opportunities.map((entry) => entry.label);
  assert.ok(!labels.includes('Textbooks'), 'already-bought items are not redirectable');
  assert.ok(!labels.includes('Euro gadget'), 'other-currency items are excluded');
  assert.ok(opportunities.some((entry) => entry.kind === 'duplicate'));
  assert.ok(opportunities.some((entry) => entry.kind === 'buying-now'));

  const subscription = opportunities.find((entry) => entry.kind === 'subscription');
  assert.equal(subscription.label, 'Streaming plus');
  assert.equal(subscription.recurring, true);
  assert.ok(!opportunities.some((entry) => entry.label === 'Phone'), 'a phone bill is not an optional subscription');
});
