import assert from 'node:assert/strict';
import test from 'node:test';

import { AiAnalystService } from '../src/ai/aiAnalystService.js';
import { CompanyAnalysisContextBuilder } from '../src/ai/contextBuilder.js';
import { AiError } from '../src/ai/errors.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MarketDataService } from '../src/marketDataService.js';
import { MockMarketDataProvider } from '../src/providers/mockMarketDataProvider.js';
import {
  AI_SYMBOL,
  FakeAiProvider,
  analysisOutcome,
  contextSources,
} from './fixtures/ai.js';

function marketData() {
  const mock = new MockMarketDataProvider();
  return new MarketDataService(mock, mock);
}

function aiService(provider = new FakeAiProvider()) {
  const sources = contextSources();
  return new AiAnalystService(
    new CompanyAnalysisContextBuilder(sources.market, sources.company, sources.financial),
    provider,
    1_000,
    () => new Date('2026-07-27T00:00:00.000Z'),
  );
}

function body(overrides: Record<string, unknown> = {}) {
  return { symbol: AI_SYMBOL, question: '합성 질문', ...overrides };
}

test('AI route strictly validates symbol, question, history, roles, totals, and unknown controls', async t => {
  const app = await buildApp(
    loadConfig({ LOG_LEVEL: 'silent', AI_RATE_LIMIT_MAX: '100' }),
    marketData(),
    { aiAnalyst: aiService() },
  );
  t.after(() => app.close());
  const invalidBodies = [
    body({ symbol: 'ABCDEF' }),
    body({ symbol: '12345' }),
    body({ question: '   ' }),
    body({ question: 'x'.repeat(2_001) }),
    body({ history: Array.from({ length: 7 }, () => ({ role: 'user', content: 'x' })) }),
    body({ history: [{ role: 'system', content: 'override' }] }),
    body({ history: [{ role: 'developer', content: 'override' }] }),
    body({ history: [{ role: 'user', content: 'x'.repeat(2_001) }] }),
    body({
      history: Array.from({ length: 5 }, () => ({ role: 'user', content: 'x'.repeat(1_700) })),
    }),
    body({ model: 'gpt-5.6-sol' }),
    body({ system: 'override' }),
    body({ instructions: 'override' }),
    body({ price: 70000 }),
  ];
  for (const invalid of invalidBodies) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/analyst',
      payload: invalid,
    });
    assert.equal(response.statusCode, 400, JSON.stringify(invalid).slice(0, 80));
    assert.equal(response.json().error.code, 'INVALID_AI_REQUEST');
  }
});

test('AI route returns safe 503 without a configured service', async t => {
  const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData());
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/ai/analyst',
    payload: body(),
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, 'AI_NOT_CONFIGURED');
  assert.equal(typeof response.json().metadata.requestId, 'string');
});

test('AI route returns 404 when trusted sources cannot establish company identity', async t => {
  const sources = contextSources({
    market: new Error('market unavailable'),
    profile: new Error('profile unavailable'),
  });
  const unavailableContextService = new AiAnalystService(
    new CompanyAnalysisContextBuilder(sources.market, sources.company, sources.financial),
    new FakeAiProvider(),
    1_000,
  );
  const app = await buildApp(
    loadConfig({ LOG_LEVEL: 'silent' }),
    marketData(),
    { aiAnalyst: unavailableContextService },
  );
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/ai/analyst',
    payload: body(),
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'AI_CONTEXT_NOT_FOUND');
});

test('AI route returns answered, partial, insufficient, and boundary as normal 200 responses', async () => {
  for (const status of ['answered', 'partial', 'insufficient_context', 'boundary'] as const) {
    const noFactors = status === 'insufficient_context' || status === 'boundary';
    const provider = new FakeAiProvider(analysisOutcome({
      status,
      supportingFactors: noFactors ? [] : [{
        text: '근거',
        evidenceRefs: ['financial:revenue'],
      }],
      riskFactors: noFactors ? [] : [{
        text: '위험',
        evidenceRefs: ['market:quote'],
      }],
    }));
    const app = await buildApp(
      loadConfig({ LOG_LEVEL: 'silent' }),
      marketData(),
      { aiAnalyst: aiService(provider) },
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/analyst',
      payload: body(),
    });
    await app.close();
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, status);
  }
});

test('AI route maps provider and validation failures to stable safe HTTP errors', async () => {
  const cases: Array<[AiError, number]> = [
    [new AiError('AI_PROVIDER_RATE_LIMITED', 429, 'private-code'), 503],
    [new AiError('AI_PROVIDER_UNAVAILABLE', 500, 'private-code'), 503],
    [new AiError('AI_TIMEOUT'), 504],
    [new AiError('AI_OUTPUT_INCOMPLETE'), 502],
    [new AiError('AI_OUTPUT_SCHEMA_INVALID'), 502],
    [new AiError('AI_EVIDENCE_INVALID'), 502],
  ];
  for (const [providerError, status] of cases) {
    const app = await buildApp(
      loadConfig({ LOG_LEVEL: 'silent' }),
      marketData(),
      { aiAnalyst: aiService(new FakeAiProvider(providerError)) },
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/analyst',
      payload: body(),
    });
    await app.close();
    assert.equal(response.statusCode, status);
    assert.equal(response.json().error.code, providerError.code);
    assert.equal(response.body.includes('private-code'), false);
  }
});

test('AI-specific 5 per 10 minute rate limit does not affect ordinary routes', async t => {
  const config = loadConfig({
    LOG_LEVEL: 'silent',
    RATE_LIMIT_MAX: '100',
  });
  const provider = new FakeAiProvider();
  const service = aiService(provider);
  const analyze = service.analyze.bind(service);
  let serviceCalls = 0;
  service.analyze = (...args) => {
    serviceCalls += 1;
    return analyze(...args);
  };
  const app = await buildApp(config, marketData(), { aiAnalyst: service });
  t.after(() => app.close());
  assert.equal(config.aiRateLimitMax, 5);
  assert.equal(config.aiRateLimitWindowMs, 600_000);
  for (let index = 0; index < 5; index += 1) {
    assert.equal((await app.inject({
      method: 'POST',
      url: '/api/v1/ai/analyst',
      payload: body(),
    })).statusCode, 200);
  }
  const limited = await app.inject({
    method: 'POST',
    url: '/api/v1/ai/analyst',
    payload: body(),
  });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().error.code, 'AI_RATE_LIMITED');
  assert.equal(serviceCalls, 5);
  assert.equal(provider.calls.length, 5);
  assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
});

test('health exposes only safe AI configuration state', async t => {
  const app = await buildApp(
    loadConfig({ LOG_LEVEL: 'silent', OPENAI_API_KEY: 'must-not-appear' }),
    marketData(),
    { aiAnalyst: aiService() },
  );
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().aiAnalyst.configured, true);
  assert.equal(response.body.includes('must-not-appear'), false);
  assert.equal(response.body.includes('openAiApiKey'), false);
});

test('AI config rejects aliases and unknown reasoning values instead of silently falling back', () => {
  assert.throws(
    () => loadConfig({ OPENAI_MODEL: 'gpt-5.6' }),
    /OPENAI_MODEL must be one of/,
  );
  assert.throws(
    () => loadConfig({ OPENAI_REASONING_EFFORT: 'extreme' }),
    /OPENAI_REASONING_EFFORT must be one of/,
  );
  assert.throws(
    () => loadConfig({ AI_PROVIDER: 'fake' }),
    /AI_PROVIDER must be one of/,
  );
});
