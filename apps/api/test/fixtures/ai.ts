import { StockQuoteDto } from '../../src/contracts.js';
import {
  CompanyProfileResponseDto,
  DisclosurePageDto,
  DisclosureQueryDto,
} from '../../src/openDart/contracts.js';
import { LatestNormalizedFinancialSummaryResponseDto } from '../../src/openDart/latestFinancial/latestFinancialContracts.js';
import { FinancialAccountNormalizer } from '../../src/openDart/normalization/accountNormalizer.js';
import {
  AiProviderInput,
  AiProviderOutcome,
  AiProviderUsage,
} from '../../src/ai/contracts.js';
import {
  AiCompanyDataLookup,
  AiLatestFinancialLookup,
  AiMarketDataLookup,
} from '../../src/ai/contextBuilder.js';
import { AiAnalysisProvider } from '../../src/ai/provider.js';
import {
  NORMALIZATION_CORP_CODE,
  NORMALIZATION_RECEIPT,
  NORMALIZATION_SYMBOL,
  financialStatementsDto,
} from './normalizedFinancial.js';

export const AI_SYMBOL = NORMALIZATION_SYMBOL;

export function usage(): AiProviderUsage {
  return {
    inputTokens: 100,
    cachedInputTokens: 20,
    cacheWriteTokens: 5,
    outputTokens: 40,
    reasoningTokens: 10,
    totalTokens: 140,
  };
}

export function validAnalysis(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'analyst-v1',
    status: 'answered',
    answer: '최근 확정 데이터에 근거한 합성 분석입니다.',
    supportingFactors: [{ text: '매출 지표가 확인됩니다.', evidenceRefs: ['financial:revenue'] }],
    riskFactors: [{ text: '최근 확정 시세의 변동을 확인해야 합니다.', evidenceRefs: ['market:quote'] }],
    uncertainties: [{ text: '공시 본문은 제공되지 않았습니다.', evidenceRefs: [] }],
    followUpQuestion: null,
    ...overrides,
  };
}

export function analysisOutcome(overrides: Record<string, unknown> = {}): AiProviderOutcome {
  return {
    kind: 'analysis',
    analysis: validAnalysis(overrides),
    usage: usage(),
    providerRequestId: 'resp_synthetic',
  };
}

export class FakeAiProvider implements AiAnalysisProvider {
  readonly id = 'fake-ai';
  readonly model = 'fake-model';
  readonly reasoningEffort = 'medium';
  calls: Array<{ input: AiProviderInput; signal?: AbortSignal }> = [];

  constructor(
    private outcome: AiProviderOutcome | Error = analysisOutcome(),
    private configured = true,
  ) {}

  isConfigured(): boolean {
    return this.configured;
  }

  setOutcome(outcome: AiProviderOutcome | Error): void {
    this.outcome = outcome;
  }

  async analyze(input: AiProviderInput, signal?: AbortSignal): Promise<AiProviderOutcome> {
    this.calls.push({ input, signal });
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

export function marketQuote(overrides: Partial<StockQuoteDto> = {}): StockQuoteDto {
  return {
    symbol: AI_SYMBOL,
    name: '합성전자',
    market: 'KOSPI',
    currency: 'KRW',
    price: 70000,
    change: 1000,
    changePercent: 1.45,
    asOf: '2026-07-24',
    source: 'public-data-fsc',
    stale: false,
    fallback: false,
    dataMode: 'eod',
    priceAdjustment: 'raw',
    ...overrides,
  };
}

export function companyProfile(
  overrides: Partial<CompanyProfileResponseDto['company']> = {},
  stale = false,
): CompanyProfileResponseDto {
  return {
    company: {
      symbol: AI_SYMBOL,
      corpCode: NORMALIZATION_CORP_CODE,
      legalName: '합성전자 주식회사',
      englishName: 'Synthetic Electronics',
      displayName: '합성전자',
      chiefExecutive: null,
      market: 'KOSPI',
      industryCode: '26110',
      establishedDate: '1969-01-13',
      fiscalYearEndMonth: '12',
      websiteUrl: null,
      irUrl: null,
      companyInfoModifiedDate: '2026-07-01',
      ...overrides,
    },
    metadata: {
      source: 'opendart-fss',
      retrievedAt: '2026-07-26T00:00:00.000Z',
      stale,
      staleReasons: stale ? ['company-profile-cache'] : [],
      fallback: false,
    },
  };
}

export function disclosures(
  options: { empty?: boolean; stale?: boolean; withdrawn?: boolean; symbol?: string } = {},
): DisclosurePageDto {
  const query: DisclosureQueryDto = {
    from: '2026-04-28',
    to: '2026-07-26',
    finalOnly: true,
    category: null,
    detailCategory: null,
    page: 1,
    pageSize: 5,
  };
  const items = options.empty ? [] : [{
    receiptNumber: '20260725000001',
    symbol: options.symbol ?? AI_SYMBOL,
    corpCode: NORMALIZATION_CORP_CODE,
    companyName: '합성전자',
    reportName: '분기보고서',
    filerName: null,
    receiptDate: '2026-07-25',
    market: 'KOSPI' as const,
    correctionType: 'none' as const,
    hasSubsequentCorrection: false,
    isWithdrawn: options.withdrawn ?? false,
    includesConsolidated: true,
    viewerUrl: 'https://example.invalid/not-used',
  }];
  return {
    items,
    pagination: { page: 1, pageSize: 5, totalCount: items.length, totalPages: items.length ? 1 : 0 },
    query,
    metadata: {
      source: 'opendart-fss',
      retrievedAt: '2026-07-26T00:00:00.000Z',
      stale: options.stale ?? false,
      staleReasons: options.stale ? ['disclosures-cache'] : [],
      fallback: false,
    },
  };
}

export function latestFinancial(
  options: { stale?: boolean; symbol?: string; resolvedFsDiv?: 'CFS' | 'OFS' } = {},
): LatestNormalizedFinancialSummaryResponseDto {
  const financial = financialStatementsDto({
    stale: options.stale,
    resolvedFsDiv: options.resolvedFsDiv,
    fallbackFromFsDiv: options.resolvedFsDiv === 'OFS' ? 'CFS' : null,
  });
  const summary = new FinancialAccountNormalizer().normalize(financial);
  if (options.symbol) summary.symbol = options.symbol;
  return {
    resolution: {
      symbol: options.symbol ?? AI_SYMBOL,
      corpCode: NORMALIZATION_CORP_CODE,
      businessYear: '2026',
      reportCode: '11013',
      periodKind: 'Q1',
      disclosureDetailType: 'A003',
      periodEnd: '2026-03',
      fiscalYearEndMonth: 12,
      filing: {
        receiptNumber: NORMALIZATION_RECEIPT,
        receiptDate: '2026-05-15',
        reportName: '분기보고서 (2026.03)',
        correctionType: 'none',
      },
      resolutionMethod: 'opendart-final-periodic-disclosure',
      metadata: {
        source: 'opendart-fss',
        retrievedAt: '2026-07-26T00:00:00.000Z',
        stale: options.stale ?? false,
        staleReasons: options.stale ? ['latest-report-cache'] : [],
        fallback: false,
      },
    },
    summary,
  };
}

export interface ContextSourceOptions {
  market?: StockQuoteDto | Error;
  profile?: CompanyProfileResponseDto | Error;
  financial?: LatestNormalizedFinancialSummaryResponseDto | Error;
  disclosures?: DisclosurePageDto | Error;
}

export function contextSources(options: ContextSourceOptions = {}): {
  market: AiMarketDataLookup;
  company: AiCompanyDataLookup;
  financial: AiLatestFinancialLookup;
} {
  const market = options.market ?? marketQuote();
  const profile = options.profile ?? companyProfile();
  const financial = options.financial ?? latestFinancial();
  const disclosurePage = options.disclosures ?? disclosures();
  const resolve = async <T>(value: T | Error): Promise<T> => {
    if (value instanceof Error) throw value;
    return value;
  };
  return {
    market: { getQuote: async () => resolve(market) },
    company: {
      getCompanyProfile: async () => resolve(profile),
      getDisclosures: async () => resolve(disclosurePage),
    },
    financial: { getLatestNormalizedFinancials: async () => resolve(financial) },
  };
}
