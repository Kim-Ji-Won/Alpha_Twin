import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCacheStore } from '../src/cache.js';
import { CorpCodeResolution, DisclosureQueryDto } from '../src/openDart/contracts.js';
import { OpenDartError } from '../src/openDart/errors.js';
import {
  fiscalPeriodMonth,
  mapLatestFinancialPeriod,
  parseLatestFinancialPeriod,
  parseLatestFinancialQuery,
} from '../src/openDart/latestFinancial/latestFinancialParser.js';
import {
  LATEST_FINANCIAL_REPORT_CACHE_POLICY,
  LatestFinancialReportResolver,
} from '../src/openDart/latestFinancial/latestFinancialReportResolver.js';
import { CompanyDisclosureProvider } from '../src/openDart/providers/openDartProvider.js';
import {
  LATEST_CORP_CODE,
  LATEST_RECEIPT,
  LATEST_SYMBOL,
  latestCorpRecord,
  latestDisclosurePage,
  latestDisclosureRow,
  latestProfile,
} from './fixtures/latestFinancial.js';

const baseNow = Date.parse('2026-07-26T00:00:00.000Z');

function corpLookup(
  record = latestCorpRecord,
  indexStale = false,
): { resolveByStockCode(symbol: string): Promise<CorpCodeResolution> } {
  return {
    async resolveByStockCode(symbol) {
      assert.equal(symbol, LATEST_SYMBOL);
      return {
        record,
        indexStale,
        indexRefreshedAt: '2026-07-26T00:00:00.000Z',
      };
    },
  };
}

function profileLookup(fiscalMonth: string | null = '12') {
  return {
    async getCompanyProfile() {
      return latestProfile(fiscalMonth);
    },
  };
}

function providerFor(
  load: (
    query: DisclosureQueryDto,
    call: number,
  ) => ReturnType<CompanyDisclosureProvider['getDisclosures']>,
): CompanyDisclosureProvider {
  let call = 0;
  return {
    async getCompanyProfile() {
      throw new Error('Profile calls must use OpenDartService');
    },
    async getDisclosures(_corpCode, query) {
      call += 1;
      return load(query, call);
    },
  };
}

function categoryPage(
  query: DisclosureQueryDto,
  reportName = '분기보고서 (2026.03)',
  overrides: Record<string, unknown> = {},
) {
  return latestDisclosurePage(query, [
    latestDisclosureRow({ report_nm: reportName, ...overrides }),
  ]);
}

function resolverWith(
  provider: CompanyDisclosureProvider,
  options: {
    millis?: () => number;
    fiscalMonth?: string | null;
    corp?: ReturnType<typeof corpLookup>;
    cache?: MemoryCacheStore;
  } = {},
) {
  const millis = options.millis ?? (() => baseNow);
  return new LatestFinancialReportResolver(
    options.corp ?? corpLookup(),
    profileLookup(options.fiscalMonth),
    provider,
    options.cache ?? new MemoryCacheStore(millis),
    () => new Date(millis()),
  );
}

test('latest query and strict period parser reject guesses and unsupported input', () => {
  assert.deepEqual(parseLatestFinancialQuery({}), { fsDiv: 'CFS' });
  assert.deepEqual(parseLatestFinancialQuery({ fsDiv: 'OFS' }), { fsDiv: 'OFS' });
  for (const raw of [
    { fsDiv: 'cfs' },
    { fsDiv: '' },
    { businessYear: '2026' },
    { reportCode: 'latest' },
    { fsDiv: ['CFS'] },
  ]) {
    assert.throws(
      () => parseLatestFinancialQuery(raw),
      (error: OpenDartError) => error.code === 'INVALID_LATEST_FINANCIAL_QUERY',
    );
  }
  assert.deepEqual(parseLatestFinancialPeriod('[기재정정]사업보고서 (2025.12)'), {
    businessYear: '2025',
    periodMonth: 12,
    periodEnd: '2025-12',
  });
  for (const name of [
    '분기보고서',
    '분기보고서 (2026)',
    '분기보고서 (2026.13)',
    '분기보고서 (abcd.ef)',
    '분기보고서 (2026.03) (2026.06)',
    '분기보고서 (2026.03) 추가문구',
  ]) {
    assert.throws(
      () => parseLatestFinancialPeriod(name),
      (error: OpenDartError) => error.code === 'LATEST_FINANCIAL_REPORT_UNRESOLVED',
    );
  }
});

test('period mapping covers December and non-December fiscal calendars', () => {
  assert.equal(fiscalPeriodMonth(12, 3), 3);
  assert.equal(fiscalPeriodMonth(3, 9), 12);
  const cases = [
    ['A001', '사업보고서 (2025.12)', 12, '11011', 'FY'],
    ['A002', '반기보고서 (2026.06)', 12, '11012', 'H1'],
    ['A003', '분기보고서 (2026.03)', 12, '11013', 'Q1'],
    ['A003', '분기보고서 (2025.09)', 12, '11014', 'Q3'],
    ['A001', '사업보고서 (2026.03)', 3, '11011', 'FY'],
    ['A003', '분기보고서 (2025.06)', 3, '11013', 'Q1'],
    ['A002', '반기보고서 (2025.09)', 3, '11012', 'H1'],
    ['A003', '분기보고서 (2025.12)', 3, '11014', 'Q3'],
  ] as const;
  for (const [detail, name, fiscal, reportCode, kind] of cases) {
    const mapped = mapLatestFinancialPeriod(detail, name, fiscal);
    assert.equal(mapped.reportCode, reportCode);
    assert.equal(mapped.periodKind, kind);
  }
  for (const [detail, name] of [
    ['A001', '사업보고서 (2025.11)'],
    ['A002', '반기보고서 (2026.05)'],
    ['A003', '분기보고서 (2026.06)'],
  ] as const) {
    assert.throws(
      () => mapLatestFinancialPeriod(detail, name, 12),
      (error: OpenDartError) => error.code === 'LATEST_FINANCIAL_REPORT_UNRESOLVED',
    );
  }
});

test('resolver issues exactly three bounded final periodic queries and sorts globally', async () => {
  const queries: DisclosureQueryDto[] = [];
  const provider = providerFor(async query => {
    queries.push(query);
    if (query.detailCategory === 'A001') {
      return categoryPage(query, '사업보고서 (2025.12)', {
        rcept_dt: '20260320',
        rcept_no: '20260320000001',
      });
    }
    if (query.detailCategory === 'A002') return { status: '013' };
    return categoryPage(query, '분기보고서 (2026.03)');
  });
  const result = await resolverWith(provider).resolve(LATEST_SYMBOL);
  assert.equal(result.disclosureDetailType, 'A003');
  assert.equal(result.reportCode, '11013');
  assert.equal(result.periodKind, 'Q1');
  assert.equal(result.periodEnd, '2026-03');
  assert.equal(result.filing.receiptNumber, LATEST_RECEIPT);
  assert.deepEqual(queries.map(query => query.detailCategory), ['A001', 'A002', 'A003']);
  for (const query of queries) {
    assert.equal(query.category, 'A');
    assert.equal(query.finalOnly, true);
    assert.equal(query.page, 1);
    assert.equal(query.pageSize, 100);
    assert.equal(
      (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`))
        / (24 * 60 * 60_000),
      365,
    );
  }
});

test('withdrawn candidates are excluded and a valid newer correction wins', async () => {
  const provider = providerFor(async query => {
    if (query.detailCategory !== 'A003') return { status: '013' };
    return latestDisclosurePage(query, [
      latestDisclosureRow({
        rcept_no: '20260516000001',
        rcept_dt: '20260516',
        report_nm: '[기재정정]분기보고서 (2026.03)',
        rm: '',
      }),
      latestDisclosureRow({ rm: '정' }),
      latestDisclosureRow({
        rcept_no: '20260517000001',
        rcept_dt: '20260517',
        rm: '철',
      }),
    ]);
  });
  const result = await resolverWith(provider).resolve(LATEST_SYMBOL);
  assert.equal(result.filing.receiptNumber, '20260516000001');
  assert.equal(result.filing.correctionType, 'content-correction');
});

test('superseded-only and withdrawn-only candidates are explicit domain failures', async () => {
  for (const [remark, code] of [
    ['정', 'LATEST_FINANCIAL_REPORT_UNRESOLVED'],
    ['철', 'LATEST_FINANCIAL_REPORT_NOT_FOUND'],
  ] as const) {
    const provider = providerFor(async query =>
      query.detailCategory === 'A003'
        ? categoryPage(query, '분기보고서 (2026.03)', { rm: remark })
        : { status: '013' });
    await assert.rejects(
      resolverWith(provider).resolve(LATEST_SYMBOL),
      (error: OpenDartError) => error.code === code,
    );
  }
});

test('newest malformed candidate never downgrades to an older valid report', async () => {
  const provider = providerFor(async query => {
    if (query.detailCategory === 'A001') {
      return categoryPage(query, '사업보고서 (2025.12)', {
        rcept_dt: '20260320',
        rcept_no: '20260320000001',
      });
    }
    if (query.detailCategory === 'A003') {
      return categoryPage(query, '분기보고서', {
        rcept_dt: '20260515',
        rcept_no: LATEST_RECEIPT,
      });
    }
    return { status: '013' };
  });
  await assert.rejects(
    resolverWith(provider).resolve(LATEST_SYMBOL),
    (error: OpenDartError) => error.code === 'LATEST_FINANCIAL_REPORT_UNRESOLVED',
  );
});

test('missing fiscal month and oversized category pages fail without guessing', async () => {
  const provider = providerFor(async query =>
    query.detailCategory === 'A003' ? categoryPage(query) : { status: '013' });
  await assert.rejects(
    resolverWith(provider, { fiscalMonth: null }).resolve(LATEST_SYMBOL),
    (error: OpenDartError) => error.code === 'LATEST_FINANCIAL_REPORT_UNRESOLVED',
  );
  const oversized = providerFor(async query =>
    latestDisclosurePage(query, [latestDisclosureRow()], {
      total_count: 101,
      total_page: 2,
    }));
  await assert.rejects(
    resolverWith(oversized).resolve(LATEST_SYMBOL),
    (error: OpenDartError) =>
      error.code === 'LATEST_FINANCIAL_REPORT_RESPONSE_INCONSISTENT',
  );
});

test('all status 013 is not found and never uses an existing stale pointer', async () => {
  let millis = baseNow;
  let empty = false;
  const cache = new MemoryCacheStore(() => millis);
  const provider = providerFor(async query =>
    empty
      ? { status: '013' }
      : query.detailCategory === 'A003' ? categoryPage(query) : { status: '013' });
  const resolver = resolverWith(provider, { millis: () => millis, cache });
  await resolver.resolve(LATEST_SYMBOL);
  millis += LATEST_FINANCIAL_REPORT_CACHE_POLICY.freshMs + 1;
  empty = true;
  await assert.rejects(
    resolver.resolve(LATEST_SYMBOL),
    (error: OpenDartError) => error.code === 'LATEST_FINANCIAL_REPORT_NOT_FOUND',
  );
});

test('latest pointer cache is fresh for 30m and stale only on availability failures', async () => {
  let millis = baseNow;
  let calls = 0;
  let failure: OpenDartError | undefined;
  const provider = providerFor(async query => {
    calls += 1;
    if (failure) throw failure;
    return query.detailCategory === 'A003' ? categoryPage(query) : { status: '013' };
  });
  const resolver = resolverWith(provider, { millis: () => millis });
  await resolver.resolve(LATEST_SYMBOL);
  await resolver.resolve(LATEST_SYMBOL);
  assert.equal(calls, 3);
  millis += LATEST_FINANCIAL_REPORT_CACHE_POLICY.freshMs + 1;
  failure = new OpenDartError('OPENDART_TIMEOUT', 'disclosures', true);
  const stale = await resolver.resolve(LATEST_SYMBOL);
  assert.equal(stale.metadata.stale, true);
  assert.deepEqual(stale.metadata.staleReasons, ['latest-report-cache']);

  for (const code of ['OPENDART_AUTH_ERROR', 'OPENDART_BAD_RESPONSE'] as const) {
    let localMillis = baseNow;
    let fail = false;
    const local = resolverWith(providerFor(async query => {
      if (fail) throw new OpenDartError(code, 'disclosures', false);
      return query.detailCategory === 'A003' ? categoryPage(query) : { status: '013' };
    }), { millis: () => localMillis });
    await local.resolve(LATEST_SYMBOL);
    localMillis += LATEST_FINANCIAL_REPORT_CACHE_POLICY.freshMs + 1;
    fail = true;
    await assert.rejects(local.resolve(LATEST_SYMBOL));
  }
});

test('rate-limit and unavailable failures may use a valid stale pointer', async () => {
  for (const code of ['OPENDART_RATE_LIMITED', 'OPENDART_UNAVAILABLE'] as const) {
    let millis = baseNow;
    let fail = false;
    const resolver = resolverWith(providerFor(async query => {
      if (fail) throw new OpenDartError(code, 'disclosures', true);
      return query.detailCategory === 'A003' ? categoryPage(query) : { status: '013' };
    }), { millis: () => millis });
    await resolver.resolve(LATEST_SYMBOL);
    millis += LATEST_FINANCIAL_REPORT_CACHE_POLICY.freshMs + 1;
    fail = true;
    const stale = await resolver.resolve(LATEST_SYMBOL);
    assert.deepEqual(stale.metadata.staleReasons, ['latest-report-cache']);
  }
});

test('latest pointer cache isolates corp codes even when a symbol mapping changes', async () => {
  let currentCorpCode = LATEST_CORP_CODE;
  let calls = 0;
  const corp = {
    async resolveByStockCode() {
      return {
        record: { ...latestCorpRecord, corpCode: currentCorpCode },
        indexStale: false,
        indexRefreshedAt: '2026-07-26T00:00:00.000Z',
      };
    },
  };
  const profiles = {
    async getCompanyProfile() {
      const profile = latestProfile();
      return {
        ...profile,
        company: { ...profile.company, corpCode: currentCorpCode },
      };
    },
  };
  const provider: CompanyDisclosureProvider = {
    async getCompanyProfile() {
      throw new Error('Profile calls must use OpenDartService');
    },
    async getDisclosures(corpCode, query) {
      calls += 1;
      if (query.detailCategory !== 'A003') return { status: '013' };
      return latestDisclosurePage(query, [
        latestDisclosureRow({ corp_code: corpCode }),
      ]);
    },
  };
  const resolver = new LatestFinancialReportResolver(
    corp,
    profiles,
    provider,
    new MemoryCacheStore(() => baseNow),
    () => new Date(baseNow),
  );
  await resolver.resolve(LATEST_SYMBOL);
  currentCorpCode = '00999999';
  await resolver.resolve(LATEST_SYMBOL);
  assert.equal(calls, 6);
});

test('single-flight shares all three category calls and clears success and failure', async () => {
  let calls = 0;
  let fail = false;
  const provider = providerFor(async query => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    if (fail) throw new OpenDartError('OPENDART_UNAVAILABLE', 'disclosures', true);
    return query.detailCategory === 'A003' ? categoryPage(query) : { status: '013' };
  });
  const resolver = resolverWith(provider);
  await Promise.all(Array.from({ length: 5 }, () => resolver.resolve(LATEST_SYMBOL)));
  assert.equal(calls, 3);

  let millis = baseNow + LATEST_FINANCIAL_REPORT_CACHE_POLICY.staleMs + 1;
  const retryProvider = providerFor(async query => {
    calls += 1;
    if (fail) throw new OpenDartError('OPENDART_UNAVAILABLE', 'disclosures', true);
    return query.detailCategory === 'A003' ? categoryPage(query) : { status: '013' };
  });
  const retry = resolverWith(retryProvider, { millis: () => millis });
  fail = true;
  await Promise.allSettled([retry.resolve(LATEST_SYMBOL), retry.resolve(LATEST_SYMBOL)]);
  const afterFailure = calls;
  fail = false;
  await retry.resolve(LATEST_SYMBOL);
  assert.equal(calls, afterFailure + 3);
  millis += 1;
});
