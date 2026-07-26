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
  logLevel: 'silent' | 'error' | 'warn' | 'info';
}

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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const provider = env.MARKET_DATA_PROVIDER === 'public-data'
    ? 'public-data'
    : env.MARKET_DATA_PROVIDER === 'live' || env.MARKET_DATA_PROVIDER === 'live-placeholder'
      ? 'live-placeholder'
      : 'mock';
  const logLevel = ['silent', 'error', 'warn', 'info'].includes(env.LOG_LEVEL ?? '')
    ? env.LOG_LEVEL as AppConfig['logLevel']
    : 'info';
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
    logLevel,
  };
}
import { fileURLToPath } from 'node:url';
