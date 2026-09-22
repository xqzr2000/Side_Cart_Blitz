const SUPPORTED_CURRENCIES = new Set(['USD', 'CAD', 'EUR', 'GBP', 'JPY', 'INR', 'AUD', 'NZD', 'SGD', 'AED']);
const STATUS = new Set(['considering', 'pending', 'bought']);

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function cleanText(value, max = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanCurrency(value, fallback = 'USD') {
  const currency = cleanText(value, 3).toUpperCase();
  return SUPPORTED_CURRENCIES.has(currency) ? currency : fallback;
}

function sanitizeState(input = {}) {
  const rawSettings = input && typeof input.settings === 'object' ? input.settings : {};
  const currency = cleanCurrency(rawSettings.currency, 'USD');
  const bills = Array.isArray(rawSettings.bills)
    ? rawSettings.bills.slice(0, 50).map((bill) => ({
        name: cleanText(bill?.name || 'Bill', 100),
        amount: finiteNonNegative(bill?.amount),
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(bill?.dueDate || '')) ? String(bill.dueDate) : '',
      }))
    : [];

  const items = Array.isArray(input.items)
    ? input.items.slice(0, 100).map((item) => {
        const itemCurrency = cleanCurrency(item?.currency, currency);
        return {
          title: cleanText(item?.title || 'Shopping item', 240),
          site: cleanText(item?.site || '', 120),
          price: item?.price == null ? null : finiteNonNegative(item.price, null),
          quantity: Math.min(99, Math.max(1, Math.round(finiteNonNegative(item?.quantity, 1)))),
          currency: itemCurrency,
          status: STATUS.has(item?.status) ? item.status : 'considering',
          intent: cleanText(item?.intent || '', 40),
        };
      })
    : [];

  return {
    settings: {
      budget: finiteNonNegative(rawSettings.budget),
      currency,
      bills,
    },
    items,
  };
}

function summarizeBudget(input = {}) {
  const state = sanitizeState(input);
  const { budget, currency, bills } = state.settings;
  const relevant = state.items.filter((item) => item.currency === currency);
  const bought = relevant.filter((item) => item.status === 'bought');
  const pending = relevant.filter((item) => item.status === 'pending');
  const considering = relevant.filter((item) => item.status === 'considering');
  const sum = (items) => items.reduce((total, item) => total + finiteNonNegative(item.price) * item.quantity, 0);
  const spent = sum(bought);
  const pendingTotal = sum(pending);
  const consideringTotal = sum(considering);
  const billsTotal = bills.reduce((total, bill) => total + finiteNonNegative(bill.amount), 0);
  const freeAfterBills = budget - spent - billsTotal;

  return {
    currency,
    budget,
    spent,
    pendingTotal,
    consideringTotal,
    billsTotal,
    remaining: budget - spent,
    freeAfterBills,
    utilization: budget > 0 ? spent / budget : 0,
    itemCount: relevant.length,
    omittedCurrencyItems: state.items.length - relevant.length,
    state,
  };
}

function money(value, currency = 'USD') {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function buildBudgetContext(input = {}) {
  const summary = summarizeBudget(input);
  const { state, currency } = summary;
  const itemLines = state.items.slice(0, 30).map((item) => {
    const price = item.price == null ? 'price unknown' : money(item.price * item.quantity, item.currency || currency);
    return `- [${item.status}] ${item.title} — ${price}${item.site ? ` — ${item.site}` : ''}`;
  });
  const billLines = state.settings.bills.slice(0, 30).map((bill) => {
    const due = bill.dueDate ? ` due ${bill.dueDate}` : '';
    return `- ${bill.name} — ${money(bill.amount, currency)}${due}`;
  });

  return [
    'BUDGET SNAPSHOT',
    `Currency: ${currency}`,
    `Monthly budget: ${money(summary.budget, currency)}`,
    `Confirmed purchases: ${money(summary.spent, currency)}`,
    `Pending checkout: ${money(summary.pendingTotal, currency)}`,
    `Considering: ${money(summary.consideringTotal, currency)}`,
    `Upcoming bills entered by user: ${money(summary.billsTotal, currency)}`,
    `Remaining before bills: ${money(summary.remaining, currency)}`,
    `Free after confirmed purchases + entered bills: ${money(summary.freeAfterBills, currency)}`,
    '',
    'SHOPPING ITEMS',
    itemLines.length ? itemLines.join('\n') : '- None',
    '',
    'UPCOMING BILLS',
    billLines.length ? billLines.join('\n') : '- None entered',
  ].join('\n');
}

function deterministicPurchaseRisk(input = {}) {
  const summary = summarizeBudget(input.state || {});
  const item = input.item || {};
  const price = finiteNonNegative(item.price, 0) * Math.max(1, finiteNonNegative(item.quantity, 1));
  const free = summary.freeAfterBills;
  const ratio = summary.budget > 0 ? price / summary.budget : 1;
  let level = 'low';
  if (price > free || free <= 0) level = 'critical';
  else if (ratio >= 0.25 || price > free * 0.5) level = 'high';
  else if (ratio >= 0.1 || price > free * 0.25) level = 'moderate';
  return { level, itemTotal: price, freeAfterBills: free, ratioOfBudget: ratio };
}

module.exports = {
  buildBudgetContext,
  cleanCurrency,
  deterministicPurchaseRisk,
  money,
  sanitizeState,
  summarizeBudget,
};
