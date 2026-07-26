import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';
import { MemoryCacheStore } from '../src/cache.js';
import { loadConfig } from '../src/config.js';
import { MarketDataService } from '../src/marketDataService.js';
import { CorpCodeArchiveParser } from '../src/openDart/corpCode/corpCodeArchiveParser.js';
import { createCorpCodeSnapshot } from '../src/openDart/corpCode/corpCodeIndexStore.js';
import { CorpCodeResolver } from '../src/openDart/corpCode/corpCodeResolver.js';
import { CorpCodeRecord } from '../src/openDart/contracts.js';
import { OpenDartError } from '../src/openDart/errors.js';
import { OpenDartService } from '../src/openDart/openDartService.js';
import { CompanyDisclosureProvider } from '../src/openDart/providers/openDartProvider.js';
import { MockMarketDataProvider } from '../src/providers/mockMarketDataProvider.js';

const now = new Date('2026-07-20T00:00:00Z');
const record: CorpCodeRecord = {
  corpCode: '00126380', corpName: '삼성전자', corpEngName: 'Samsung', stockCode: '005930',
  companyInfoModifiedDate: '2026-07-01',
};

function resolver(records: CorpCodeRecord[] = [record]) {
  const snapshot = createCorpCodeSnapshot(records, now.toISOString());
  const store = { async load() { return snapshot; }, async save() {} };
  const source = { async fetchArchive(): Promise<Buffer> { throw new Error('not used'); } };
  const parser = { async parse(): Promise<CorpCodeRecord[]> { return records; } } as CorpCodeArchiveParser;
  return new CorpCodeResolver(source, parser, store, () => now);
}

function marketData() {
  const mock = new MockMarketDataProvider();
  return new MarketDataService(mock, mock);
}

function provider(overrides: Partial<CompanyDisclosureProvider> = {}): CompanyDisclosureProvider {
  return {
    async getCompanyProfile() {
      return {
        status: '000', corp_name: '삼성전자 주식회사', corp_name_eng: 'Samsung Electronics',
        stock_name: '삼성전자', stock_code: '005930', ceo_nm: '대표', corp_cls: 'Y',
        est_dt: '19690113', acc_mt: '12', jurir_no: 'private-jurir', bizr_no: 'private-bizr',
        adres: 'private-address', phn_no: 'private-phone', fax_no: 'private-fax',
      };
    },
    async getDisclosures() { return { status: '013' }; },
    ...overrides,
  };
}

test('OpenDART routes validate input and return safe not-configured responses', async t => {
  const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData());
  t.after(() => app.close());
  const invalid = await app.inject({ method: 'GET', url: '/api/v1/companies/ABC/profile' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'INVALID_SYMBOL');
  const missing = await app.inject({ method: 'GET', url: '/api/v1/companies/005930/profile' });
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.json().error.code, 'OPENDART_NOT_CONFIGURED');
  assert.equal(typeof missing.json().metadata.requestId, 'string');
  assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/stocks/000660/quote' })).statusCode, 200);
});

test('profile route returns allowlisted DTO and never serializes private provider fields', async t => {
  const service = new OpenDartService(resolver(), provider(), new MemoryCacheStore(), () => now);
  const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData(), { openDart: service });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/api/v1/companies/005930/profile' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().company.market, 'KOSPI');
  assert.equal(response.json().metadata.source, 'opendart-fss');
  assert.equal(response.json().metadata.fallback, false);
  const serialized = response.body;
  for (const value of ['private-jurir', 'private-bizr', 'private-address', 'private-phone', 'private-fax']) {
    assert.equal(serialized.includes(value), false);
  }
});

test('API distinguishes missing mappings, missing profiles, and upstream failures', async t => {
  const config = loadConfig({ LOG_LEVEL: 'silent' });
  const cases: Array<[OpenDartService, string, number]> = [
    [new OpenDartService(resolver([]), provider()), 'CORP_CODE_NOT_FOUND', 404],
    [new OpenDartService(resolver(), provider({ async getCompanyProfile() { throw new OpenDartError('COMPANY_PROFILE_NOT_FOUND', 'company-profile', false, '013'); } })), 'COMPANY_PROFILE_NOT_FOUND', 404],
    [new OpenDartService(resolver(), provider({ async getCompanyProfile() { throw new OpenDartError('OPENDART_AUTH_ERROR', 'company-profile', false, '010'); } })), 'OPENDART_AUTH_ERROR', 503],
    [new OpenDartService(resolver(), provider({ async getCompanyProfile() { throw new OpenDartError('OPENDART_BAD_RESPONSE', 'company-profile', false); } })), 'OPENDART_BAD_RESPONSE', 502],
  ];
  for (const [service, code, status] of cases) {
    const app = await buildApp(config, marketData(), { openDart: service });
    const response = await app.inject({ method: 'GET', url: '/api/v1/companies/005930/profile' });
    await app.close();
    assert.equal(response.statusCode, status);
    assert.equal(response.json().error.code, code);
  }
  t.after(() => undefined);
});

test('disclosures route validates query and returns status 013 as an empty page', async t => {
  const app = await buildApp(
    loadConfig({ LOG_LEVEL: 'silent' }),
    marketData(),
    { openDart: new OpenDartService(resolver(), provider(), new MemoryCacheStore(), () => now) },
  );
  t.after(() => app.close());
  const empty = await app.inject({ method: 'GET', url: '/api/v1/companies/005930/disclosures?to=2026-07-20' });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json().items, []);
  assert.deepEqual(empty.json().pagination, { page: 1, pageSize: 20, totalCount: 0, totalPages: 0 });
  for (const url of [
    '/api/v1/companies/005930/disclosures?pageSize=101',
    '/api/v1/companies/005930/disclosures?to=2026-02-30',
    '/api/v1/companies/005930/disclosures?from=2026-07-21&to=2026-07-20',
    '/api/v1/companies/005930/disclosures?from=2025-01-01&to=2026-07-20',
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.json().error.code, 'INVALID_DISCLOSURE_QUERY');
  }
});

test('error responses and health never expose injected API key or provider URLs', async t => {
  const secret = 'fake-opendart-secret-never-log';
  const app = await buildApp(
    loadConfig({ LOG_LEVEL: 'silent', OPENDART_API_KEY: secret, OPENDART_BASE_URL: 'https://private.example.test' }),
    marketData(),
    { openDart: new OpenDartService(resolver(), provider({ async getCompanyProfile() { throw new OpenDartError('OPENDART_AUTH_ERROR', 'company-profile', false, '010'); } })) },
  );
  t.after(() => app.close());
  const bodies = [
    (await app.inject({ method: 'GET', url: '/health' })).body,
    (await app.inject({ method: 'GET', url: '/api/v1/companies/005930/profile' })).body,
  ].join(' ');
  assert.equal(bodies.includes(secret), false);
  assert.equal(bodies.includes('private.example.test'), false);
  assert.equal(bodies.includes('crtfc_key'), false);
});
