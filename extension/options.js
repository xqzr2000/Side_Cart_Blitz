const backendUrl = document.getElementById('backendUrl');
const sharedSecret = document.getElementById('sharedSecret');
const status = document.getElementById('status');

document.addEventListener('DOMContentLoaded', load);
document.getElementById('optionsForm').addEventListener('submit', save);
document.getElementById('testConnection').addEventListener('click', testConnection);
document.getElementById('loadDemo').addEventListener('click', loadDemo);
document.getElementById('clearAll').addEventListener('click', clearAll);

async function load() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  backendUrl.value = settings.backendUrl || 'http://localhost:8787';
  sharedSecret.value = settings.sharedSecret || '';
}

async function save(event) {
  event.preventDefault();
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({
    settings: {
      ...settings,
      backendUrl: backendUrl.value.trim().replace(/\/+$/, ''),
      sharedSecret: sharedSecret.value,
    },
  });
  showStatus('Saved.');
}

async function testConnection() {
  showStatus('Testing…');
  try {
    const url = backendUrl.value.trim().replace(/\/+$/, '');
    const response = await fetch(`${url}/health`, {
      headers: sharedSecret.value ? { 'x-cartside-secret': sharedSecret.value } : {},
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const extras = [
      `${data.tools?.length || 0} agent tools`,
      data.streaming ? 'live progress' : 'no streaming',
      data.webSearch ? 'web search on' : 'web search off',
    ].join(' · ');
    showStatus(`Connected. OpenRouter key: ${data.openRouterConfigured ? 'configured' : 'missing'}. Model: ${data.model}. ${extras}.`);
  } catch (error) {
    showStatus(`Connection failed: ${error.message}`);
  }
}

function showStatus(text) {
  status.textContent = text;
}

function showDemoStatus(text) {
  document.getElementById('demoStatus').textContent = text;
}

// The connection settings are the one thing worth keeping across a reset —
// re-typing a Codespaces URL mid-demo is exactly the wrong moment for it.
async function replaceState(next) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({
    ...next,
    settings: {
      ...next.settings,
      backendUrl: settings.backendUrl || backendUrl.value.trim() || 'http://localhost:8787',
      sharedSecret: settings.sharedSecret ?? sharedSecret.value,
    },
  });
}

async function loadDemo() {
  const demo = buildDemoState();
  await replaceState(demo);
  const bought = demo.items.filter((item) => item.status === 'bought').length;
  showDemoStatus(`Loaded: CA$900 budget, ${demo.settings.bills.length} bills, ${bought} bought and ${demo.items.length - bought} considering. Open the side panel.`);
}

async function clearAll() {
  await replaceState({
    items: [],
    goals: [],
    chatMessages: [],
    purchaseNudge: null,
    settings: { budget: 500, currency: 'USD', bills: [] },
  });
  showDemoStatus('Cleared. Budget reset to $500 USD.');
}
