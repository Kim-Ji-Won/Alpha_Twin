import { CacheStore, MemoryCacheStore } from '../cache.js';
import {
  FinancialStatementsQuery,
  FinancialStatementsResponseDto,
  OpenDartResponseMetadata,
  OpenDartStaleReason,
} from './contracts.js';
import { CorpCodeResolver } from './corpCode/corpCodeResolver.js';
import { isOpenDartError, OpenDartError } from './errors.js';
import { mapFinancialStatements } from './mappers/financialStatementMapper.js';
import { OpenDartObservability, OpenDartSafeLogger } from './observability.js';
import { FinancialStatementProvider } from './providers/financialStatementProvider.js';

export const OPENDART_FINANCIAL_CACHE_POLICY = {
  freshMs: 12 * 60 * 60_000,
  staleMs: 7 * 24 * 60 * 60_000,
} as const;

interface FinancialCacheValue {
  response: Omit<FinancialStatementsResponseDto, 'metadata'>;
  retrievedAt: string;
}

interface LoadedFinancial {
  value: FinancialCacheValue;
  cacheStale: boolean;
}

function normalizeSymbol(input: string): string {
  const symbol = input.trim();
  if (!/^\d{6}$/.test(symbol)) {
    throw new OpenDartError('INVALID_SYMBOL', 'financial-statements', false);
  }
  return symbol;
}

function responseMetadata(
  retrievedAt: string,
  reasons: OpenDartStaleReason[],
  requestId?: string,
): OpenDartResponseMetadata {
  const order: OpenDartStaleReason[] = [
    'corp-code-index',
    'financial-statements-cache',
  ];
  const staleReasons = order.filter(reason => reasons.includes(reason));
  return {
    source: 'opendart-fss',
    retrievedAt,
    stale: staleReasons.length > 0,
    staleReasons,
    fallback: false,
    ...(requestId ? { requestId } : {}),
  };
}

function canUseStale(error: unknown): boolean {
  return isOpenDartError(error)
    && ['OPENDART_RATE_LIMITED', 'OPENDART_UNAVAILABLE', 'OPENDART_TIMEOUT'].includes(error.code);
}

export class OpenDartFinancialService {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly resolver: CorpCodeResolver,
    private readonly provider: FinancialStatementProvider,
    private readonly cache: CacheStore = new MemoryCacheStore(),
    private readonly now: () => Date = () => new Date(),
    private readonly observability = new OpenDartObservability(),
  ) {}

  get status() {
    return {
      provider: 'opendart-fss',
      cache: this.cache.kind,
      cacheEntries: this.cache.size,
      events: this.observability.snapshot(),
    };
  }

  setLogger(logger: OpenDartSafeLogger): void {
    this.observability.setLogger(logger);
  }

  async getFinancialStatements(
    inputSymbol: string,
    query: FinancialStatementsQuery,
    requestId?: string,
  ): Promise<FinancialStatementsResponseDto> {
    const symbol = normalizeSymbol(inputSymbol);
    const resolution = await this.resolver.resolveByStockCode(symbol);
    if (!resolution.record) {
      throw new OpenDartError('CORP_CODE_NOT_FOUND', 'financial-statements', false);
    }
    const record = resolution.record;
    const key = [
      'opendart',
      'opendart-fss',
      'financial-statements',
      record.corpCode,
      query.businessYear,
      query.reportCode,
      query.fsDiv,
    ].join(':');
    const reasons: OpenDartStaleReason[] = resolution.indexStale ? ['corp-code-index'] : [];
    const cached = await this.cache.get<FinancialCacheValue>(key);
    if (cached && this.cache.isFresh(cached)) {
      this.record(symbol, 'fresh', reasons, cached.value.response.lines.length, requestId, 'success');
      return {
        ...cached.value.response,
        metadata: responseMetadata(cached.value.retrievedAt, reasons, requestId),
      };
    }

    const loaded = await this.singleFlight(key, async (): Promise<LoadedFinancial> => {
      const current = await this.cache.get<FinancialCacheValue>(key);
      if (current && this.cache.isFresh(current)) {
        return { value: current.value, cacheStale: false };
      }
      try {
        const raw = await this.provider.getFinancialStatements({
          corpCode: record.corpCode,
          ...query,
        });
        let resolvedFsDiv = query.fsDiv;
        let resolvedRaw = raw;
        if (raw.status === '013') {
          if (query.fsDiv === 'OFS') {
            throw new OpenDartError(
              'FINANCIAL_REPORT_NOT_FOUND',
              'financial-statements',
              false,
              '013',
            );
          }
          resolvedFsDiv = 'OFS';
          resolvedRaw = await this.provider.getFinancialStatements({
            corpCode: record.corpCode,
            businessYear: query.businessYear,
            reportCode: query.reportCode,
            fsDiv: 'OFS',
          });
          if (resolvedRaw.status === '013') {
            throw new OpenDartError(
              'FINANCIAL_REPORT_NOT_FOUND',
              'financial-statements',
              false,
              '013',
            );
          }
        }
        const mapped = mapFinancialStatements({
          symbol,
          corpCode: record.corpCode,
          businessYear: query.businessYear,
          reportCode: query.reportCode,
          resolvedFsDiv,
          raw: resolvedRaw,
        });
        const value: FinancialCacheValue = {
          response: {
            symbol,
            corpCode: record.corpCode,
            report: {
              businessYear: query.businessYear,
              reportCode: query.reportCode,
              periodKind: mapped.periodKind,
              requestedFsDiv: query.fsDiv,
              resolvedFsDiv,
              fallbackFromFsDiv: resolvedFsDiv === query.fsDiv ? null : query.fsDiv,
              receiptNumber: mapped.receiptNumber,
            },
            lines: mapped.lines,
            currencies: mapped.currencies,
            warnings: mapped.warnings,
          },
          retrievedAt: this.now().toISOString(),
        };
        await this.cache.set(
          key,
          value,
          OPENDART_FINANCIAL_CACHE_POLICY.freshMs,
          OPENDART_FINANCIAL_CACHE_POLICY.staleMs,
        );
        this.record(symbol, 'miss', reasons, mapped.lines.length, requestId, 'success');
        return { value, cacheStale: false };
      } catch (error) {
        const stale = canUseStale(error)
          ? await this.cache.get<FinancialCacheValue>(key)
          : undefined;
        if (stale) {
          const staleReasons: OpenDartStaleReason[] = [...reasons, 'financial-statements-cache'];
          this.record(
            symbol,
            'stale',
            staleReasons,
            stale.value.response.lines.length,
            requestId,
            'success',
          );
          return { value: stale.value, cacheStale: true };
        }
        this.recordFailure(symbol, requestId, error);
        throw error;
      }
    });

    const responseReasons: OpenDartStaleReason[] = loaded.cacheStale
      ? [...reasons, 'financial-statements-cache']
      : reasons;
    return {
      ...loaded.value.response,
      metadata: responseMetadata(loaded.value.retrievedAt, responseReasons, requestId),
    };
  }

  private singleFlight<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const request = load().finally(() => {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    });
    this.inFlight.set(key, request);
    return request;
  }

  private record(
    symbol: string,
    cacheStatus: 'fresh' | 'stale' | 'miss',
    staleReasons: OpenDartStaleReason[],
    rowCount: number,
    requestId: string | undefined,
    outcome: 'success' | 'empty',
  ): void {
    this.observability.record({
      operation: 'financial-statements',
      provider: 'opendart',
      symbol,
      corpCodeResolved: true,
      cacheStatus,
      stale: staleReasons.length > 0,
      staleReasons,
      itemCount: rowCount,
      requestId,
      outcome,
    });
  }

  private recordFailure(symbol: string, requestId: string | undefined, error: unknown): void {
    this.observability.record({
      operation: 'financial-statements',
      provider: 'opendart',
      symbol,
      corpCodeResolved: true,
      requestId,
      outcome: 'failure',
      retryable: isOpenDartError(error) ? error.retryable : true,
      providerStatus: isOpenDartError(error) ? error.providerStatus : undefined,
    });
  }
}
