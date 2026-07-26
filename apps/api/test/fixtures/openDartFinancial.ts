import { OpenDartFinancialRawResponse } from '../../src/openDart/contracts.js';

export const SYNTHETIC_CORP_CODE = '00123456';
export const SYNTHETIC_SYMBOL = '123456';
export const SYNTHETIC_RECEIPT = '20260726000001';

export function financialRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rcept_no: SYNTHETIC_RECEIPT,
    reprt_code: '11013',
    bsns_year: '2026',
    corp_code: SYNTHETIC_CORP_CODE,
    sj_div: 'BS',
    sj_nm: '재무상태표',
    account_id: 'ifrs-full_Assets',
    account_nm: '합성 자산',
    account_detail: '-',
    thstrm_nm: '합성 당기',
    thstrm_amount: '9,007,199,254,740,993',
    thstrm_add_amount: '',
    frmtrm_nm: '합성 전기',
    frmtrm_amount: '-1,234',
    frmtrm_q_nm: '',
    frmtrm_q_amount: '-',
    frmtrm_add_amount: '',
    bfefrmtrm_nm: '',
    bfefrmtrm_amount: '',
    ord: '1',
    currency: 'KRW',
    ...overrides,
  };
}

export function financialResponse(
  rows: Record<string, unknown>[] = [financialRow()],
): OpenDartFinancialRawResponse {
  return { status: '000', message: 'synthetic success', list: rows };
}

export const noFinancialData = (): OpenDartFinancialRawResponse => ({
  status: '013',
  message: 'synthetic no data',
});
