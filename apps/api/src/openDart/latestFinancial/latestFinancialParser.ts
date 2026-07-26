import {
  FinancialPeriodKind,
  FinancialReportCode,
} from '../contracts.js';
import { OpenDartError } from '../errors.js';
import { stripDisclosureCorrectionPrefix } from '../mappers/disclosureMapper.js';
import {
  LatestFinancialDisclosureDetailType,
  LatestFinancialQuery,
} from './latestFinancialContracts.js';

const PERIOD_MARKER = /\((\d{4})\.(\d{2})\)/g;

export interface ParsedFinancialPeriod {
  businessYear: string;
  periodMonth: number;
  periodEnd: string;
}

export interface MappedFinancialPeriod extends ParsedFinancialPeriod {
  reportCode: FinancialReportCode;
  periodKind: FinancialPeriodKind;
}

function unresolved(): never {
  throw new OpenDartError(
    'LATEST_FINANCIAL_REPORT_UNRESOLVED',
    'latest-financial-report',
    false,
  );
}

export function parseLatestFinancialQuery(
  raw: Record<string, unknown>,
): LatestFinancialQuery {
  if (Object.keys(raw).some(key => key !== 'fsDiv')) {
    throw new OpenDartError(
      'INVALID_LATEST_FINANCIAL_QUERY',
      'latest-financial-report',
      false,
    );
  }
  const value = raw.fsDiv;
  if (value == null) return { fsDiv: 'CFS' };
  if (value !== 'CFS' && value !== 'OFS') {
    throw new OpenDartError(
      'INVALID_LATEST_FINANCIAL_QUERY',
      'latest-financial-report',
      false,
    );
  }
  return { fsDiv: value };
}

export function parseLatestFinancialPeriod(reportName: string): ParsedFinancialPeriod {
  const normalized = stripDisclosureCorrectionPrefix(reportName);
  const matches = [...normalized.matchAll(PERIOD_MARKER)];
  const match = matches[0];
  if (
    matches.length !== 1
    || !match
    || match.index == null
    || match.index + match[0].length !== normalized.length
  ) unresolved();
  const businessYear = match[1]!;
  const monthText = match[2]!;
  const periodMonth = Number(monthText);
  if (periodMonth < 1 || periodMonth > 12) unresolved();
  return {
    businessYear,
    periodMonth,
    periodEnd: `${businessYear}-${monthText}`,
  };
}

export function fiscalPeriodMonth(
  fiscalYearEndMonth: number,
  monthsAfterYearEnd: 0 | 3 | 6 | 9,
): number {
  if (!Number.isInteger(fiscalYearEndMonth)
    || fiscalYearEndMonth < 1
    || fiscalYearEndMonth > 12) unresolved();
  return ((fiscalYearEndMonth - 1 + monthsAfterYearEnd) % 12) + 1;
}

export function mapLatestFinancialPeriod(
  detailType: LatestFinancialDisclosureDetailType,
  reportName: string,
  fiscalYearEndMonth: number,
): MappedFinancialPeriod {
  const parsed = parseLatestFinancialPeriod(reportName);
  if (detailType === 'A001') {
    if (parsed.periodMonth !== fiscalPeriodMonth(fiscalYearEndMonth, 0)) unresolved();
    return { ...parsed, reportCode: '11011', periodKind: 'FY' };
  }
  if (detailType === 'A002') {
    if (parsed.periodMonth !== fiscalPeriodMonth(fiscalYearEndMonth, 6)) unresolved();
    return { ...parsed, reportCode: '11012', periodKind: 'H1' };
  }
  if (parsed.periodMonth === fiscalPeriodMonth(fiscalYearEndMonth, 3)) {
    return { ...parsed, reportCode: '11013', periodKind: 'Q1' };
  }
  if (parsed.periodMonth === fiscalPeriodMonth(fiscalYearEndMonth, 9)) {
    return { ...parsed, reportCode: '11014', periodKind: 'Q3' };
  }
  return unresolved();
}
