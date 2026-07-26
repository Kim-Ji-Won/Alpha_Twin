import cors from '@fastify/cors';
import Fastify, { FastifyInstance } from 'fastify';

import { AppConfig } from './config.js';
import { ApiErrorDto, CandleRange } from './contracts.js';
import { isMarketDataError } from './marketDataErrors.js';
import { MarketDataService } from './marketDataService.js';
import { isOpenDartError, OpenDartError } from './openDart/errors.js';
import { parseFinancialStatementsQuery } from './openDart/financialQuery.js';
import { FinancialAccountNormalizer } from './openDart/normalization/accountNormalizer.js';
import { OpenDartFinancialService } from './openDart/openDartFinancialService.js';
import { OpenDartService } from './openDart/openDartService.js';
import { parseDisclosureQuery } from './openDart/query.js';

const SYMBOL_PATTERN = /^\d{6}$/;
const RANGES = new Set<CandleRange>(['1m', '3m', '6m', '1y']);

function normalizeSymbol(symbol: string): { symbol?: string; error?: string } {
  const normalized = symbol.trim();
  if (!SYMBOL_PATTERN.test(normalized)) return { error: 'symbol must contain exactly six digits' };
  return { symbol: normalized };
}

function errorBody(code: string, message: string, requestId?: string): ApiErrorDto {
  return {
    error: { code, message },
    metadata: {
      asOf: new Date().toISOString(),
      source: 'alpha-twin-api',
      stale: false,
      fallback: false,
      ...(requestId ? { requestId } : {}),
    },
  };
}

export interface AppDependencies {
  openDart?: OpenDartService;
  openDartFinancial?: OpenDartFinancialService;
  openDartFinancialNormalizer?: FinancialAccountNormalizer;
}

export async function buildApp(
  config: AppConfig,
  marketData: MarketDataService,
  dependencies: AppDependencies = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      serializers: {
        req(request) {
          return { method: request.method };
        },
      },
    },
    requestTimeout: config.timeoutMs,
  });
  marketData.setLogger(app.log);
  dependencies.openDart?.setLogger(app.log);
  dependencies.openDartFinancial?.setLogger(app.log);
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
    ...(dependencies.openDart ? { openDart: dependencies.openDart.status } : {}),
    ...(dependencies.openDartFinancial
      ? { openDartFinancial: dependencies.openDartFinancial.status }
      : {}),
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

  const openDartErrorResponse = (
    error: unknown,
    requestId: string,
    operation: 'company-profile' | 'disclosures' | 'financial-statements',
  ) => {
    const safe = isOpenDartError(error)
      ? error
      : new OpenDartError('OPENDART_UNAVAILABLE', operation, true);
    return {
      status: safe.httpStatus,
      body: errorBody(safe.code, safe.safeMessage, requestId),
    };
  };

  app.get<{ Params: { symbol: string } }>('/api/v1/companies/:symbol/profile', async (request, reply) => {
    const normalized = normalizeSymbol(request.params.symbol);
    if (!normalized.symbol) {
      return reply.code(400).send(errorBody('INVALID_SYMBOL', normalized.error ?? 'Invalid symbol', request.id));
    }
    try {
      if (!dependencies.openDart) throw new OpenDartError('OPENDART_NOT_CONFIGURED', 'company-profile', false);
      return await dependencies.openDart.getCompanyProfile(normalized.symbol, request.id);
    } catch (error) {
      const response = openDartErrorResponse(error, request.id, 'company-profile');
      return reply.code(response.status).send(response.body);
    }
  });

  app.get<{
    Params: { symbol: string };
    Querystring: {
      from?: string; to?: string; finalOnly?: string; category?: string;
      detailCategory?: string; page?: string; pageSize?: string;
    };
  }>('/api/v1/companies/:symbol/disclosures', async (request, reply) => {
    const normalized = normalizeSymbol(request.params.symbol);
    if (!normalized.symbol) {
      return reply.code(400).send(errorBody('INVALID_SYMBOL', normalized.error ?? 'Invalid symbol', request.id));
    }
    try {
      const query = parseDisclosureQuery(request.query);
      if (!dependencies.openDart) throw new OpenDartError('OPENDART_NOT_CONFIGURED', 'disclosures', false);
      return await dependencies.openDart.getDisclosures(normalized.symbol, query, request.id);
    } catch (error) {
      const response = openDartErrorResponse(error, request.id, 'disclosures');
      return reply.code(response.status).send(response.body);
    }
  });

  app.get<{
    Params: { symbol: string };
    Querystring: {
      businessYear?: string;
      reportCode?: string;
      fsDiv?: string;
    };
  }>('/api/v1/companies/:symbol/financials', async (request, reply) => {
    const normalized = normalizeSymbol(request.params.symbol);
    if (!normalized.symbol) {
      return reply.code(400).send(
        errorBody('INVALID_SYMBOL', normalized.error ?? 'Invalid symbol', request.id),
      );
    }
    try {
      const query = parseFinancialStatementsQuery(request.query);
      if (!dependencies.openDartFinancial) {
        throw new OpenDartError('OPENDART_NOT_CONFIGURED', 'financial-statements', false);
      }
      return await dependencies.openDartFinancial.getFinancialStatements(
        normalized.symbol,
        query,
        request.id,
      );
    } catch (error) {
      const response = openDartErrorResponse(error, request.id, 'financial-statements');
      return reply.code(response.status).send(response.body);
    }
  });

  app.get<{
    Params: { symbol: string };
    Querystring: {
      businessYear?: string;
      reportCode?: string;
      fsDiv?: string;
    };
  }>('/api/v1/companies/:symbol/financials/normalized', async (request, reply) => {
    const normalized = normalizeSymbol(request.params.symbol);
    if (!normalized.symbol) {
      return reply.code(400).send(
        errorBody('INVALID_SYMBOL', normalized.error ?? 'Invalid symbol', request.id),
      );
    }
    try {
      const query = parseFinancialStatementsQuery(request.query);
      if (!dependencies.openDartFinancial || !dependencies.openDartFinancialNormalizer) {
        throw new OpenDartError('OPENDART_NOT_CONFIGURED', 'financial-statements', false);
      }
      const financial = await dependencies.openDartFinancial.getFinancialStatements(
        normalized.symbol,
        query,
        request.id,
      );
      return dependencies.openDartFinancialNormalizer.normalize(financial);
    } catch (error) {
      const response = openDartErrorResponse(error, request.id, 'financial-statements');
      return reply.code(response.status).send(response.body);
    }
  });

  return app;
}
