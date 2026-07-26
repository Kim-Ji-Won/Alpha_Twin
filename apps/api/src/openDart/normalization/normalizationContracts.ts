import {
  FinancialAccountIdKind,
  FinancialReportMetadata,
  FinancialStatementType,
  OpenDartResponseMetadata,
} from '../contracts.js';

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

export type FinancialAmountSourceField =
  | 'currentAmount'
  | 'currentCumulativeAmount';

export type FinancialMetricResolutionStatus = 'resolved' | 'unresolved' | 'conflict';

export type FinancialMetricUnresolvedReason =
  | 'account-not-found'
  | 'amount-missing'
  | 'unsupported-statement-structure'
  | 'currency-missing'
  | 'dimension-ambiguous';

export type FinancialMetricConflictReason =
  | 'multiple-standard-account-matches'
  | 'multiple-alias-matches'
  | 'statement-conflict'
  | 'value-conflict'
  | 'dimension-conflict';

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
  reason: FinancialMetricUnresolvedReason;
  candidates?: FinancialMetricCandidateSummary[];
}

export interface ConflictedFinancialMetric {
  metric: CanonicalFinancialMetric;
  status: 'conflict';
  value: null;
  reason: FinancialMetricConflictReason;
  candidates: FinancialMetricCandidateSummary[];
}

export type NormalizedFinancialMetric =
  | ResolvedFinancialMetric
  | UnresolvedFinancialMetric
  | ConflictedFinancialMetric;

export interface NormalizedFinancialMetrics {
  totalAssets: NormalizedFinancialMetric;
  totalLiabilities: NormalizedFinancialMetric;
  totalEquity: NormalizedFinancialMetric;
  cashAndCashEquivalents: NormalizedFinancialMetric;
  revenue: NormalizedFinancialMetric;
  operatingIncome: NormalizedFinancialMetric;
  netIncome: NormalizedFinancialMetric;
  operatingCashFlow: NormalizedFinancialMetric;
}

export type FinancialNormalizationWarningCode =
  | 'METRIC_UNRESOLVED'
  | 'METRIC_CONFLICT'
  | 'MISSING_METRIC_CURRENCY'
  | 'DUPLICATE_EQUIVALENT_CANDIDATE';

export interface FinancialNormalizationWarning {
  code: FinancialNormalizationWarningCode;
  metrics: CanonicalFinancialMetric[];
}

export interface NormalizedFinancialSummaryDto {
  symbol: string;
  corpCode: string;
  report: FinancialReportMetadata;
  metrics: NormalizedFinancialMetrics;
  warnings: FinancialNormalizationWarning[];
  metadata: OpenDartResponseMetadata;
}
