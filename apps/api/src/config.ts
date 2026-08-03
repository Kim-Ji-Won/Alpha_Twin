import { fileURLToPath } from 'node:url';

export interface AppConfig {
  port: number;
  host: string;
  corsOrigins: string[];
  provider: 'mock' | 'public-data' | 'live-placeholder';
  marketDataBaseUrl?: string;
  marketDataApiKey?: string;
  marketDataAppSecret?: string;
  allowMockFallback: boolean;
  timeoutMs: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  cacheMaxEntries: number;
  openDartApiKey?: string;
  openDartBaseUrl: string;
  openDartTimeoutMs: number;
  openDartArchiveTimeoutMs: number;
  openDartIndexCacheDir: string;
  aiProvider: 'openai';
  openAiApiKey?: string;
  openAiModel: OpenAiModel;
  openAiReasoningEffort: OpenAiReasoningEffort;
  openAiTimeoutMs: number;
  openAiMaxOutputTokens: number;
  aiRateLimitMax: number;
  aiRateLimitWindowMs: number;
  filingPersistenceEnabled: boolean;
  databaseUrl?: string;
  databasePoolMax: number;
  databaseConnectionTimeoutMs: number;
  databaseIdleTimeoutMs: number;
  databaseStatementTimeoutMs: number;
  databaseSslMode: 'disable' | 'verify-full';
  logLevel: 'silent' | 'error' | 'warn' | 'info';
}

export type OpenAiModel = 'gpt-5.6-terra' | 'gpt-5.6-sol' | 'gpt-5.6-luna';
export type OpenAiReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedNumberFromEnv(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function enumFromEnv<T extends string>(
  name: string,
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value == null || !value.trim()) return fallback;
  const normalized = value.trim();
  if (!allowed.includes(normalized as T)) {
    throw new Error(`${name} must be one of ${allowed.join(', ')}`);
  }
  return normalized as T;
}

function booleanFromEnv(
  name: string,
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value == null || !value.trim()) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const provider = env.MARKET_DATA_PROVIDER === 'public-data'
    ? 'public-data'
    : env.MARKET_DATA_PROVIDER === 'live' || env.MARKET_DATA_PROVIDER === 'live-placeholder'
      ? 'live-placeholder'
      : 'mock';
  const logLevel = ['silent', 'error', 'warn', 'info'].includes(env.LOG_LEVEL ?? '')
    ? env.LOG_LEVEL as AppConfig['logLevel']
    : 'info';
  const filingPersistenceEnabled = booleanFromEnv(
    'FILING_PERSISTENCE_ENABLED',
    env.FILING_PERSISTENCE_ENABLED,
    false,
  );
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  if (filingPersistenceEnabled && !databaseUrl) {
    throw new Error(
      'DATABASE_URL is required when FILING_PERSISTENCE_ENABLED is true',
    );
  }
  return {
    port: numberFromEnv(env.PORT, 4000),
    host: env.HOST?.trim() || '127.0.0.1',
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:8081,http://localhost:8083,http://localhost:19006')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
    provider,
    marketDataBaseUrl: env.MARKET_DATA_BASE_URL?.trim() || undefined,
    marketDataApiKey: env.MARKET_DATA_API_KEY?.trim() || undefined,
    marketDataAppSecret: env.MARKET_DATA_APP_SECRET?.trim() || undefined,
    allowMockFallback: env.MARKET_DATA_ALLOW_MOCK_FALLBACK !== 'false',
    timeoutMs: numberFromEnv(env.MARKET_DATA_TIMEOUT_MS, 5000),
    rateLimitMax: numberFromEnv(env.RATE_LIMIT_MAX, 120),
    rateLimitWindowMs: numberFromEnv(env.RATE_LIMIT_WINDOW_MS, 60_000),
    cacheMaxEntries: numberFromEnv(env.MARKET_DATA_CACHE_MAX_ENTRIES, 500),
    openDartApiKey: env.OPENDART_API_KEY?.trim() || undefined,
    openDartBaseUrl: env.OPENDART_BASE_URL?.trim().replace(/\/$/, '') || 'https://opendart.fss.or.kr',
    openDartTimeoutMs: boundedNumberFromEnv(env.OPENDART_TIMEOUT_MS, 7_000, 1_000, 60_000),
    openDartArchiveTimeoutMs: boundedNumberFromEnv(env.OPENDART_ARCHIVE_TIMEOUT_MS, 15_000, 2_000, 120_000),
    openDartIndexCacheDir: env.OPENDART_INDEX_CACHE_DIR?.trim()
      || fileURLToPath(new URL('../.runtime-cache/opendart/', import.meta.url)),
    aiProvider: enumFromEnv('AI_PROVIDER', env.AI_PROVIDER, ['openai'] as const, 'openai'),
    openAiApiKey: env.OPENAI_API_KEY?.trim() || undefined,
    openAiModel: enumFromEnv(
      'OPENAI_MODEL',
      env.OPENAI_MODEL,
      ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna'] as const,
      'gpt-5.6-terra',
    ),
    openAiReasoningEffort: enumFromEnv(
      'OPENAI_REASONING_EFFORT',
      env.OPENAI_REASONING_EFFORT,
      ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const,
      'medium',
    ),
    openAiTimeoutMs: boundedNumberFromEnv(env.OPENAI_TIMEOUT_MS, 35_000, 1_000, 120_000),
    openAiMaxOutputTokens: boundedNumberFromEnv(
      env.OPENAI_MAX_OUTPUT_TOKENS,
      12_000,
      1_000,
      32_000,
    ),
    aiRateLimitMax: boundedNumberFromEnv(env.AI_RATE_LIMIT_MAX, 5, 1, 100),
    aiRateLimitWindowMs: boundedNumberFromEnv(
      env.AI_RATE_LIMIT_WINDOW_MS,
      10 * 60_000,
      1_000,
      24 * 60 * 60_000,
    ),
    filingPersistenceEnabled,
    databaseUrl,
    databasePoolMax: boundedNumberFromEnv(env.DATABASE_POOL_MAX, 4, 1, 20),
    databaseConnectionTimeoutMs: boundedNumberFromEnv(
      env.DATABASE_CONNECTION_TIMEOUT_MS,
      5_000,
      250,
      60_000,
    ),
    databaseIdleTimeoutMs: boundedNumberFromEnv(
      env.DATABASE_IDLE_TIMEOUT_MS,
      30_000,
      1_000,
      10 * 60_000,
    ),
    databaseStatementTimeoutMs: boundedNumberFromEnv(
      env.DATABASE_STATEMENT_TIMEOUT_MS,
      60_000,
      1_000,
      10 * 60_000,
    ),
    databaseSslMode: enumFromEnv(
      'DATABASE_SSL_MODE',
      env.DATABASE_SSL_MODE,
      ['disable', 'verify-full'] as const,
      'disable',
    ),
    logLevel,
  };
}
