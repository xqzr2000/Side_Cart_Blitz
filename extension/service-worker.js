const DEFAULT_SETTINGS = {
  budget: 500,
  currency: 'USD',
  bills: [],
  backendUrl: 'http://localhost:8787',
  sharedSecret: '',
};
const DEFAULT_STATE = { items: [], settings: DEFAULT_SETTINGS, chatMessages: [], purchaseNudge: null };

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULT_STATE)) if (current[key] === undefined) patch[key] = value;
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

chrome.runtime.onStartup.addListener(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'SHOP_ACTION') return false;
  if (sender.tab?.id) chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
  upsertShoppingEvent(message).catch(console.error);
  sendResponse({ ok: true });
  return false;
});

async function upsertShoppingEvent(message) {
  const { items = [], settings = DEFAULT_SETTINGS } = await chrome.storage.local.get(['items', 'settings']);
  const incoming = sanitizeItem(message.item || {}, settings.currency);
  const now = Date.now();
  const next = [...items];
  const existingIndex = next.findIndex((item) => item.fingerprint === incoming.fingerprint);

  if (message.action === 'confirm') {
    if (existingIndex >= 0) {
      next[existingIndex] = { ...next[existingIndex], ...incoming, status: 'pending', intent: 'checkout', updatedAt: now };
    } else {
      next.unshift({ ...incoming, status: 'pending', intent: 'checkout', firstSeenAt: now, updatedAt: now, quantity: 1 });
    }
    await chrome.storage.local.set({
      items: next.slice(0, 100),
      purchaseNudge: { at: now, text: 'Checkout detected. Confirm the item as bought only after the order succeeds.' },
    });
    return;
  }

  const base = {
    ...incoming,
    status: 'considering',
    intent: message.action === 'buyNow' ? 'buying' : 'considering',
    updatedAt: now,
  };
  if (existingIndex >= 0) {
    next[existingIndex] = { ...next[existingIndex], ...base, firstSeenAt: next[existingIndex].firstSeenAt || now, quantity: next[existingIndex].quantity || 1 };
  } else {
    next.unshift({ ...base, firstSeenAt: now, quantity: 1 });
  }
  await chrome.storage.local.set({ items: next.slice(0, 100) });
}

function sanitizeItem(item, fallbackCurrency) {
  const title = String(item.title || 'Shopping item').trim().slice(0, 240);
  const url = safeHttpUrl(item.url);
  const site = String(item.site || '').trim().slice(0, 120);
  const image = safeHttpUrl(item.image);
  const numericPrice = Number(item.price);
  const price = Number.isFinite(numericPrice) && numericPrice >= 0 ? numericPrice : null;
  const currency = String(item.currency || fallbackCurrency || 'USD').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'USD';
  const fingerprint = String(item.fingerprint || `${site}|${title}|${url}`.toLowerCase()).slice(0, 2200);
  return { title, url, site, image, price, currency, fingerprint };
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString().slice(0, 2000) : '';
  } catch { return ''; }
}
