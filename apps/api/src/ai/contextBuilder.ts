import { StockQuoteDto } from '../contracts.js';
import { isMarketDataError } from '../marketDataErrors.js';
import { MarketDataService } from '../marketDataService.js';
import {
  CompanyProfileResponseDto,
  DisclosurePageDto,
  DisclosureQueryDto,
} from '../openDart/contracts.js';
import { isOpenDartError } from '../openDart/errors.js';
import { LatestNormalizedFinancialSummaryResponseDto } from '../openDart/latestFinancial/latestFinancialContracts.js';
import { LatestFinancialService } from '../openDart/latestFinancial/latestFinancialService.js';
import { CANONICAL_FINANCIAL_METRICS } from '../openDart/normalization/canonicalFinancialMetrics.js';
import { OpenDartService } from '../openDart/openDartService.js';
import { getKstToday } from '../openDart/query.js';
import {
  AI_CONTEXT_SCHEMA_VERSION,
  AI_LIMITS,
  AiContextSource,
  AiDataReferenceDto,
  AiDisclosureContext,
  AiFinancialContext,
  AiFinancialMetricContext,
  AiMarketContext,
  AiProfileContext,
  CompanyAnalysisContextPack,
  CompanyAnalysisContextResult,
} from './contracts.js';
import { AiError } from './errors.js';

const SOURCE_ORDER: AiContextSource[] = ['market', 'profile', 'financial', 'disclosures'];
const DAY_MS = 24 * 60 * 60_000;

export interface AiMarketDataLookup {
  getQuote(symbol: string): Promise<StockQuoteDto>;
}

export interface AiCompanyDataLookup {
  getCompanyProfile(symbol: string, requestId?: string): Promise<CompanyProfileResponseDto>;
  getDisclosures(
    symbol: string,
    query: DisclosureQueryDto,
    requestId?: string,
  ): Promise<DisclosurePageDto>;
}

export interface AiLatestFinancialLookup {
  getLatestNormalizedFinancials(
    symbol: string,
    fsDiv: 'CFS' | 'OFS',
    requestId?: string,
  ): Promise<LatestNormalizedFinancialSummaryResponseDto>;
}

interface SourceResult<T> {
  value: T | null;
  available: boolean;
  stale: boolean;
}

function isoDateBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

function disclosureQuery(now: Date): DisclosureQueryDto {
  const to = getKstToday(now);
  return {
    from: isoDateBefore(to, 89),
    to,
    finalOnly: true,
    category: null,
    detailCategory: null,
    page: 1,
    pageSize: 5,
  };
}

function assertSymbol(actual: unknown, expected: string): void {
  if (actual !== expected) throw new AiError('AI_CONTEXT_INCONSISTENT');
}

function semanticSourceFailure(error: unknown): boolean {
  if (isMarketDataError(error)) return error.code === 'INVALID_RESPONSE';
  if (!isOpenDartError(error)) return false;
  return [
    'CORP_CODE_CONFLICT',
    'OPENDART_BAD_REQUEST_MAPPING',
    'OPENDART_BAD_RESPONSE',
    'FINANCIAL_RESPONSE_INCONSISTENT',
    'FINANCIAL_ACCOUNT_VALUE_INVALID',
    'LATEST_FINANCIAL_REPORT_UNRESOLVED',
    'LATEST_FINANCIAL_REPORT_RESPONSE_INCONSISTENT',
    'LATEST_FINANCIAL_REPORT_RECEIPT_MISMATCH',
  ].includes(error.code);
}

function sourceResult<T>(
  result: PromiseSettledResult<T>,
  map: (value: T) => { value: T | null; available: boolean; stale: boolean },
): SourceResult<T> {
  if (result.status === 'fulfilled') return map(result.value);
  if (semanticSourceFailure(result.reason)) {
    throw new AiError('AI_CONTEXT_BUILD_FAILED', undefined, undefined, undefined, {
      cause: result.reason,
    });
  }
  return { value: null, available: false, stale: false };
}

function compactMarket(quote: StockQuoteDto, symbol: string): AiMarketContext {
  assertSymbol(quote.symbol, symbol);
  if (
    !quote.name.trim()
    || !quote.market.trim()
    || !quote.currency.trim()
    || !quote.source.trim()
    || !quote.asOf.trim()
    || ![quote.price, quote.change, quote.changePercent].every(Number.isFinite)
  ) throw new AiError('AI_CONTEXT_BUILD_FAILED');
  return {
    symbol,
    name: quote.name,
    market: quote.market,
    currency: quote.currency,
    price: quote.price,
    change: quote.change,
    changePercent: quote.changePercent,
    asOf: quote.asOf,
    source: quote.source,
    dataMode: quote.dataMode ?? null,
    stale: quote.stale,
    priceAdjustment: quote.priceAdjustment ?? null,
  };
}

function compactProfile(response: CompanyProfileResponseDto, symbol: string): AiProfileContext {
  assertSymbol(response.company.symbol, symbol);
  if (!response.company.displayName.trim() || !response.company.legalName.trim()) {
    throw new AiError('AI_CONTEXT_BUILD_FAILED');
  }
  return {
    symbol,
    displayName: response.company.displayName,
    legalName: response.company.legalName,
    market: response.company.market,
    industryCode: response.company.industryCode,
    fiscalYearEndMonth: response.company.fiscalYearEndMonth,
    establishedDate: response.company.establishedDate,
  };
}

function compactFinancial(
  response: LatestNormalizedFinancialSummaryResponseDto,
  symbol: string,
): AiFinancialContext {
  assertSymbol(response.resolution.symbol, symbol);
  assertSymbol(response.summary.symbol, symbol);
  if (
    response.resolution.filing.receiptNumber !== response.summary.report.receiptNumber
    || response.resolution.businessYear !== response.summary.report.businessYear
    || response.resolution.periodKind !== response.summary.report.periodKind
  ) throw new AiError('AI_CONTEXT_INCONSISTENT');

  const metrics: AiFinancialMetricContext[] = CANONICAL_FINANCIAL_METRICS.map(metricName => {
    const metric = response.summary.metrics[metricName];
    if (metric.metric !== metricName) throw new AiError('AI_CONTEXT_INCONSISTENT');
    if (metric.status === 'resolved') {
      if (typeof metric.value !== 'string' || !metric.value.trim()) {
        throw new AiError('AI_CONTEXT_BUILD_FAILED');
      }
      if (metric.evidence.receiptNumber !== response.summary.report.receiptNumber) {
        throw new AiError('AI_CONTEXT_INCONSISTENT');
      }
      return {
        metric: metricName,
        status: 'resolved',
        value: metric.value,
        currency: metric.currency,
        basis: metric.basis,
        statementType: metric.evidence.statementType,
        receiptNumber: metric.evidence.receiptNumber,
      };
    }
    return {
      metric: metricName,
      status: metric.status,
      value: null,
      reason: metric.reason,
    };
  });

  return {
    symbol,
    businessYear: response.summary.report.businessYear,
    periodKind: response.summary.report.periodKind,
    requestedFsDiv: response.summary.report.requestedFsDiv,
    resolvedFsDiv: response.summary.report.resolvedFsDiv,
    receiptNumber: response.summary.report.receiptNumber,
    receiptDate: response.resolution.filing.receiptDate,
    source: response.summary.metadata.source,
    stale: response.summary.metadata.stale || response.resolution.metadata.stale,
    metrics,
  };
}

function compactDisclosures(response: DisclosurePageDto, symbol: string): AiDisclosureContext[] {
  return response.items.slice(0, 5).map(item => {
    assertSymbol(item.symbol, symbol);
    if (!item.receiptNumber.trim() || !item.reportName.trim() || !item.receiptDate.trim()) {
      throw new AiError('AI_CONTEXT_BUILD_FAILED');
    }
    return {
      receiptNumber: item.receiptNumber,
      symbol,
      reportName: item.reportName,
      receiptDate: item.receiptDate,
      correctionType: item.correctionType,
      hasSubsequentCorrection: item.hasSubsequentCorrection,
      isWithdrawn: item.isWithdrawn,
      includesConsolidated: item.includesConsolidated,
    };
  });
}

function financialPeriod(financial: AiFinancialContext | null): string | null {
  return financial ? `${financial.businessYear}-${financial.periodKind}` : null;
}

function buildReferences(
  context: CompanyAnalysisContextPack,
): {
  ids: Set<string>;
  catalog: Map<string, AiDataReferenceDto>;
} {
  const ids = new Set<string>();
  const catalog = new Map<string, AiDataReferenceDto>();
  const add = (reference: AiDataReferenceDto) => {
    ids.add(reference.id);
    catalog.set(reference.id, reference);
  };

  if (context.profile) {
    add({
      id: 'profile:company',
      sourceType: 'profile',
      label: 'OpenDART 기업개황',
      asOf: null,
    });
  }
  if (context.market) {
    add({
      id: 'market:quote',
      sourceType: 'market',
      label: '금융위원회 최근 확정 시세',
      asOf: context.market.asOf,
    });
  }
  if (context.financial) {
    const period = financialPeriod(context.financial) ?? context.financial.businessYear;
    for (const metric of context.financial.metrics) {
      if (metric.status !== 'resolved') continue;
      add({
        id: `financial:${metric.metric}`,
        sourceType: 'financial',
        label: `OpenDART 재무 · ${metric.metric}`,
        asOf: context.financial.receiptDate,
        metric: metric.metric,
        period,
      });
    }
  }
  for (const disclosure of context.disclosures) {
    if (disclosure.isWithdrawn) continue;
    add({
      id: `disclosure:${disclosure.receiptNumber}`,
      sourceType: 'disclosure',
      label: 'OpenDART 공시 목록',
      asOf: disclosure.receiptDate,
      receiptNumber: disclosure.receiptNumber,
      reportName: disclosure.reportName,
      receiptDate: disclosure.receiptDate,
    });
  }
  return { ids, catalog };
}

export class CompanyAnalysisContextBuilder {
  constructor(
    private readonly marketData: AiMarketDataLookup,
    private readonly companyData: AiCompanyDataLookup,
    private readonly latestFinancial: AiLatestFinancialLookup,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async build(symbol: string, requestId?: string): Promise<CompanyAnalysisContextResult> {
    const [marketSettled, profileSettled, financialSettled, disclosuresSettled] =
      await Promise.allSettled([
        this.marketData.getQuote(symbol),
        this.companyData.getCompanyProfile(symbol, requestId),
        this.latestFinancial.getLatestNormalizedFinancials(symbol, 'CFS', requestId),
        this.companyData.getDisclosures(symbol, disclosureQuery(this.now()), requestId),
      ]);

    const marketSource = sourceResult(marketSettled, quote => ({
      value: quote.fallback || quote.dataMode === 'mock' ? null : quote,
      available: !quote.fallback && quote.dataMode !== 'mock',
      stale: !quote.fallback && quote.dataMode !== 'mock' && quote.stale,
    }));
    const profileSource = sourceResult(profileSettled, response => ({
      value: response,
      available: true,
      stale: response.metadata.stale,
    }));
    const financialSource = sourceResult(financialSettled, response => ({
      value: response,
      available: true,
      stale: response.summary.metadata.stale || response.resolution.metadata.stale,
    }));
    const disclosuresSource = sourceResult(disclosuresSettled, response => ({
      value: response,
      available: true,
      stale: response.metadata.stale,
    }));

    const market = marketSource.value ? compactMarket(marketSource.value, symbol) : null;
    const profile = profileSource.value ? compactProfile(profileSource.value, symbol) : null;
    const financial = financialSource.value
      ? compactFinancial(financialSource.value, symbol)
      : null;
    const disclosures = disclosuresSource.value
      ? compactDisclosures(disclosuresSource.value, symbol)
      : [];

    if (!market && !profile) throw new AiError('AI_CONTEXT_NOT_FOUND');

    const sourceStates: Record<AiContextSource, SourceResult<unknown>> = {
      market: marketSource,
      profile: profileSource,
      financial: financialSource,
      disclosures: disclosuresSource,
    };
    const availableSources = SOURCE_ORDER.filter(source => sourceStates[source].available);
    const missingSources = SOURCE_ORDER.filter(source => !sourceStates[source].available);
    const staleSources = SOURCE_ORDER.filter(source => sourceStates[source].stale);
    const latestDisclosureDate = disclosures.reduce<string | null>(
      (latest, item) => !latest || item.receiptDate > latest ? item.receiptDate : latest,
      null,
    );
    const context: CompanyAnalysisContextPack = {
      schemaVersion: AI_CONTEXT_SCHEMA_VERSION,
      identity: {
        symbol,
        displayName: profile?.displayName ?? market?.name ?? symbol,
        market: profile?.market ?? market?.market ?? null,
      },
      availability: { availableSources, missingSources, staleSources },
      market,
      profile,
      financial,
      disclosures,
      dataAsOf: {
        market: market?.asOf ?? null,
        financialPeriod: financialPeriod(financial),
        latestDisclosureDate,
      },
    };
    const serialized = JSON.stringify(context);
    if (serialized.length > AI_LIMITS.contextChars) throw new AiError('AI_CONTEXT_BUILD_FAILED');
    const references = buildReferences(context);
    return {
      context,
      validReferenceIds: references.ids,
      referenceCatalog: references.catalog,
    };
  }
}

export function createCompanyAnalysisContextBuilder(
  marketData: MarketDataService,
  openDart: OpenDartService,
  latestFinancial: LatestFinancialService,
): CompanyAnalysisContextBuilder {
  return new CompanyAnalysisContextBuilder(marketData, openDart, latestFinancial);
}
