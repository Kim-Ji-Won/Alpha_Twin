import { StockCandle } from '@/src/types';
import {
  CanonicalFinancialMetric,
  CompanyProfileResponseDto,
  DisclosurePageDto,
  LatestNormalizedFinancialSummaryResponseDto,
  OpenDartResponseMetadata,
} from '@/src/types/companyTwin';
import {
  AiAnalysisPointDto,
  AiAnalystRequestDto,
  AiAnalystResponseDto,
  AiContextSource,
  AiDataReferenceDto,
} from '@/src/types/ai';

export interface StockQuoteDto {
  symbol: string;
  name: string;
  market: string;
  sector?: string;
  currency: string;
  price: number;
  change: number;
  changePercent: number;
  volume?: number;
  tradingValue?: number;
  asOf: string;
  source: string;
  stale: boolean;
  fallback: boolean;
  dataMode?: 'eod' | 'realtime' | 'mock';
  priceAdjustment?: 'raw' | 'adjusted' | 'unknown';
}

export interface StockSummaryDto {
  quote: StockQuoteDto;
  candles: StockCandle[];
  metadata: {
    asOf: string;
    source: string;
    stale: boolean;
    fallback: boolean;
    dataMode?: 'eod' | 'realtime' | 'mock';
    priceAdjustment?: 'raw' | 'adjusted' | 'unknown';
  };
}

export class AlphaTwinApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = 'AlphaTwinApiError';
  }
}

const API_BASE_URL = process.env.EXPO_PUBLIC_ALPHA_TWIN_API_BASE_URL?.replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 12_000;
const AI_REQUEST_TIMEOUT_MS = 50_000;
const FINANCIAL_KEYS: CanonicalFinancialMetric[] = [
  'totalAssets',
  'totalLiabilities',
  'totalEquity',
  'cashAndCashEquivalents',
  'revenue',
  'operatingIncome',
  'netIncome',
  'operatingCashFlow',
];

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value));
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function oneOf(value: unknown, options: readonly string[]): boolean {
  return typeof value === 'string' && options.includes(value);
}

function isAiPoint(value: unknown): value is AiAnalysisPointDto {
  const point = record(value);
  return !!point
    && typeof point.text === 'string'
    && point.text.trim().length > 0
    && point.text.length <= 400
    && Array.isArray(point.evidenceRefs)
    && point.evidenceRefs.length <= 5
    && point.evidenceRefs.every(ref => typeof ref === 'string' && ref.trim().length > 0);
}

function isAiReference(value: unknown): value is AiDataReferenceDto {
  const reference = record(value);
  if (
    !reference
    || typeof reference.id !== 'string'
    || typeof reference.label !== 'string'
    || !nullableString(reference.asOf)
  ) return false;
  if (reference.sourceType === 'market' || reference.sourceType === 'profile') return true;
  if (reference.sourceType === 'financial') {
    return oneOf(reference.metric, FINANCIAL_KEYS) && typeof reference.period === 'string';
  }
  return reference.sourceType === 'disclosure'
    && typeof reference.receiptNumber === 'string'
    && typeof reference.reportName === 'string'
    && typeof reference.receiptDate === 'string';
}

function isAiSourceArray(value: unknown): value is AiContextSource[] {
  return Array.isArray(value)
    && value.every(source => oneOf(source, ['market', 'profile', 'financial', 'disclosures']));
}

function isAiAnalystResponse(value: unknown): value is AiAnalystResponseDto {
  const response = record(value);
  const metadata = record(response?.metadata);
  const dataAsOf = record(metadata?.dataAsOf);
  if (
    !response
    || response.schemaVersion !== '1'
    || !oneOf(response.status, ['answered', 'partial', 'insufficient_context', 'boundary'])
    || typeof response.answer !== 'string'
    || response.answer.trim().length === 0
    || response.answer.length > 1_200
    || !Array.isArray(response.supportingFactors)
    || !response.supportingFactors.every(isAiPoint)
    || !Array.isArray(response.riskFactors)
    || !response.riskFactors.every(isAiPoint)
    || !Array.isArray(response.uncertainties)
    || !response.uncertainties.every(isAiPoint)
    || !nullableString(response.followUpQuestion)
    || !Array.isArray(response.dataReferences)
    || !response.dataReferences.every(isAiReference)
    || !metadata
    || typeof metadata.symbol !== 'string'
    || typeof metadata.generatedAt !== 'string'
    || !dataAsOf
    || !nullableString(dataAsOf.market)
    || !nullableString(dataAsOf.financialPeriod)
    || !nullableString(dataAsOf.latestDisclosureDate)
    || !isAiSourceArray(metadata.availableSources)
    || !isAiSourceArray(metadata.missingSources)
    || typeof metadata.stale !== 'boolean'
    || !isAiSourceArray(metadata.staleSources)
  ) return false;

  const referenceIds = new Set(response.dataReferences.map(reference => reference.id));
  const points = [
    ...response.supportingFactors,
    ...response.riskFactors,
    ...response.uncertainties,
  ];
  return points.every(point => point.evidenceRefs.every(ref => referenceIds.has(ref)));
}

function isOpenDartMetadata(value: unknown): value is OpenDartResponseMetadata {
  const data = record(value);
  return !!data
    && data.source === 'opendart-fss'
    && typeof data.retrievedAt === 'string'
    && typeof data.stale === 'boolean'
    && Array.isArray(data.staleReasons)
    && data.staleReasons.every(reason => oneOf(reason, [
      'corp-code-index',
      'company-profile-cache',
      'disclosures-cache',
      'financial-statements-cache',
      'latest-report-cache',
    ]))
    && data.fallback === false
    && (data.requestId == null || typeof data.requestId === 'string');
}

function isStockSummary(value: unknown): value is StockSummaryDto {
  const summary = record(value);
  const quote = record(summary?.quote);
  const metadata = record(summary?.metadata);
  return !!summary
    && !!quote
    && !!metadata
    && Array.isArray(summary.candles)
    && typeof quote.symbol === 'string'
    && typeof quote.name === 'string'
    && typeof quote.market === 'string'
    && typeof quote.currency === 'string'
    && typeof quote.price === 'number'
    && typeof quote.change === 'number'
    && typeof quote.changePercent === 'number'
    && typeof quote.asOf === 'string'
    && typeof quote.source === 'string'
    && typeof quote.stale === 'boolean'
    && typeof quote.fallback === 'boolean'
    && (quote.dataMode == null || oneOf(quote.dataMode, ['eod', 'realtime', 'mock']))
    && typeof metadata.asOf === 'string'
    && typeof metadata.source === 'string'
    && typeof metadata.stale === 'boolean'
    && typeof metadata.fallback === 'boolean'
    && (metadata.dataMode == null || oneOf(metadata.dataMode, ['eod', 'realtime', 'mock']));
}

function isCompanyProfile(value: unknown): value is CompanyProfileResponseDto {
  const response = record(value);
  const company = record(response?.company);
  return !!response
    && !!company
    && typeof company.symbol === 'string'
    && typeof company.corpCode === 'string'
    && typeof company.legalName === 'string'
    && nullableString(company.englishName)
    && typeof company.displayName === 'string'
    && nullableString(company.chiefExecutive)
    && oneOf(company.market, ['KOSPI', 'KOSDAQ', 'KONEX', 'OTHER', 'UNKNOWN'])
    && nullableString(company.industryCode)
    && nullableString(company.establishedDate)
    && nullableString(company.fiscalYearEndMonth)
    && nullableString(company.websiteUrl)
    && nullableString(company.irUrl)
    && typeof company.companyInfoModifiedDate === 'string'
    && isOpenDartMetadata(response.metadata);
}

function isDisclosurePage(value: unknown): value is DisclosurePageDto {
  const response = record(value);
  const pagination = record(response?.pagination);
  const query = record(response?.query);
  return !!response
    && Array.isArray(response.items)
    && response.items.every(item => {
      const disclosure = record(item);
      return !!disclosure
        && typeof disclosure.receiptNumber === 'string'
        && typeof disclosure.symbol === 'string'
        && typeof disclosure.corpCode === 'string'
        && typeof disclosure.companyName === 'string'
        && typeof disclosure.reportName === 'string'
        && nullableString(disclosure.filerName)
        && typeof disclosure.receiptDate === 'string'
        && oneOf(disclosure.market, ['KOSPI', 'KOSDAQ', 'KONEX', 'OTHER', 'UNKNOWN'])
        && oneOf(disclosure.correctionType, [
          'none',
          'content-correction',
          'attachment-correction',
          'attachment-added',
          'registration-changed',
          'extension-decided',
          'issuance-terms-finalized',
          'correction-order',
          'correction-request',
          'unknown',
        ])
        && typeof disclosure.hasSubsequentCorrection === 'boolean'
        && typeof disclosure.isWithdrawn === 'boolean'
        && typeof disclosure.includesConsolidated === 'boolean'
        && typeof disclosure.viewerUrl === 'string';
    })
    && !!pagination
    && typeof pagination.page === 'number'
    && typeof pagination.pageSize === 'number'
    && typeof pagination.totalCount === 'number'
    && typeof pagination.totalPages === 'number'
    && !!query
    && isOpenDartMetadata(response.metadata);
}

function isFinancialMetric(value: unknown): boolean {
  const metric = record(value);
  if (!metric || !oneOf(metric.metric, FINANCIAL_KEYS)) return false;
  if (metric.status === 'resolved') {
    return typeof metric.value === 'string'
      && nullableString(metric.currency)
      && oneOf(metric.basis, ['current-point-in-time', 'current-period', 'current-cumulative'])
      && oneOf(metric.matchedBy, [
        'standard-account-id',
        'approved-account-id-alias',
        'approved-account-name-alias',
      ])
      && record(metric.evidence) != null;
  }
  if (metric.status === 'unresolved') {
    return metric.value === null && typeof metric.reason === 'string';
  }
  return metric.status === 'conflict'
    && metric.value === null
    && typeof metric.reason === 'string'
    && Array.isArray(metric.candidates);
}

function isLatestFinancialSummary(
  value: unknown,
): value is LatestNormalizedFinancialSummaryResponseDto {
  const response = record(value);
  const resolution = record(response?.resolution);
  const filing = record(resolution?.filing);
  const summary = record(response?.summary);
  const report = record(summary?.report);
  const metrics = record(summary?.metrics);
  return !!response
    && !!resolution
    && typeof resolution.symbol === 'string'
    && typeof resolution.corpCode === 'string'
    && typeof resolution.businessYear === 'string'
    && oneOf(resolution.reportCode, ['11011', '11012', '11013', '11014'])
    && oneOf(resolution.periodKind, ['Q1', 'H1', 'Q3', 'FY'])
    && oneOf(resolution.disclosureDetailType, ['A001', 'A002', 'A003'])
    && typeof resolution.periodEnd === 'string'
    && typeof resolution.fiscalYearEndMonth === 'number'
    && !!filing
    && typeof filing.receiptNumber === 'string'
    && typeof filing.receiptDate === 'string'
    && typeof filing.reportName === 'string'
    && typeof filing.correctionType === 'string'
    && resolution.resolutionMethod === 'opendart-final-periodic-disclosure'
    && isOpenDartMetadata(resolution.metadata)
    && !!summary
    && typeof summary.symbol === 'string'
    && typeof summary.corpCode === 'string'
    && !!report
    && typeof report.businessYear === 'string'
    && oneOf(report.reportCode, ['11011', '11012', '11013', '11014'])
    && oneOf(report.periodKind, ['Q1', 'H1', 'Q3', 'FY'])
    && oneOf(report.requestedFsDiv, ['CFS', 'OFS'])
    && oneOf(report.resolvedFsDiv, ['CFS', 'OFS'])
    && nullableString(report.fallbackFromFsDiv)
    && typeof report.receiptNumber === 'string'
    && !!metrics
    && FINANCIAL_KEYS.every(key => {
      const metric = record(metrics[key]);
      return metric?.metric === key && isFinancialMetric(metrics[key]);
    })
    && Array.isArray(summary.warnings)
    && isOpenDartMetadata(summary.metadata)
    && summary.symbol === resolution.symbol
    && summary.corpCode === resolution.corpCode
    && report.businessYear === resolution.businessYear
    && report.reportCode === resolution.reportCode
    && report.periodKind === resolution.periodKind
    && report.receiptNumber === filing.receiptNumber;
}

function errorCode(value: unknown, status: number): string {
  const response = record(value);
  const error = record(response?.error);
  return typeof error?.code === 'string' ? error.code : `HTTP_${status}`;
}

async function requestJson<T>(
  path: string,
  validate: (value: unknown) => value is T,
  signal?: AbortSignal,
  options?: {
    method?: 'GET' | 'POST';
    body?: unknown;
    timeoutMs?: number;
    timeoutErrorCode?: string;
  },
): Promise<T> {
  if (!API_BASE_URL) {
    throw new AlphaTwinApiError('API_NOT_CONFIGURED', 0);
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abort();
  }, options?.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: options?.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(options?.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new AlphaTwinApiError(errorCode(body, response.status), response.status);
    if (!validate(body)) throw new AlphaTwinApiError('INVALID_API_RESPONSE', 502);
    return body;
  } catch (error) {
    if (error instanceof AlphaTwinApiError) throw error;
    if (controller.signal.aborted) {
      throw new AlphaTwinApiError(
        timedOut && !signal?.aborted
          ? options?.timeoutErrorCode ?? 'REQUEST_TIMEOUT'
          : 'REQUEST_ABORTED',
        0,
      );
    }
    throw new AlphaTwinApiError('NETWORK_UNAVAILABLE', 0);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function symbolPath(symbol: string): string {
  if (!/^\d{6}$/.test(symbol)) throw new AlphaTwinApiError('INVALID_SYMBOL', 400);
  return encodeURIComponent(symbol);
}

export const alphaTwinApi = {
  async askAiAnalyst(
    request: AiAnalystRequestDto,
    signal?: AbortSignal,
  ): Promise<AiAnalystResponseDto> {
    if (!/^\d{6}$/.test(request.symbol)) {
      throw new AlphaTwinApiError('INVALID_SYMBOL', 400);
    }
    const question = request.question.trim();
    if (question.length === 0 || question.length > 2_000) {
      throw new AlphaTwinApiError('INVALID_AI_REQUEST', 400);
    }
    const response = await requestJson(
      '/api/v1/ai/analyst',
      isAiAnalystResponse,
      signal,
      {
        method: 'POST',
        body: { ...request, question },
        timeoutMs: AI_REQUEST_TIMEOUT_MS,
        timeoutErrorCode: 'AI_TIMEOUT',
      },
    );
    if (response.metadata.symbol !== request.symbol) {
      throw new AlphaTwinApiError('INVALID_API_RESPONSE', 502);
    }
    return response;
  },

  async getStockSummary(symbol: string, signal?: AbortSignal): Promise<StockSummaryDto> {
    const response = await requestJson(
      `/api/v1/stocks/${symbolPath(symbol)}/summary?range=1m`,
      isStockSummary,
      signal,
    );
    if (
      response.quote.symbol !== symbol
      || response.candles.some(candle => candle.symbol !== symbol)
    ) {
      throw new AlphaTwinApiError('INVALID_API_RESPONSE', 502);
    }
    return response;
  },

  async getCompanyProfile(
    symbol: string,
    signal?: AbortSignal,
  ): Promise<CompanyProfileResponseDto> {
    const response = await requestJson(
      `/api/v1/companies/${symbolPath(symbol)}/profile`,
      isCompanyProfile,
      signal,
    );
    if (response.company.symbol !== symbol) {
      throw new AlphaTwinApiError('INVALID_API_RESPONSE', 502);
    }
    return response;
  },

  async getCompanyDisclosures(
    symbol: string,
    signal?: AbortSignal,
  ): Promise<DisclosurePageDto> {
    const response = await requestJson(
      `/api/v1/companies/${symbolPath(symbol)}/disclosures?page=1&pageSize=20`,
      isDisclosurePage,
      signal,
    );
    if (response.items.some(item => item.symbol !== symbol)) {
      throw new AlphaTwinApiError('INVALID_API_RESPONSE', 502);
    }
    return response;
  },

  async getLatestNormalizedFinancials(
    symbol: string,
    signal?: AbortSignal,
  ): Promise<LatestNormalizedFinancialSummaryResponseDto> {
    const response = await requestJson(
      `/api/v1/companies/${symbolPath(symbol)}/financials/normalized/latest`,
      isLatestFinancialSummary,
      signal,
    );
    if (response.resolution.symbol !== symbol || response.summary.symbol !== symbol) {
      throw new AlphaTwinApiError('INVALID_API_RESPONSE', 502);
    }
    return response;
  },
};
