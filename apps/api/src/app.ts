import cors from '@fastify/cors';
import Fastify, { FastifyInstance } from 'fastify';

import { AppConfig } from './config.js';
import { ApiErrorDto, CandleRange } from './contracts.js';
import { MarketDataService } from './marketDataService.js';

const SYMBOL_PATTERN = /^\d{6}$/;
const RANGES = new Set<CandleRange>(['1m', '3m', '6m', '1y']);

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
  const app = Fastify({ logger: false, requestTimeout: config.timeoutMs });
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
  }));

  app.get<{ Params: { symbol: string } }>('/api/v1/stocks/:symbol/quote', async (request, reply) => {
    const { symbol } = request.params;
    if (!SYMBOL_PATTERN.test(symbol)) return reply.code(400).send(errorBody('INVALID_SYMBOL', 'symbol must be six digits'));
    try {
      return await marketData.getQuote(symbol);
    } catch {
      return reply.code(503).send(errorBody('MARKET_DATA_UNAVAILABLE', 'Market data is temporarily unavailable'));
    }
  });

  app.get<{ Params: { symbol: string }; Querystring: { range?: string } }>('/api/v1/stocks/:symbol/candles', async (request, reply) => {
    const { symbol } = request.params;
    const range = request.query.range ?? '1m';
    if (!SYMBOL_PATTERN.test(symbol)) return reply.code(400).send(errorBody('INVALID_SYMBOL', 'symbol must be six digits'));
    if (!RANGES.has(range as CandleRange)) return reply.code(400).send(errorBody('INVALID_RANGE', 'range must be one of 1m, 3m, 6m, 1y'));
    try {
      return await marketData.getCandles(symbol, range as CandleRange);
    } catch {
      return reply.code(503).send(errorBody('MARKET_DATA_UNAVAILABLE', 'Market data is temporarily unavailable'));
    }
  });

  app.get<{ Params: { symbol: string }; Querystring: { range?: string } }>('/api/v1/stocks/:symbol/summary', async (request, reply) => {
    const { symbol } = request.params;
    const range = request.query.range ?? '1m';
    if (!SYMBOL_PATTERN.test(symbol)) return reply.code(400).send(errorBody('INVALID_SYMBOL', 'symbol must be six digits'));
    if (!RANGES.has(range as CandleRange)) return reply.code(400).send(errorBody('INVALID_RANGE', 'range must be one of 1m, 3m, 6m, 1y'));
    try {
      return await marketData.getSummary(symbol, range as CandleRange);
    } catch {
      return reply.code(503).send(errorBody('MARKET_DATA_UNAVAILABLE', 'Market data is temporarily unavailable'));
    }
  });

  return app;
}
