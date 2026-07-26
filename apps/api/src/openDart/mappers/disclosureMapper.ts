import {
  CompanyMarket,
  DisclosureCorrectionType,
  DisclosureDto,
  DisclosureQueryDto,
  OpenDartDisclosurePageRaw,
} from '../contracts.js';
import { OpenDartError } from '../errors.js';
import { mapCompanyMarket } from './companyProfileMapper.js';

const PREFIXES: Array<[string, DisclosureCorrectionType]> = [
  ['[기재정정]', 'content-correction'],
  ['[첨부정정]', 'attachment-correction'],
  ['[첨부추가]', 'attachment-added'],
  ['[변경등록]', 'registration-changed'],
  ['[연장결정]', 'extension-decided'],
  ['[발행조건확정]', 'issuance-terms-finalized'],
  ['[정정명령부과]', 'correction-order'],
  ['[정정제출요구]', 'correction-request'],
];

export function stripDisclosureCorrectionPrefix(reportName: string): string {
  const found = PREFIXES.find(([prefix]) => reportName.startsWith(prefix));
  return found ? reportName.slice(found[0].length).trim() : reportName.trim();
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OpenDartError('OPENDART_BAD_RESPONSE', 'disclosures', false);
  }
  return value.trim();
}

function nonNegativeInteger(value: unknown, name: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new OpenDartError('OPENDART_BAD_RESPONSE', 'disclosures', false, name);
  }
  return parsed;
}

function receiptDate(value: unknown): string {
  const text = requiredText(value);
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (!match) throw new OpenDartError('OPENDART_BAD_RESPONSE', 'disclosures', false);
  const result = `${match[1]}-${match[2]}-${match[3]}`;
  if (new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) {
    throw new OpenDartError('OPENDART_BAD_RESPONSE', 'disclosures', false);
  }
  return result;
}

function correctionType(reportName: string): DisclosureCorrectionType {
  const found = PREFIXES.find(([prefix]) => reportName.startsWith(prefix));
  if (found) return found[1];
  return reportName.startsWith('[') ? 'unknown' : 'none';
}

function mapItem(symbol: string, corpCode: string, value: unknown): DisclosureDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpenDartError('OPENDART_BAD_RESPONSE', 'disclosures', false);
  }
  const raw = value as Record<string, unknown>;
  const receiptNumber = requiredText(raw.rcept_no);
  if (!/^\d{14}$/.test(receiptNumber) || raw.corp_code !== corpCode || raw.stock_code !== symbol) {
    throw new OpenDartError('OPENDART_BAD_RESPONSE', 'disclosures', false);
  }
  const reportName = requiredText(raw.report_nm);
  const remark = typeof raw.rm === 'string' ? raw.rm : '';
  return {
    receiptNumber,
    symbol,
    corpCode,
    companyName: requiredText(raw.corp_name),
    reportName,
    filerName: typeof raw.flr_nm === 'string' && raw.flr_nm.trim() ? raw.flr_nm.trim() : null,
    receiptDate: receiptDate(raw.rcept_dt),
    market: mapCompanyMarket(raw.corp_cls) as CompanyMarket,
    correctionType: correctionType(reportName),
    hasSubsequentCorrection: remark.includes('정'),
    isWithdrawn: remark.includes('철'),
    includesConsolidated: remark.includes('연'),
    viewerUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receiptNumber}`,
  };
}

export function mapDisclosurePage(
  symbol: string,
  corpCode: string,
  query: DisclosureQueryDto,
  raw: OpenDartDisclosurePageRaw,
): Omit<import('../contracts.js').DisclosurePageDto, 'metadata'> {
  if (raw.status === '013') {
    return { items: [], pagination: { page: query.page, pageSize: query.pageSize, totalCount: 0, totalPages: 0 }, query };
  }
  if (raw.status !== '000' || !Array.isArray(raw.list)) {
    throw new OpenDartError('OPENDART_BAD_RESPONSE', 'disclosures', false);
  }
  const page = nonNegativeInteger(raw.page_no, 'page_no');
  const pageSize = nonNegativeInteger(raw.page_count, 'page_count');
  const totalCount = nonNegativeInteger(raw.total_count, 'total_count');
  const totalPages = nonNegativeInteger(raw.total_page, 'total_page');
  if (page !== query.page || page < 1 || pageSize < 1 || pageSize > 100 || pageSize !== query.pageSize
    || totalPages !== (totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize))) {
    throw new OpenDartError('OPENDART_BAD_RESPONSE', 'disclosures', false);
  }
  const unique = new Map<string, DisclosureDto>();
  for (const item of raw.list) {
    const mapped = mapItem(symbol, corpCode, item);
    if (!unique.has(mapped.receiptNumber)) unique.set(mapped.receiptNumber, mapped);
  }
  const items = [...unique.values()].sort((a, b) =>
    b.receiptDate.localeCompare(a.receiptDate) || b.receiptNumber.localeCompare(a.receiptNumber));
  return { items, pagination: { page, pageSize, totalCount, totalPages }, query };
}
