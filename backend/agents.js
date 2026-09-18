const { estimateCapacity, findSavingsOpportunities, round } = require('./planner');
const { referenceContext } = require('./cost-library');

const AGENTS = {
  Mom: {
    name: 'Mom',
    usesTools: false,
    system: `You are Mom in a two-agent budgeting room inside a shopping companion.
Your job is to guard the user's wallet and gently talk them out of unnecessary impulse purchases.
Be warm, protective, practical, and concise. Never shame, scold, moralize, or act controlling.
Use only the budget, shopping cards, savings goals, and bills supplied in context. Never invent income, bills, debt, or prices.
Call out concrete tradeoffs: amount remaining, how much this item would consume, duplicate/similar considering items, and whether waiting 24 hours could help.
If the item appears necessary or already planned, acknowledge that instead of arguing blindly.
Money reserved for a savings goal is already spoken for. Treat it as unavailable, and defend it when a purchase would eat into it.
When the user is working on a savings goal, Bestie owns the plan and the numbers. Do not restate or recompute her figures. Add the one guardrail that protects the plan: what could derail it, or what should stay untouched.
Prefer 2-5 short sentences. End with at most one useful question when a question is warranted.`,
  },
  Bestie: {
    name: 'Bestie',
    usesTools: true,
    system: `You are Bestie in a two-agent budgeting room inside a shopping companion.
Your job is to help the user remember upcoming bills, fit shopping into the rest of their month, and turn things they want into savings plans that actually work.
Be friendly, grounded, concise, and zero-pressure. Never shame or guilt the user.
Use only bills, budget, cart, and goal data supplied in context; never fabricate obligations or prices.

YOU HAVE TOOLS AND YOU ARE EXPECTED TO USE THEM. When the user wants to save for something, work in this order:
1. estimate_goal_costs — break the goal into real line items (ticket, travel, lodging, food, local transport, essentials). Prefer your own researched figures; the tool falls back to a built-in reference estimate.
2. draft_savings_plan — never state a monthly number you worked out in your head. This tool knows their budget, bills, current spending and existing reservations.
3. create_savings_goal — when they have agreed, or when they asked you to set it up, actually create the card. Do not describe a card you have not created.
4. list_savings_candidates then suggest_savings_opportunities — show where the money can come from, using only spending that is really in their cart or bills.

Rules for numbers: every amount and date you say out loud must come back from a tool. Tools total and round for you; quote their output rather than doing arithmetic.
Be honest when the plan does not fit. If the deadline needs more per month than they can hold, say so plainly, give the date they can actually make, and offer the trade: trim these expenses, or aim at the next edition.
Say that cost estimates are estimates. Never present them as live prices you just looked up unless a tool result says the figures were researched.
After creating a goal, tell them in one line what you set up and what it means for this month's free money.
Prefer 2-5 short sentences. End with at most one useful question when a question is warranted.`,
  },
};

function money(value, currency = 'USD') {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function buildBudgetContext(state = {}, options = {}) {
  const settings = state.settings || {};
  const items = Array.isArray(state.items) ? state.items : [];
  const bills = Array.isArray(settings.bills) ? settings.bills : [];
  const goals = Array.isArray(state.goals) ? state.goals : [];
  const currency = settings.currency || 'USD';
  const budget = Number(settings.budget || 0);

  const relevantItems = items.filter(
    (item) => !item.currency || item.currency === currency,
  );
  const bought = relevantItems.filter((item) => item.status === 'bought');
  const considering = relevantItems.filter((item) => item.status !== 'bought');
  const spent = bought.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
  const consideringTotal = considering.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1),
    0,
  );
  const billsTotal = bills.reduce((sum, bill) => sum + Number(bill.amount || 0), 0);

  const activeGoals = goals.filter((goal) => goal.status !== 'paused' && goal.status !== 'reached');
  const reserved = activeGoals.reduce((sum, goal) => sum + Number(goal.monthlyContribution || 0), 0);
  const capacity = estimateCapacity({ budget, billsTotal, reserved, typicalSpend: spent });

  const itemLines = items.slice(0, 20).map((item) => {
    const price = item.price == null ? 'price unknown' : money(item.price, item.currency || currency);
    return `- [${item.status || 'considering'}] ${item.title || 'Untitled item'} — ${price} — ${item.site || 'unknown site'}`;
  });

  const billLines = bills.slice(0, 20).map((bill) => {
    const due = bill.dueDate ? ` due ${bill.dueDate}` : '';
    return `- ${bill.name || 'Bill'} — ${money(bill.amount, currency)}${due}`;
  });

  const goalLines = goals.slice(0, 10).map((goal) => {
    const saved = money(goal.saved, goal.currency || currency);
    const target = money(goal.targetAmount, goal.currency || currency);
    const monthly = money(goal.monthlyContribution, goal.currency || currency);
    const due = goal.targetDate ? `, target ${goal.targetDate}` : '';
    const ready = goal.projectedReadyDate ? `, on track for ${goal.projectedReadyDate}` : '';
    return `- ${goal.name} (id ${goal.id}) — ${saved} of ${target} saved, reserving ${monthly}/month [${goal.status || 'active'}]${due}${ready}`;
  });

  const candidates = findSavingsOpportunities({ items, bills, currency });
  const candidateLines = candidates.map(
    (entry) => `- ${entry.label} — ${money(entry.amount, currency)}${entry.recurring ? '/month, recurring' : ', one-time'} (${entry.kind})`,
  );

  const reference = options.userMessage ? referenceContext(options.userMessage, currency) : '';

  const sections = [
    `BUDGET SNAPSHOT\nCurrency: ${currency}\nBudget: ${money(budget, currency)}\nActually marked bought: ${money(spent, currency)}\nRemaining before upcoming bills: ${money(budget - spent, currency)}\nConsidering / buying-now cards: ${money(consideringTotal, currency)}\nUpcoming bills total entered by user: ${money(billsTotal, currency)}\nRemaining after bought items + entered bills: ${money(budget - spent - billsTotal, currency)}\nReserved by active savings goals: ${money(reserved, currency)}\nFree to spend after bought items, bills and reservations: ${money(round(capacity.disposable), currency)}\nComfortable monthly savings capacity: ${money(capacity.comfortable, currency)} (leaves breathing room on purpose)`,
    `SHOPPING CARDS\n${itemLines.length ? itemLines.join('\n') : '- None'}`,
    `UPCOMING BILLS\n${billLines.length ? billLines.join('\n') : '- None entered'}`,
    `SAVINGS GOALS\n${goalLines.length ? goalLines.join('\n') : '- None yet'}`,
    `REDIRECTABLE SPENDING (from this user's own cart and bills — the only things you may suggest cutting)\n${candidateLines.length ? candidateLines.join('\n') : '- Nothing in the cart to redirect right now'}`,
  ];

  if (reference) sections.push(reference);
  sections.push(`TODAY IS ${new Date(options.now || Date.now()).toISOString().slice(0, 10)}.`);

  return sections.join('\n\n');
}

module.exports = { AGENTS, buildBudgetContext };
