import {
  CompanyProfileResponseDto,
  CorpCodeRecord,
  DisclosureQueryDto,
  OpenDartDisclosurePageRaw,
} from '../../src/openDart/contracts.js';

export const LATEST_SYMBOL = '123456';
export const LATEST_CORP_CODE = '00123456';
export const LATEST_RECEIPT = '20260515000001';

export const latestCorpRecord: CorpCodeRecord = {
  corpCode: LATEST_CORP_CODE,
  corpName: '합성기업',
  corpEngName: 'Synthetic Company',
  stockCode: LATEST_SYMBOL,
  companyInfoModifiedDate: '2026-07-01',
};

export function latestProfile(
  fiscalYearEndMonth: string | null = '12',
): CompanyProfileResponseDto {
  return {
    company: {
      symbol: LATEST_SYMBOL,
      corpCode: LATEST_CORP_CODE,
      legalName: '합성기업 주식회사',
      englishName: 'Synthetic Company',
      displayName: '합성기업',
      chiefExecutive: null,
      market: 'KOSPI',
      industryCode: null,
      establishedDate: null,
      fiscalYearEndMonth,
      websiteUrl: null,
      irUrl: null,
      companyInfoModifiedDate: '2026-07-01',
    },
    metadata: {
      source: 'opendart-fss',
      retrievedAt: '2026-07-26T00:00:00.000Z',
      stale: false,
      staleReasons: [],
      fallback: false,
    },
  };
}

export function latestDisclosureRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    corp_cls: 'Y',
    corp_name: '합성기업',
    corp_code: LATEST_CORP_CODE,
    stock_code: LATEST_SYMBOL,
    report_nm: '분기보고서 (2026.03)',
    rcept_no: LATEST_RECEIPT,
    flr_nm: '합성기업',
    rcept_dt: '20260515',
    rm: '',
    ...overrides,
  };
}

export function latestDisclosurePage(
  query: DisclosureQueryDto,
  rows: Record<string, unknown>[] = [latestDisclosureRow()],
  overrides: Partial<OpenDartDisclosurePageRaw> = {},
): OpenDartDisclosurePageRaw {
  return {
    status: '000',
    page_no: query.page,
    page_count: query.pageSize,
    total_count: rows.length,
    total_page: rows.length ? 1 : 0,
    list: rows,
    ...overrides,
  };
}
