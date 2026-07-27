import assert from 'node:assert/strict';
import test from 'node:test';

import { AiAnalystService } from '../src/ai/aiAnalystService.js';
import { CompanyAnalysisContextBuilder } from '../src/ai/contextBuilder.js';
import { AiError } from '../src/ai/errors.js';
import { AiObservability } from '../src/ai/observability.js';
import { AiAnalysisProvider } from '../src/ai/provider.js';
import {
  AI_SYMBOL,
  FakeAiProvider,
  analysisOutcome,
  contextSources,
  usage,
} from './fixtures/ai.js';

function contextBuilder() {
  const sources = contextSources();
  return new CompanyAnalysisContextBuilder(
    sources.market,
    sources.company,
    sources.financial,
    () => new Date('2026-07-26T00:00:00.000Z'),
  );
}

function service(
  provider: AiAnalysisProvider = new FakeAiProvider(),
  timeoutMs = 1_000,
  observability = new AiObservability(),
) {
  return new AiAnalystService(
    contextBuilder(),
    provider,
    timeoutMs,
    () => new Date('2026-07-27T01:02:03.000Z'),
    observability,
  );
}

const request = { symbol: AI_SYMBOL, question: '합성 분석 질문' };

test('service returns model semantics with server-generated metadata and only used references', async () => {
  const response = await service().analyze(request, 'request-safe');
  assert.equal(response.schemaVersion, '1');
  assert.equal(response.metadata.symbol, AI_SYMBOL);
  assert.equal(response.metadata.generatedAt, '2026-07-27T01:02:03.000Z');
  assert.equal(response.metadata.dataAsOf.market, '2026-07-24');
  assert.deepEqual(response.dataReferences.map(item => item.id), [
    'financial:revenue',
    'market:quote',
  ]);
  assert.equal(response.dataReferences.some(item => item.id === 'profile:company'), false);
});

test('all four normal domain statuses return HTTP-independent service responses', async () => {
  for (const status of ['answered', 'partial', 'insufficient_context', 'boundary'] as const) {
    const noFactors = status === 'insufficient_context' || status === 'boundary';
    const fake = new FakeAiProvider(analysisOutcome({
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
    assert.equal((await service(fake).analyze(request)).status, status);
  }
});

test('unknown evidence and evidence-free supporting or risk factors fail closed', async () => {
  const invalidOutputs = [
    {
      supportingFactors: [{ text: '알 수 없는 근거', evidenceRefs: ['financial:notReal'] }],
    },
    {
      supportingFactors: [{ text: '근거 없음', evidenceRefs: [] }],
    },
    {
      riskFactors: [{ text: '근거 없음', evidenceRefs: [] }],
    },
  ];
  for (const output of invalidOutputs) {
    await assert.rejects(
      service(new FakeAiProvider(analysisOutcome(output))).analyze(request),
      (error: unknown) => error instanceof AiError
        && ['AI_EVIDENCE_INVALID', 'AI_OUTPUT_SCHEMA_INVALID'].includes(error.code),
    );
  }
});

test('duplicate evidence references are deduplicated with stable ordering', async () => {
  const fake = new FakeAiProvider(analysisOutcome({
    supportingFactors: [{
      text: '중복 근거',
      evidenceRefs: ['financial:revenue', 'financial:revenue'],
    }],
  }));
  const response = await service(fake).analyze(request);
  assert.deepEqual(response.supportingFactors[0]?.evidenceRefs, ['financial:revenue']);
});

test('bounds and strict unknown-field validation reject malformed model output', async () => {
  const invalidOutputs = [
    { answer: 'x'.repeat(1_201) },
    { followUpQuestion: 'x'.repeat(301) },
    {
      supportingFactors: Array.from({ length: 5 }, (_, index) => ({
        text: `근거 ${index}`,
        evidenceRefs: ['financial:revenue'],
      })),
    },
    { symbol: '005930' },
    { answer: '<script>alert(1)</script>' },
    { answer: '[임의 링크](https://example.invalid)' },
  ];
  for (const output of invalidOutputs) {
    await assert.rejects(
      service(new FakeAiProvider(analysisOutcome(output))).analyze(request),
      (error: unknown) => error instanceof AiError && error.code === 'AI_OUTPUT_SCHEMA_INVALID',
    );
  }
});

test('provider refusal becomes a server-authored boundary response', async () => {
  const fake = new FakeAiProvider({
    kind: 'refusal',
    usage: usage(),
    providerRequestId: 'resp_refusal',
  });
  const response = await service(fake).analyze(request);
  assert.equal(response.status, 'boundary');
  assert.deepEqual(response.supportingFactors, []);
  assert.deepEqual(response.riskFactors, []);
  assert.deepEqual(response.dataReferences, []);
  assert.equal(response.answer.includes('provider'), false);
});

test('service timeout aborts provider work and maps to AI_TIMEOUT', async () => {
  let aborted = false;
  const provider: AiAnalysisProvider = {
    id: 'slow-fake',
    model: 'fake-model',
    reasoningEffort: 'medium',
    isConfigured: () => true,
    analyze: (_input, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new AiError('AI_PROVIDER_UNAVAILABLE'));
      });
    }),
  };
  await assert.rejects(
    service(provider, 5).analyze(request),
    (error: unknown) => error instanceof AiError && error.code === 'AI_TIMEOUT',
  );
  assert.equal(aborted, true);
});

test('unconfigured provider is rejected before any trusted context fetch', async () => {
  let sourceCalls = 0;
  const sources = contextSources();
  const builder = new CompanyAnalysisContextBuilder(
    { async getQuote(symbol) { sourceCalls += 1; return sources.market.getQuote(symbol); } },
    sources.company,
    sources.financial,
  );
  const ai = new AiAnalystService(builder, new FakeAiProvider(analysisOutcome(), false), 1_000);
  await assert.rejects(
    ai.analyze(request),
    (error: unknown) => error instanceof AiError && error.code === 'AI_NOT_CONFIGURED',
  );
  assert.equal(sourceCalls, 0);
});

test('structured logs contain counts and usage but omit raw question, history, context, and secrets', async () => {
  const events: object[] = [];
  const observability = new AiObservability();
  observability.setLogger({
    info(data) { events.push(data); },
    warn(data) { events.push(data); },
    error(data) { events.push(data); },
  });
  await service(new FakeAiProvider(), 1_000, observability).analyze({
    symbol: AI_SYMBOL,
    question: '로그에 남으면 안 되는 질문 원문',
    history: [{ role: 'user', content: '로그에 남으면 안 되는 대화 원문' }],
  });
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('로그에 남으면 안 되는 질문 원문'), false);
  assert.equal(serialized.includes('로그에 남으면 안 되는 대화 원문'), false);
  assert.equal(serialized.includes('company-analysis-context-v1'), true);
  assert.equal(serialized.includes('"inputTokens":100'), true);
});
