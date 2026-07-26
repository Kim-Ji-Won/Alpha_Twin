import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FinancialReportCode,
  FinancialStatementDivision,
} from '../src/openDart/contracts.js';
import { OpenDartError } from '../src/openDart/errors.js';
import { parseFinancialStatementsQuery } from '../src/openDart/financialQuery.js';
import {
  mapFinancialStatements,
  MAX_FINANCIAL_ROWS,
  normalizeFinancialAmount,
  STANDARD_ACCOUNT_CODE_UNUSED,
} from '../src/openDart/mappers/financialStatementMapper.js';
import { OpenDartHttpClient } from '../src/openDart/openDartHttpClient.js';
import {
  MAX_FINANCIAL_JSON_BYTES,
  OpenDartFinancialStatementProvider,
} from '../src/openDart/providers/financialStatementProvider.js';
import {
  financialResponse,
  financialRow,
  SYNTHETIC_CORP_CODE,
  SYNTHETIC_RECEIPT,
  SYNTHETIC_SYMBOL,
} from './fixtures/openDartFinancial.js';

function map(
  rows = [financialRow()],
  reportCode: FinancialReportCode = '11013',
  resolvedFsDiv: FinancialStatementDivision = 'CFS',
) {
  return mapFinancialStatements({
    symbol: SYNTHETIC_SYMBOL,
    corpCode: SYNTHETIC_CORP_CODE,
    businessYear: '2026',
    reportCode,
    resolvedFsDiv,
    raw: financialResponse(rows),
  });
}

test('financial query accepts only supported specific reports and exact uppercase divisions', () => {
  const now = new Date('2026-07-26T00:00:00Z');
  assert.deepEqual(
    parseFinancialStatementsQuery(
      { businessYear: '2026', reportCode: '11013', fsDiv: 'CFS' },
      now,
    ),
    { businessYear: '2026', reportCode: '11013', fsDiv: 'CFS' },
  );
  for (const raw of [
    {},
    { businessYear: '2014', reportCode: '11013', fsDiv: 'CFS' },
    { businessYear: '2027', reportCode: '11013', fsDiv: 'CFS' },
    { businessYear: '26', reportCode: '11013', fsDiv: 'CFS' },
    { businessYear: '2026', reportCode: 'latest', fsDiv: 'CFS' },
    { businessYear: '2026', reportCode: '11013', fsDiv: 'cfs' },
  ]) {
    assert.throws(
      () => parseFinancialStatementsQuery(raw, now),
      (error: OpenDartError) => error.code === 'INVALID_FINANCIAL_QUERY',
    );
  }
});

test('mapper preserves quarterly statement semantics, provenance, large amounts, and dimensions', () => {
  const result = map([
    financialRow(),
    financialRow({
      sj_div: 'IS',
      sj_nm: '손익계산서',
      account_id: STANDARD_ACCOUNT_CODE_UNUSED,
      account_nm: '합성 손익',
      account_detail: 'unexpected-dimension',
      thstrm_amount: '123',
      thstrm_add_amount: '1,234',
      frmtrm_q_nm: '합성 비교분기',
      frmtrm_q_amount: '100',
      frmtrm_add_amount: '1,000',
      ord: 'not-an-order',
      currency: 'USD',
    }),
    financialRow({
      sj_div: 'SCE',
      sj_nm: '자본변동표',
      account_id: null,
      account_nm: '합성 자본 변동',
      account_detail: 'member=synthetic',
      thstrm_amount: '0',
      ord: '',
    }),
  ]);

  assert.equal(result.periodKind, 'Q1');
  assert.equal(result.receiptNumber, SYNTHETIC_RECEIPT);
  assert.equal(result.lines[0]?.currentAmount, '9007199254740993');
  assert.equal(typeof result.lines[0]?.currentAmount, 'string');
  assert.equal(result.lines[0]?.previousAmount, '-1234');
  assert.equal(result.lines[0]?.accountIdKind, 'standard');
  assert.equal(result.lines[0]?.accountDetail, null);
  assert.equal(result.lines[1]?.accountId, null);
  assert.equal(result.lines[1]?.accountIdKind, 'standard-code-unused');
  assert.equal(result.lines[1]?.currentCumulativeAmount, '1234');
  assert.equal(result.lines[1]?.previousComparableQuarterAmount, '100');
  assert.equal(result.lines[1]?.previousCumulativeAmount, '1000');
  assert.equal(result.lines[1]?.order, null);
  assert.equal(result.lines[2]?.accountIdKind, 'missing');
  assert.equal(result.lines[2]?.accountDetail, 'member=synthetic');
  assert.deepEqual(result.currencies, ['KRW', 'USD']);
  assert.equal(result.warnings.some(warning => warning.code === 'BLANK_AMOUNT'), true);
  assert.equal(result.warnings.some(warning => warning.code === 'DASH_AMOUNT'), true);
  assert.equal(result.warnings.some(warning => warning.code === 'INVALID_ORDER'), true);
  assert.equal(result.warnings.some(warning => warning.code === 'MULTIPLE_CURRENCIES'), true);
  assert.equal(result.warnings.some(warning => warning.code === 'UNEXPECTED_ACCOUNT_DETAIL'), true);
});

test('mapper retains annual, OFS, BS, CF, and CIS fields without canonical metric extraction', () => {
  const annual = map([
    financialRow({
      reprt_code: '11011',
      sj_div: 'CF',
      sj_nm: '현금흐름표',
      bfefrmtrm_nm: '합성 전전기',
      bfefrmtrm_amount: '7,000',
    }),
    financialRow({
      reprt_code: '11011',
      sj_div: 'CIS',
      sj_nm: '포괄손익계산서',
      account_id: 'entity-specific-account',
      account_nm: '합성 포괄손익',
    }),
  ], '11011', 'OFS');
  assert.equal(annual.periodKind, 'FY');
  assert.equal(annual.lines[0]?.statementType, 'CF');
  assert.equal(annual.lines[0]?.priorPeriodAmount, '7000');
  assert.equal(annual.lines[0]?.fsDiv, 'OFS');
  assert.equal(annual.lines[1]?.accountIdKind, 'unknown');

  const periods: Array<[FinancialReportCode, string]> = [
    ['11012', 'H1'],
    ['11014', 'Q3'],
  ];
  for (const [code, kind] of periods) {
    assert.equal(map([financialRow({ reprt_code: code })], code).periodKind, kind);
  }
});

test('amount parser maps blank and dash to null and rejects malformed financial values', () => {
  assert.equal(normalizeFinancialAmount(undefined), null);
  assert.equal(normalizeFinancialAmount('  '), null);
  assert.equal(normalizeFinancialAmount('-'), null);
  assert.equal(normalizeFinancialAmount('1,234'), '1234');
  assert.equal(normalizeFinancialAmount('-1234'), '-1234');
  for (const value of ['1,23,456', '123.45', '12abc', '+123', '(123)', 123]) {
    assert.throws(
      () => normalizeFinancialAmount(value),
      (error: OpenDartError) => error.code === 'FINANCIAL_ACCOUNT_VALUE_INVALID',
    );
  }
});

test('mapper rejects malformed amount values without silently repairing them', () => {
  for (const value of ['1,23,456', '123.45']) {
    assert.throws(
      () => map([financialRow({ thstrm_amount: value })]),
      (error: OpenDartError) => error.code === 'FINANCIAL_ACCOUNT_VALUE_INVALID',
    );
  }
});

test('mapper rejects row request mismatches, unknown statements, and multiple receipts', () => {
  const invalidRows = [
    financialRow({ corp_code: '00999999' }),
    financialRow({ bsns_year: '2025' }),
    financialRow({ reprt_code: '11011' }),
    financialRow({ sj_div: 'UNKNOWN' }),
    financialRow({ account_nm: '' }),
    financialRow({ rcept_no: 'bad' }),
  ];
  for (const row of invalidRows) {
    assert.throws(
      () => map([row]),
      (error: OpenDartError) => error.code === 'FINANCIAL_RESPONSE_INCONSISTENT',
    );
  }
  assert.throws(
    () => map([
      financialRow(),
      financialRow({ rcept_no: '20260726000002' }),
    ]),
    (error: OpenDartError) => error.code === 'FINANCIAL_RESPONSE_INCONSISTENT',
  );
});

test('mapper enforces list shape, non-empty receipt consistency, and the 5000-row ceiling', () => {
  const base = {
    symbol: SYNTHETIC_SYMBOL,
    corpCode: SYNTHETIC_CORP_CODE,
    businessYear: '2026',
    reportCode: '11013' as const,
    resolvedFsDiv: 'CFS' as const,
  };
  for (const raw of [
    { status: '000' },
    { status: '000', list: {} },
    { status: '000', list: [] },
    { status: '000', list: Array.from({ length: MAX_FINANCIAL_ROWS + 1 }, financialRow) },
  ]) {
    assert.throws(() => mapFinancialStatements({ ...base, raw }));
  }
});

test('financial provider uses the official operation and request fields', async () => {
  assert.equal(MAX_FINANCIAL_JSON_BYTES, 5 * 1024 * 1024);
  let requested: URL | undefined;
  const client = new OpenDartHttpClient({
    apiKey: 'synthetic-secret',
    baseUrl: 'https://example.test',
    timeoutMs: 100,
    fetchImpl: async input => {
      requested = new URL(String(input));
      return new Response(JSON.stringify({ status: '013' }));
    },
  });
  const provider = new OpenDartFinancialStatementProvider(client);
  const response = await provider.getFinancialStatements({
    corpCode: SYNTHETIC_CORP_CODE,
    businessYear: '2026',
    reportCode: '11013',
    fsDiv: 'CFS',
  });
  assert.equal(response.status, '013');
  assert.equal(requested?.pathname, '/api/fnlttSinglAcntAll.json');
  assert.equal(requested?.searchParams.get('corp_code'), SYNTHETIC_CORP_CODE);
  assert.equal(requested?.searchParams.get('bsns_year'), '2026');
  assert.equal(requested?.searchParams.get('reprt_code'), '11013');
  assert.equal(requested?.searchParams.get('fs_div'), 'CFS');
});
