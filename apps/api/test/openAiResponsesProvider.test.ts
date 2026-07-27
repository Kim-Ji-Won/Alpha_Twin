import assert from 'node:assert/strict';
import test from 'node:test';

import OpenAI from 'openai';
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses';

import { AiError } from '../src/ai/errors.js';
import {
  OpenAiResponsesClient,
  OpenAiResponsesProvider,
  OPENAI_MAX_RETRIES,
} from '../src/ai/openAiResponsesProvider.js';
import { AI_ANALYST_INSTRUCTIONS } from '../src/ai/prompt.js';
import { validAnalysis } from './fixtures/ai.js';

function response(overrides: Partial<Response> = {}): Response {
  return {
    id: 'resp_test',
    status: 'completed',
    output_text: JSON.stringify(validAnalysis()),
    output: [],
    error: null,
    incomplete_details: null,
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 20, cache_write_tokens: 5 },
      output_tokens: 40,
      output_tokens_details: { reasoning_tokens: 10 },
      total_tokens: 140,
    },
    ...overrides,
  } as unknown as Response;
}

class CapturingClient implements OpenAiResponsesClient {
  params?: ResponseCreateParamsNonStreaming;
  signal?: AbortSignal;

  constructor(private result: Response | Error = response()) {}

  create(
    params: ResponseCreateParamsNonStreaming,
    options?: { signal?: AbortSignal },
  ): PromiseLike<Response> {
    this.params = params;
    this.signal = options?.signal;
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
}

function provider(client: OpenAiResponsesClient) {
  return new OpenAiResponsesProvider({
    apiKey: 'synthetic-key-not-real',
    model: 'gpt-5.6-terra',
    reasoningEffort: 'medium',
    timeoutMs: 35_000,
    maxOutputTokens: 12_000,
  }, client);
}

const input = {
  contextJson: '{"schemaVersion":"company-analysis-context-v1"}',
  validReferenceIds: ['market:quote'],
  history: [],
  question: '합성 질문',
};

test('OpenAI provider sends the explicit non-persistent structured Responses contract', async () => {
  const client = new CapturingClient();
  const abort = new AbortController();
  const result = await provider(client).analyze(
    { ...input, safetyIdentifier: 'anonymous-install-hash' },
    abort.signal,
  );
  assert.equal(result.kind, 'analysis');
  assert.equal(client.params?.model, 'gpt-5.6-terra');
  assert.equal(client.params?.instructions, AI_ANALYST_INSTRUCTIONS);
  assert.equal(client.params?.store, false);
  assert.equal(client.params?.stream, false);
  assert.deepEqual(client.params?.reasoning, { effort: 'medium' });
  assert.equal(client.params?.max_output_tokens, 12_000);
  assert.equal(client.params?.text?.verbosity, 'low');
  assert.equal(client.params?.text?.format?.type, 'json_schema');
  assert.equal(client.params?.text?.format?.strict, true);
  assert.deepEqual(client.params?.tools, undefined);
  assert.equal(client.params?.previous_response_id, undefined);
  assert.equal(client.params?.prompt_cache_key, undefined);
  assert.equal(client.params?.safety_identifier, 'anonymous-install-hash');
  assert.equal(client.signal, abort.signal);
  assert.equal(OPENAI_MAX_RETRIES, 0);
});

test('OpenAI provider parses usage without retaining the raw response', async () => {
  const result = await provider(new CapturingClient()).analyze(input);
  assert.equal(result.kind, 'analysis');
  assert.deepEqual(result.usage, {
    inputTokens: 100,
    cachedInputTokens: 20,
    cacheWriteTokens: 5,
    outputTokens: 40,
    reasoningTokens: 10,
    totalTokens: 140,
  });
  assert.equal('rawResponse' in result, false);
});

test('OpenAI refusal becomes a typed refusal without forwarding refusal text', async () => {
  const refusal = response({
    output_text: '',
    output: [{
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'refusal', refusal: 'private provider refusal text' }],
    }],
  });
  const result = await provider(new CapturingClient(refusal)).analyze(input);
  assert.equal(result.kind, 'refusal');
  assert.equal(JSON.stringify(result).includes('private provider refusal text'), false);
});

test('incomplete and malformed output fail closed', async () => {
  await assert.rejects(
    provider(new CapturingClient(response({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    }))).analyze(input),
    (error: unknown) => error instanceof AiError && error.code === 'AI_OUTPUT_INCOMPLETE',
  );
  await assert.rejects(
    provider(new CapturingClient(response({ output_text: '{not-json' }))).analyze(input),
    (error: unknown) => error instanceof AiError && error.code === 'AI_OUTPUT_SCHEMA_INVALID',
  );
});

test('provider 401, 403, 429, 5xx and timeout map to safe AI errors', async () => {
  const cases: Array<[Error, string]> = [
    [new OpenAI.AuthenticationError(401, {}, 'private auth detail', new Headers()), 'AI_PROVIDER_UNAVAILABLE'],
    [new OpenAI.PermissionDeniedError(403, {}, 'private permission detail', new Headers()), 'AI_PROVIDER_UNAVAILABLE'],
    [new OpenAI.RateLimitError(429, {}, 'private rate detail', new Headers()), 'AI_PROVIDER_RATE_LIMITED'],
    [new OpenAI.InternalServerError(500, {}, 'private server detail', new Headers()), 'AI_PROVIDER_UNAVAILABLE'],
    [new OpenAI.APIConnectionTimeoutError({ message: 'private timeout detail' }), 'AI_TIMEOUT'],
  ];
  for (const [providerError, code] of cases) {
    await assert.rejects(
      provider(new CapturingClient(providerError)).analyze(input),
      (error: unknown) => (
        error instanceof AiError
        && error.code === code
        && !error.safeMessage.includes('private')
      ),
    );
  }
});

test('provider without a key is unconfigured and cannot attempt a request', async () => {
  let calls = 0;
  const client: OpenAiResponsesClient = {
    create() {
      calls += 1;
      return Promise.resolve(response());
    },
  };
  const unconfigured = new OpenAiResponsesProvider({
    model: 'gpt-5.6-terra',
    reasoningEffort: 'medium',
    timeoutMs: 35_000,
    maxOutputTokens: 12_000,
  }, client);
  assert.equal(unconfigured.isConfigured(), false);
  await assert.rejects(
    unconfigured.analyze(input),
    (error: unknown) => error instanceof AiError && error.code === 'AI_NOT_CONFIGURED',
  );
  assert.equal(calls, 0);
});
