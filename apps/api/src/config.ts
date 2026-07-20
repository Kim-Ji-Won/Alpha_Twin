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
  logLevel: 'silent' | 'error' | 'warn' | 'info';
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
    logLevel,
  };
}
