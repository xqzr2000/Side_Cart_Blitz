const fs = require('node:fs');
const path = require('node:path');

function loadLocalEnv(cwd = process.cwd()) {
  const envPath = path.resolve(cwd, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function integerEnv(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function parseOrigins(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getConfig() {
  loadLocalEnv();
  const nodeEnv = process.env.NODE_ENV || 'development';
  const host = process.env.HOST || '0.0.0.0';
  const sharedSecret = process.env.APP_SHARED_SECRET || '';

  if (nodeEnv === 'production' && host !== '127.0.0.1' && host !== 'localhost' && !sharedSecret) {
    throw new Error('APP_SHARED_SECRET is required for a non-local production bind.');
  }

  return Object.freeze({
    nodeEnv,
    host,
    port: integerEnv('PORT', 8787, 1, 65535),
    sharedSecret,
    allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
    requestBodyMaxBytes: integerEnv('REQUEST_BODY_MAX_BYTES', 262144, 4096, 2_000_000),
    rateLimitWindowMs: integerEnv('RATE_LIMIT_WINDOW_MS', 60000, 1000, 3_600_000),
    rateLimitMax: integerEnv('RATE_LIMIT_MAX', 45, 1, 10_000),
    openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
    openRouterModel: process.env.OPENROUTER_MODEL || 'openrouter/auto',
    openRouterTimeoutMs: integerEnv('OPENROUTER_TIMEOUT_MS', 20000, 1000, 120000),
    typeSafeApiKey: process.env.TYPESAFE_API_KEY || '',
    typeSafeModel: process.env.TYPESAFE_MODEL || 'jev-latest',
    typeSafeTimeoutMs: integerEnv('TYPESAFE_TIMEOUT_MS', 8000, 1000, 60000),
    appUrl: process.env.APP_URL || 'http://localhost:8787',
    appTitle: process.env.APP_TITLE || 'WiseShelf',
  });
}

module.exports = { getConfig, loadLocalEnv, parseOrigins };
