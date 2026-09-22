const backendUrl = document.getElementById('backendUrl');
const sharedSecret = document.getElementById('sharedSecret');
const status = document.getElementById('status');

document.addEventListener('DOMContentLoaded', load);
document.getElementById('optionsForm').addEventListener('submit', save);
document.getElementById('testConnection').addEventListener('click', testConnection);

async function load() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  backendUrl.value = settings.backendUrl || 'http://localhost:8787';
  sharedSecret.value = settings.sharedSecret || '';
}

async function save(event) {
  event.preventDefault();
  try {
    const normalized = normalizeBackendUrl(backendUrl.value);
    const { settings = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, backendUrl: normalized, sharedSecret: sharedSecret.value } });
    showStatus('Settings saved. Provider credentials remain on the backend.');
  } catch (error) {
    showStatus(error.message);
  }
}

async function testConnection() {
  showStatus('Testing connection…');
  try {
    const url = normalizeBackendUrl(backendUrl.value);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetch(`${url}/health`, {
        signal: controller.signal,
        headers: sharedSecret.value ? { 'x-wiseshelf-secret': sharedSecret.value } : {},
      });
    } finally { clearTimeout(timeout); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const providers = data.providers || {};
    showStatus(`Connected to ${data.service || 'WiseShelf backend'} ${data.version || ''}. Chat provider: ${providers.openRouterConfigured ? 'configured' : 'not configured'}. Jev: ${providers.typeSafeConfigured ? 'configured' : 'not configured'}.`);
  } catch (error) {
    showStatus(error.name === 'AbortError' ? 'Connection timed out.' : `Connection failed: ${error.message}`);
  }
}

function normalizeBackendUrl(value) {
  const url = new URL(String(value || '').trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && url.protocol !== 'https:') throw new Error('Remote backends must use HTTPS so the shared secret is not sent in plaintext.');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Backend URL must use HTTP or HTTPS.');
  return url.toString().replace(/\/+$/, '');
}

function showStatus(text) { status.textContent = text; }
