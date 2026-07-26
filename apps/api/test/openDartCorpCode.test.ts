import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CorpCodeArchiveParser,
  parseCorpCodeXml,
} from '../src/openDart/corpCode/corpCodeArchiveParser.js';
import {
  HttpCorpCodeArchiveSource,
} from '../src/openDart/corpCode/corpCodeArchiveSource.js';
import {
  createCorpCodeSnapshot,
  FileCorpCodeIndexStore,
} from '../src/openDart/corpCode/corpCodeIndexStore.js';
import {
  CORP_CODE_FRESH_TTL_MS,
  CorpCodeResolver,
} from '../src/openDart/corpCode/corpCodeResolver.js';
import { CorpCodeIndexSnapshot, CorpCodeRecord } from '../src/openDart/contracts.js';
import { OpenDartError } from '../src/openDart/errors.js';

const fixture = (name: string) => new URL(`./fixtures/open-dart/${name}`, import.meta.url);

const records: CorpCodeRecord[] = [{
  corpCode: '00126380', corpName: '삼성전자', corpEngName: 'Samsung', stockCode: '005930',
  companyInfoModifiedDate: '2026-07-01',
}];

test('corp code XML normalizes listed records and excludes empty stock codes', async () => {
  const result = parseCorpCodeXml(await readFile(fixture('corp-code.xml')));
  assert.deepEqual(result.map(record => record.stockCode), ['000660', '005930']);
  assert.equal(result[0]?.corpCode, '00164779');
  assert.equal(result[1]?.companyInfoModifiedDate, '2026-07-01');
});

test('corp code XML rejects invalid fields, duplicate symbols, entities, controls, and row limits', () => {
  const xml = (body: string) => Buffer.from(`<result>${body}</result>`);
  const row = (stock: string, corp = '00126380', date = '20260701') =>
    `<list><corp_code>${corp}</corp_code><corp_name>A</corp_name><corp_eng_name></corp_eng_name><stock_code>${stock}</stock_code><modify_date>${date}</modify_date></list>`;
  for (const payload of [
    xml(row('123', '00126380')),
    xml(row('005930', '123')),
    xml(row('005930', '00126380', '20260230')),
    xml(`${row('005930')}${row('005930', '00126381')}`),
    Buffer.from('<!DOCTYPE result><result/>'),
    Buffer.from('<!ENTITY x "y"><result/>'),
    Buffer.from('<result>\0</result>'),
    Buffer.from([0xff, 0xfe, 0xfd]),
  ]) assert.throws(() => parseCorpCodeXml(payload), OpenDartError);
  assert.throws(() => parseCorpCodeXml(xml(`${row('005930')}${row('000660', '00164779')}`), 1), OpenDartError);
});

test('corp code ZIP parser accepts one XML and rejects damaged or ambiguous archives', async () => {
  const parser = new CorpCodeArchiveParser();
  assert.equal((await parser.parse(await readFile(fixture('corp-code.zip')))).length, 2);
  await assert.rejects(parser.parse(Buffer.from('not-a-zip')), OpenDartError);
  await assert.rejects(parser.parse(await readFile(fixture('multiple-xml.zip'))), OpenDartError);
  await assert.rejects(parser.parse(await readFile(fixture('no-xml.zip'))), OpenDartError);
  await assert.rejects(parser.parse(await readFile(fixture('too-many-entries.zip'))), OpenDartError);
});

test('archive source limits bytes, maps provider status, times out, and never fetches without a key', async () => {
  let calls = 0;
  const unconfigured = new HttpCorpCodeArchiveSource({ baseUrl: 'https://example.test', timeoutMs: 10, fetchImpl: async () => { calls += 1; return new Response(); } });
  await assert.rejects(unconfigured.fetchArchive(), (error: OpenDartError) => error.code === 'OPENDART_NOT_CONFIGURED');
  assert.equal(calls, 0);

  const status = new HttpCorpCodeArchiveSource({ apiKey: 'fake', baseUrl: 'https://example.test', timeoutMs: 10, fetchImpl: async () => new Response('<result><status>020</status></result>') });
  await assert.rejects(status.fetchArchive(), (error: OpenDartError) => error.code === 'OPENDART_RATE_LIMITED');

  const oversized = new HttpCorpCodeArchiveSource({ apiKey: 'fake', baseUrl: 'https://example.test', timeoutMs: 10, maximumBytes: 3, fetchImpl: async () => new Response('PK\x03\x04too-big') });
  await assert.rejects(oversized.fetchArchive(), (error: OpenDartError) => error.code === 'CORP_CODE_ARCHIVE_INVALID');

  const timeout = new HttpCorpCodeArchiveSource({ apiKey: 'fake', baseUrl: 'https://example.test', timeoutMs: 1, fetchImpl: async (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) });
  await assert.rejects(timeout.fetchArchive(), (error: OpenDartError) => error.code === 'OPENDART_TIMEOUT');
});

test('snapshot store atomically saves, validates checksum, and rejects damaged snapshots', async t => {
  const directory = await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), 'alpha-twin-opendart-')));
  t.after(() => import('node:fs/promises').then(fs => fs.rm(directory, { recursive: true, force: true })));
  const store = new FileCorpCodeIndexStore(directory);
  const snapshot = createCorpCodeSnapshot(records, '2026-07-20T00:00:00.000Z');
  await store.save(snapshot);
  assert.deepEqual(await store.load(), snapshot);
  assert.equal((await readdir(directory)).some(name => name.endsWith('.tmp')), false);

  const path = join(directory, 'corp-code-index.json');
  await writeFile(path, JSON.stringify({ ...snapshot, checksum: 'bad' }));
  await assert.rejects(store.load(), OpenDartError);
  await writeFile(path, '{bad json');
  await assert.rejects(store.load(), OpenDartError);
});

class MemoryIndexStore {
  constructor(public snapshot?: CorpCodeIndexSnapshot) {}
  async load() { return this.snapshot; }
  async save(snapshot: CorpCodeIndexSnapshot) { this.snapshot = snapshot; }
}

test('resolver loads fresh snapshots, returns stale on refresh failure, and rejects expired stale data', async () => {
  let now = new Date('2026-07-20T00:00:00.000Z');
  const fresh = createCorpCodeSnapshot(records, new Date(now.getTime() - 1_000).toISOString());
  let archiveCalls = 0;
  const source = { async fetchArchive(): Promise<Buffer> { archiveCalls += 1; throw new Error('offline'); } };
  const parser = { async parse(): Promise<CorpCodeRecord[]> { return records; } } as CorpCodeArchiveParser;
  const resolver = new CorpCodeResolver(source, parser, new MemoryIndexStore(fresh), () => now);
  assert.equal((await resolver.resolveByStockCode(' 005930 ')).record?.corpCode, '00126380');
  assert.equal(archiveCalls, 0);

  now = new Date(now.getTime() + CORP_CODE_FRESH_TTL_MS + 1);
  const stale = await resolver.resolveByStockCode('005930');
  assert.equal(stale.indexStale, true);
  assert.equal(archiveCalls, 1);

  const expired = createCorpCodeSnapshot(records, '2026-05-01T00:00:00.000Z');
  await assert.rejects(
    new CorpCodeResolver(source, parser, new MemoryIndexStore(expired), () => now).resolveByStockCode('005930'),
  );
  await assert.rejects(resolver.resolveByStockCode('bad'), (error: OpenDartError) => error.code === 'INVALID_SYMBOL');
});

test('resolver coalesces concurrent refreshes and clears failed in-flight work', async () => {
  let calls = 0;
  let fail = false;
  const source = { async fetchArchive() { calls += 1; await new Promise(resolve => setTimeout(resolve, 5)); if (fail) throw new Error('offline'); return Buffer.from('zip'); } };
  const parser = { async parse() { return records; } } as CorpCodeArchiveParser;
  const resolver = new CorpCodeResolver(source, parser, new MemoryIndexStore(), () => new Date('2026-07-20T00:00:00Z'));
  await Promise.all([resolver.refresh(), resolver.refresh(), resolver.refresh()]);
  assert.equal(calls, 1);
  fail = true;
  const failed = new CorpCodeResolver(source, parser, new MemoryIndexStore(), () => new Date('2026-07-20T00:00:00Z'));
  await assert.rejects(Promise.all([failed.refresh(), failed.refresh()]));
  fail = false;
  await failed.refresh();
  assert.equal(calls, 3);
});
