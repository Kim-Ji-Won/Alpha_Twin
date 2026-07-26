import {
  CanonicalFinancialMetric,
  LatestNormalizedFinancialSummaryResponseDto,
  NormalizedFinancialMetric,
} from '@/src/types/companyTwin';

const METRICS: Array<{ key: CanonicalFinancialMetric; label: string }> = [
  { key: 'totalAssets', label: '총자산' },
  { key: 'totalLiabilities', label: '총부채' },
  { key: 'totalEquity', label: '총자본' },
  { key: 'cashAndCashEquivalents', label: '현금및현금성자산' },
  { key: 'revenue', label: '매출액' },
  { key: 'operatingIncome', label: '영업이익' },
  { key: 'netIncome', label: '당기순이익' },
  { key: 'operatingCashFlow', label: '영업활동현금흐름' },
];

export interface CompanyTwinFinancialMetricViewModel {
  key: CanonicalFinancialMetric;
  label: string;
  status: NormalizedFinancialMetric['status'];
  valueText: string;
  basisLabel: string | null;
}

export interface CompanyTwinFinancialViewModel {
  periodLabel: string;
  statementDivisionLabel: string;
  metrics: CompanyTwinFinancialMetricViewModel[];
  resolutionStale: boolean;
  financialStale: boolean;
  hasWarnings: boolean;
}

export function formatFinancialInteger(value: string): string | null {
  if (!/^-?(0|[1-9]\d*)$/.test(value)) return null;
  const negative = value.startsWith('-');
  const digits = negative ? value.slice(1) : value;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}`;
}

function basisLabel(metric: NormalizedFinancialMetric): string | null {
  if (metric.status !== 'resolved') return null;
  if (metric.basis === 'current-point-in-time') return '기준시점';
  if (metric.basis === 'current-cumulative') return '보고기간 누적';
  return '당기';
}

function valueText(metric: NormalizedFinancialMetric): string {
  if (metric.status === 'unresolved') return '확인 불가';
  if (metric.status === 'conflict') return '데이터 확인 필요';
  const formatted = formatFinancialInteger(metric.value);
  if (!formatted) return '확인 불가';
  if (metric.currency === 'KRW') return `${formatted}원`;
  return metric.currency ? `${formatted} ${metric.currency}` : formatted;
}

export function financialPeriodLabel(
  businessYear: string,
  periodKind: 'Q1' | 'H1' | 'Q3' | 'FY',
): string {
  const period = {
    Q1: '1분기',
    H1: '반기',
    Q3: '3분기',
    FY: '연간',
  }[periodKind];
  return `${businessYear}년 ${period}`;
}

export function mapCompanyTwinFinancials(
  response: LatestNormalizedFinancialSummaryResponseDto,
): CompanyTwinFinancialViewModel {
  return {
    periodLabel: financialPeriodLabel(
      response.resolution.businessYear,
      response.resolution.periodKind,
    ),
    statementDivisionLabel:
      response.summary.report.resolvedFsDiv === 'CFS'
        ? '연결재무제표'
        : '별도재무제표',
    metrics: METRICS.map(({ key, label }) => {
      const metric = response.summary.metrics[key];
      return {
        key,
        label,
        status: metric.status,
        valueText: valueText(metric),
        basisLabel: basisLabel(metric),
      };
    }),
    resolutionStale: response.resolution.metadata.stale,
    financialStale: response.summary.metadata.stale,
    hasWarnings: response.summary.warnings.length > 0,
  };
}
