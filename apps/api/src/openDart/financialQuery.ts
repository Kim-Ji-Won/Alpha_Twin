import {
  FinancialReportCode,
  FinancialStatementDivision,
  FinancialStatementsQuery,
} from './contracts.js';
import { OpenDartError } from './errors.js';

const REPORT_CODES = new Set<FinancialReportCode>(['11011', '11012', '11013', '11014']);
const FS_DIVISIONS = new Set<FinancialStatementDivision>(['CFS', 'OFS']);

function currentKstYear(now: Date): number {
  return Number(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
  }).format(now));
}

export function parseFinancialStatementsQuery(
  raw: Record<string, string | undefined>,
  now: Date = new Date(),
): FinancialStatementsQuery {
  const businessYear = raw.businessYear;
  const reportCode = raw.reportCode;
  const fsDiv = raw.fsDiv;
  const year = businessYear && /^\d{4}$/.test(businessYear) ? Number(businessYear) : NaN;

  if (
    !businessYear
    || !Number.isInteger(year)
    || year < 2015
    || year > currentKstYear(now)
    || !reportCode
    || !REPORT_CODES.has(reportCode as FinancialReportCode)
    || !fsDiv
    || !FS_DIVISIONS.has(fsDiv as FinancialStatementDivision)
  ) {
    throw new OpenDartError('INVALID_FINANCIAL_QUERY', 'financial-statements', false);
  }

  return {
    businessYear,
    reportCode: reportCode as FinancialReportCode,
    fsDiv: fsDiv as FinancialStatementDivision,
  };
}
