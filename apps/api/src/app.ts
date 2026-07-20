import cors from '@fastify/cors';
import Fastify, { FastifyInstance } from 'fastify';

import { AppConfig } from './config.js';
import { ApiErrorDto, CandleRange } from './contracts.js';
import { isMarketDataError } from './marketDataErrors.js';
import { MarketDataService } from './marketDataService.js';

const SYMBOL_PATTERN = /^\d{6}$/;
const RANGES = new Set<CandleRange>(['1m', '3m', '6m', '1y']);

function normalizeSymbol(symbol: string): { symbol?: string; error?: string } {
  const normalized = symbol.trim();
  if (!SYMBOL_PATTERN.test(normalized)) return { error: 'symbol must contain exactly six digits' };
  return { symbol: normalized };
}

function errorBody(code: string, message: string): ApiErrorDto {
  return {
    error: { code, message },
    metadata: {
      asOf: new Date().toISOString(),
      source: 'alpha-twin-api',
      stale: false,
      fallback: false,
    },
  };
}

export async function buildApp(config: AppConfig, marketData: MarketDataService): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel }, requestTimeout: config.timeoutMs });
  marketData.setLogger(app.log);
  const requestWindows = new Map<string, { count: number; resetsAt: number }>();
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed'), false);
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    const now = Date.now();
    const current = requestWindows.get(request.ip);
    const window = !current || current.resetsAt <= now
      ? { count: 0, resetsAt: now + config.rateLimitWindowMs }
      : current;
    window.count += 1;
    requestWindows.set(request.ip, window);
    reply.header('X-RateLimit-Limit', config.rateLimitMax);
    reply.header('X-RateLimit-Remaining', Math.max(config.rateLimitMax - window.count, 0));
    if (window.count > config.rateLimitMax) {
      return reply.code(429).send(errorBody('RATE_LIMITED', 'Too many requests'));
    }
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'alpha-twin-api',
    asOf: new Date().toISOString(),
    marketData: marketData.status,
  }));

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send(errorBody('NOT_FOUND', 'Route was not found'));
  });

  app.get<{ Params: { symbol: string } }>('/api/v1/stocks/:symbol/quote', async (request, reply) => {
    const normalized = normalizeSymbol(request.params.symbol);
    if (!normalized.symbol) return reply.code(400).send(errorBody('INVALID_SYMBOL', normalized.error ?? 'Invalid symbol'));
    try {
      return await marketData.getQuote(normalized.symbol);
    } catch (error) {
      if (isMarketDataError(error, 'SYMBOL_NOT_FOUND')) {
        return reply.code(404).send(errorBody('SYMBOL_NOT_FOUND', 'Stock symbol was not found'));
      }
      return reply.code(503).send(errorBody('MARKET_DATA_UNAVAILABLE', 'Market data is temporarily unavailable'));
    }
  });

  app.get<{ Params: { symbol: string }; Querystring: { range?: string } }>('/api/v1/stocks/:symbol/candles', async (request, reply) => {
    const normalized = normalizeSymbol(request.params.symbol);
    const range = request.query.range ?? '1m';
    if (!normalized.symbol) return reply.code(400).send(errorBody('INVALID_SYMBOL', normalized.error ?? 'Invalid symbol'));
    if (!RANGES.has(range as CandleRange)) return reply.code(400).send(errorBody('INVALID_RANGE', 'range must be one of 1m, 3m, 6m, 1y'));
    try {
      return await marketData.getCandles(normalized.symbol, range as CandleRange);
    } catch (error) {
      if (isMarketDataError(error, 'SYMBOL_NOT_FOUND')) {
        return reply.code(404).send(errorBody('SYMBOL_NOT_FOUND', 'Stock symbol was not found'));
      }
      return reply.code(503).send(errorBody('MARKET_DATA_UNAVAILABLE', 'Market data is temporarily unavailable'));
    }
  });

  app.get<{ Params: { symbol: string }; Querystring: { range?: string } }>('/api/v1/stocks/:symbol/summary', async (request, reply) => {
    const normalized = normalizeSymbol(request.params.symbol);
    const range = request.query.range ?? '1m';
    if (!normalized.symbol) return reply.code(400).send(errorBody('INVALID_SYMBOL', normalized.error ?? 'Invalid symbol'));
    if (!RANGES.has(range as CandleRange)) return reply.code(400).send(errorBody('INVALID_RANGE', 'range must be one of 1m, 3m, 6m, 1y'));
    try {
      return await marketData.getSummary(normalized.symbol, range as CandleRange);
    } catch (error) {
      if (isMarketDataError(error, 'SYMBOL_NOT_FOUND')) {
        return reply.code(404).send(errorBody('SYMBOL_NOT_FOUND', 'Stock symbol was not found'));
      }
      return reply.code(503).send(errorBody('MARKET_DATA_UNAVAILABLE', 'Market data is temporarily unavailable'));
    }
  });

  return app;
}
