const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateWithJev, normalizeJevAnswers } = require('./jev');

test('Jev is an optional enhancement and deterministic risk still returns without a key', async () => {
  const result = await evaluateWithJev({
    config: { typeSafeApiKey: '', typeSafeModel: 'jev-latest', typeSafeTimeoutMs: 8000 },
    state: { settings: { budget: 100, currency: 'USD', bills: [] }, items: [] },
    item: { title: 'Thing', price: 20, currency: 'USD' },
  });
  assert.equal(result.enabled, false);
  assert.equal(result.deterministic.level, 'moderate');
});

test('Jev request uses one System One call with parallel atomic questions', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'jev-test',
        answers: {
          spend_type: { type: 'choice', choice: 'discretionary', confidence: 0.8, probabilities: { discretionary: 0.8, essential_like: 0.1, unclear: 0.1 } },
          duplicate_risk: { type: 'noul', noul: 0.7 },
          delay_value: { type: 'score', score: 2.2, confidence: 0.6, probabilities: {} },
        },
      }),
    };
  };
  const result = await evaluateWithJev({
    config: { typeSafeApiKey: 'test-key', typeSafeModel: 'jev-latest', typeSafeTimeoutMs: 8000 },
    state: { settings: { budget: 500, currency: 'USD', bills: [] }, items: [] },
    item: { title: 'Headphones', price: 100, currency: 'USD' },
    fetchImpl,
  });
  assert.equal(request.url, 'https://api.typesafe.ai/v1/systemone');
  assert.deepEqual(Object.keys(request.body.questions).sort(), ['delay_value', 'duplicate_risk', 'spend_type']);
  assert.equal(result.decision.spendType, 'discretionary');
  assert.equal(result.decision.duplicateRisk, 0.7);
});

test('normalizer defaults safely for incomplete provider output', () => {
  assert.deepEqual(normalizeJevAnswers({}), {
    spendType: 'unclear', spendConfidence: 0, duplicateRisk: null, delayScore: null, delayConfidence: 0,
  });
});
