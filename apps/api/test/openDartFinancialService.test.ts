import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCacheStore } from '../src/cache.js';
import { CorpCodeArchiveParser } from '../src/openDart/corpCode/corpCodeArchiveParser.js';
import { createCorpCodeSnapshot } from '../src/openDart/corpCode/corpCodeIndexStore.js';
import { CorpCodeResolver } from '../src/openDart/corpCode/corpCodeResolver.js';
import {
  CorpCodeIndexSnapshot,
  CorpCodeRecord,
  FinancialStatementDivision,
} from '../src/openDart/contracts.js';
import { OpenDartError } from '../src/openDart/errors.js';
import {
  OPENDART_FINANCIAL_CACHE_POLICY,
  OpenDartFinancialService,
} from '../src/openDart/openDartFinancialService.js';
import {
  FinancialStatementProvider,
  FinancialStatementProviderInput,
} from '../src/openDart/providers/financialStatementProvider.js';
import {
  financialResponse,
  financialRow,
  noFinancialData,
  SYNTHETIC_CORP_CODE,
  SYNTHETIC_SYMBOL,
} from './fixtures/openDartFinancial.js';

const record: CorpCodeRecord = {
  corpCode: SYNTHETIC_CORP_CODE,
  corpName: '합성기업',
  corpEngName: 'Synthetic Company',
  stockCode: SYNTHETIC_SYMBOL,
  companyInfoModifiedDate: '2026-07-01',
};
const query = { businessYear: '2026', reportCode: '11013' as const, fsDiv: 'CFS' as const };

class IndexStore {
  constructor(public snapshot: CorpCodeIndexSnapshot) {}
  async load() { return this.snapshot; }
  async save(snapshot: CorpCodeIndexSnapshot) { this.snapshot = snapshot; }
}

function resolverAt(now: Date, stale = false, records = [record]) {
  const refreshedAt = new Date(now.getTime() - (stale ? 2 : 0) * 24 * 60 * 60_000).toISOString();
  const source = {
    async fetchArchive(): Promise<Buffer> {
      throw new OpenDartError('OPENDART_UNAVAILABLE', 'corp-code', true);
    },
  };
  const parser = { async parse(): Promise<CorpCodeRecord[]> { return records; } } as CorpCodeArchiveParser;
  return new CorpCodeResolver(
    source,
    parser,
    new IndexStore(createCorpCodeSnapshot(records, refreshedAt)),
    () => now,
  );
}

function provider(
  load: (input: FinancialStatementProviderInput) => ReturnType<FinancialStatementProvider['getFinancialStatements']>,
): FinancialStatementProvider {
  return { getFinancialStatements: load };
}

test('financial service caches CFS success and coalesces same-key concurrent misses', async () => {
  const now = new Date('2026-07-26T00:00:00Z');
  let calls = 0;
  const service = new OpenDartFinancialService(
    resolverAt(now),
    provider(async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return financialResponse();
    }),
    new MemoryCacheStore(() => now.getTime()),
    () => now,
  );
  const responses = await Promise.all([
    service.getFinancialStatements(SYNTHETIC_SYMBOL, query),
    service.getFinancialStatements(SYNTHETIC_SYMBOL, query),
  ]);
  await service.getFinancialStatements(SYNTHETIC_SYMBOL, query);
  assert.equal(calls, 1);
  assert.equal(responses[0]?.report.requestedFsDiv, 'CFS');
  assert.equal(responses[0]?.report.resolvedFsDiv, 'CFS');
  assert.equal(responses[0]?.report.fallbackFromFsDiv, null);
  assert.equal(responses[0]?.metadata.fallback, false);
});

test('financial service resolves CFS 013 to one OFS request for all concurrent callers', async () => {
  const now = new Date('2026-07-26T00:00:00Z');
  const calls: FinancialStatementDivision[] = [];
  const service = new OpenDartFinancialService(
    resolverAt(now),
    provider(async input => {
      calls.push(input.fsDiv);
      await new Promise(resolve => setTimeout(resolve, 5));
      return input.fsDiv === 'CFS'
        ? noFinancialData()
        : financialResponse([financialRow()]);
    }),
  );
  const [response] = await Promise.all([
    service.getFinancialStatements(SYNTHETIC_SYMBOL, query),
    service.getFinancialStatements(SYNTHETIC_SYMBOL, query),
    service.getFinancialStatements(SYNTHETIC_SYMBOL, query),
  ]);
  assert.deepEqual(calls, ['CFS', 'OFS']);
  assert.equal(response.report.requestedFsDiv, 'CFS');
  assert.equal(response.report.resolvedFsDiv, 'OFS');
  assert.equal(response.report.fallbackFromFsDiv, 'CFS');
  assert.equal(response.lines[0]?.fsDiv, 'OFS');
  assert.equal(response.metadata.fallback, false);
});

test('financial service maps final 013 to 404 and never substitutes stale data', async () => {
  let millis = Date.parse('2026-07-26T00:00:00Z');
  const now = () => new Date(millis);
  let absent = false;
  const service = new OpenDartFinancialService(
    resolverAt(now()),
    provider(async input => absent || input.fsDiv === 'OFS' ? noFinancialData() : financialResponse()),
    new MemoryCacheStore(() => millis),
    now,
  );
  await service.getFinancialStatements(SYNTHETIC_SYMBOL, query);
  millis += OPENDART_FINANCIAL_CACHE_POLICY.freshMs + 1;
  absent = true;
  await assert.rejects(
    service.getFinancialStatements(SYNTHETIC_SYMBOL, query),
    (error: OpenDartError) => error.code === 'FINANCIAL_REPORT_NOT_FOUND'
      && error.httpStatus === 404,
  );
  await assert.rejects(
    service.getFinancialStatements(SYNTHETIC_SYMBOL, { ...query, fsDiv: 'OFS' }),
    (error: OpenDartError) => error.code === 'FINANCIAL_REPORT_NOT_FOUND',
  );
});

test('financial service never attempts OFS after CFS provider or mapping failures', async () => {
  const now = new Date('2026-07-26T00:00:00Z');
  for (const failure of [
    new OpenDartError('OPENDART_TIMEOUT', 'financial-statements', true),
    new OpenDartError('OPENDART_AUTH_ERROR', 'financial-statements', false, '010'),
    new OpenDartError('OPENDART_RATE_LIMITED', 'financial-statements', true, '020'),
  ]) {
    const divisions: FinancialStatementDivision[] = [];
    const service = new OpenDartFinancialService(
      resolverAt(now),
      provider(async input => {
        divisions.push(input.fsDiv);
        throw failure;
      }),
    );
    await assert.rejects(service.getFinancialStatements(SYNTHETIC_SYMBOL, query));
    assert.deepEqual(divisions, ['CFS']);
  }
  const divisions: FinancialStatementDivision[] = [];
  const malformed = new OpenDartFinancialService(
    resolverAt(now),
    provider(async input => {
      divisions.push(input.fsDiv);
      return financialResponse([financialRow({ thstrm_amount: '1.2' })]);
    }),
  );
  await assert.rejects(malformed.getFinancialStatements(SYNTHETIC_SYMBOL, query));
  assert.deepEqual(divisions, ['CFS']);
});

test('financial service uses same-key stale only for provider availability failures', async () => {
  let millis = Date.parse('2026-07-26T00:00:00Z');
  const now = () => new Date(millis);
  let fail = false;
  const service = new OpenDartFinancialService(
    resolverAt(now(), true),
    provider(async () => {
      if (fail) throw new OpenDartError('OPENDART_UNAVAILABLE', 'financial-statements', true, '800');
      return financialResponse();
    }),
    new MemoryCacheStore(() => millis),
    now,
  );
  await service.getFinancialStatements(SYNTHETIC_SYMBOL, query);
  millis += OPENDART_FINANCIAL_CACHE_POLICY.freshMs + 1;
  fail = true;
  const stale = await service.getFinancialStatements(SYNTHETIC_SYMBOL, query);
  assert.equal(stale.metadata.stale, true);
  assert.deepEqual(
    stale.metadata.staleReasons,
    ['corp-code-index', 'financial-statements-cache'],
  );
});

test('financial cache keys isolate year, report code, and requested division', async () => {
  const now = new Date('2026-07-26T00:00:00Z');
  const calls: string[] = [];
  const service = new OpenDartFinancialService(
    resolverAt(now),
    provider(async input => {
      calls.push(`${input.businessYear}:${input.reportCode}:${input.fsDiv}`);
      return financialResponse([
        financialRow({
          bsns_year: input.businessYear,
          reprt_code: input.reportCode,
        }),
      ]);
    }),
  );
  await service.getFinancialStatements(SYNTHETIC_SYMBOL, query);
  await service.getFinancialStatements(SYNTHETIC_SYMBOL, {
    businessYear: '2025',
    reportCode: '11013',
    fsDiv: 'CFS',
  });
  await service.getFinancialStatements(SYNTHETIC_SYMBOL, {
    businessYear: '2026',
    reportCode: '11011',
    fsDiv: 'CFS',
  });
  await service.getFinancialStatements(SYNTHETIC_SYMBOL, {
    businessYear: '2026',
    reportCode: '11013',
    fsDiv: 'OFS',
  });
  assert.equal(calls.length, 4);
});

test('failed financial single-flight entries are removed for a later retry', async () => {
  const now = new Date('2026-07-26T00:00:00Z');
  let calls = 0;
  const service = new OpenDartFinancialService(
    resolverAt(now),
    provider(async () => {
      calls += 1;
      if (calls === 1) throw new OpenDartError('OPENDART_TIMEOUT', 'financial-statements', true);
      return financialResponse();
    }),
  );
  await assert.rejects(service.getFinancialStatements(SYNTHETIC_SYMBOL, query));
  const response = await service.getFinancialStatements(SYNTHETIC_SYMBOL, query);
  assert.equal(response.lines.length, 1);
  assert.equal(calls, 2);
});

test('financial service distinguishes invalid symbols and missing corp-code mappings', async () => {
  const now = new Date('2026-07-26T00:00:00Z');
  const service = new OpenDartFinancialService(
    resolverAt(now, false, []),
    provider(async () => financialResponse()),
  );
  await assert.rejects(
    service.getFinancialStatements('ABC', query),
    (error: OpenDartError) => error.code === 'INVALID_SYMBOL',
  );
  await assert.rejects(
    service.getFinancialStatements(SYNTHETIC_SYMBOL, query),
    (error: OpenDartError) => error.code === 'CORP_CODE_NOT_FOUND',
  );
});
