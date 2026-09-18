const DEFAULT_SETTINGS = {
  budget: 500,
  currency: 'USD',
  bills: [],
  backendUrl: 'http://localhost:8787',
  sharedSecret: '',
};

const QUICK_PROMPTS = [
  'I want to go to Coachella. Can you help me save for it?',
  "Help! I'm over budget. What should I do?",
  'What can I cut this month to save faster?',
];

const DAYS_PER_MONTH = 30.44;
const MS_PER_DAY = 86_400_000;
const MILESTONES = [25, 50, 75, 100];

const state = {
  items: [],
  goals: [],
  settings: { ...DEFAULT_SETTINGS },
  chatMessages: [],
  purchaseNudge: null,
  sessionId: crypto.randomUUID(),
};

const ui = { activity: [], sending: false, editingGoalId: null, contributingGoalId: null };

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const key of ['items', 'goals', 'chatMessages', 'purchaseNudge']) {
    if (changes[key]) state[key] = changes[key].newValue ?? (key === 'purchaseNudge' ? null : []);
  }
  if (changes.settings) state.settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
  render();
});

async function init() {
  const saved = await chrome.storage.local.get(['items', 'goals', 'settings', 'chatMessages', 'purchaseNudge']);
  state.items = saved.items || [];
  state.goals = saved.goals || [];
  state.chatMessages = saved.chatMessages || [];
  state.purchaseNudge = saved.purchaseNudge || null;
  state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
  bindEvents();
  renderQuickChips();
  render();
}

function bindEvents() {
  $('letsTalk').addEventListener('click', openChat);
  $('closeChat').addEventListener('click', closeChat);
  $('chatForm').addEventListener('submit', sendChat);
  $('editBudget').addEventListener('click', openBudgetDialog);
  $('addBill').addEventListener('click', () => addBillRow());
  $('budgetForm').addEventListener('submit', saveBudgetDialog);
  $('addGoal').addEventListener('click', () => openGoalDialog());
  $('goalForm').addEventListener('submit', saveGoalDialog);
  $('contributeForm').addEventListener('submit', saveContribution);
  $('dismissNudge').addEventListener('click', () => chrome.storage.local.set({ purchaseNudge: null }));
  $('openSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('chatInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('chatForm').requestSubmit();
    }
  });
}

function render() {
  renderBudget();
  renderGoals();
  renderItems();
  renderNudge();
  renderChat();
}

/* ---------------------------------------------------------------- money --- */

function money(value, currency = state.settings.currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value || 0));
  } catch {
    return `${currency} ${Number(value || 0).toFixed(2)}`;
  }
}

function sumItems(items) {
  return items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
}

function activeGoals() {
  return state.goals.filter((goal) => goal.status !== 'paused' && goal.status !== 'reached');
}

function reservedTotal() {
  const currency = state.settings.currency;
  return activeGoals()
    .filter((goal) => !goal.currency || goal.currency === currency)
    .reduce((sum, goal) => sum + Number(goal.monthlyContribution || 0), 0);
}

function shortDate(value) {
  if (!value) return '';
  const date = new Date(String(value).length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Local mirror of the backend planner, used when the user edits a goal by hand.
 * Agent-created plans always come back computed from the server.
 */
function projectGoal(goal) {
  const target = Number(goal.targetAmount || 0);
  const saved = Number(goal.saved || 0);
  const monthly = Number(goal.monthlyContribution || 0);
  const remaining = Math.max(0, Math.round((target - saved) * 100) / 100);
  const percent = target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0;

  if (remaining === 0) return { remaining: 0, percent: 100, months: 0, readyDate: '', onTime: true };
  if (monthly <= 0) return { remaining, percent, months: null, readyDate: '', onTime: false };

  const months = Math.ceil(remaining / monthly);
  const readyDate = new Date(Date.now() + months * DAYS_PER_MONTH * MS_PER_DAY).toISOString().slice(0, 10);
  const onTime = !goal.targetDate || new Date(readyDate) <= new Date(goal.targetDate);
  return { remaining, percent, months, readyDate, onTime };
}

/* --------------------------------------------------------------- budget --- */

function renderBudget() {
  const currency = state.settings.currency || 'USD';
  const budget = Number(state.settings.budget || 0);
  const sameCurrency = state.items.filter((item) => !item.currency || item.currency === currency);
  const spent = sumItems(sameCurrency.filter((item) => item.status === 'bought'));
  const consideringTotal = sumItems(sameCurrency.filter((item) => item.status !== 'bought'));
  const reserved = reservedTotal();
  const free = budget - spent - reserved;

  $('budgetValue').textContent = money(budget, currency);
  $('spentValue').textContent = money(spent, currency);
  $('reservedValue').textContent = money(reserved, currency);
  $('remainingValue').textContent = money(free, currency);
  $('consideringValue').textContent = money(consideringTotal, currency);

  const pct = (value) => (budget > 0 ? Math.max(0, Math.min(100, (value / budget) * 100)) : 0);
  $('segSpent').style.width = `${pct(spent)}%`;
  $('segReserved').style.width = `${pct(reserved)}%`;
  $('budgetBar').classList.toggle('over', free < 0);
  $('budgetBar').setAttribute(
    'aria-label',
    `${money(spent, currency)} bought, ${money(reserved, currency)} reserved, ${money(free, currency)} free of ${money(budget, currency)}`,
  );
  $('goalsBlock').classList.toggle('has-goals', state.goals.length > 0);

  const omitted = state.items.filter((item) => item.currency && item.currency !== currency).length;
  $('currencyNote').textContent = omitted
    ? `${omitted} item${omitted === 1 ? '' : 's'} in another currency are kept in the list but left out of this total.`
    : '';
}

/* ---------------------------------------------------------------- goals --- */

function renderGoals() {
  const container = $('goalCards');
  container.textContent = '';

  if (!state.goals.length) {
    const empty = document.createElement('div');
    empty.className = 'empty goal-empty';
    empty.textContent = 'No goals yet. Tell Bestie what you’re dreaming about and she’ll build the plan.';
    container.append(empty);
    return;
  }

  for (const goal of state.goals) container.append(buildGoalCard(goal));
}

function buildGoalCard(goal) {
  const projection = projectGoal(goal);
  const currency = goal.currency || state.settings.currency;
  const card = document.createElement('article');
  card.className = `goal-card${goal.status === 'paused' ? ' paused' : ''}${projection.percent >= 100 ? ' reached' : ''}`;

  const head = document.createElement('div');
  head.className = 'goal-head';

  const badge = document.createElement('span');
  badge.className = 'goal-emoji';
  badge.textContent = goal.emoji || '🎯';

  const heading = document.createElement('div');
  heading.className = 'goal-heading';
  const name = document.createElement('p');
  name.className = 'goal-name';
  name.textContent = goal.name || 'Savings goal';
  const sub = document.createElement('p');
  sub.className = 'goal-sub';
  sub.textContent = `${money(goal.monthlyContribution, currency)}/mo reserved`;
  if (goal.createdBy === 'Bestie') {
    const chip = document.createElement('span');
    chip.className = 'by-chip';
    chip.textContent = 'by Bestie';
    sub.append(' ', chip);
  }
  heading.append(name, sub);

  const amount = document.createElement('div');
  amount.className = 'goal-amount';
  amount.innerHTML = '';
  const savedEl = document.createElement('strong');
  savedEl.textContent = money(goal.saved, currency);
  const targetEl = document.createElement('small');
  targetEl.textContent = `of ${money(goal.targetAmount, currency)}`;
  amount.append(savedEl, targetEl);

  head.append(badge, heading, amount);

  const track = document.createElement('div');
  track.className = 'goal-progress';
  const fill = document.createElement('span');
  fill.className = 'goal-fill';
  fill.style.width = `${projection.percent}%`;
  track.append(fill);
  for (const milestone of MILESTONES.slice(0, 3)) {
    const tick = document.createElement('i');
    tick.className = `tick${projection.percent >= milestone ? ' passed' : ''}`;
    tick.style.left = `${milestone}%`;
    track.append(tick);
  }

  const status = document.createElement('p');
  status.className = 'goal-status';
  if (projection.percent >= 100) {
    status.textContent = `🎉 Fully funded — ${money(goal.targetAmount, currency)} ready to go.`;
  } else if (!projection.months) {
    status.textContent = 'Set a monthly amount to start the countdown.';
  } else {
    const ready = shortDate(goal.projectedReadyDate || projection.readyDate);
    status.textContent = `${projection.percent}% there · ${projection.months} month${projection.months === 1 ? '' : 's'} to go · ready ${ready}`;
  }

  card.append(head, track, status);

  if (goal.targetDate && projection.percent < 100) {
    const deadline = document.createElement('p');
    const onTime = goal.projectedReadyDate
      ? new Date(goal.projectedReadyDate) <= new Date(goal.targetDate)
      : projection.onTime;
    deadline.className = `goal-deadline${onTime ? ' ok' : ' short'}`;
    deadline.textContent = onTime
      ? `On track for ${shortDate(goal.targetDate)}.`
      : `Short of ${shortDate(goal.targetDate)} at this pace — trim below or aim at the next one.`;
    card.append(deadline);
  }

  if (goal.rationale) {
    const why = document.createElement('p');
    why.className = 'goal-why';
    why.textContent = goal.rationale;
    card.append(why);
  }

  if (goal.breakdown?.length) card.append(buildBreakdown(goal, currency));
  if (goal.opportunities?.length) card.append(buildOpportunities(goal, currency));

  const actions = document.createElement('div');
  actions.className = 'card-actions goal-actions';
  actions.append(
    actionButton('Add money', () => openContributeDialog(goal)),
    actionButton('Adjust', () => openGoalDialog(goal), 'quiet'),
    actionButton(goal.status === 'paused' ? 'Resume' : 'Pause', () => toggleGoal(goal), 'quiet'),
    actionButton('Remove', () => removeGoal(goal.id), 'quiet'),
  );
  card.append(actions);
  return card;
}

function buildBreakdown(goal, currency) {
  const details = document.createElement('details');
  details.className = 'goal-breakdown';
  const summary = document.createElement('summary');
  summary.textContent = `What’s in the ${money(goal.targetAmount, currency)}`;
  details.append(summary);

  const list = document.createElement('ul');
  for (const line of goal.breakdown) {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = line.label;
    if (line.note) label.title = line.note;
    const value = document.createElement('strong');
    value.textContent = money(line.amount, currency);
    row.append(label, value);
    list.append(row);
  }
  details.append(list);

  const note = document.createElement('p');
  note.className = 'small-note';
  note.textContent = 'Estimates, not live quotes.';
  details.append(note);
  return details;
}

function buildOpportunities(goal, currency) {
  const box = document.createElement('div');
  box.className = 'opportunities';

  const open = goal.opportunities.filter((entry) => !entry.applied);
  const total = open.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  const title = document.createElement('p');
  title.className = 'opp-title';
  title.textContent = open.length
    ? `Get there sooner — ${money(total, currency)} within reach`
    : 'All suggestions applied. Nice.';
  box.append(title);

  for (const opportunity of goal.opportunities) {
    const row = document.createElement('div');
    row.className = `opp-row${opportunity.applied ? ' applied' : ''}`;

    const text = document.createElement('div');
    const label = document.createElement('p');
    label.className = 'opp-label';
    label.textContent = `${opportunity.label} · ${money(opportunity.amount, currency)}${opportunity.recurring ? '/mo' : ''}`;
    const reason = document.createElement('p');
    reason.className = 'opp-reason';
    reason.textContent = opportunity.reason || '';
    text.append(label, reason);

    const apply = document.createElement('button');
    apply.className = 'opp-apply';
    apply.textContent = opportunity.applied ? 'Applied' : 'Apply';
    apply.disabled = Boolean(opportunity.applied);
    apply.addEventListener('click', () => applyOpportunity(goal.id, opportunity.id));

    row.append(text, apply);
    box.append(row);
  }
  return box;
}

function actionButton(text, onClick, className = '') {
  const button = document.createElement('button');
  button.textContent = text;
  if (className) button.className = className;
  button.addEventListener('click', onClick);
  return button;
}

async function saveGoals(goals) {
  state.goals = goals;
  await chrome.storage.local.set({ goals });
}

function patchGoal(goals, id, patch) {
  return goals.map((goal) => (goal.id === id ? { ...goal, ...patch, updatedAt: Date.now() } : goal));
}

async function toggleGoal(goal) {
  await saveGoals(patchGoal(state.goals, goal.id, { status: goal.status === 'paused' ? 'active' : 'paused' }));
}

async function removeGoal(id) {
  await saveGoals(state.goals.filter((goal) => goal.id !== id));
}

/**
 * Turning a suggestion into real money: recurring cuts raise the monthly
 * reservation, one-off cuts drop the item from the cart and land in the fund.
 */
async function applyOpportunity(goalId, opportunityId) {
  const goal = state.goals.find((entry) => entry.id === goalId);
  const opportunity = goal?.opportunities?.find((entry) => entry.id === opportunityId);
  if (!goal || !opportunity || opportunity.applied) return;

  const amount = Number(opportunity.amount || 0);
  const patch = {
    opportunities: goal.opportunities.map((entry) =>
      entry.id === opportunityId ? { ...entry, applied: true } : entry,
    ),
  };

  if (opportunity.recurring) {
    patch.monthlyContribution = Math.round((Number(goal.monthlyContribution || 0) + amount) * 100) / 100;
  } else {
    patch.saved = Math.min(Number(goal.targetAmount || 0), Number(goal.saved || 0) + amount);
    patch.contributions = [
      ...(goal.contributions || []),
      { at: Date.now(), amount, note: `Skipped ${opportunity.label}` },
    ];
  }

  const next = patchGoal(state.goals, goalId, finalizeGoal({ ...goal, ...patch }));
  const items = opportunity.fingerprint
    ? state.items.filter((item) => item.fingerprint !== opportunity.fingerprint)
    : state.items;

  state.items = items;
  await chrome.storage.local.set({ goals: next, items });
  state.goals = next;
}

function finalizeGoal(goal) {
  const projection = projectGoal(goal);
  return {
    ...goal,
    months: projection.months,
    projectedReadyDate: projection.readyDate,
    status: projection.percent >= 100 ? 'reached' : goal.status === 'reached' ? 'active' : goal.status || 'active',
  };
}

/* ----------------------------------------------------------------- cart --- */

function renderItems() {
  const considering = state.items.filter((item) => item.status !== 'bought');
  const bought = state.items.filter((item) => item.status === 'bought');
  $('consideringCount').textContent = considering.length;
  $('boughtCount').textContent = bought.length;
  renderCardList($('consideringCards'), considering, false);
  renderCardList($('boughtCards'), bought, true);
}

function renderCardList(container, items, isBought) {
  container.textContent = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = isBought ? 'Nothing marked bought yet.' : 'Add something to a cart and it’ll appear here.';
    container.append(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'item-card';

    const media = item.image ? document.createElement('img') : document.createElement('div');
    media.className = `item-image${item.image ? '' : ' placeholder'}`;
    if (item.image) {
      media.src = item.image;
      media.alt = '';
      media.referrerPolicy = 'no-referrer';
      media.addEventListener('error', () => {
        const placeholder = document.createElement('div');
        placeholder.className = 'item-image placeholder';
        placeholder.textContent = '◌';
        media.replaceWith(placeholder);
      });
    } else {
      media.textContent = '◌';
    }

    const body = document.createElement('div');
    const title = document.createElement('p');
    title.className = 'item-title';
    title.textContent = item.title || 'Shopping item';
    if (item.intent === 'buying' && !isBought) {
      const chip = document.createElement('span');
      chip.className = 'intent-chip';
      chip.textContent = 'buying now';
      title.append(chip);
    }

    const meta = document.createElement('p');
    meta.className = 'item-meta';
    meta.textContent = item.site || 'shopping site';

    const price = document.createElement('div');
    price.className = 'item-price';
    price.textContent = item.price == null ? 'Price not detected' : money(item.price, item.currency || state.settings.currency);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.append(
      actionButton(isBought ? 'Move back' : 'Mark bought', () =>
        updateItem(item.fingerprint, {
          status: isBought ? 'considering' : 'bought',
          intent: isBought ? 'considering' : 'bought',
        })),
    );

    const visit = actionButton('Open', () => item.url && chrome.tabs.create({ url: item.url }), 'quiet');
    visit.disabled = !item.url;
    actions.append(visit, actionButton('Remove', () => removeItem(item.fingerprint), 'quiet'));

    body.append(title, meta, price, actions);
    card.append(media, body);
    container.append(card);
  }
}

function renderNudge() {
  const nudge = state.purchaseNudge;
  $('purchaseNudge').classList.toggle('hidden', !nudge);
  $('purchaseNudgeText').textContent = nudge?.text || '';
}

async function updateItem(fingerprint, patch) {
  const items = state.items.map((item) =>
    item.fingerprint === fingerprint ? { ...item, ...patch, updatedAt: Date.now() } : item,
  );
  await chrome.storage.local.set({ items });
}

async function removeItem(fingerprint) {
  await chrome.storage.local.set({ items: state.items.filter((item) => item.fingerprint !== fingerprint) });
}

/* ----------------------------------------------------------------- chat --- */

function openChat() {
  $('chatView').classList.add('open');
  $('chatView').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('chatInput').focus(), 220);
  scrollChat();
}

function closeChat() {
  $('chatView').classList.remove('open');
  $('chatView').setAttribute('aria-hidden', 'true');
}

function renderQuickChips() {
  const container = $('quickChips');
  container.textContent = '';
  for (const prompt of QUICK_PROMPTS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = prompt.length > 34 ? `${prompt.slice(0, 32)}…` : prompt;
    chip.title = prompt;
    chip.addEventListener('click', () => {
      if (ui.sending) return;
      $('chatInput').value = prompt;
      $('chatForm').requestSubmit();
    });
    container.append(chip);
  }
}

function renderChat() {
  const log = $('chatLog');
  log.textContent = '';

  if (!state.chatMessages.length) {
    const intro = document.createElement('div');
    intro.className = 'message agent';
    const speaker = document.createElement('span');
    speaker.className = 'speaker';
    speaker.textContent = 'Room';
    intro.append(
      speaker,
      document.createTextNode(
        'Ask about an item, your remaining budget, or something you want to save for. Bestie can research the cost, build the plan, and set up the card for you.',
      ),
    );
    log.append(intro);
  }

  for (const message of state.chatMessages.slice(-40)) {
    if (message.kind === 'action') {
      const receipt = document.createElement('div');
      receipt.className = 'receipt';
      receipt.textContent = message.content;
      log.append(receipt);
      continue;
    }

    const node = document.createElement('div');
    node.className = `message ${message.role === 'user' ? 'user' : 'agent'}${message.agent === 'Mom' ? ' from-mom' : ''}${message.agent === 'Bestie' ? ' from-bestie' : ''}`;
    const speaker = document.createElement('span');
    speaker.className = 'speaker';
    speaker.textContent = message.role === 'user' ? 'You' : message.agent || 'Agent';
    node.append(speaker, document.createTextNode(message.content));
    log.append(node);
  }
  scrollChat();
}

function renderActivity() {
  const container = $('activity');
  container.textContent = '';
  container.classList.toggle('hidden', !ui.activity.length);
  for (const entry of ui.activity.slice(-4)) {
    const chip = document.createElement('span');
    chip.className = `activity-chip${entry.done ? ' done' : ''}`;
    chip.textContent = `${entry.done ? '✓' : '•'} ${entry.label}`;
    container.append(chip);
  }
}

function pushActivity(label, key) {
  ui.activity.push({ key, label, done: false });
  renderActivity();
}

function completeActivity(key) {
  const entry = [...ui.activity].reverse().find((item) => item.key === key && !item.done);
  if (entry) entry.done = true;
  renderActivity();
}

function outboundMessages(history) {
  return history
    .filter((message) => message.kind !== 'action' && (message.role === 'user' || message.role === 'assistant'))
    .map(({ role, content }) => ({ role, content }));
}

function requestPayload(history) {
  return {
    sessionId: state.sessionId,
    messages: outboundMessages(history),
    state: {
      items: state.items,
      goals: state.goals,
      settings: {
        budget: state.settings.budget,
        currency: state.settings.currency,
        bills: state.settings.bills || [],
      },
    },
  };
}

function requestHeaders() {
  return {
    'content-type': 'application/json',
    ...(state.settings.sharedSecret ? { 'x-cartside-secret': state.settings.sharedSecret } : {}),
  };
}

async function sendChat(event) {
  event.preventDefault();
  const input = $('chatInput');
  const content = input.value.trim();
  if (!content || ui.sending) return;

  input.value = '';
  const history = [...state.chatMessages, { role: 'user', content, at: Date.now() }].slice(-40);
  state.chatMessages = history;
  await chrome.storage.local.set({ chatMessages: history });

  ui.activity = [];
  renderActivity();
  setSending(true);

  const backendUrl = String(state.settings.backendUrl || DEFAULT_SETTINGS.backendUrl).replace(/\/+$/, '');
  const payload = requestPayload(history);
  const arrived = [];

  try {
    try {
      await streamRoom(backendUrl, payload, arrived);
    } catch (streamError) {
      if (arrived.length) throw streamError;
      await postRoom(backendUrl, payload, arrived);
    }
  } catch (error) {
    await appendMessages([
      { role: 'assistant', agent: 'Room', content: `I couldn't reach the budgeting agents: ${error.message}`, at: Date.now() },
    ]);
  } finally {
    ui.activity = [];
    renderActivity();
    setSending(false);
  }
}

async function streamRoom(backendUrl, payload, arrived) {
  const response = await fetch(`${backendUrl}/api/chat/stream`, {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body || !(response.headers.get('content-type') || '').includes('text/event-stream')) {
    throw new Error(`Streaming unavailable (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let failure = '';

  const handle = async (event, data) => {
    if (event === 'tool') pushActivity(`${data.agent}: ${data.label}`, `${data.agent}:${data.tool}`);
    else if (event === 'tool_result') completeActivity(`${data.agent}:${data.tool}`);
    else if (event === 'status') pushActivity(`${data.agent} is thinking`, `${data.agent}:thinking`);
    else if (event === 'message') {
      completeActivity(`${data.agent}:thinking`);
      arrived.push(data.agent);
      await appendMessages([{ role: 'assistant', agent: data.agent, content: data.content, at: Date.now() }]);
    } else if (event === 'actions') await applyActions(data.actions || []);
    else if (event === 'agent_error') failure = failure || `${data.agent}: ${data.error}`;
    else if (event === 'error') failure = data.error || 'Agent room failed.';
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split;
    while ((split = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      let name = 'message';
      let raw = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) raw += line.slice(5).trim();
      }
      if (!raw) continue;
      try {
        await handle(name, JSON.parse(raw));
      } catch {
        // A malformed frame should never take the whole room down.
      }
    }
  }

  if (!arrived.length) throw new Error(failure || 'The agents did not reply.');
}

async function postRoom(backendUrl, payload, arrived) {
  const response = await fetch(`${backendUrl}/api/chat`, {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Backend returned ${response.status}`);

  await applyActions(data.actions || []);
  const replies = (data.replies || []).map((reply) => ({
    role: 'assistant',
    agent: reply.agent,
    content: reply.content,
    at: Date.now(),
  }));
  arrived.push(...replies.map((reply) => reply.agent));
  await appendMessages(replies);
}

async function appendMessages(messages) {
  if (!messages.length) return;
  state.chatMessages = [...state.chatMessages, ...messages].slice(-40);
  await chrome.storage.local.set({ chatMessages: state.chatMessages });
}

/**
 * What the agents did, turned into real state. This is the moment a plan stops
 * being a chat message and becomes a card in the panel.
 */
async function applyActions(actions) {
  if (!actions?.length) return;
  let goals = [...state.goals];
  const receipts = [];

  for (const action of actions) {
    if (action.type === 'create_goal' && action.goal?.id) {
      if (goals.some((goal) => goal.id === action.goal.id)) continue;
      goals = [finalizeGoal({ ...action.goal }), ...goals];
      const currency = action.goal.currency || state.settings.currency;
      receipts.push(
        `${action.goal.emoji || '🎯'} Created “${action.goal.name}” — ${money(action.goal.monthlyContribution, currency)}/month reserved toward ${money(action.goal.targetAmount, currency)}`,
      );
    } else if (action.type === 'update_goal') {
      const existing = goals.find((goal) => goal.id === action.id);
      if (!existing) continue;
      goals = patchGoal(goals, action.id, finalizeGoal({ ...existing, ...action.patch }));
      receipts.push(`✏️ Updated “${existing.name}”`);
    } else if (action.type === 'contribute') {
      const existing = goals.find((goal) => goal.id === action.id);
      if (!existing) continue;
      const saved = Math.min(Number(existing.targetAmount || 0), Number(existing.saved || 0) + Number(action.amount || 0));
      goals = patchGoal(goals, action.id, finalizeGoal({
        ...existing,
        saved,
        contributions: [...(existing.contributions || []), { at: Date.now(), amount: action.amount, note: action.note || '' }],
      }));
      receipts.push(`💰 Added ${money(action.amount, existing.currency)} to “${existing.name}”`);
    } else if (action.type === 'set_opportunities') {
      const existing = goals.find((goal) => goal.id === action.id);
      if (!existing) continue;
      goals = patchGoal(goals, action.id, { opportunities: action.opportunities || [] });
      receipts.push(`🔎 Found ${action.opportunities?.length || 0} ways to save faster`);
    }
  }

  if (!receipts.length) return;
  await saveGoals(goals);
  await appendMessages(receipts.map((content) => ({ role: 'system', kind: 'action', content, at: Date.now() })));
}

function setSending(sending) {
  ui.sending = sending;
  $('sendChat').disabled = sending;
  $('chatInput').disabled = sending;
  $('sendChat').textContent = sending ? '…' : 'Send';
  $('quickChips').classList.toggle('hidden', sending);
}

function scrollChat() {
  requestAnimationFrame(() => {
    const log = $('chatLog');
    log.scrollTop = log.scrollHeight;
  });
}

/* -------------------------------------------------------------- dialogs --- */

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
  row.innerHTML = `
    <input data-key="name" aria-label="Bill name" placeholder="Rent" value="${escapeAttr(bill.name || '')}">
    <input data-key="amount" aria-label="Bill amount" type="number" min="0" step="0.01" placeholder="0" value="${escapeAttr(bill.amount ?? '')}">
    <input data-key="dueDate" aria-label="Bill due date" type="date" value="${escapeAttr(bill.dueDate || '')}">
    <button type="button" aria-label="Remove bill">×</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  $('billRows').append(row);
}

async function saveBudgetDialog(event) {
  event.preventDefault();
  const bills = [...$('billRows').querySelectorAll('.bill-row')]
    .map((row) => ({
      name: row.querySelector('[data-key="name"]').value.trim(),
      amount: Number(row.querySelector('[data-key="amount"]').value || 0),
      dueDate: row.querySelector('[data-key="dueDate"]').value,
    }))
    .filter((bill) => bill.name || bill.amount);

  const settings = {
    ...state.settings,
    budget: Math.max(0, Number($('budgetInput').value || 0)),
    currency: $('currencyInput').value,
    bills,
  };
  await chrome.storage.local.set({ settings });
  $('budgetDialog').close();
}

function openGoalDialog(goal = null) {
  ui.editingGoalId = goal?.id || null;
  $('goalDialogTitle').textContent = goal ? 'Adjust goal' : 'New goal';
  $('goalEmojiInput').value = goal?.emoji || '';
  $('goalNameInput').value = goal?.name || '';
  $('goalTargetInput').value = goal?.targetAmount || '';
  $('goalMonthlyInput').value = goal?.monthlyContribution || '';
  $('goalDateInput').value = goal?.targetDate || '';
  $('goalFormHint').textContent = `Reserved money is taken out of "Still free" in ${state.settings.currency}.`;
  $('goalDialog').showModal();
}

async function saveGoalDialog(event) {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') return $('goalDialog').close();

  const name = $('goalNameInput').value.trim();
  const targetAmount = Number($('goalTargetInput').value || 0);
  if (!name || targetAmount <= 0) return;

  const base = {
    name,
    emoji: [...($('goalEmojiInput').value.trim() || '🎯')][0],
    targetAmount,
    monthlyContribution: Math.max(0, Number($('goalMonthlyInput').value || 0)),
    targetDate: $('goalDateInput').value,
    currency: state.settings.currency,
    updatedAt: Date.now(),
  };

  if (ui.editingGoalId) {
    const existing = state.goals.find((goal) => goal.id === ui.editingGoalId);
    await saveGoals(patchGoal(state.goals, ui.editingGoalId, finalizeGoal({ ...existing, ...base })));
  } else {
    const goal = finalizeGoal({
      id: `goal_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      saved: 0,
      status: 'active',
      breakdown: [],
      opportunities: [],
      contributions: [],
      createdBy: 'you',
      createdAt: Date.now(),
      ...base,
    });
    await saveGoals([goal, ...state.goals]);
  }

  ui.editingGoalId = null;
  $('goalDialog').close();
}

function openContributeDialog(goal) {
  ui.contributingGoalId = goal.id;
  $('contributeTitle').textContent = `Add to ${goal.name}`;
  $('contributeInput').value = goal.monthlyContribution || '';
  $('contributeNote').value = '';
  $('contributeDialog').showModal();
}

async function saveContribution(event) {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') return $('contributeDialog').close();

  const goal = state.goals.find((entry) => entry.id === ui.contributingGoalId);
  const amount = Number($('contributeInput').value || 0);
  if (!goal || amount <= 0) return $('contributeDialog').close();

  const saved = Math.min(Number(goal.targetAmount || 0), Number(goal.saved || 0) + amount);
  await saveGoals(patchGoal(state.goals, goal.id, finalizeGoal({
    ...goal,
    saved,
    contributions: [...(goal.contributions || []), { at: Date.now(), amount, note: $('contributeNote').value.trim() }],
  })));

  ui.contributingGoalId = null;
  $('contributeDialog').close();
}

function escapeAttr(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
