const { buildBudgetContext, deterministicPurchaseRisk } = require('./budget');

const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';

function buildJevState(state, item = {}) {
  return [
    buildBudgetContext(state),
    '',
    'CANDIDATE PURCHASE',
    `Title: ${String(item.title || 'Unknown').slice(0, 240)}`,
    `Site: ${String(item.site || 'Unknown').slice(0, 120)}`,
    `Price: ${item.price == null ? 'unknown' : Number(item.price)}`,
    `Currency: ${String(item.currency || state?.settings?.currency || 'USD').slice(0, 3)}`,
    `Intent signal: ${String(item.intent || 'considering').slice(0, 40)}`,
  ].join('\n');
}

const QUESTIONS = Object.freeze({
  spend_type: {
    type: 'choice',
    instructions: 'Classify the candidate purchase by the kind of spending suggested by the product itself. Do not assume the user planned it.',
    criteria: {
      essential_like: 'Commonly a basic necessity or required household, health, education, or work expense.',
      discretionary: 'Primarily optional, recreational, aesthetic, convenience, hobby, entertainment, or luxury spending.',
      unclear: 'The product title and supplied state are insufficient to classify reliably.',
    },
  },
  duplicate_risk: {
    type: 'noul',
    instructions: 'Does the candidate appear substantially similar to another item already listed in the shopping state?',
  },
  delay_value: {
    type: 'score',
    instructions: 'How useful would a cooling-off delay likely be before this purchase, based only on the supplied shopping and budget state?',
    criteria: [
      'Little reason to delay based on the available state.',
      'A short pause may be useful.',
      'A 24-hour pause would likely improve the decision.',
      'Strong reason to delay and reassess before purchase.',
    ],
  },
});

function normalizeJevAnswers(data) {
  const answers = data?.answers && typeof data.answers === 'object' ? data.answers : {};
  const spend = answers.spend_type || {};
  const delay = answers.delay_value || {};
  const duplicate = answers.duplicate_risk || {};
  return {
    spendType: typeof spend.choice === 'string' ? spend.choice : 'unclear',
    spendConfidence: Number.isFinite(spend.confidence) ? spend.confidence : 0,
    duplicateRisk: Number.isFinite(duplicate.noul) ? Math.max(0, Math.min(1, duplicate.noul)) : null,
    delayScore: Number.isFinite(delay.score) ? delay.score : null,
    delayConfidence: Number.isFinite(delay.confidence) ? delay.confidence : 0,
  };
}

async function evaluateWithJev({ config, state, item, fetchImpl = fetch }) {
  const deterministic = deterministicPurchaseRisk({ state, item });
  if (!config.typeSafeApiKey) {
    return { enabled: false, model: null, deterministic, decision: null, reason: 'TYPESAFE_API_KEY is not configured.' };
  }

  const response = await fetchImpl(TYPESAFE_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.typeSafeApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      state: buildJevState(state, item),
      model: config.typeSafeModel,
      questions: QUESTIONS,
    }),
    signal: AbortSignal.timeout(config.typeSafeTimeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `TypeSafe returned ${response.status}`;
    throw new Error(message);
  }

  return {
    enabled: true,
    model: data.model || config.typeSafeModel,
    deterministic,
    decision: normalizeJevAnswers(data),
    usage: data.usage || null,
  };
}

module.exports = { QUESTIONS, buildJevState, evaluateWithJev, normalizeJevAnswers };
