const {
  buildPlan,
  estimateCapacity,
  findSavingsOpportunities,
  isoDate,
  round,
  summarizeOpportunities,
} = require('./planner');
const { referenceEstimate } = require('./cost-library');

const MAX_BREAKDOWN_ITEMS = 12;
const MAX_SUGGESTIONS = 6;

const TOOL_SPECS = [
  {
    type: 'function',
    function: {
      name: 'estimate_goal_costs',
      description:
        'Break a goal into its real cost line items and total them. Call this first for any "I want to save for X" request. Supply your own researched line items when you have them; leave lineItems empty to fall back to the built-in reference estimate.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'What the user wants, e.g. "Coachella 2027".' },
          lineItems: {
            type: 'array',
            description: 'Individual costs. Amounts must be in the user\'s currency.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                amount: { type: 'number' },
                note: { type: 'string', description: 'Where the number comes from or what tier it assumes.' },
              },
              required: ['label', 'amount'],
            },
          },
          assumptions: { type: 'string', description: 'Tier, dates, travel origin, who they are splitting costs with.' },
        },
        required: ['goal'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_savings_plan',
      description:
        'Compute the monthly contribution, timeline and feasibility for a target amount, using the user\'s real budget, bills and existing reservations. Always call this before quoting any monthly number.',
      parameters: {
        type: 'object',
        properties: {
          targetAmount: { type: 'number', description: 'Omit to reuse the total from estimate_goal_costs.' },
          targetDate: { type: 'string', description: 'YYYY-MM-DD deadline, if the goal has one.' },
          preferredMonthly: { type: 'number', description: 'Only if the user named an amount themselves.' },
          alreadySaved: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_savings_goal',
      description:
        'Create the savings card in the app and reserve the monthly amount from the budget. Call this once the user has agreed, or when they clearly asked you to set it up.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short card title, e.g. "Coachella Fund".' },
          emoji: { type: 'string', description: 'One emoji for the card.' },
          targetAmount: { type: 'number' },
          monthlyContribution: { type: 'number' },
          targetDate: { type: 'string', description: 'YYYY-MM-DD.' },
          rationale: { type: 'string', description: 'One sentence the card shows explaining the plan.' },
          breakdown: {
            type: 'array',
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, amount: { type: 'number' }, note: { type: 'string' } },
              required: ['label', 'amount'],
            },
          },
        },
        required: ['name', 'targetAmount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_savings_goal',
      description: 'Change the reserved amount, target, deadline or status of an existing savings goal.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'Goal id or name.' },
          monthlyContribution: { type: 'number' },
          targetAmount: { type: 'number' },
          targetDate: { type: 'string' },
          status: { type: 'string', enum: ['active', 'paused'] },
        },
        required: ['goal'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'contribute_to_goal',
      description: 'Record money the user is putting into a goal right now, outside the monthly reservation.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'Goal id or name.' },
          amount: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['goal', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_savings_candidates',
      description:
        'Read back the spending in the user\'s own cart and bills that could be redirected into a goal. Use this before suggesting anything to cut — never invent expenses.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggest_savings_opportunities',
      description:
        'Attach specific, user-facing "here is where the money comes from" suggestions to a goal. Only use labels returned by list_savings_candidates.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'Goal id or name. Defaults to the most recent goal.' },
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                amount: { type: 'number', description: 'Money freed, in the user\'s currency.' },
                recurring: { type: 'boolean', description: 'True if it frees this amount every month.' },
                reason: { type: 'string', description: 'One short sentence, zero guilt.' },
                fingerprint: { type: 'string', description: 'Copy from list_savings_candidates when it refers to a cart item.' },
              },
              required: ['label', 'amount', 'reason'],
            },
          },
        },
        required: ['suggestions'],
      },
    },
  },
];

const TOOL_LABELS = {
  estimate_goal_costs: 'Researching what this actually costs',
  draft_savings_plan: 'Running the numbers against your budget',
  create_savings_goal: 'Creating your savings card',
  update_savings_goal: 'Updating your savings card',
  contribute_to_goal: 'Adding money to your fund',
  list_savings_candidates: 'Scanning your cart for savings',
  suggest_savings_opportunities: 'Finding ways to get there sooner',
};

function clampNumber(value, { min = 0, max = 1_000_000, fallback = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return round(Math.min(max, Math.max(min, parsed)));
}

function clampText(value, max = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function clampEmoji(value) {
  const text = String(value ?? '').trim();
  return text ? [...text][0] : '🎯';
}

function normalizeBreakdown(lineItems, limit = MAX_BREAKDOWN_ITEMS) {
  if (!Array.isArray(lineItems)) return [];
  return lineItems
    .filter((item) => item && clampText(item.label))
    .slice(0, limit)
    .map((item) => ({
      label: clampText(item.label, 90),
      amount: clampNumber(item.amount),
      note: clampText(item.note, 160),
    }));
}

function newGoalId() {
  return `goal_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function findGoal(goals, needle) {
  if (!Array.isArray(goals) || !goals.length) return null;
  const key = clampText(needle).toLowerCase();
  if (!key) return goals[0];
  return (
    goals.find((goal) => String(goal.id).toLowerCase() === key) ||
    goals.find((goal) => String(goal.name).toLowerCase() === key) ||
    goals.find((goal) => String(goal.name).toLowerCase().includes(key) || key.includes(String(goal.name).toLowerCase())) ||
    goals[0]
  );
}

/**
 * Everything the agent needs to reason about money, computed once per request.
 */
function buildToolContext(state = {}, now = new Date()) {
  const settings = state.settings || {};
  const currency = settings.currency || 'USD';
  const items = Array.isArray(state.items) ? state.items : [];
  const bills = Array.isArray(settings.bills) ? settings.bills : [];
  const goals = Array.isArray(state.goals) ? state.goals : [];

  const relevant = items.filter((item) => !item.currency || item.currency === currency);
  const spent = relevant
    .filter((item) => item.status === 'bought')
    .reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
  const billsTotal = bills.reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
  const reserved = goals
    .filter((goal) => goal.status !== 'paused' && goal.status !== 'reached')
    .reduce((sum, goal) => sum + Number(goal.monthlyContribution || 0), 0);

  const capacity = estimateCapacity({
    budget: Number(settings.budget || 0),
    billsTotal,
    reserved,
    typicalSpend: spent,
  });

  return {
    now,
    currency,
    settings,
    items,
    bills,
    goals: goals.map((goal) => ({ ...goal })),
    budget: round(Number(settings.budget || 0)),
    spent: round(spent),
    billsTotal: round(billsTotal),
    reserved: round(reserved),
    capacity,
    candidates: findSavingsOpportunities({ items, bills, currency }),
    scratch: {},
    actions: [],
  };
}

const HANDLERS = {
  estimate_goal_costs(args, ctx) {
    const goal = clampText(args.goal, 120) || 'this goal';
    let breakdown = normalizeBreakdown(args.lineItems);
    let source = 'agent';
    let disclaimer = '';

    if (!breakdown.length) {
      const reference = referenceEstimate(goal, ctx.currency);
      if (!reference) {
        return {
          ok: false,
          error: `No built-in reference for "${goal}". Supply lineItems yourself, in ${ctx.currency}.`,
        };
      }
      breakdown = reference.lineItems;
      source = 'reference-library';
      disclaimer = [reference.disclaimer, reference.fxNote].filter(Boolean).join(' ');
    }

    const total = round(breakdown.reduce((sum, item) => sum + item.amount, 0));
    const reference = referenceEstimate(goal, ctx.currency);
    ctx.scratch.estimate = { goal, breakdown, total, currency: ctx.currency };

    return {
      ok: true,
      goal,
      currency: ctx.currency,
      lineItems: breakdown,
      total,
      source,
      disclaimer,
      assumptions: clampText(args.assumptions, 400),
      referenceTotalForComparison: reference ? reference.total : null,
      upcomingDates: reference?.nextDates || [],
      note: 'Total computed server-side from the line items. Quote this number, do not re-add it yourself.',
    };
  },

  draft_savings_plan(args, ctx) {
    const targetAmount = clampNumber(args.targetAmount) || ctx.scratch.estimate?.total || 0;
    if (!targetAmount) {
      return { ok: false, error: 'No target amount. Call estimate_goal_costs first or pass targetAmount.' };
    }

    const plan = buildPlan({
      targetAmount,
      alreadySaved: clampNumber(args.alreadySaved),
      targetDate: clampText(args.targetDate, 30),
      preferredMonthly: clampNumber(args.preferredMonthly),
      monthlyCapacity: ctx.capacity.comfortable,
      now: ctx.now,
    });

    ctx.scratch.plan = plan;
    const savings = summarizeOpportunities(ctx.candidates);

    return {
      ok: true,
      currency: ctx.currency,
      plan,
      budgetPicture: {
        budget: ctx.budget,
        billsTotal: ctx.billsTotal,
        markedBought: ctx.spent,
        alreadyReservedByOtherGoals: ctx.reserved,
        disposable: ctx.capacity.disposable,
        comfortableMonthlyCapacity: ctx.capacity.comfortable,
      },
      redirectableFromCart: savings,
      note: 'These numbers are computed, not estimated. Use them verbatim.',
    };
  },

  create_savings_goal(args, ctx) {
    const name = clampText(args.name, 60) || 'Savings Goal';
    const targetAmount = clampNumber(args.targetAmount) || ctx.scratch.estimate?.total || 0;
    if (!targetAmount) return { ok: false, error: 'targetAmount is required and must be above zero.' };

    const existing = ctx.goals.find((goal) => String(goal.name).toLowerCase() === name.toLowerCase());
    if (existing) {
      return { ok: false, error: `A goal named "${name}" already exists. Use update_savings_goal instead.`, goalId: existing.id };
    }

    const breakdown = normalizeBreakdown(args.breakdown).length
      ? normalizeBreakdown(args.breakdown)
      : ctx.scratch.estimate?.breakdown || [];

    const plan = buildPlan({
      targetAmount,
      targetDate: clampText(args.targetDate, 30),
      preferredMonthly: clampNumber(args.monthlyContribution),
      monthlyCapacity: ctx.capacity.comfortable,
      now: ctx.now,
    });

    const goal = {
      id: newGoalId(),
      name,
      emoji: clampEmoji(args.emoji),
      currency: ctx.currency,
      targetAmount: plan.targetAmount,
      monthlyContribution: plan.monthlyContribution,
      saved: 0,
      targetDate: plan.targetDate,
      projectedReadyDate: plan.projectedReadyDate,
      months: plan.months,
      status: 'active',
      rationale: clampText(args.rationale, 240),
      breakdown,
      opportunities: [],
      contributions: [],
      createdBy: 'Bestie',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    ctx.goals.push(goal);
    ctx.reserved = round(ctx.reserved + goal.monthlyContribution);
    ctx.actions.push({ type: 'create_goal', goal });

    return {
      ok: true,
      goalId: goal.id,
      created: goal,
      plan,
      onTime: plan.onTime,
      warnings: plan.notes,
      note: 'The card is now live in the side panel and the monthly amount is reserved from the budget.',
    };
  },

  update_savings_goal(args, ctx) {
    const goal = findGoal(ctx.goals, args.goal);
    if (!goal) return { ok: false, error: 'No savings goals exist yet. Use create_savings_goal.' };

    const patch = { updatedAt: Date.now() };
    if (args.targetAmount !== undefined) patch.targetAmount = clampNumber(args.targetAmount);
    if (args.targetDate !== undefined) patch.targetDate = isoDate(clampText(args.targetDate, 30));
    if (args.status === 'active' || args.status === 'paused') patch.status = args.status;

    const plan = buildPlan({
      targetAmount: patch.targetAmount ?? goal.targetAmount,
      alreadySaved: goal.saved,
      targetDate: patch.targetDate ?? goal.targetDate,
      preferredMonthly: clampNumber(args.monthlyContribution) || goal.monthlyContribution,
      monthlyCapacity: ctx.capacity.comfortable + Number(goal.monthlyContribution || 0),
      now: ctx.now,
    });

    patch.monthlyContribution = plan.monthlyContribution;
    patch.months = plan.months;
    patch.projectedReadyDate = plan.projectedReadyDate;

    Object.assign(goal, patch);
    ctx.actions.push({ type: 'update_goal', id: goal.id, patch });

    return { ok: true, goalId: goal.id, goal, plan, warnings: plan.notes };
  },

  contribute_to_goal(args, ctx) {
    const goal = findGoal(ctx.goals, args.goal);
    if (!goal) return { ok: false, error: 'No savings goals exist yet.' };
    const amount = clampNumber(args.amount);
    if (!amount) return { ok: false, error: 'amount must be above zero.' };

    const saved = round(Math.min(goal.targetAmount, Number(goal.saved || 0) + amount));
    const note = clampText(args.note, 120);
    goal.saved = saved;
    ctx.actions.push({ type: 'contribute', id: goal.id, amount, note });

    const remaining = round(Math.max(0, goal.targetAmount - saved));
    return {
      ok: true,
      goalId: goal.id,
      saved,
      remaining,
      percent: goal.targetAmount ? Math.round((saved / goal.targetAmount) * 100) : 0,
      reached: remaining === 0,
    };
  },

  list_savings_candidates(_args, ctx) {
    return {
      ok: true,
      currency: ctx.currency,
      candidates: ctx.candidates,
      totals: summarizeOpportunities(ctx.candidates),
      note: 'Taken straight from the user\'s cart and entered bills. Do not suggest anything that is not on this list.',
    };
  },

  suggest_savings_opportunities(args, ctx) {
    const goal = findGoal(ctx.goals, args.goal);
    if (!goal) return { ok: false, error: 'Create a savings goal before attaching suggestions to it.' };

    const allowed = new Map(ctx.candidates.map((candidate) => [candidate.label.toLowerCase(), candidate]));
    const suggestions = [];
    const rejected = [];

    for (const raw of Array.isArray(args.suggestions) ? args.suggestions.slice(0, MAX_SUGGESTIONS) : []) {
      const label = clampText(raw?.label, 90);
      if (!label) continue;
      const match =
        allowed.get(label.toLowerCase()) ||
        ctx.candidates.find((candidate) => candidate.fingerprint && candidate.fingerprint === raw.fingerprint) ||
        ctx.candidates.find((candidate) => candidate.label.toLowerCase().includes(label.toLowerCase()));

      if (!match) {
        rejected.push(label);
        continue;
      }

      suggestions.push({
        id: `opp_${Math.random().toString(36).slice(2, 9)}`,
        label: match.label,
        amount: match.amount,
        recurring: raw.recurring === undefined ? match.recurring : Boolean(raw.recurring),
        reason: clampText(raw.reason, 180) || match.basis,
        fingerprint: match.fingerprint || '',
        kind: match.kind,
        applied: false,
      });
    }

    goal.opportunities = suggestions;
    ctx.actions.push({ type: 'set_opportunities', id: goal.id, opportunities: suggestions });

    return {
      ok: true,
      goalId: goal.id,
      attached: suggestions.length,
      totals: summarizeOpportunities(suggestions),
      rejected: rejected.length ? rejected : undefined,
      rejectedReason: rejected.length ? 'Not present in the user\'s cart or bills, so it was dropped.' : undefined,
    };
  },
};

function executeTool(name, rawArgs, ctx) {
  const handler = HANDLERS[name];
  if (!handler) return { ok: false, error: `Unknown tool: ${name}` };
  let args = rawArgs;
  if (typeof rawArgs === 'string') {
    try {
      args = JSON.parse(rawArgs || '{}');
    } catch {
      return { ok: false, error: 'Tool arguments were not valid JSON.' };
    }
  }
  try {
    return handler(args && typeof args === 'object' ? args : {}, ctx);
  } catch (error) {
    return { ok: false, error: error.message || 'Tool failed.' };
  }
}

module.exports = {
  TOOL_LABELS,
  TOOL_SPECS,
  buildToolContext,
  executeTool,
  findGoal,
  newGoalId,
  normalizeBreakdown,
};
