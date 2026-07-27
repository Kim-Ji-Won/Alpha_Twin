import { FastifyInstance } from 'fastify';

import { AppConfig } from '../config.js';
import { ApiErrorDto } from '../contracts.js';
import { AiAnalystService } from './aiAnalystService.js';
import { parseAiAnalystRequest } from './contracts.js';
import { AiError, isAiError } from './errors.js';

function errorBody(code: string, message: string, requestId: string): ApiErrorDto {
  return {
    error: { code, message },
    metadata: {
      asOf: new Date().toISOString(),
      source: 'alpha-twin-api',
      stale: false,
      fallback: false,
      requestId,
    },
  };
}

export function registerAiRoutes(
  app: FastifyInstance,
  config: AppConfig,
  aiAnalyst?: AiAnalystService,
): void {
  const requestWindows = new Map<string, { count: number; resetsAt: number }>();

  app.post<{ Body: unknown }>(
    '/api/v1/ai/analyst',
    { bodyLimit: 32 * 1_024 },
    async (request, reply) => {
    const now = Date.now();
    const current = requestWindows.get(request.ip);
    const window = !current || current.resetsAt <= now
      ? { count: 0, resetsAt: now + config.aiRateLimitWindowMs }
      : current;
    window.count += 1;
    requestWindows.set(request.ip, window);
    reply.header('X-AI-RateLimit-Limit', config.aiRateLimitMax);
    reply.header('X-AI-RateLimit-Remaining', Math.max(config.aiRateLimitMax - window.count, 0));
    if (window.count > config.aiRateLimitMax) {
      return reply.code(429).send(
        errorBody('AI_RATE_LIMITED', 'Too many AI analysis requests', request.id),
      );
    }

    const parsed = parseAiAnalystRequest(request.body);
    if (!parsed) {
      return reply.code(400).send(
        errorBody('INVALID_AI_REQUEST', 'AI analysis request is invalid', request.id),
      );
    }
    if (!aiAnalyst) {
      const error = new AiError('AI_NOT_CONFIGURED');
      return reply.code(error.httpStatus).send(errorBody(error.code, error.safeMessage, request.id));
    }

    const controller = new AbortController();
    const onAborted = () => controller.abort(new Error('Client disconnected'));
    request.raw.once('aborted', onAborted);
    try {
      return await aiAnalyst.analyze(parsed, request.id, controller.signal);
    } catch (error) {
      const safe = isAiError(error) ? error : new AiError('AI_PROVIDER_UNAVAILABLE');
      return reply.code(safe.httpStatus).send(errorBody(safe.code, safe.safeMessage, request.id));
    } finally {
      request.raw.off('aborted', onAborted);
    }
    },
  );
}
