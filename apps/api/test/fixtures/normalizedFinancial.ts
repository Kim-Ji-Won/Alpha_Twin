import {
  FinancialPeriodKind,
  FinancialReportCode,
  FinancialStatementLineDto,
  FinancialStatementsResponseDto,
} from '../../src/openDart/contracts.js';

export const NORMALIZATION_SYMBOL = '123456';
export const NORMALIZATION_CORP_CODE = '00123456';
export const NORMALIZATION_RECEIPT = '20260726000001';

const REPORT_CODES: Record<FinancialPeriodKind, FinancialReportCode> = {
  Q1: '11013',
  H1: '11012',
  Q3: '11014',
  FY: '11011',
};

export function normalizationLine(
  overrides: Partial<FinancialStatementLineDto> = {},
): FinancialStatementLineDto {
  return {
    receiptNumber: NORMALIZATION_RECEIPT,
    symbol: NORMALIZATION_SYMBOL,
    corpCode: NORMALIZATION_CORP_CODE,
    businessYear: '2026',
    reportCode: '11013',
    fsDiv: 'CFS',
    statementType: 'BS',
    statementName: '합성 재무상태표',
    accountId: 'ifrs-full_Assets',
    accountIdKind: 'standard',
    accountName: '자산총계',
    accountDetail: null,
    currentPeriodName: '합성 당기',
    currentAmount: '9007199254740993',
    currentCumulativeAmount: null,
    previousPeriodName: null,
    previousAmount: null,
    previousComparableQuarterPeriodName: null,
    previousComparableQuarterAmount: null,
    previousCumulativeAmount: null,
    priorPeriodName: null,
    priorPeriodAmount: null,
    order: 1,
    currency: 'KRW',
    ...overrides,
  };
}

export function canonicalFinancialLines(): FinancialStatementLineDto[] {
  return [
    normalizationLine(),
    normalizationLine({
      accountId: 'ifrs-full_Liabilities',
      accountName: '부채총계',
      currentAmount: '4000',
      order: 2,
    }),
    normalizationLine({
      accountId: 'ifrs-full_Equity',
      accountName: '자본총계',
      currentAmount: '5000',
      order: 3,
    }),
    normalizationLine({
      accountId: 'ifrs-full_CashAndCashEquivalents',
      accountName: '현금및현금성자산',
      currentAmount: '1000',
      order: 4,
    }),
    normalizationLine({
      statementType: 'IS',
      statementName: '합성 손익계산서',
      accountId: 'ifrs-full_Revenue',
      accountName: '매출액',
      currentAmount: '300',
      currentCumulativeAmount: '1300',
      order: 5,
    }),
    normalizationLine({
      statementType: 'IS',
      statementName: '합성 손익계산서',
      accountId: 'dart_OperatingIncomeLoss',
      accountName: '영업이익',
      currentAmount: '-30',
      currentCumulativeAmount: '-130',
      order: 6,
    }),
    normalizationLine({
      statementType: 'CIS',
      statementName: '합성 포괄손익계산서',
      accountId: 'ifrs-full_ProfitLoss',
      accountName: '분기순이익',
      currentAmount: '20',
      currentCumulativeAmount: '120',
      order: 7,
    }),
    normalizationLine({
      statementType: 'CF',
      statementName: '합성 현금흐름표',
      accountId: 'ifrs-full_CashFlowsFromUsedInOperatingActivities',
      accountName: '영업활동현금흐름',
      currentAmount: '800',
      currentCumulativeAmount: null,
      order: 8,
    }),
  ];
}

export interface FinancialDtoOptions {
  lines?: FinancialStatementLineDto[];
  periodKind?: FinancialPeriodKind;
  requestedFsDiv?: 'CFS' | 'OFS';
  resolvedFsDiv?: 'CFS' | 'OFS';
  fallbackFromFsDiv?: 'CFS' | 'OFS' | null;
  stale?: boolean;
}

export function financialStatementsDto(
  options: FinancialDtoOptions = {},
): FinancialStatementsResponseDto {
  const periodKind = options.periodKind ?? 'Q1';
  const reportCode = REPORT_CODES[periodKind];
  const requestedFsDiv = options.requestedFsDiv ?? 'CFS';
  const resolvedFsDiv = options.resolvedFsDiv ?? requestedFsDiv;
  const lines = (options.lines ?? canonicalFinancialLines()).map(line => ({
    ...line,
    reportCode,
    fsDiv: resolvedFsDiv,
  }));
  return {
    symbol: NORMALIZATION_SYMBOL,
    corpCode: NORMALIZATION_CORP_CODE,
    report: {
      businessYear: periodKind === 'FY' ? '2025' : '2026',
      reportCode,
      periodKind,
      requestedFsDiv,
      resolvedFsDiv,
      fallbackFromFsDiv: options.fallbackFromFsDiv ?? null,
      receiptNumber: NORMALIZATION_RECEIPT,
    },
    lines,
    currencies: ['KRW'],
    warnings: [],
    metadata: {
      source: 'opendart-fss',
      retrievedAt: '2026-07-26T00:00:00.000Z',
      stale: options.stale ?? false,
      staleReasons: options.stale ? ['financial-statements-cache'] : [],
      fallback: false,
      requestId: 'synthetic-request',
    },
  };
}
