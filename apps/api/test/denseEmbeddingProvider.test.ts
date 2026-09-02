import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';

import { createOpenAiEmbeddingTokenizer, DENSE_COST_LIMITS,
  planDenseBatches } from '../src/filingIntelligence/dense/batchPlanner.js';
import { DenseGenerationError, isCompatibleEmbeddingResponseModel } from '../src/filingIntelligence/dense/embeddingProvider.js';
import { OpenAiEmbeddingProvider, parseRetryAfterMs } from '../src/filingIntelligence/dense/openAiEmbeddingProvider.js';
import { FILING_DENSE_PROFILES } from '../src/filingIntelligence/dense/profile.js';

const profile = FILING_DENSE_PROFILES.openAiSmall1536;
const vector = () => Array.from({ length: 1536 }, (_, index) => (index % 17 + 1) / 100);
const input = (id: number, text = `입력 ${id}`) => ({ chunkRowId: String(id), chunkId: `chunk-${id}`,
  ordinal: id, contentHash: 'a'.repeat(64), retrievalText: text, inputFingerprint: 'b'.repeat(64) });
const denseError = (code: DenseGenerationError['code']) =>
  (value: unknown) => value instanceof DenseGenerationError && value.code === code;

test('OpenAI embedding adapter uses profile-owned model and dimensions and maps response indices', async () => {
  let request: unknown;
  const client = { create: async (body: unknown) => {
    request = body;
    return { object: 'list' as const, model: profile.modelId,
      data: [{ object: 'embedding' as const, index: 1, embedding: vector() },
        { object: 'embedding' as const, index: 0, embedding: vector() }],
      usage: { prompt_tokens: 12, total_tokens: 12 } };
  } };
  const provider = new OpenAiEmbeddingProvider('test-only', 1_000, client);
  const result = await provider.embedBatch(profile, [{ inputId: 'a', text: '한국어' }, { inputId: 'b', text: 'English 123' }]);
  assert.deepEqual(request, { model: profile.modelId, dimensions: 1536,
    encoding_format: 'float', input: ['한국어', 'English 123'] });
  assert.deepEqual(result.vectors.map(value => value.inputId), ['a', 'b']);
  assert.equal(result.tokenCount, 12);
});

test('OpenAI embedding adapter fails closed on malformed output', async t => {
  const response = (data: Array<{ object: 'embedding'; index: number; embedding: number[] }>, model = profile.modelId) => ({ create: async () => ({
    object: 'list' as const, model, data, usage: { prompt_tokens: 1, total_tokens: 1 },
  }) });
  await t.test('wrong model', async () => assert.rejects(
    new OpenAiEmbeddingProvider('test-only', 1_000, response([{ object: 'embedding', index: 0, embedding: vector() }], 'wrong'))
      .embedBatch(profile, [{ inputId: 'a', text: 'a' }]), denseError('DENSE_PROVIDER_RESPONSE_INVALID')));
  await t.test('duplicate index', async () => assert.rejects(
    new OpenAiEmbeddingProvider('test-only', 1_000, response([
      { object: 'embedding', index: 0, embedding: vector() },
      { object: 'embedding', index: 0, embedding: vector() },
    ])).embedBatch(profile, [{ inputId: 'a', text: 'a' }, { inputId: 'b', text: 'b' }]),
    denseError('DENSE_PROVIDER_RESPONSE_INVALID')));
  for (const embedding of [Array(1535).fill(0.1), Array(1536).fill(0),
    Array(1536).fill(Number.NaN), Array(1536).fill(Number.POSITIVE_INFINITY)]) {
    await assert.rejects(new OpenAiEmbeddingProvider('test-only', 1_000,
      response([{ object: 'embedding', index: 0, embedding }]))
      .embedBatch(profile, [{ inputId: 'a', text: 'a' }]), denseError('DENSE_PROVIDER_RESPONSE_INVALID'));
  }
});

test('OpenAI response model identity accepts only the requested alias or its dated snapshot', async () => {
  assert.equal(isCompatibleEmbeddingResponseModel(profile.modelId, profile.modelId), true);
  assert.equal(isCompatibleEmbeddingResponseModel(profile.modelId, `${profile.modelId}-2024-01-25`), true);
  assert.equal(isCompatibleEmbeddingResponseModel(profile.modelId, 'text-embedding-3-large'), false);
  assert.equal(isCompatibleEmbeddingResponseModel(profile.modelId, `${profile.modelId}-latest`), false);
  const client = { create: async () => ({ object: 'list' as const,
    model: `${profile.modelId}-2024-01-25`,
    data: [{ object: 'embedding' as const, index: 0, embedding: vector() }],
    usage: { prompt_tokens: 1, total_tokens: 1 } }) };
  const result = await new OpenAiEmbeddingProvider('test-only', 1_000, client)
    .embedBatch(profile, [{ inputId: 'a', text: 'a' }]);
  assert.equal(result.model, `${profile.modelId}-2024-01-25`);
});

test('OpenAI embedding adapter classifies rate limiting without exposing response content', async () => {
  const headers = new Headers({ 'retry-after': '7' });
  const client = { create: async () => { throw new OpenAI.RateLimitError(429, {}, 'sensitive', headers); } };
  await assert.rejects(new OpenAiEmbeddingProvider('test-only', 1_000, client)
    .embedBatch(profile, [{ inputId: 'a', text: 'a' }]), value => {
      assert.ok(value instanceof DenseGenerationError);
      assert.equal(value.code, 'DENSE_PROVIDER_RATE_LIMITED');
      assert.equal(value.retryable, true); assert.equal(value.retryAfterMs, 7_000);
      assert.equal(value.message.includes('sensitive'), false);
      return true;
    });
});

test('Retry-After parsing supports bounded seconds, HTTP-date, and provider reset formats', () => {
  const now = Date.parse('2026-09-02T00:00:00Z');
  assert.equal(parseRetryAfterMs(new Headers({ 'retry-after': '7' }), now), 7_000);
  assert.equal(parseRetryAfterMs(new Headers({ 'retry-after': 'Wed, 02 Sep 2026 00:00:09 GMT' }), now), 9_000);
  assert.equal(parseRetryAfterMs(new Headers({ 'retry-after': '-1' }), now), undefined);
  assert.equal(parseRetryAfterMs(new Headers({ 'retry-after': 'invalid' }), now), undefined);
  assert.equal(parseRetryAfterMs(new Headers({ 'retry-after': '999999999999999' }), now), 15 * 60_000);
  assert.equal(parseRetryAfterMs(new Headers({ 'x-ratelimit-reset-tokens': '1.5s' }), now), 1_500);
});

test('dense batch planner is deterministic and enforces exact token and cost boundaries', () => {
  const tokenizer = { count: (text: string) => text.length };
  const chunks = [input(1, '한글'), input(2, 'English'), input(3, '123 456')];
  assert.deepEqual(planDenseBatches(profile, chunks, tokenizer), planDenseBatches(profile, chunks, tokenizer));
  assert.throws(() => planDenseBatches(profile, [input(1, 'x')],
    { count: () => DENSE_COST_LIMITS.maximumTokensPerInput + 1 }), denseError('DENSE_INPUT_LIMIT_EXCEEDED'));
  assert.throws(() => planDenseBatches(profile,
    Array.from({ length: DENSE_COST_LIMITS.maximumChunksPerDocument + 1 }, (_, index) => input(index + 1)), tokenizer),
  denseError('DENSE_COST_LIMIT_EXCEEDED'));
  const fiveHundred = planDenseBatches(profile,
    Array.from({ length: 500 }, (_, index) => input(index + 1)), tokenizer);
  assert.deepEqual(fiveHundred.batches.map(batch => batch.length), [100, 100, 100, 100, 100]);
});

test('cl100k tokenizer counts Korean, English, numeric, and table-like inputs exactly and consistently', () => {
  const tokenizer = createOpenAiEmbeddingTokenizer();
  for (const value of ['한글 재무제표', 'English financial statement', '2026 1,234.56 -7.8%',
    '매출액 | 영업이익\n100 | 20']) {
    const count = tokenizer.count(value);
    assert.equal(Number.isInteger(count), true); assert.ok(count > 0);
    assert.equal(tokenizer.count(value), count);
  }
});
