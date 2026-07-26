export type OpenDartStaleReason =
  | 'corp-code-index'
  | 'company-profile-cache'
  | 'disclosures-cache'
  | 'financial-statements-cache'
  | 'latest-report-cache';

export interface OpenDartResponseMetadata {
  source: 'opendart-fss';
  retrievedAt: string;
  stale: boolean;
  staleReasons: OpenDartStaleReason[];
  fallback: false;
  requestId?: string;
}

export type CompanyMarket = 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'OTHER' | 'UNKNOWN';

export interface CompanyProfileDto {
  symbol: string;
  corpCode: string;
  legalName: string;
  englishName: string | null;
  displayName: string;
  chiefExecutive: string | null;
  market: CompanyMarket;
  industryCode: string | null;
  establishedDate: string | null;
  fiscalYearEndMonth: string | null;
  websiteUrl: string | null;
  irUrl: string | null;
  companyInfoModifiedDate: string;
}

export interface CompanyProfileResponseDto {
  company: CompanyProfileDto;
  metadata: OpenDartResponseMetadata;
}

export type DisclosureCorrectionType =
  | 'none'
  | 'content-correction'
  | 'attachment-correction'
  | 'attachment-added'
  | 'registration-changed'
  | 'extension-decided'
  | 'issuance-terms-finalized'
  | 'correction-order'
  | 'correction-request'
  | 'unknown';

export interface DisclosureDto {
  receiptNumber: string;
  symbol: string;
  corpCode: string;
  companyName: string;
  reportName: string;
  filerName: string | null;
  receiptDate: string;
  market: CompanyMarket;
  correctionType: DisclosureCorrectionType;
  hasSubsequentCorrection: boolean;
  isWithdrawn: boolean;
  includesConsolidated: boolean;
  viewerUrl: string;
}

export interface DisclosurePageDto {
  items: DisclosureDto[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
  query: {
    from: string;
    to: string;
    finalOnly: boolean;
    category: string | null;
    detailCategory: string | null;
    page: number;
    pageSize: number;
  };
  metadata: OpenDartResponseMetadata;
}

export type FinancialReportCode = '11011' | '11012' | '11013' | '11014';
export type FinancialStatementDivision = 'CFS' | 'OFS';
export type FinancialPeriodKind = 'Q1' | 'H1' | 'Q3' | 'FY';
export type FinancialStatementType = 'BS' | 'IS' | 'CIS' | 'CF' | 'SCE';
export type FinancialAccountIdKind =
  | 'standard'
  | 'extension'
  | 'standard-code-unused'
  | 'missing'
  | 'unknown';
export type CanonicalFinancialMetric =
  | 'totalAssets'
  | 'totalLiabilities'
  | 'totalEquity'
  | 'cashAndCashEquivalents'
  | 'revenue'
  | 'operatingIncome'
  | 'netIncome'
  | 'operatingCashFlow';
export type FinancialAmountBasis =
  | 'current-point-in-time'
  | 'current-period'
  | 'current-cumulative';
export type FinancialAmountSourceField = 'currentAmount' | 'currentCumulativeAmount';
export type FinancialMetricMatchedBy =
  | 'standard-account-id'
  | 'approved-account-id-alias'
  | 'approved-account-name-alias';

export interface FinancialMetricEvidence {
  receiptNumber: string;
  statementType: FinancialStatementType;
  accountId: string | null;
  accountIdKind: FinancialAccountIdKind;
  accountName: string;
  accountDetail: string | null;
  sourceField: FinancialAmountSourceField;
  basis: FinancialAmountBasis;
  matchedBy: FinancialMetricMatchedBy;
  currency: string | null;
}

export interface FinancialMetricCandidateSummary {
  statementType: FinancialStatementType;
  accountId: string | null;
  accountIdKind: FinancialAccountIdKind;
  accountName: string;
  hasAccountDetail: boolean;
  matchedBy: FinancialMetricMatchedBy;
}

export interface ResolvedFinancialMetric {
  metric: CanonicalFinancialMetric;
  status: 'resolved';
  value: string;
  currency: string | null;
  basis: FinancialAmountBasis;
  matchedBy: FinancialMetricMatchedBy;
  evidence: FinancialMetricEvidence;
}

export interface UnresolvedFinancialMetric {
  metric: CanonicalFinancialMetric;
  status: 'unresolved';
  value: null;
  reason:
    | 'account-not-found'
    | 'amount-missing'
    | 'unsupported-statement-structure'
    | 'currency-missing'
    | 'dimension-ambiguous';
  candidates?: FinancialMetricCandidateSummary[];
}

export interface ConflictedFinancialMetric {
  metric: CanonicalFinancialMetric;
  status: 'conflict';
  value: null;
  reason:
    | 'multiple-standard-account-matches'
    | 'multiple-alias-matches'
    | 'statement-conflict'
    | 'value-conflict'
    | 'dimension-conflict';
  candidates: FinancialMetricCandidateSummary[];
}

export type NormalizedFinancialMetric =
  | ResolvedFinancialMetric
  | UnresolvedFinancialMetric
  | ConflictedFinancialMetric;

export type NormalizedFinancialMetrics = Record<
  CanonicalFinancialMetric,
  NormalizedFinancialMetric
>;

export interface FinancialReportMetadata {
  businessYear: string;
  reportCode: FinancialReportCode;
  periodKind: FinancialPeriodKind;
  requestedFsDiv: FinancialStatementDivision;
  resolvedFsDiv: FinancialStatementDivision;
  fallbackFromFsDiv: FinancialStatementDivision | null;
  receiptNumber: string;
}

export interface NormalizedFinancialSummaryDto {
  symbol: string;
  corpCode: string;
  report: FinancialReportMetadata;
  metrics: NormalizedFinancialMetrics;
  warnings: Array<{
    code:
      | 'METRIC_UNRESOLVED'
      | 'METRIC_CONFLICT'
      | 'MISSING_METRIC_CURRENCY'
      | 'DUPLICATE_EQUIVALENT_CANDIDATE';
    metrics: CanonicalFinancialMetric[];
  }>;
  metadata: OpenDartResponseMetadata;
}

export interface LatestFinancialReportResolutionDto {
  symbol: string;
  corpCode: string;
  businessYear: string;
  reportCode: FinancialReportCode;
  periodKind: FinancialPeriodKind;
  disclosureDetailType: 'A001' | 'A002' | 'A003';
  periodEnd: string;
  fiscalYearEndMonth: number;
  filing: {
    receiptNumber: string;
    receiptDate: string;
    reportName: string;
    correctionType: DisclosureCorrectionType;
  };
  resolutionMethod: 'opendart-final-periodic-disclosure';
  metadata: OpenDartResponseMetadata;
}

export interface LatestNormalizedFinancialSummaryResponseDto {
  resolution: LatestFinancialReportResolutionDto;
  summary: NormalizedFinancialSummaryDto;
}
