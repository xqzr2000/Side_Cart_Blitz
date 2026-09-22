const ACTION_PATTERNS = {
  confirm: [
    /\bplace\s+(?:your\s+)?order\b/i,
    /\bcomplete\s+(?:order|purchase)\b/i,
    /\bconfirm\s+(?:order|purchase)\b/i,
    /\bsubmit\s+order\b/i,
    /\bpay\s+now\b/i,
  ],
  buyNow: [/\bbuy\s+now\b/i, /\bpurchase\s+now\b/i, /\bcheckout\b/i, /\bcheck\s*out\b/i],
  add: [/\badd\s+to\s+(?:cart|bag|basket)\b/i, /\badd\s+bag\b/i],
};

document.addEventListener('click', handleClick, true);

function handleClick(event) {
  if (!event.isTrusted) return;
  const control = findClickable(event.composedPath?.() || []);
  if (!control) return;
  const action = classifyAction(getControlLabel(control));
  if (!action) return;
  chrome.runtime.sendMessage({ type: 'SHOP_ACTION', action, item: extractProduct(control) }).catch(() => {});
}

function findClickable(path) {
  for (const node of path) {
    if (node instanceof Element && node.matches('button, a, input[type="button"], input[type="submit"], [role="button"]')) return node;
  }
  return null;
}

function getControlLabel(element) {
  return [element.innerText, element.textContent, element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('name'), element.getAttribute('value'), element.id]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function classifyAction(label) {
  if (!label) return null;
  for (const action of ['confirm', 'buyNow', 'add']) {
    if (ACTION_PATTERNS[action].some((pattern) => pattern.test(label))) return action;
  }
  return null;
}

function extractProduct(control) {
  const structured = findProductJsonLd();
  const title = firstText(structured?.name, meta('property', 'og:title'), meta('name', 'twitter:title'), text('[itemprop="name"]'), text('main h1'), text('h1'), document.title) || 'Shopping item';
  const offer = Array.isArray(structured?.offers) ? structured.offers[0] : structured?.offers;
  const rawPrice = firstText(offer?.price, offer?.lowPrice, meta('property', 'product:price:amount'), attr('[itemprop="price"]', 'content'), attr('[itemprop="price"]', 'value'), text('[itemprop="price"]'), nearbyPrice(control));
  const currency = firstText(offer?.priceCurrency, meta('property', 'product:price:currency'), attr('[itemprop="priceCurrency"]', 'content'), inferCurrency(rawPrice));
  const imageCandidate = Array.isArray(structured?.image) ? structured.image[0] : structured?.image;
  const image = absoluteUrl(firstText(typeof imageCandidate === 'object' ? imageCandidate?.url : imageCandidate, meta('property', 'og:image'), meta('name', 'twitter:image'), attr('[itemprop="image"]', 'src')));
  const url = canonicalUrl();
  const site = location.hostname.replace(/^www\./, '');
  return { title, price: parsePrice(rawPrice), currency, image, url, site, fingerprint: `${site}|${normalize(title)}|${normalize(url)}` };
}

function findProductJsonLd() {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const product = findTypedNode(JSON.parse(script.textContent), 'Product');
      if (product) return product;
    } catch {}
  }
  return null;
}

function findTypedNode(value, type) {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findTypedNode(entry, type);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  if (types.some((candidate) => String(candidate || '').toLowerCase() === type.toLowerCase())) return value;
  return value['@graph'] ? findTypedNode(value['@graph'], type) : null;
}

function nearbyPrice(control) {
  let node = control;
  for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
    for (const candidate of node.querySelectorAll?.('[class*="price" i], [data-testid*="price" i], [aria-label*="price" i]') || []) {
      const content = candidate.getAttribute('content') || candidate.getAttribute('aria-label') || candidate.textContent;
      if (content && /(?:[$€£¥₹]|\b(?:USD|CAD|EUR|GBP|JPY|INR|AED)\b).*\d|\d[\d,.]*/i.test(content)) return content.trim();
    }
  }
  return '';
}

function parsePrice(value) {
  if (value == null) return null;
  let token = String(value).replace(/[^0-9.,]/g, '');
  if (!token) return null;
  const comma = token.lastIndexOf(',');
  const dot = token.lastIndexOf('.');

  if (comma >= 0 && dot >= 0) {
    const decimalMark = comma > dot ? ',' : '.';
    const groupMark = decimalMark === ',' ? '.' : ',';
    token = token.split(groupMark).join('').replace(decimalMark, '.');
  } else if (comma >= 0) {
    const digitsAfter = token.length - comma - 1;
    token = digitsAfter === 1 || digitsAfter === 2 ? token.replace(',', '.') : token.replace(/,/g, '');
  } else if (dot >= 0) {
    const digitsAfter = token.length - dot - 1;
    if (digitsAfter === 3 && /^\d{1,3}(\.\d{3})+$/.test(token)) token = token.replace(/\./g, '');
  }

  const parsed = Number(token);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function inferCurrency(value) {
  const source = String(value || '');
  if (/CA\$|\bCAD\b/i.test(source)) return 'CAD';
  if (/US\$|\bUSD\b/i.test(source)) return 'USD';
  if (/₹|\bINR\b/i.test(source)) return 'INR';
  if (/€|\bEUR\b/i.test(source)) return 'EUR';
  if (/£|\bGBP\b/i.test(source)) return 'GBP';
  if (/¥|\bJPY\b/i.test(source)) return 'JPY';
  if (/\bAED\b/i.test(source)) return 'AED';
  if (/\$/i.test(source)) return 'USD';
  return '';
}

function meta(attribute, value) { return document.querySelector(`meta[${attribute}="${CSS.escape(value)}"]`)?.content || ''; }
function text(selector) { return document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || ''; }
function attr(selector, name) { return document.querySelector(selector)?.getAttribute(name) || ''; }
function firstText(...values) { return values.find((value) => value !== undefined && value !== null && String(value).trim())?.toString().trim() || ''; }
function normalize(value) { return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function canonicalUrl() {
  const href = document.querySelector('link[rel="canonical"]')?.href || location.href;
  try {
    const url = new URL(href, location.href);
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|ref_|tag$|aff|affiliate|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    url.hash = '';
    return url.toString();
  } catch { return location.href; }
}

function absoluteUrl(value) {
  if (!value) return '';
  try { return new URL(value, location.href).toString(); } catch { return ''; }
}
