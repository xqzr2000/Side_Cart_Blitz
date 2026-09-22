const state = {
  items: [],
  settings: { budget: 500, currency: 'USD', bills: [], backendUrl: 'http://localhost:8787', sharedSecret: '' },
  chatMessages: [],
  purchaseNudge: null,
  sessionId: crypto.randomUUID(),
};

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const key of ['items', 'settings', 'chatMessages', 'purchaseNudge']) {
    if (changes[key]) state[key] = changes[key].newValue;
  }
  render();
});

async function init() {
  const saved = await chrome.storage.local.get(['items', 'settings', 'chatMessages', 'purchaseNudge']);
  Object.assign(state, saved);
  bindEvents();
  render();
}

function bindEvents() {
  $('letsTalk').addEventListener('click', openChat);
  $('closeChat').addEventListener('click', closeChat);
  $('chatForm').addEventListener('submit', sendChat);
  $('editBudget').addEventListener('click', openBudgetDialog);
  $('addBill').addEventListener('click', () => addBillRow());
  $('budgetForm').addEventListener('submit', saveBudgetDialog);
  $('dismissNudge').addEventListener('click', () => chrome.storage.local.set({ purchaseNudge: null }));
  $('openSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

function render() {
  renderBudget();
  renderItems();
  renderNudge();
  renderChat();
}

function renderBudget() {
  const summary = getSummary();
  $('budgetValue').textContent = money(summary.budget, summary.currency);
  $('spentValue').textContent = money(summary.spent, summary.currency);
  $('pendingValue').textContent = money(summary.pending, summary.currency);
  $('remainingValue').textContent = money(summary.remaining, summary.currency);
  $('freeValue').textContent = money(summary.freeAfterBills, summary.currency);
  const ratio = summary.budget > 0 ? Math.min(1, Math.max(0, summary.spent / summary.budget)) : 0;
  $('budgetProgress').style.width = `${ratio * 100}%`;
  $('currencyNote').textContent = summary.omitted
    ? `${summary.omitted} item${summary.omitted === 1 ? '' : 's'} in another currency are excluded from this ledger.`
    : '';
}

function getSummary() {
  const currency = state.settings?.currency || 'USD';
  const budget = nonNegative(state.settings?.budget);
  const sameCurrency = state.items.filter((item) => !item.currency || item.currency === currency);
  const spent = sumItems(sameCurrency.filter((item) => item.status === 'bought'));
  const pending = sumItems(sameCurrency.filter((item) => item.status === 'pending'));
  const considering = sumItems(sameCurrency.filter((item) => item.status === 'considering'));
  const bills = (state.settings?.bills || []).reduce((sum, bill) => sum + nonNegative(bill.amount), 0);
  return {
    currency, budget, spent, pending, considering, bills,
    remaining: budget - spent,
    freeAfterBills: budget - spent - bills,
    omitted: state.items.filter((item) => item.currency && item.currency !== currency).length,
  };
}

function renderItems() {
  const pending = state.items.filter((item) => item.status === 'pending');
  const considering = state.items.filter((item) => item.status === 'considering');
  const bought = state.items.filter((item) => item.status === 'bought');
  $('pendingCount').textContent = pending.length;
  $('consideringCount').textContent = considering.length;
  $('boughtCount').textContent = bought.length;
  $('pendingSection').classList.toggle('hidden', pending.length === 0);
  renderItemList($('pendingCards'), pending, 'pending');
  renderItemList($('consideringCards'), considering, 'considering');
  renderItemList($('boughtCards'), bought, 'bought');
}

function renderItemList(container, items, group) {
  container.textContent = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = group === 'bought' ? 'No confirmed purchases yet.' : 'Shopping items detected on supported pages appear here.';
    container.append(empty);
    return;
  }
  for (const item of items) container.append(createItemRow(item, group));
}

function createItemRow(item, group) {
  const row = document.createElement('article');
  row.className = 'item-row';

  const media = item.image ? document.createElement('img') : document.createElement('div');
  media.className = `item-image${item.image ? '' : ' placeholder'}`;
  if (item.image) {
    media.src = item.image;
    media.alt = '';
    media.referrerPolicy = 'no-referrer';
    media.loading = 'lazy';
    media.addEventListener('error', () => {
      const replacement = document.createElement('div');
      replacement.className = 'item-image placeholder';
      replacement.textContent = 'ITEM';
      media.replaceWith(replacement);
    });
  } else {
    media.textContent = 'ITEM';
  }

  const body = document.createElement('div');
  body.className = 'item-body';
  const topline = document.createElement('div');
  topline.className = 'item-topline';
  const title = document.createElement('p');
  title.className = 'item-title';
  title.textContent = item.title || 'Shopping item';
  const price = document.createElement('div');
  price.className = 'item-price';
  price.textContent = item.price == null ? '—' : money(nonNegative(item.price) * Math.max(1, Number(item.quantity || 1)), item.currency || state.settings.currency);
  topline.append(title, price);

  const meta = document.createElement('p');
  meta.className = 'item-meta';
  meta.textContent = item.site || 'shopping site';

  const statusLine = document.createElement('div');
  statusLine.className = 'status-line';
  const tag = document.createElement('span');
  tag.className = `status-tag ${group}`;
  tag.textContent = group === 'pending' ? 'Checkout pending' : group === 'bought' ? 'Confirmed' : (item.intent === 'buying' ? 'Buying now' : 'Considering');
  statusLine.append(tag);

  body.append(topline, meta, statusLine);
  if (item.evaluation) body.append(renderAssessment(item.evaluation));
  body.append(createActions(item, group));
  row.append(media, body);
  return row;
}

function renderAssessment(evaluation) {
  const box = document.createElement('div');
  box.className = 'assessment';
  if (evaluation.loading) {
    box.textContent = 'Assessing budget impact…';
    return box;
  }
  if (evaluation.error) {
    box.textContent = evaluation.error;
    return box;
  }
  const risk = evaluation.deterministic?.level || 'unknown';
  const decision = evaluation.decision;
  const fragments = [`Budget impact: ${risk}`];
  if (decision?.spendType && decision.spendConfidence >= 0.35) fragments.push(`type: ${decision.spendType.replaceAll('_', ' ')}`);
  if (decision?.duplicateRisk != null && decision.duplicateRisk >= 0.6) fragments.push('possible duplicate');
  if (decision?.delayScore != null && decision.delayConfidence >= 0.35 && decision.delayScore >= 1.5) fragments.push('pause may help');
  const strong = document.createElement('strong');
  strong.textContent = 'ASSESSMENT · ';
  box.append(strong, document.createTextNode(fragments.join(' · ')));
  return box;
}

function createActions(item, group) {
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  if (group === 'pending') {
    actions.append(actionButton('CONFIRM BOUGHT', () => updateItem(item.fingerprint, { status: 'bought', intent: 'bought' })));
    actions.append(actionButton('NOT BOUGHT', () => updateItem(item.fingerprint, { status: 'considering', intent: 'considering' }), 'quiet'));
  } else if (group === 'bought') {
    actions.append(actionButton('MOVE BACK', () => updateItem(item.fingerprint, { status: 'considering', intent: 'considering' })));
  } else {
    actions.append(actionButton('MARK BOUGHT', () => updateItem(item.fingerprint, { status: 'bought', intent: 'bought' })));
  }

  const assess = actionButton(item.evaluation?.loading ? 'ASSESSING…' : 'ASSESS', () => assessItem(item), 'quiet');
  assess.disabled = Boolean(item.evaluation?.loading);
  actions.append(assess);

  const open = actionButton('OPEN', () => openItem(item), 'quiet');
  open.disabled = !item.url;
  actions.append(open);
  actions.append(actionButton('REMOVE', () => removeItem(item.fingerprint), 'quiet'));
  return actions;
}

function actionButton(label, handler, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener('click', handler);
  return button;
}

async function assessItem(item) {
  await updateItem(item.fingerprint, { evaluation: { loading: true } });
  try {
    const response = await backendFetch('/api/evaluate', {
      method: 'POST',
      body: JSON.stringify({ item, state: publicState() }),
    });
    await updateItem(item.fingerprint, { evaluation: response.evaluation || { error: 'No assessment returned.' } });
  } catch (error) {
    await updateItem(item.fingerprint, { evaluation: { error: readableNetworkError(error) } });
  }
}

function renderNudge() {
  const nudge = state.purchaseNudge;
  $('purchaseNudge').classList.toggle('hidden', !nudge);
  $('purchaseNudgeText').textContent = nudge?.text || '';
}

function openChat() {
  $('chatView').classList.add('open');
  $('chatView').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('chatInput').focus(), 120);
  scrollChat();
}

function closeChat() {
  $('chatView').classList.remove('open');
  $('chatView').setAttribute('aria-hidden', 'true');
}

function renderChat() {
  const log = $('chatLog');
  log.textContent = '';
  if (!state.chatMessages.length) {
    const intro = document.createElement('div');
    intro.className = 'message agent';
    const speaker = document.createElement('span');
    speaker.className = 'speaker';
    speaker.textContent = 'WISESHELF';
    intro.append(speaker, document.createTextNode('Ask about a purchase, your remaining budget, or the bills you entered.')); 
    log.append(intro);
  }
  for (const message of state.chatMessages.slice(-40)) {
    const node = document.createElement('div');
    node.className = `message ${message.role === 'user' ? 'user' : 'agent'}`;
    const speaker = document.createElement('span');
    speaker.className = 'speaker';
    speaker.textContent = message.role === 'user' ? 'YOU' : (message.agent || 'WISESHELF').toUpperCase();
    node.append(speaker, document.createTextNode(message.content));
    log.append(node);
  }
  scrollChat();
}

async function sendChat(event) {
  event.preventDefault();
  const input = $('chatInput');
  const content = input.value.trim();
  if (!content) return;

  input.value = '';
  const history = [...state.chatMessages, { role: 'user', content, at: Date.now() }].slice(-40);
  state.chatMessages = history;
  await chrome.storage.local.set({ chatMessages: history });
  setSending(true);

  try {
    const candidate = state.items.find((item) => item.status === 'pending') || state.items.find((item) => item.status === 'considering') || null;
    const data = await backendFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: state.sessionId,
        messages: history.map(({ role, content: text }) => ({ role, content: text })),
        state: publicState(),
        item: candidate,
      }),
    });
    const replies = (data.replies || []).map((reply) => ({ role: 'assistant', agent: reply.agent, content: reply.content, at: Date.now() }));
    state.chatMessages = [...history, ...replies].slice(-40);
    $('providerState').textContent = data.decisionContext?.enabled ? 'JEV + CHAT' : 'CHAT';
    await chrome.storage.local.set({ chatMessages: state.chatMessages });
  } catch (error) {
    state.chatMessages = [...history, { role: 'assistant', agent: 'Room', content: readableNetworkError(error), at: Date.now() }].slice(-40);
    $('providerState').textContent = 'OFFLINE';
    await chrome.storage.local.set({ chatMessages: state.chatMessages });
  } finally {
    setSending(false);
  }
}

function publicState() {
  return {
    items: state.items.map(({ evaluation, image, url, fingerprint, ...item }) => item),
    settings: {
      budget: state.settings.budget,
      currency: state.settings.currency,
      bills: state.settings.bills || [],
    },
  };
}

async function backendFetch(path, options = {}) {
  const base = normalizeBackendUrl(state.settings.backendUrl || 'http://localhost:8787');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${base}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(state.settings.sharedSecret ? { 'x-wiseshelf-secret': state.settings.sharedSecret } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Backend returned ${response.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBackendUrl(value) {
  const url = new URL(String(value || '').trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && url.protocol !== 'https:') throw new Error('Remote backend must use HTTPS.');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Backend URL must use HTTP or HTTPS.');
  return url.toString().replace(/\/+$/, '');
}

function readableNetworkError(error) {
  if (error?.name === 'AbortError') return 'The backend timed out. Check the connection and try again.';
  return `WiseShelf could not complete the request: ${error?.message || 'Unknown error'}`;
}

function setSending(sending) {
  $('sendChat').disabled = sending;
  $('chatInput').disabled = sending;
  $('sendChat').textContent = sending ? '…' : 'SEND';
}

function openBudgetDialog() {
  $('budgetInput').value = Number(state.settings.budget || 0);
  $('currencyInput').value = state.settings.currency || 'USD';
  $('billRows').textContent = '';
  for (const bill of state.settings.bills || []) addBillRow(bill);
  $('budgetDialog').showModal();
}

function addBillRow(bill = {}) {
  const row = document.createElement('div');
  row.className = 'bill-row';
  const name = document.createElement('input');
  name.dataset.key = 'name'; name.ariaLabel = 'Bill name'; name.placeholder = 'Rent'; name.value = bill.name || '';
  const amount = document.createElement('input');
  amount.dataset.key = 'amount'; amount.ariaLabel = 'Bill amount'; amount.type = 'number'; amount.min = '0'; amount.step = '0.01'; amount.placeholder = '0'; amount.value = bill.amount ?? '';
  const due = document.createElement('input');
  due.dataset.key = 'dueDate'; due.ariaLabel = 'Bill due date'; due.type = 'date'; due.value = bill.dueDate || '';
  const remove = document.createElement('button');
  remove.type = 'button'; remove.ariaLabel = 'Remove bill'; remove.textContent = '×'; remove.addEventListener('click', () => row.remove());
  row.append(name, amount, due, remove);
  $('billRows').append(row);
}

async function saveBudgetDialog(event) {
  event.preventDefault();
  const bills = [...$('billRows').querySelectorAll('.bill-row')].map((row) => ({
    name: row.querySelector('[data-key="name"]').value.trim().slice(0, 100),
    amount: nonNegative(row.querySelector('[data-key="amount"]').value),
    dueDate: row.querySelector('[data-key="dueDate"]').value,
  })).filter((bill) => bill.name || bill.amount);
  const settings = {
    ...state.settings,
    budget: nonNegative($('budgetInput').value),
    currency: $('currencyInput').value,
    bills,
  };
  await chrome.storage.local.set({ settings });
  $('budgetDialog').close();
}

async function updateItem(fingerprint, patch) {
  const items = state.items.map((item) => item.fingerprint === fingerprint ? { ...item, ...patch, updatedAt: Date.now() } : item);
  state.items = items;
  await chrome.storage.local.set({ items });
}

async function removeItem(fingerprint) {
  const items = state.items.filter((item) => item.fingerprint !== fingerprint);
  state.items = items;
  await chrome.storage.local.set({ items });
}

function openItem(item) {
  if (!item.url) return;
  try {
    const url = new URL(item.url);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    chrome.tabs.create({ url: url.toString() });
  } catch {}
}

function sumItems(items) { return items.reduce((sum, item) => sum + nonNegative(item.price) * Math.max(1, Number(item.quantity || 1)), 0); }
function nonNegative(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; }
function money(value, currency) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value || 0)); }
  catch { return `${currency} ${Number(value || 0).toFixed(2)}`; }
}
function scrollChat() { requestAnimationFrame(() => { const log = $('chatLog'); log.scrollTop = log.scrollHeight; }); }
