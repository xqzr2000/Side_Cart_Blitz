const DEFAULT_STATE = {
  items: [],
  goals: [],
  settings: {
    budget: 500,
    currency: 'USD',
    bills: [],
    backendUrl: 'http://localhost:8787',
    sharedSecret: '',
  },
  chatMessages: [],
  purchaseNudge: null,
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULT_STATE)) {
    if (current[key] === undefined) patch[key] = value;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'SHOP_ACTION') return false;

  // Important: open immediately while Chrome still associates this message with the user's click.
  if (sender.tab?.id) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch((error) => {
      console.debug('CartSide could not auto-open the side panel:', error.message);
    });
  }

  upsertShoppingEvent(message).catch(console.error);
  sendResponse({ ok: true });
  return false;
});

async function upsertShoppingEvent(message) {
  const { items = [], settings = DEFAULT_STATE.settings } = await chrome.storage.local.get(['items', 'settings']);
  const now = Date.now();
  const incoming = sanitizeItem(message.item || {}, settings.currency);
  const action = message.action;
  const next = [...items];

  if (action === 'confirm') {
    const exactIndex = next.findIndex((item) => item.fingerprint === incoming.fingerprint);
    if (exactIndex >= 0 && Number(next[exactIndex].price || incoming.price) > 0) {
      next[exactIndex] = { ...next[exactIndex], status: 'bought', intent: 'bought', updatedAt: now };
      await chrome.storage.local.set({ items: next, purchaseNudge: null });
      return;
    }

    const active = next
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status !== 'bought');

    if (active.length === 1) {
      next[active[0].index] = { ...active[0].item, status: 'bought', intent: 'bought', updatedAt: now };
      await chrome.storage.local.set({ items: next, purchaseNudge: null });
      return;
    }

    await chrome.storage.local.set({
      purchaseNudge: {
        at: now,
        text: 'Looks like you finished checkout. Mark the item(s) you actually bought so your total stays accurate.',
      },
    });
    return;
  }

  const status = 'considering';
  const intent = action === 'buyNow' ? 'buying' : 'considering';
  const existingIndex = next.findIndex((item) => item.fingerprint === incoming.fingerprint);
  const base = {
    ...incoming,
    status,
    intent,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    next[existingIndex] = {
      ...next[existingIndex],
      ...base,
      firstSeenAt: next[existingIndex].firstSeenAt || now,
      quantity: next[existingIndex].quantity || 1,
    };
  } else {
    next.unshift({ ...base, firstSeenAt: now, quantity: 1 });
  }

  await chrome.storage.local.set({ items: next.slice(0, 100) });
}

function sanitizeItem(item, fallbackCurrency) {
  const title = String(item.title || 'Shopping item').trim().slice(0, 240);
  const url = String(item.url || '').slice(0, 2000);
  const site = String(item.site || '').slice(0, 120);
  const image = /^https?:\/\//i.test(item.image || '') ? String(item.image).slice(0, 2000) : '';
  const numericPrice = Number(item.price);
  const price = Number.isFinite(numericPrice) && numericPrice >= 0 ? numericPrice : null;
  const currency = String(item.currency || fallbackCurrency || 'USD').toUpperCase().slice(0, 3);
  const fingerprint = String(item.fingerprint || `${site}|${title}|${url}`.toLowerCase()).slice(0, 2200);
  return { title, url, site, image, price, currency, fingerprint };
}
