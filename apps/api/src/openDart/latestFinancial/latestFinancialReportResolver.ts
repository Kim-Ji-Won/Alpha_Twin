import { CacheStore, MemoryCacheStore } from '../../cache.js';
import {
  CompanyProfileResponseDto,
  CorpCodeResolution,
  DisclosureQueryDto,
  OpenDartResponseMetadata,
  OpenDartStaleReason,
} from '../contracts.js';
import { isOpenDartError, OpenDartError } from '../errors.js';
import { mapDisclosurePage } from '../mappers/disclosureMapper.js';
import { OpenDartObservability, OpenDartSafeLogger } from '../observability.js';
import { CompanyDisclosureProvider } from '../providers/openDartProvider.js';
import { getKstToday } from '../query.js';
import {
  LatestFinancialDisclosureDetailType,
  LatestFinancialReportCandidate,
  LatestFinancialReportResolutionDto,
} from './latestFinancialContracts.js';
import { mapLatestFinancialPeriod } from './latestFinancialParser.js';

export const LATEST_FINANCIAL_REPORT_CACHE_POLICY = {
  freshMs: 30 * 60_000,
  staleMs: 24 * 60 * 60_000,
} as const;

const DETAIL_TYPES: LatestFinancialDisclosureDetailType[] = ['A001', 'A002', 'A003'];
const DAY_MS = 24 * 60 * 60_000;

export interface LatestCorpCodeLookup {
  resolveByStockCode(symbol: string): Promise<CorpCodeResolution>;
}

export interface LatestCompanyProfileLookup {
  getCompanyProfile(symbol: string, requestId?: string): Promise<CompanyProfileResponseDto>;
}

type ResolutionCore = Omit<LatestFinancialReportResolutionDto, 'symbol' | 'metadata'>;

interface LatestCacheValue {
  resolution: ResolutionCore;
  retrievedAt: string;
  staleReasons: OpenDartStaleReason[];
}

interface LoadedLatest {
  value: LatestCacheValue;
  cacheStale: boolean;
}

function dateFromTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function searchQuery(
  detailType: LatestFinancialDisclosureDetailType,
  now: Date,
): DisclosureQueryDto {
  const to = getKstToday(now);
  const toValue = Date.parse(`${to}T00:00:00Z`);
  return {
    from: dateFromTimestamp(toValue - 365 * DAY_MS),
    to,
    finalOnly: true,
    category: 'A',
    detailCategory: detailType,
    page: 1,
    pageSize: 100,
  };
}

function metadata(
  retrievedAt: string,
  reasons: OpenDartStaleReason[],
  requestId?: string,
): OpenDartResponseMetadata {
  const order: OpenDartStaleReason[] = [
    'corp-code-index',
    'company-profile-cache',
    'latest-report-cache',
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

function latestError(
  code:
    | 'LATEST_FINANCIAL_REPORT_NOT_FOUND'
    | 'LATEST_FINANCIAL_REPORT_UNRESOLVED'
    | 'LATEST_FINANCIAL_REPORT_RESPONSE_INCONSISTENT',
): OpenDartError {
  return new OpenDartError(code, 'latest-financial-report', false);
}

function parseFiscalYearEndMonth(profile: CompanyProfileResponseDto): number {
  const value = Number(profile.company.fiscalYearEndMonth);
  if (!Number.isInteger(value) || value < 1 || value > 12) {
    throw latestError('LATEST_FINANCIAL_REPORT_UNRESOLVED');
  }
  return value;
}

function candidateKey(candidate: LatestFinancialReportCandidate): string {
  return [
    candidate.detailType,
    candidate.receiptNumber,
    candidate.receiptDate,
    candidate.reportName,
    candidate.correctionType,
    candidate.hasSubsequentCorrection,
    candidate.isWithdrawn,
    candidate.corpCode,
  ].join('\u0000');
}

export class LatestFinancialReportResolver {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly corpCodes: LatestCorpCodeLookup,
    private readonly profiles: LatestCompanyProfileLookup,
    private readonly provider: CompanyDisclosureProvider,
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

  async resolve(
    inputSymbol: string,
    requestId?: string,
  ): Promise<LatestFinancialReportResolutionDto> {
    const symbol = inputSymbol.trim();
    if (!/^\d{6}$/.test(symbol)) {
      throw new OpenDartError('INVALID_SYMBOL', 'latest-financial-report', false);
    }
    const corp = await this.corpCodes.resolveByStockCode(symbol);
    if (!corp.record) {
      throw new OpenDartError('CORP_CODE_NOT_FOUND', 'latest-financial-report', false);
    }
    const key = `opendart:latest-financial-report:${corp.record.corpCode}`;
    const currentReasons: OpenDartStaleReason[] =
      corp.indexStale ? ['corp-code-index'] : [];
    const cached = await this.cache.get<LatestCacheValue>(key);
    if (cached && this.cache.isFresh(cached)) {
      this.record(
        symbol,
        'fresh',
        cached.value.resolution,
        [...currentReasons, ...cached.value.staleReasons],
        requestId,
      );
      return this.response(symbol, cached.value, currentReasons, false, requestId);
    }

    const loaded = await this.singleFlight(key, async (): Promise<LoadedLatest> => {
      const current = await this.cache.get<LatestCacheValue>(key);
      if (current && this.cache.isFresh(current)) {
        return { value: current.value, cacheStale: false };
      }
      try {
        const profile = await this.profiles.getCompanyProfile(symbol, requestId);
        if (profile.company.corpCode !== corp.record!.corpCode) {
          throw latestError('LATEST_FINANCIAL_REPORT_RESPONSE_INCONSISTENT');
        }
        const fiscalYearEndMonth = parseFiscalYearEndMonth(profile);
        const candidates = (
          await Promise.all(DETAIL_TYPES.map(detailType =>
            this.loadCandidates(symbol, corp.record!.corpCode, detailType)))
        ).flat();
        const resolution = this.select(
          corp.record!.corpCode,
          candidates,
          fiscalYearEndMonth,
        );
        const staleReasons = profile.metadata.staleReasons.filter(reason =>
          reason === 'corp-code-index' || reason === 'company-profile-cache');
        const value: LatestCacheValue = {
          resolution,
          retrievedAt: this.now().toISOString(),
          staleReasons,
        };
        await this.cache.set(
          key,
          value,
          LATEST_FINANCIAL_REPORT_CACHE_POLICY.freshMs,
          LATEST_FINANCIAL_REPORT_CACHE_POLICY.staleMs,
        );
        this.record(symbol, 'miss', resolution, staleReasons, requestId);
        return { value, cacheStale: false };
      } catch (error) {
        const stale = canUseStale(error)
          ? await this.cache.get<LatestCacheValue>(key)
          : undefined;
        if (stale) {
          this.record(
            symbol,
            'stale',
            stale.value.resolution,
            [...stale.value.staleReasons, 'latest-report-cache'],
            requestId,
          );
          return { value: stale.value, cacheStale: true };
        }
        this.recordFailure(symbol, requestId, error);
        throw error;
      }
    });
    return this.response(symbol, loaded.value, currentReasons, loaded.cacheStale, requestId);
  }

  private async loadCandidates(
    symbol: string,
    corpCode: string,
    detailType: LatestFinancialDisclosureDetailType,
  ): Promise<LatestFinancialReportCandidate[]> {
    const query = searchQuery(detailType, this.now());
    let page;
    try {
      page = mapDisclosurePage(
        symbol,
        corpCode,
        query,
        await this.provider.getDisclosures(corpCode, query),
      );
    } catch (error) {
      if (isOpenDartError(error) && error.code === 'OPENDART_BAD_RESPONSE') {
        throw latestError('LATEST_FINANCIAL_REPORT_RESPONSE_INCONSISTENT');
      }
      throw error;
    }
    if (page.pagination.totalCount > 100 || page.pagination.totalPages > 1) {
      throw latestError('LATEST_FINANCIAL_REPORT_RESPONSE_INCONSISTENT');
    }
    return page.items.map(item => ({
      detailType,
      receiptNumber: item.receiptNumber,
      receiptDate: item.receiptDate,
      reportName: item.reportName,
      correctionType: item.correctionType,
      hasSubsequentCorrection: item.hasSubsequentCorrection,
      isWithdrawn: item.isWithdrawn,
      corpCode: item.corpCode,
    }));
  }

  private select(
    corpCode: string,
    candidates: LatestFinancialReportCandidate[],
    fiscalYearEndMonth: number,
  ): ResolutionCore {
    const unique = new Map<string, LatestFinancialReportCandidate>();
    for (const candidate of candidates) {
      const existing = unique.get(candidate.receiptNumber);
      if (existing && candidateKey(existing) !== candidateKey(candidate)) {
        throw latestError('LATEST_FINANCIAL_REPORT_RESPONSE_INCONSISTENT');
      }
      if (!existing) unique.set(candidate.receiptNumber, candidate);
    }
    const valid = [...unique.values()]
      .filter(candidate => !candidate.isWithdrawn)
      .sort((left, right) =>
        right.receiptDate.localeCompare(left.receiptDate)
        || right.receiptNumber.localeCompare(left.receiptNumber));
    const selected = valid[0];
    if (!selected) throw latestError('LATEST_FINANCIAL_REPORT_NOT_FOUND');
    if (selected.hasSubsequentCorrection) {
      throw latestError('LATEST_FINANCIAL_REPORT_UNRESOLVED');
    }
    const mapped = mapLatestFinancialPeriod(
      selected.detailType,
      selected.reportName,
      fiscalYearEndMonth,
    );
    return {
      corpCode,
      businessYear: mapped.businessYear,
      reportCode: mapped.reportCode,
      periodKind: mapped.periodKind,
      disclosureDetailType: selected.detailType,
      periodEnd: mapped.periodEnd,
      fiscalYearEndMonth,
      filing: {
        receiptNumber: selected.receiptNumber,
        receiptDate: selected.receiptDate,
        reportName: selected.reportName,
        correctionType: selected.correctionType,
      },
      resolutionMethod: 'opendart-final-periodic-disclosure',
    };
  }

  private response(
    symbol: string,
    value: LatestCacheValue,
    currentReasons: OpenDartStaleReason[],
    cacheStale: boolean,
    requestId?: string,
  ): LatestFinancialReportResolutionDto {
    const reasons = [
      ...currentReasons,
      ...value.staleReasons,
      ...(cacheStale ? ['latest-report-cache' as const] : []),
    ];
    return {
      symbol,
      ...value.resolution,
      metadata: metadata(value.retrievedAt, reasons, requestId),
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
    resolution: ResolutionCore,
    staleReasons: OpenDartStaleReason[],
    requestId?: string,
  ): void {
    this.observability.record({
      operation: 'latest-financial-report',
      provider: 'opendart',
      symbol,
      cacheStatus,
      stale: staleReasons.length > 0,
      staleReasons,
      businessYear: resolution.businessYear,
      reportCode: resolution.reportCode,
      periodKind: resolution.periodKind,
      detailType: resolution.disclosureDetailType,
      receiptDate: resolution.filing.receiptDate,
      itemCount: 1,
      requestId,
      outcome: 'success',
    });
  }

  private recordFailure(symbol: string, requestId: string | undefined, error: unknown): void {
    this.observability.record({
      operation: 'latest-financial-report',
      provider: 'opendart',
      symbol,
      requestId,
      outcome: 'failure',
      retryable: isOpenDartError(error) ? error.retryable : true,
      providerStatus: isOpenDartError(error) ? error.providerStatus : undefined,
    });
  }
}
