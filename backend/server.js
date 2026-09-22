const http = require('node:http');
const crypto = require('node:crypto');
const { getConfig } = require('./config');
const { sanitizeState, summarizeBudget } = require('./budget');
const { evaluateWithJev } = require('./jev');
const { AGENTS, askAgent, cleanConversation } = require('./agents');

const config = getConfig();
const rateBuckets = new Map();

function log(level, message, fields = {}) {
  const entry = { ts: new Date().toISOString(), level, message, ...fields };
  process[level === 'error' ? 'stderr' : 'stdout'].write(`${JSON.stringify(entry)}\n`);
}

function requestId(req) {
  const supplied = String(req.headers['x-request-id'] || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
  return supplied || crypto.randomUUID();
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isAuthorized(req) {
  if (!config.sharedSecret) return true;
  return safeEqual(req.headers['x-wiseshelf-secret'] || req.headers['x-cartside-secret'], config.sharedSecret);
}

function corsOrigin(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return '';
  if (origin.startsWith('chrome-extension://')) return origin;
  if (config.allowedOrigins.includes(origin)) return origin;
  return '';
}

function responseHeaders(req, id) {
  const origin = corsOrigin(req);
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'x-request-id': id,
    ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    'access-control-allow-headers': 'content-type, x-wiseshelf-secret, x-cartside-secret, x-request-id',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
}

function sendJson(req, res, id, status, body) {
  const payload = status === 204 ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...responseHeaders(req, id),
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > config.requestBodyMaxBytes) {
        const error = new Error('Request body too large.');
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        const error = new Error('Invalid JSON.');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function clientKey(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function rateLimited(req) {
  const now = Date.now();
  const key = clientKey(req);
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= config.rateLimitWindowMs) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > config.rateLimitMax;
}

function validateItem(item) {
  if (!item || typeof item !== 'object') return null;
  const price = item.price == null ? null : Number(item.price);
  return {
    title: String(item.title || 'Shopping item').replace(/\s+/g, ' ').trim().slice(0, 240),
    site: String(item.site || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    price: Number.isFinite(price) && price >= 0 ? price : null,
    quantity: Math.min(99, Math.max(1, Number(item.quantity || 1))),
    currency: String(item.currency || '').toUpperCase().slice(0, 3),
    intent: String(item.intent || 'considering').slice(0, 40),
  };
}

async function handleEvaluate(req, res, id) {
  const body = await readJson(req);
  const state = sanitizeState(body.state || {});
  const item = validateItem(body.item);
  if (!item) return sendJson(req, res, id, 400, { error: 'A candidate item is required.', requestId: id });
  try {
    const evaluation = await evaluateWithJev({ config, state, item });
    return sendJson(req, res, id, 200, { evaluation, requestId: id });
  } catch (error) {
    log('error', 'jev_evaluation_failed', { requestId: id, error: error.message });
    const fallback = await evaluateWithJev({ config: { ...config, typeSafeApiKey: '' }, state, item });
    return sendJson(req, res, id, 200, { evaluation: fallback, warning: 'Structured AI evaluation unavailable; deterministic budget risk returned.', requestId: id });
  }
}

async function handleChat(req, res, id) {
  const body = await readJson(req);
  const conversation = cleanConversation(body.messages);
  if (!conversation.length || conversation.at(-1)?.role !== 'user') {
    return sendJson(req, res, id, 400, { error: 'A user message is required.', requestId: id });
  }
  const state = sanitizeState(body.state || {});
  const candidate = validateItem(body.item || state.items.find((item) => item.status !== 'bought') || null);
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 120) : '';

  let decisionContext = null;
  if (candidate?.title) {
    try {
      decisionContext = await evaluateWithJev({ config, state, item: candidate });
    } catch (error) {
      decisionContext = { enabled: false, reason: 'TypeSafe unavailable for this request.' };
      log('error', 'jev_chat_context_failed', { requestId: id, error: error.message });
    }
  }

  const results = await Promise.allSettled([
    askAgent({ config, agent: AGENTS.Mom, conversation, state, decisionContext, sessionId }),
    askAgent({ config, agent: AGENTS.Bestie, conversation, state, decisionContext, sessionId }),
  ]);
  const replies = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  const warnings = results.filter((result) => result.status === 'rejected').map((result) => result.reason?.message || 'Agent error');
  if (!replies.length) return sendJson(req, res, id, 502, { error: warnings.join(' | ') || 'Both agents failed.', requestId: id });
  return sendJson(req, res, id, 200, { replies, decisionContext, warnings, requestId: id });
}

const server = http.createServer(async (req, res) => {
  const id = requestId(req);
  const started = process.hrtime.bigint();
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'OPTIONS') return sendJson(req, res, id, 204, {});
    if (rateLimited(req)) return sendJson(req, res, id, 429, { error: 'Rate limit exceeded.', requestId: id });

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(req, res, id, 200, {
        ok: true,
        service: 'wiseshelf-backend',
        version: '1.0.0',
        providers: {
          openRouterConfigured: Boolean(config.openRouterApiKey),
          typeSafeConfigured: Boolean(config.typeSafeApiKey),
        },
      });
    }
    if (req.method === 'GET' && url.pathname === '/ready') {
      return sendJson(req, res, id, config.openRouterApiKey ? 200 : 503, { ready: Boolean(config.openRouterApiKey) });
    }

    if (!isAuthorized(req)) return sendJson(req, res, id, 401, { error: 'Unauthorized.', requestId: id });
    if (req.method === 'POST' && url.pathname === '/api/evaluate') return await handleEvaluate(req, res, id);
    if (req.method === 'POST' && url.pathname === '/api/chat') return await handleChat(req, res, id);
    return sendJson(req, res, id, 404, { error: 'Not found.', requestId: id });
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    log('error', 'request_failed', { requestId: id, status, error: error.message });
    if (!res.headersSent) sendJson(req, res, id, status, { error: status >= 500 ? 'Internal server error.' : error.message, requestId: id });
  } finally {
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    log('log', 'request_complete', { requestId: id, method: req.method, path: req.url, status: res.statusCode, elapsedMs: Number(elapsedMs.toFixed(2)) });
  }
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;

server.listen(config.port, config.host, () => {
  log('log', 'server_started', { host: config.host, port: config.port, env: config.nodeEnv });
});

function shutdown(signal) {
  log('log', 'shutdown_requested', { signal });
  server.close((error) => {
    if (error) {
      log('error', 'shutdown_failed', { error: error.message });
      process.exitCode = 1;
    }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { server, safeEqual, validateItem };
