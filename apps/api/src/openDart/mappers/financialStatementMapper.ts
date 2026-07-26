import {
  FinancialAccountIdKind,
  FinancialPeriodKind,
  FinancialReportCode,
  FinancialStatementDivision,
  FinancialStatementLineDto,
  FinancialStatementType,
  FinancialWarningCode,
  FinancialWarningDto,
  OpenDartFinancialRawResponse,
} from '../contracts.js';
import { OpenDartError } from '../errors.js';

export const MAX_FINANCIAL_ROWS = 5_000;
export const STANDARD_ACCOUNT_CODE_UNUSED = '-표준계정코드 미사용-';

const STATEMENT_TYPES = new Set<FinancialStatementType>(['BS', 'IS', 'CIS', 'CF', 'SCE']);
// These are official taxonomy namespaces observed in the audited OpenDART contract.
const STANDARD_ACCOUNT_ID_PATTERN = /^(?:ifrs-full|dart)_/;
const PERIOD_KINDS: Record<FinancialReportCode, FinancialPeriodKind> = {
  '11011': 'FY',
  '11012': 'H1',
  '11013': 'Q1',
  '11014': 'Q3',
};
const WARNING_ORDER: FinancialWarningCode[] = [
  'BLANK_AMOUNT',
  'DASH_AMOUNT',
  'INVALID_ORDER',
  'MULTIPLE_CURRENCIES',
  'UNEXPECTED_ACCOUNT_DETAIL',
];

type RawRow = Record<string, unknown>;

export interface FinancialMappingInput {
  symbol: string;
  corpCode: string;
  businessYear: string;
  reportCode: FinancialReportCode;
  resolvedFsDiv: FinancialStatementDivision;
  raw: OpenDartFinancialRawResponse;
}

export interface FinancialMappingResult {
  receiptNumber: string;
  periodKind: FinancialPeriodKind;
  lines: FinancialStatementLineDto[];
  currencies: string[];
  warnings: FinancialWarningDto[];
}

function inconsistent(): never {
  throw new OpenDartError(
    'FINANCIAL_RESPONSE_INCONSISTENT',
    'financial-statements',
    false,
  );
}

function requiredString(value: unknown, pattern?: RegExp): string {
  if (typeof value !== 'string') inconsistent();
  const normalized = value.trim();
  if (!normalized || (pattern && !pattern.test(normalized))) inconsistent();
  return normalized;
}

function optionalString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') inconsistent();
  const normalized = value.trim();
  return normalized && normalized !== '-' ? normalized : null;
}

function increment(warnings: Map<FinancialWarningCode, number>, code: FinancialWarningCode): void {
  warnings.set(code, (warnings.get(code) ?? 0) + 1);
}

export function normalizeFinancialAmount(
  value: unknown,
  warnings?: Map<FinancialWarningCode, number>,
): string | null {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    if (warnings) increment(warnings, 'BLANK_AMOUNT');
    return null;
  }
  if (typeof value !== 'string') {
    throw new OpenDartError(
      'FINANCIAL_ACCOUNT_VALUE_INVALID',
      'financial-statements',
      false,
    );
  }
  const normalized = value.trim();
  if (normalized === '-') {
    if (warnings) increment(warnings, 'DASH_AMOUNT');
    return null;
  }
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(normalized)) {
    throw new OpenDartError(
      'FINANCIAL_ACCOUNT_VALUE_INVALID',
      'financial-statements',
      false,
    );
  }
  return normalized.replaceAll(',', '');
}

function mapAccountId(
  value: unknown,
): { accountId: string | null; accountIdKind: FinancialAccountIdKind } {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    return { accountId: null, accountIdKind: 'missing' };
  }
  if (typeof value !== 'string') inconsistent();
  const normalized = value.trim();
  if (normalized === STANDARD_ACCOUNT_CODE_UNUSED) {
    return { accountId: null, accountIdKind: 'standard-code-unused' };
  }
  const accountIdKind: FinancialAccountIdKind =
    STANDARD_ACCOUNT_ID_PATTERN.test(normalized) ? 'standard' : 'unknown';
  return { accountId: normalized, accountIdKind };
}

function mapOrder(value: unknown, warnings: Map<FinancialWarningCode, number>): number | null {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  increment(warnings, 'INVALID_ORDER');
  return null;
}

export function mapFinancialStatements(input: FinancialMappingInput): FinancialMappingResult {
  if (input.raw.status !== '000' || !Array.isArray(input.raw.list)) {
    throw new OpenDartError('OPENDART_BAD_RESPONSE', 'financial-statements', false);
  }
  if (input.raw.list.length > MAX_FINANCIAL_ROWS) {
    throw new OpenDartError('OPENDART_BAD_RESPONSE', 'financial-statements', false);
  }

  const warnings = new Map<FinancialWarningCode, number>();
  const receipts = new Set<string>();
  const currencies = new Set<string>();
  const lines = input.raw.list.map((candidate): FinancialStatementLineDto => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) inconsistent();
    const row = candidate as RawRow;
    const receiptNumber = requiredString(row.rcept_no, /^\d{14}$/);
    const reportCode = requiredString(row.reprt_code);
    const businessYear = requiredString(row.bsns_year);
    const corpCode = requiredString(row.corp_code, /^\d{8}$/);
    const statementTypeValue = requiredString(row.sj_div);
    if (
      reportCode !== input.reportCode
      || businessYear !== input.businessYear
      || corpCode !== input.corpCode
      || !STATEMENT_TYPES.has(statementTypeValue as FinancialStatementType)
    ) inconsistent();

    const statementType = statementTypeValue as FinancialStatementType;
    const accountDetail = optionalString(row.account_detail);
    if (statementType !== 'SCE' && accountDetail) {
      increment(warnings, 'UNEXPECTED_ACCOUNT_DETAIL');
    }
    const currency = optionalString(row.currency);
    if (currency) currencies.add(currency);
    const account = mapAccountId(row.account_id);
    receipts.add(receiptNumber);

    return {
      receiptNumber,
      symbol: input.symbol,
      corpCode,
      businessYear,
      reportCode: input.reportCode,
      fsDiv: input.resolvedFsDiv,
      statementType,
      statementName: optionalString(row.sj_nm) ?? statementType,
      ...account,
      accountName: requiredString(row.account_nm),
      accountDetail,
      currentPeriodName: optionalString(row.thstrm_nm),
      currentAmount: normalizeFinancialAmount(row.thstrm_amount, warnings),
      currentCumulativeAmount: normalizeFinancialAmount(row.thstrm_add_amount, warnings),
      previousPeriodName: optionalString(row.frmtrm_nm),
      previousAmount: normalizeFinancialAmount(row.frmtrm_amount, warnings),
      previousComparableQuarterPeriodName: optionalString(row.frmtrm_q_nm),
      previousComparableQuarterAmount: normalizeFinancialAmount(row.frmtrm_q_amount, warnings),
      previousCumulativeAmount: normalizeFinancialAmount(row.frmtrm_add_amount, warnings),
      priorPeriodName: optionalString(row.bfefrmtrm_nm),
      priorPeriodAmount: normalizeFinancialAmount(row.bfefrmtrm_amount, warnings),
      order: mapOrder(row.ord, warnings),
      currency,
    };
  });

  if (receipts.size !== 1) inconsistent();
  const sortedCurrencies = [...currencies].sort();
  if (sortedCurrencies.length > 1) increment(warnings, 'MULTIPLE_CURRENCIES');

  return {
    receiptNumber: [...receipts][0]!,
    periodKind: PERIOD_KINDS[input.reportCode],
    lines,
    currencies: sortedCurrencies,
    warnings: WARNING_ORDER.flatMap(code => {
      const count = warnings.get(code);
      return count ? [{ code, count }] : [];
    }),
  };
}
