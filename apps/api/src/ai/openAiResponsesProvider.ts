import OpenAI from 'openai';
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses';

import { OpenAiModel, OpenAiReasoningEffort } from '../config.js';
import {
  AI_MODEL_OUTPUT_JSON_SCHEMA,
  AiProviderInput,
  AiProviderOutcome,
  AiProviderUsage,
} from './contracts.js';
import { AiError } from './errors.js';
import { AI_ANALYST_INSTRUCTIONS, buildOpenAiInput } from './prompt.js';
import { AiAnalysisProvider } from './provider.js';

export interface OpenAiResponsesClient {
  create(
    params: ResponseCreateParamsNonStreaming,
    options?: { signal?: AbortSignal },
  ): PromiseLike<Response>;
}

export interface OpenAiResponsesProviderConfig {
  apiKey?: string;
  model: OpenAiModel;
  reasoningEffort: OpenAiReasoningEffort;
  timeoutMs: number;
  maxOutputTokens: number;
}

export const OPENAI_MAX_RETRIES = 0;

function createClient(config: OpenAiResponsesProviderConfig): OpenAiResponsesClient | undefined {
  if (!config.apiKey) return undefined;
  const sdk = new OpenAI({
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    maxRetries: OPENAI_MAX_RETRIES,
    logLevel: 'off',
  });
  return {
    create(params, options) {
      return sdk.responses.create(params, { signal: options?.signal });
    },
  };
}

function emptyUsage(): AiProviderUsage {
  return {
    inputTokens: null,
    cachedInputTokens: null,
    cacheWriteTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
  };
}

function usageFromResponse(response: Response): AiProviderUsage {
  const usage = response.usage;
  if (!usage) return emptyUsage();
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.input_tokens_details.cached_tokens,
    cacheWriteTokens: usage.input_tokens_details.cache_write_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details.reasoning_tokens,
    totalTokens: usage.total_tokens,
  };
}

function hasRefusal(response: Response): boolean {
  return response.output.some(item => (
    item.type === 'message'
    && item.content.some(content => content.type === 'refusal')
  ));
}

function mapProviderError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new AiError('AI_TIMEOUT', undefined, error.code ?? undefined, error.requestID ?? undefined);
  }
  if (error instanceof OpenAI.APIUserAbortError) {
    return new AiError('AI_PROVIDER_UNAVAILABLE');
  }
  if (error instanceof OpenAI.APIError) {
    const requestId = error.requestID ?? undefined;
    const code = error.code ?? undefined;
    if (error.status === 429) {
      return new AiError('AI_PROVIDER_RATE_LIMITED', error.status, code, requestId);
    }
    return new AiError('AI_PROVIDER_UNAVAILABLE', error.status, code, requestId);
  }
  return new AiError('AI_PROVIDER_UNAVAILABLE');
}

export class OpenAiResponsesProvider implements AiAnalysisProvider {
  readonly id = 'openai';
  readonly model: OpenAiModel;
  readonly reasoningEffort: OpenAiReasoningEffort;
  private readonly client?: OpenAiResponsesClient;

  constructor(
    private readonly config: OpenAiResponsesProviderConfig,
    client?: OpenAiResponsesClient,
  ) {
    this.model = config.model;
    this.reasoningEffort = config.reasoningEffort;
    this.client = client ?? createClient(config);
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.client);
  }

  async analyze(input: AiProviderInput, signal?: AbortSignal): Promise<AiProviderOutcome> {
    if (!this.client || !this.config.apiKey) throw new AiError('AI_NOT_CONFIGURED');
    try {
      const response = await this.client.create({
        model: this.config.model,
        instructions: AI_ANALYST_INSTRUCTIONS,
        input: buildOpenAiInput(input),
        reasoning: { effort: this.config.reasoningEffort },
        store: false,
        stream: false,
        max_output_tokens: this.config.maxOutputTokens,
        text: {
          verbosity: 'low',
          format: {
            type: 'json_schema',
            name: 'alpha_twin_ai_analyst',
            strict: true,
            schema: AI_MODEL_OUTPUT_JSON_SCHEMA,
          },
        },
        ...(input.safetyIdentifier
          ? { safety_identifier: input.safetyIdentifier }
          : {}),
      }, { signal });
      const usage = usageFromResponse(response);
      if (response.status === 'incomplete') {
        throw new AiError(
          'AI_OUTPUT_INCOMPLETE',
          undefined,
          response.incomplete_details?.reason ?? undefined,
          response.id,
        );
      }
      if (response.error) {
        throw new AiError('AI_PROVIDER_UNAVAILABLE', undefined, response.error.code, response.id);
      }
      if (hasRefusal(response)) {
        return { kind: 'refusal', usage, providerRequestId: response.id };
      }
      if (!response.output_text.trim()) {
        throw new AiError('AI_OUTPUT_SCHEMA_INVALID', undefined, undefined, response.id);
      }
      let analysis: unknown;
      try {
        analysis = JSON.parse(response.output_text);
      } catch {
        throw new AiError('AI_OUTPUT_SCHEMA_INVALID', undefined, undefined, response.id);
      }
      return {
        kind: 'analysis',
        analysis,
        usage,
        providerRequestId: response.id,
      };
    } catch (error) {
      throw mapProviderError(error);
    }
  }
}
