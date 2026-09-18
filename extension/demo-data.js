/**
 * One-click state for walking someone through the demos: a Canadian first-year
 * with a real budget, real bills, a month that is already mostly spent, and a
 * cart with obvious slack in it. Tuned so the numbers tell an honest story —
 * Coachella genuinely does not fit before April, and the panel says so.
 */
const CARTSIDE_DEMO = {
  settings: {
    budget: 900,
    currency: 'CAD',
    bills: [
      { name: 'Phone plan', amount: 45, dueDate: '' },
      { name: 'Streaming plus', amount: 16, dueDate: '' },
      { name: 'Campus gym', amount: 25, dueDate: '' },
      { name: 'Textbook rental', amount: 39, dueDate: '' },
    ],
  },
  items: [
    { title: 'Intro to Economics, 12th ed.', price: 189, site: 'campusbooks.ca', status: 'bought' },
    { title: 'Dorm bedding set, twin XL', price: 96, site: 'homegoods.ca', status: 'bought' },
    { title: 'Grocery run — week 3', price: 88, site: 'freshmart.ca', status: 'bought' },
    { title: 'LED desk lamp', price: 42, site: 'homegoods.ca', status: 'bought' },
    { title: 'Wired earbuds', price: 60, site: 'techdepot.ca', status: 'bought' },
    { title: 'Nintendo Switch 2 bundle', price: 529, site: 'techdepot.ca', status: 'considering' },
    { title: 'Air fryer, 4L', price: 119, site: 'homegoods.ca', status: 'considering', intent: 'buying' },
    { title: 'Campus hoodie', price: 79, site: 'campusstore.ca', status: 'considering' },
  ],
};

function buildDemoState(now = Date.now()) {
  const items = CARTSIDE_DEMO.items.map((item, index) => ({
    title: item.title,
    price: item.price,
    currency: 'CAD',
    site: item.site,
    url: '',
    image: '',
    status: item.status,
    intent: item.intent || (item.status === 'bought' ? 'bought' : 'considering'),
    quantity: 1,
    fingerprint: `demo|${item.site}|${item.title.toLowerCase()}`,
    firstSeenAt: now - (index + 1) * 3_600_000,
    updatedAt: now - (index + 1) * 3_600_000,
  }));

  return {
    items,
    goals: [],
    chatMessages: [],
    purchaseNudge: null,
    settings: { ...CARTSIDE_DEMO.settings },
  };
}

if (typeof globalThis !== 'undefined') globalThis.buildDemoState = buildDemoState;
