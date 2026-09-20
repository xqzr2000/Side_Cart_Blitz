const { round } = require('./planner');

// The month these rates and the reference prices below were set. It is carried
// all the way onto the savings card, so a plan built a year from now cannot
// pass stale figures off as freshly researched ones.
const REFERENCE_AS_OF = '2026-09';
const REFERENCE_AS_OF_LABEL = 'September 2026';

// Static, clearly-labelled rates. Good enough to sanity-check a savings goal;
// never presented to the user as a live quote.
const FX_TO_USD = {
  USD: 1,
  CAD: 0.73,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0064,
};

// Always shown alongside the dated disclaimer, so it does not repeat the date.
const FX_NOTE = 'Cross-currency amounts use a static reference rate.';

function convert(amount, from = 'USD', to = 'USD') {
  const source = FX_TO_USD[String(from).toUpperCase()];
  const target = FX_TO_USD[String(to).toUpperCase()];
  if (!source || !target) return round(amount);
  return round((Number(amount || 0) * source) / target);
}

/**
 * Reference cost breakdowns for goals people actually save for. These are
 * student-tier ("lean") estimates in USD and exist so the agent has a grounded
 * starting point instead of guessing. The agent is free to replace any line.
 */
const GOAL_REFERENCES = [
  {
    id: 'coachella',
    match: /coachella/i,
    label: 'Coachella — 3-day weekend in Indio, CA (student/lean tier)',
    currency: 'USD',
    season: 'Mid-April',
    nextDates: ['2027-04-09', '2028-04-14'],
    lineItems: [
      { label: 'GA 3-day pass + fees', amount: 640, note: 'Advance tier on the payment plan; fees run ~15%.' },
      { label: 'Return flight', amount: 380, note: 'To LAX or Palm Springs, booked early, off-peak days.' },
      { label: 'Lodging, 3 nights', amount: 160, note: 'Car camping or a room split 4 ways.' },
      { label: 'Food and drink', amount: 180, note: 'Roughly $60/day on site.' },
      { label: 'Local transport', amount: 90, note: 'Shuttle pass or rideshare split.' },
      { label: 'Essentials and misc', amount: 100, note: 'Sunscreen, refillable bottle, outfits, phone battery.' },
    ],
  },
  {
    id: 'music-festival',
    match: /(festival|lollapalooza|bonnaroo|osheaga|govball|edc)\b/i,
    label: 'Multi-day music festival (lean tier)',
    currency: 'USD',
    lineItems: [
      { label: 'Festival pass + fees', amount: 420, note: 'Early-bird GA.' },
      { label: 'Travel', amount: 300, note: 'Flight or long-distance rail.' },
      { label: 'Lodging', amount: 200, note: 'Shared room or camping.' },
      { label: 'Food and drink', amount: 160, note: 'On-site prices are roughly double normal.' },
      { label: 'Local transport and misc', amount: 120, note: '' },
    ],
  },
  {
    id: 'concert-trip',
    match: /(concert|tour|show|eras|stadium)\b/i,
    label: 'Out-of-town concert weekend',
    currency: 'USD',
    lineItems: [
      { label: 'Ticket + fees', amount: 220, note: 'Face value plus service charges.' },
      { label: 'Travel', amount: 180, note: '' },
      { label: 'One night lodging', amount: 120, note: 'Split with a friend.' },
      { label: 'Food and local transport', amount: 90, note: '' },
    ],
  },
  {
    id: 'spring-break',
    match: /(spring break|reading week|beach trip|cancun|cabo)\b/i,
    label: 'Spring break trip, 5 nights (lean tier)',
    currency: 'USD',
    lineItems: [
      { label: 'Return flight', amount: 450, note: '' },
      { label: 'Lodging, 5 nights', amount: 350, note: 'Hostel or split room.' },
      { label: 'Food', amount: 250, note: '' },
      { label: 'Activities', amount: 150, note: '' },
      { label: 'Local transport and misc', amount: 100, note: '' },
    ],
  },
  {
    id: 'laptop',
    match: /(laptop|macbook|notebook computer)\b/i,
    label: 'Student laptop',
    currency: 'USD',
    lineItems: [
      { label: 'Laptop, education pricing', amount: 999, note: 'Mid-tier 13-14" machine.' },
      { label: 'Sleeve and accessories', amount: 80, note: '' },
      { label: 'Extended coverage', amount: 150, note: 'Optional.' },
    ],
  },
  {
    id: 'flight-home',
    match: /(flight home|fly home|go home|visit family|holiday travel)\b/i,
    label: 'Trip home for the holidays',
    currency: 'USD',
    lineItems: [
      { label: 'Return flight, peak dates', amount: 520, note: 'December fares run high; book 8+ weeks out.' },
      { label: 'Airport transport', amount: 80, note: '' },
      { label: 'Gifts and spending', amount: 150, note: '' },
    ],
  },
  {
    id: 'first-apartment',
    match: /(apartment|move out|moving|first place|lease)\b/i,
    label: 'Moving into a first apartment',
    currency: 'USD',
    lineItems: [
      { label: 'Security deposit', amount: 900, note: 'Commonly one month of rent.' },
      { label: 'First month rent', amount: 900, note: '' },
      { label: 'Basic furniture', amount: 600, note: 'Second-hand where possible.' },
      { label: 'Kitchen and household basics', amount: 250, note: '' },
      { label: 'Utility setup and deposits', amount: 150, note: '' },
    ],
  },
];

function lookupGoalReference(text = '') {
  const haystack = String(text);
  return GOAL_REFERENCES.find((entry) => entry.match.test(haystack)) || null;
}

/**
 * Reference breakdown converted into the user's currency, totalled by code.
 */
function referenceEstimate(text, currency = 'USD') {
  const reference = lookupGoalReference(text);
  if (!reference) return null;

  // Whole units: a savings card reads better with "877" than "876.71", and the
  // precision was never real to begin with.
  const lineItems = reference.lineItems.map((item) => ({
    label: item.label,
    amount: Math.round(convert(item.amount, reference.currency, currency)),
    note: item.note || '',
  }));

  return {
    id: reference.id,
    label: reference.label,
    currency,
    lineItems,
    total: round(lineItems.reduce((sum, item) => sum + item.amount, 0)),
    season: reference.season || '',
    nextDates: reference.nextDates || [],
    sourceCurrency: reference.currency,
    fxNote: reference.currency === currency ? '' : FX_NOTE,
    asOf: REFERENCE_AS_OF,
    disclaimer: `Reference estimate for a lean/student trip, priced ${REFERENCE_AS_OF_LABEL} — not a live quote.`,
  };
}

function referenceContext(text, currency = 'USD') {
  const estimate = referenceEstimate(text, currency);
  if (!estimate) return '';
  const lines = estimate.lineItems.map((item) => `- ${item.label}: ${item.amount} ${currency}${item.note ? ` (${item.note})` : ''}`);
  const dates = estimate.nextDates.length ? `\nUpcoming editions: ${estimate.nextDates.join(', ')}` : '';
  return `REFERENCE COST ESTIMATE — ${estimate.label}\n${lines.join('\n')}\nReference total: ${estimate.total} ${currency}${dates}\n${estimate.disclaimer}${estimate.fxNote ? ` ${estimate.fxNote}` : ''}`;
}

module.exports = {
  FX_NOTE,
  GOAL_REFERENCES,
  REFERENCE_AS_OF,
  REFERENCE_AS_OF_LABEL,
  convert,
  lookupGoalReference,
  referenceContext,
  referenceEstimate,
};
