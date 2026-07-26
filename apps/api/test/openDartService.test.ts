import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCacheStore } from '../src/cache.js';
import { CorpCodeArchiveParser } from '../src/openDart/corpCode/corpCodeArchiveParser.js';
import { createCorpCodeSnapshot } from '../src/openDart/corpCode/corpCodeIndexStore.js';
import { CorpCodeResolver } from '../src/openDart/corpCode/corpCodeResolver.js';
import { CorpCodeIndexSnapshot, CorpCodeRecord, DisclosureQueryDto } from '../src/openDart/contracts.js';
import { OpenDartError } from '../src/openDart/errors.js';
import { mapCompanyProfile } from '../src/openDart/mappers/companyProfileMapper.js';
import { mapDisclosurePage } from '../src/openDart/mappers/disclosureMapper.js';
import { OpenDartHttpClient } from '../src/openDart/openDartHttpClient.js';
import { OPENDART_CACHE_POLICY, OpenDartService } from '../src/openDart/openDartService.js';
import { parseDisclosureQuery } from '../src/openDart/query.js';
import { CompanyDisclosureProvider, OpenDartProvider } from '../src/openDart/providers/openDartProvider.js';

const record: CorpCodeRecord = {
  corpCode: '00126380', corpName: '삼성전자', corpEngName: 'Samsung Electronics', stockCode: '005930',
  companyInfoModifiedDate: '2026-07-01',
};
const query: DisclosureQueryDto = {
  from: '2026-04-22', to: '2026-07-20', finalOnly: false,
  category: null, detailCategory: null, page: 1, pageSize: 20,
};

const profileRaw = {
  status: '000', corp_name: '삼성전자 주식회사', corp_name_eng: 'Samsung Electronics Co., Ltd.',
  stock_name: '삼성전자', stock_code: '005930', ceo_nm: '테스트 대표', corp_cls: 'Y',
  induty_code: '264', est_dt: '19690113', acc_mt: '12', hm_url: 'www.samsung.com',
  ir_url: 'javascript:alert(1)', jurir_no: 'private-jurir', bizr_no: 'private-bizr',
  adres: 'private-address', phn_no: 'private-phone', fax_no: 'private-fax',
};

function disclosureRaw(overrides: Record<string, unknown> = {}) {
  return {
    corp_cls: 'Y', corp_name: '삼성전자', corp_code: '00126380', stock_code: '005930',
    report_nm: '[기재정정]사업보고서', rcept_no: '20260720000001', flr_nm: '삼성전자',
    rcept_dt: '20260720', rm: '정철연', ...overrides,
  };
}

class IndexStore {
  constructor(public snapshot: CorpCodeIndexSnapshot) {}
  async load() { return this.snapshot; }
  async save(snapshot: CorpCodeIndexSnapshot) { this.snapshot = snapshot; }
}

function resolverAt(now: Date, refreshedAt = now.toISOString(), records = [record]) {
  const source = { async fetchArchive(): Promise<Buffer> { throw new OpenDartError('OPENDART_UNAVAILABLE', 'corp-code', true); } };
  const parser = { async parse(): Promise<CorpCodeRecord[]> { return records; } } as CorpCodeArchiveParser;
  return new CorpCodeResolver(source, parser, new IndexStore(createCorpCodeSnapshot(records, refreshedAt)), () => now);
}

test('company profile mapper allowlists fields, normalizes values, and excludes private data', () => {
  const mapped = mapCompanyProfile('005930', record, profileRaw);
  assert.equal(mapped.market, 'KOSPI');
  assert.equal(mapped.establishedDate, '1969-01-13');
  assert.equal(mapped.websiteUrl, 'https://www.samsung.com/');
  assert.equal(mapped.irUrl, null);
  const serialized = JSON.stringify(mapped);
  for (const secret of ['private-jurir', 'private-bizr', 'private-address', 'private-phone', 'private-fax']) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(mapCompanyProfile('005930', record, { ...profileRaw, corp_cls: 'Z', est_dt: '20260230', acc_mt: '13' }).market, 'UNKNOWN');
  assert.throws(() => mapCompanyProfile('005930', record, { ...profileRaw, stock_code: '000660' }), OpenDartError);
});

test('disclosure mapper preserves correction and remark semantics, de-duplicates, and sorts', () => {
  const page = mapDisclosurePage('005930', '00126380', query, {
    status: '000', page_no: '1', page_count: '20', total_count: '3', total_page: '1',
    list: [
      disclosureRaw({ rcept_dt: '20260719', rcept_no: '20260719000001' }),
      disclosureRaw(),
      disclosureRaw(),
    ],
  });
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0]?.correctionType, 'content-correction');
  assert.equal(page.items[0]?.hasSubsequentCorrection, true);
  assert.equal(page.items[0]?.isWithdrawn, true);
  assert.equal(page.items[0]?.includesConsolidated, true);
  assert.match(page.items[0]?.viewerUrl ?? '', /rcpNo=20260720000001$/);

  const unknown = mapDisclosurePage('005930', '00126380', query, {
    status: '000', page_no: 1, page_count: 20, total_count: 1, total_page: 1,
    list: [disclosureRaw({ report_nm: '[새정정]보고서', rm: '정' })],
  });
  assert.equal(unknown.items[0]?.correctionType, 'unknown');
  assert.throws(() => mapDisclosurePage('005930', '00126380', query, { status: '000', page_no: 2, page_count: 20, total_count: 1, total_page: 1, list: [] }), OpenDartError);
});

test('disclosure status 013 is a normal empty page', () => {
  const page = mapDisclosurePage('005930', '00126380', query, { status: '013' });
  assert.deepEqual(page.items, []);
  assert.deepEqual(page.pagination, { page: 1, pageSize: 20, totalCount: 0, totalPages: 0 });
});

test('disclosure query defaults to KST 90 days and rejects unsafe ranges and filters', () => {
  const defaults = parseDisclosureQuery({}, new Date('2026-07-20T00:00:00Z'));
  assert.deepEqual(defaults, { ...query });
  assert.equal(parseDisclosureQuery({ pageSize: '100', category: 'a', detailCategory: 'A001', finalOnly: 'true' }, new Date('2026-07-20T00:00:00Z')).pageSize, 100);
  for (const raw of [
    { pageSize: '101' }, { from: '2025-01-01', to: '2026-07-20' },
    { from: '2026-07-21', to: '2026-07-20' }, { to: '2026-02-30' },
    { category: 'Z' }, { detailCategory: 'DROP TABLE' }, { category: 'B', detailCategory: 'A001' },
    { finalOnly: 'yes' },
  ]) assert.throws(() => parseDisclosureQuery(raw, new Date('2026-07-20T00:00:00Z')), OpenDartError);
});

test('HTTP client maps statuses, malformed bodies, size limits, timeouts, and missing keys', async () => {
  let calls = 0;
  const missing = new OpenDartHttpClient({ baseUrl: 'https://example.test', timeoutMs: 10, fetchImpl: async () => { calls += 1; return new Response(); } });
  await assert.rejects(missing.getJson('company-profile', '/api/company.json', {}), (error: OpenDartError) => error.code === 'OPENDART_NOT_CONFIGURED');
  assert.equal(calls, 0);
  for (const [status, code] of [['010', 'OPENDART_AUTH_ERROR'], ['020', 'OPENDART_RATE_LIMITED'], ['800', 'OPENDART_UNAVAILABLE'], ['100', 'OPENDART_BAD_REQUEST_MAPPING']]) {
    const client = new OpenDartHttpClient({ apiKey: 'fake-secret', baseUrl: 'https://example.test', timeoutMs: 10, fetchImpl: async () => new Response(JSON.stringify({ status })) });
    await assert.rejects(client.getJson('company-profile', '/api/company.json', {}), (error: OpenDartError) => error.code === code);
  }
  const malformed = new OpenDartHttpClient({ apiKey: 'fake', baseUrl: 'https://example.test', timeoutMs: 10, fetchImpl: async () => new Response('<html>bad</html>') });
  await assert.rejects(malformed.getJson('company-profile', '/api/company.json', {}), (error: OpenDartError) => error.code === 'OPENDART_BAD_RESPONSE');
  const large = new OpenDartHttpClient({ apiKey: 'fake', baseUrl: 'https://example.test', timeoutMs: 10, maxJsonBytes: 2, fetchImpl: async () => new Response('{"status":"000"}') });
  await assert.rejects(large.getJson('company-profile', '/api/company.json', {}), (error: OpenDartError) => error.code === 'OPENDART_BAD_RESPONSE');
});

test('provider converts profile/disclosure operations without exposing raw transport fields', async () => {
  const requested: URL[] = [];
  const client = new OpenDartHttpClient({
    apiKey: 'fake-secret', baseUrl: 'https://example.test', timeoutMs: 10,
    fetchImpl: async input => {
      const url = new URL(String(input));
      requested.push(url);
      return new Response(JSON.stringify(url.pathname.endsWith('company.json') ? profileRaw : { status: '013' }));
    },
  });
  const provider = new OpenDartProvider(client);
  await provider.getCompanyProfile('00126380');
  await provider.getDisclosures('00126380', { ...query, finalOnly: true, category: 'A', detailCategory: 'A001', pageSize: 100 });
  assert.equal(requested[0]?.searchParams.get('corp_code'), '00126380');
  assert.equal(requested[1]?.searchParams.get('bgn_de'), '20260422');
  assert.equal(requested[1]?.searchParams.get('last_reprt_at'), 'Y');
  assert.equal(requested[1]?.searchParams.get('pblntf_ty'), null);
  assert.equal(requested[1]?.searchParams.get('pblntf_detail_ty'), 'A001');
  assert.equal(requested[1]?.searchParams.get('page_count'), '100');
});

test('service caches profile and disclosures and coalesces concurrent misses', async () => {
  const now = new Date('2026-07-20T00:00:00Z');
  let profileCalls = 0;
  let disclosureCalls = 0;
  const provider: CompanyDisclosureProvider = {
    async getCompanyProfile() { profileCalls += 1; await new Promise(resolve => setTimeout(resolve, 5)); return profileRaw; },
    async getDisclosures() { disclosureCalls += 1; return { status: '013' }; },
  };
  const service = new OpenDartService(resolverAt(now), provider, new MemoryCacheStore(() => now.getTime()), () => now);
  const profiles = await Promise.all([service.getCompanyProfile('005930'), service.getCompanyProfile('005930')]);
  assert.equal(profileCalls, 1);
  assert.equal(profiles[0]?.metadata.fallback, false);
  await service.getCompanyProfile('005930');
  assert.equal(profileCalls, 1);
  const empty = await service.getDisclosures('005930', query);
  await service.getDisclosures('005930', query);
  assert.equal(disclosureCalls, 1);
  assert.deepEqual(empty.items, []);
});

test('service returns stale profile and disclosures with deterministic stale reasons', async () => {
  let millis = Date.parse('2026-07-20T00:00:00Z');
  const now = () => new Date(millis);
  let fail = false;
  const provider: CompanyDisclosureProvider = {
    async getCompanyProfile() { if (fail) throw new OpenDartError('OPENDART_UNAVAILABLE', 'company-profile', true); return profileRaw; },
    async getDisclosures() { if (fail) throw new OpenDartError('OPENDART_UNAVAILABLE', 'disclosures', true); return { status: '013' }; },
  };
  const service = new OpenDartService(resolverAt(now()), provider, new MemoryCacheStore(() => millis), now);
  await service.getCompanyProfile('005930');
  await service.getDisclosures('005930', query);
  fail = true;
  millis += OPENDART_CACHE_POLICY.disclosuresFreshMs + 1;
  assert.deepEqual((await service.getDisclosures('005930', query)).metadata.staleReasons, ['disclosures-cache']);
  millis += OPENDART_CACHE_POLICY.profileFreshMs;
  assert.deepEqual((await service.getCompanyProfile('005930')).metadata.staleReasons, ['company-profile-cache']);
});

test('service distinguishes missing corp code and missing profile without Mock fallback', async () => {
  const now = new Date('2026-07-20T00:00:00Z');
  const provider: CompanyDisclosureProvider = {
    async getCompanyProfile() { throw new OpenDartError('COMPANY_PROFILE_NOT_FOUND', 'company-profile', false, '013'); },
    async getDisclosures() { return { status: '013' }; },
  };
  await assert.rejects(new OpenDartService(resolverAt(now, now.toISOString(), []), provider).getCompanyProfile('005930'), (error: OpenDartError) => error.code === 'CORP_CODE_NOT_FOUND');
  await assert.rejects(new OpenDartService(resolverAt(now), provider).getCompanyProfile('005930'), (error: OpenDartError) => error.code === 'COMPANY_PROFILE_NOT_FOUND');
});
