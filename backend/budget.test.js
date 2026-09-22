const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeBudget, buildBudgetContext, deterministicPurchaseRisk, sanitizeState } = require('./budget');

test('budget summary separates confirmed, pending, considering, and bills', () => {
  const summary = summarizeBudget({
    settings: { budget: 1000, currency: 'USD', bills: [{ name: 'Phone', amount: 80 }] },
    items: [
      { title: 'Shoes', price: 120, status: 'bought', currency: 'USD' },
      { title: 'Headphones', price: 90, status: 'pending', currency: 'USD' },
      { title: 'Lamp', price: 40, status: 'considering', currency: 'USD' },
      { title: 'Tea', price: 10, status: 'bought', currency: 'GBP' },
    ],
  });
  assert.equal(summary.spent, 120);
  assert.equal(summary.pendingTotal, 90);
  assert.equal(summary.consideringTotal, 40);
  assert.equal(summary.billsTotal, 80);
  assert.equal(summary.freeAfterBills, 800);
  assert.equal(summary.omittedCurrencyItems, 1);
});

test('state sanitization clamps malformed numeric values', () => {
  const state = sanitizeState({
    settings: { budget: -10, currency: 'BAD', bills: [{ name: 'X', amount: -4 }] },
    items: [{ title: 'A', price: -20, quantity: 1000, status: 'hacked' }],
  });
  assert.equal(state.settings.budget, 0);
  assert.equal(state.settings.currency, 'USD');
  assert.equal(state.items[0].price, null);
  assert.equal(state.items[0].quantity, 99);
  assert.equal(state.items[0].status, 'considering');
});

test('budget context explicitly labels pending checkout as unconfirmed', () => {
  const context = buildBudgetContext({
    settings: { budget: 500, currency: 'USD', bills: [] },
    items: [{ title: 'Camera', price: 200, status: 'pending', currency: 'USD' }],
  });
  assert.match(context, /Pending checkout: \$200\.00/);
  assert.match(context, /\[pending\] Camera/);
});

test('deterministic risk becomes critical when candidate exceeds free-after-bills cash', () => {
  const risk = deterministicPurchaseRisk({
    state: { settings: { budget: 300, currency: 'USD', bills: [{ name: 'Rent', amount: 200 }] }, items: [] },
    item: { price: 150, quantity: 1 },
  });
  assert.equal(risk.level, 'critical');
  assert.equal(risk.freeAfterBills, 100);
});
