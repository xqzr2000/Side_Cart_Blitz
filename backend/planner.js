const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30.44;
const DEFAULT_HORIZON_MONTHS = 12;

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function roundUpTo(value, step) {
  if (!step || step <= 0) return round(value);
  return round(Math.ceil(Number(value || 0) / step) * step);
}

function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (!value) return null;
  const parsed = new Date(String(value).length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDate(date) {
  return toDate(date)?.toISOString().slice(0, 10) || '';
}

function addMonths(date, months) {
  const base = toDate(date) || new Date();
  return new Date(base.getTime() + months * DAYS_PER_MONTH * MS_PER_DAY);
}

// Whole contributions available before the deadline. Floors so the money is in
// hand *before* the date, never on the way to it.
function monthsUntil(targetDate, now = new Date()) {
  const target = toDate(targetDate);
  const from = toDate(now) || new Date();
  if (!target) return null;
  return (target.getTime() - from.getTime()) / (DAYS_PER_MONTH * MS_PER_DAY);
}

/**
 * How much room the user actually has each month, after bills, what they have
 * already spent this cycle, and money reserved by other goals.
 * `comfortable` is the number we are willing to recommend: taking every last
 * free dollar is how savings plans get abandoned in week two.
 */
function estimateCapacity({
  budget = 0,
  billsTotal = 0,
  reserved = 0,
  typicalSpend = 0,
  safetyRatio = 0.5,
} = {}) {
  const disposable = Math.max(0, round(Number(budget) - Number(billsTotal) - Number(reserved) - Number(typicalSpend)));
  const comfortable = roundUpTo(disposable * safetyRatio, 5);
  return {
    disposable,
    comfortable: Math.min(disposable, comfortable),
    safetyRatio,
  };
}

/**
 * The core plan. Everything the agent says about money should come from here.
 */
function buildPlan({
  targetAmount = 0,
  alreadySaved = 0,
  targetDate = '',
  preferredMonthly = 0,
  monthlyCapacity = null,
  step = 5,
  now = new Date(),
} = {}) {
  const target = Math.max(0, round(targetAmount));
  const saved = Math.max(0, round(alreadySaved));
  const remaining = round(Math.max(0, target - saved));
  const capacity = monthlyCapacity == null ? null : Math.max(0, round(monthlyCapacity));
  const startedAt = toDate(now) || new Date();

  if (remaining === 0) {
    return {
      targetAmount: target,
      alreadySaved: saved,
      remaining: 0,
      monthlyContribution: 0,
      months: 0,
      reached: true,
      feasible: true,
      onTime: true,
      capacity,
      projectedReadyDate: isoDate(startedAt),
      targetDate: isoDate(targetDate),
      notes: ['Already funded.'],
    };
  }

  const horizonRaw = monthsUntil(targetDate, startedAt);
  const deadlineMonths = horizonRaw == null ? null : Math.max(1, Math.floor(horizonRaw));
  const deadlinePassed = horizonRaw != null && horizonRaw <= 0;

  const requiredForDeadline = deadlineMonths ? roundUpTo(remaining / deadlineMonths, step) : null;

  let monthlyContribution;
  if (preferredMonthly > 0) {
    monthlyContribution = round(preferredMonthly);
  } else if (requiredForDeadline != null) {
    monthlyContribution = capacity == null ? requiredForDeadline : Math.min(requiredForDeadline, Math.max(capacity, step));
  } else {
    const paced = roundUpTo(remaining / DEFAULT_HORIZON_MONTHS, step);
    monthlyContribution = capacity == null ? paced : Math.min(paced, Math.max(capacity, step));
  }
  monthlyContribution = Math.max(step, round(monthlyContribution));

  const months = Math.max(1, Math.ceil(remaining / monthlyContribution));
  const projectedReadyDate = isoDate(addMonths(startedAt, months));
  const onTime = deadlineMonths == null ? true : months <= deadlineMonths && !deadlinePassed;
  const feasible = capacity == null ? true : monthlyContribution <= capacity;

  const notes = [];
  if (deadlinePassed) notes.push('The target date is already in the past — pick the next edition or a new date.');
  if (requiredForDeadline != null && !onTime) {
    notes.push(`Hitting ${isoDate(targetDate)} needs ${requiredForDeadline} per month, which is above what this budget can hold.`);
  }
  if (!feasible) notes.push('This contribution is above the comfortable monthly capacity.');
  if (capacity === 0) notes.push('There is no free room in the budget right now — something has to move first.');

  return {
    targetAmount: target,
    alreadySaved: saved,
    remaining,
    monthlyContribution,
    months,
    totalReserved: round(monthlyContribution * months),
    reached: false,
    feasible,
    onTime,
    capacity,
    requiredForDeadline,
    deadlineMonths,
    monthlyShortfall: requiredForDeadline == null ? 0 : round(Math.max(0, requiredForDeadline - monthlyContribution)),
    targetDate: isoDate(targetDate),
    projectedReadyDate,
    notes,
  };
}

function normalizeTitle(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Candidate money the user could redirect into a goal, derived from their own
 * cart. Deterministic on purpose: the agent explains these, it does not invent
 * them.
 */
function findSavingsOpportunities({ items = [], bills = [], currency = 'USD', limit = 5 } = {}) {
  const relevant = items.filter((item) => (!item.currency || item.currency === currency) && Number(item.price) > 0);
  const considering = relevant.filter((item) => item.status !== 'bought');
  const opportunities = [];

  const seen = new Map();
  for (const item of considering) {
    const key = normalizeTitle(item.title);
    if (seen.has(key)) {
      opportunities.push({
        kind: 'duplicate',
        fingerprint: item.fingerprint,
        label: item.title,
        amount: round(Number(item.price) * Number(item.quantity || 1)),
        recurring: false,
        basis: `Looks like a second copy of "${seen.get(key).title}" already in the cart.`,
      });
      continue;
    }
    seen.set(key, item);
  }

  for (const item of considering) {
    if (item.intent !== 'buying') continue;
    if (opportunities.some((entry) => entry.fingerprint === item.fingerprint)) continue;
    opportunities.push({
      kind: 'buying-now',
      fingerprint: item.fingerprint,
      label: item.title,
      amount: round(Number(item.price) * Number(item.quantity || 1)),
      recurring: false,
      basis: 'Flagged as buying now — the fastest thing to pause for 24 hours.',
    });
  }

  const ranked = [...considering].sort(
    (a, b) => Number(b.price) * Number(b.quantity || 1) - Number(a.price) * Number(a.quantity || 1),
  );
  for (const item of ranked) {
    if (opportunities.length >= limit) break;
    if (opportunities.some((entry) => entry.fingerprint === item.fingerprint)) continue;
    opportunities.push({
      kind: 'considering',
      fingerprint: item.fingerprint,
      label: item.title,
      amount: round(Number(item.price) * Number(item.quantity || 1)),
      recurring: false,
      basis: 'Still in the considering list, not charged yet.',
    });
  }

  for (const bill of bills) {
    if (opportunities.length >= limit + 2) break;
    const amount = round(Number(bill.amount || 0));
    if (!amount || !/subscri|stream|music|plus|premium|membership|gym/i.test(String(bill.name || ''))) continue;
    opportunities.push({
      kind: 'subscription',
      fingerprint: '',
      label: bill.name,
      amount,
      recurring: true,
      basis: 'Recurring bill — cancelling frees this amount every single month.',
    });
  }

  return opportunities.slice(0, limit + 2);
}

function summarizeOpportunities(opportunities = []) {
  const oneTime = opportunities.filter((entry) => !entry.recurring).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const recurring = opportunities.filter((entry) => entry.recurring).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  return { oneTime: round(oneTime), recurring: round(recurring), count: opportunities.length };
}

module.exports = {
  addMonths,
  buildPlan,
  estimateCapacity,
  findSavingsOpportunities,
  isoDate,
  monthsUntil,
  round,
  roundUpTo,
  summarizeOpportunities,
};
