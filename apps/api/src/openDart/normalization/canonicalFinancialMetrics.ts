import {
  FinancialPeriodKind,
  FinancialStatementType,
} from '../contracts.js';
import {
  CanonicalFinancialMetric,
  FinancialAmountBasis,
  FinancialAmountSourceField,
} from './normalizationContracts.js';

export interface FinancialAmountSelectionRule {
  basis: FinancialAmountBasis;
  sourceField: FinancialAmountSourceField;
}

export interface CanonicalMetricDefinition {
  metric: CanonicalFinancialMetric;
  allowedStatementTypes: FinancialStatementType[];
  standardAccountIds: string[];
  approvedAccountIdAliases: string[];
  approvedAccountNameAliases: string[];
  selectionByPeriod: Record<FinancialPeriodKind, FinancialAmountSelectionRule>;
}

export const CANONICAL_FINANCIAL_METRICS: CanonicalFinancialMetric[] = [
  'totalAssets',
  'totalLiabilities',
  'totalEquity',
  'cashAndCashEquivalents',
  'revenue',
  'operatingIncome',
  'netIncome',
  'operatingCashFlow',
];

const POINT_IN_TIME: Record<FinancialPeriodKind, FinancialAmountSelectionRule> = {
  Q1: { basis: 'current-point-in-time', sourceField: 'currentAmount' },
  H1: { basis: 'current-point-in-time', sourceField: 'currentAmount' },
  Q3: { basis: 'current-point-in-time', sourceField: 'currentAmount' },
  FY: { basis: 'current-point-in-time', sourceField: 'currentAmount' },
};

const INCOME_PERIOD: Record<FinancialPeriodKind, FinancialAmountSelectionRule> = {
  Q1: { basis: 'current-cumulative', sourceField: 'currentCumulativeAmount' },
  H1: { basis: 'current-cumulative', sourceField: 'currentCumulativeAmount' },
  Q3: { basis: 'current-cumulative', sourceField: 'currentCumulativeAmount' },
  FY: { basis: 'current-period', sourceField: 'currentAmount' },
};

// OpenDART CF carries the cumulative interim flow in thstrm_amount/currentAmount.
const CASH_FLOW_PERIOD: Record<FinancialPeriodKind, FinancialAmountSelectionRule> = {
  Q1: { basis: 'current-cumulative', sourceField: 'currentAmount' },
  H1: { basis: 'current-cumulative', sourceField: 'currentAmount' },
  Q3: { basis: 'current-cumulative', sourceField: 'currentAmount' },
  FY: { basis: 'current-period', sourceField: 'currentAmount' },
};

export const CANONICAL_FINANCIAL_REGISTRY: CanonicalMetricDefinition[] = [
  {
    metric: 'totalAssets',
    allowedStatementTypes: ['BS'],
    standardAccountIds: ['ifrs-full_Assets'],
    approvedAccountIdAliases: [],
    approvedAccountNameAliases: ['자산총계'],
    selectionByPeriod: POINT_IN_TIME,
  },
  {
    metric: 'totalLiabilities',
    allowedStatementTypes: ['BS'],
    standardAccountIds: ['ifrs-full_Liabilities'],
    approvedAccountIdAliases: [],
    approvedAccountNameAliases: ['부채총계'],
    selectionByPeriod: POINT_IN_TIME,
  },
  {
    metric: 'totalEquity',
    allowedStatementTypes: ['BS'],
    standardAccountIds: ['ifrs-full_Equity'],
    approvedAccountIdAliases: [],
    approvedAccountNameAliases: ['자본총계'],
    selectionByPeriod: POINT_IN_TIME,
  },
  {
    metric: 'cashAndCashEquivalents',
    allowedStatementTypes: ['BS'],
    standardAccountIds: ['ifrs-full_CashAndCashEquivalents'],
    approvedAccountIdAliases: [],
    approvedAccountNameAliases: ['현금및현금성자산'],
    selectionByPeriod: POINT_IN_TIME,
  },
  {
    metric: 'revenue',
    allowedStatementTypes: ['IS', 'CIS'],
    standardAccountIds: ['ifrs-full_Revenue'],
    approvedAccountIdAliases: [],
    approvedAccountNameAliases: ['매출액'],
    selectionByPeriod: INCOME_PERIOD,
  },
  {
    metric: 'operatingIncome',
    allowedStatementTypes: ['IS', 'CIS'],
    standardAccountIds: ['dart_OperatingIncomeLoss'],
    approvedAccountIdAliases: [],
    approvedAccountNameAliases: ['영업이익'],
    selectionByPeriod: INCOME_PERIOD,
  },
  {
    metric: 'netIncome',
    allowedStatementTypes: ['IS', 'CIS'],
    standardAccountIds: ['ifrs-full_ProfitLoss'],
    approvedAccountIdAliases: [],
    approvedAccountNameAliases: ['분기순이익', '당기순이익'],
    selectionByPeriod: INCOME_PERIOD,
  },
  {
    metric: 'operatingCashFlow',
    allowedStatementTypes: ['CF'],
    standardAccountIds: ['ifrs-full_CashFlowsFromUsedInOperatingActivities'],
    approvedAccountIdAliases: [],
    approvedAccountNameAliases: ['영업활동현금흐름', '영업활동 현금흐름'],
    selectionByPeriod: CASH_FLOW_PERIOD,
  },
];
