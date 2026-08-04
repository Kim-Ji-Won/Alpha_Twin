import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { FilingLexicalError } from '../src/filingIntelligence/lexical/errors.js';
import { FilingLexicalRepository } from '../src/filingIntelligence/lexical/filingLexicalRepository.js';
import { lexicalizeText } from '../src/filingIntelligence/lexical/lexicalNormalizer.js';
import {
  FILING_LEXICAL_BOUNDS,
  FILING_LEXICAL_PROFILE,
} from '../src/filingIntelligence/lexical/profile.js';
import { FilingDocumentRepository } from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import { clearPersistence, requiredTestDatabaseUrl, runMigrations } from './helpers/database.js';
import { syntheticPersistenceInputFor } from './helpers/filingFixture.js';

function lexicalError(code: FilingLexicalError['code']) {
  return (error: unknown) => error instanceof FilingLexicalError && error.code === code;
}

async function relationExists(pool: Pool, relation: string): Promise<boolean> {
  const result = await pool.query<{ relation: string | null }>('SELECT to_regclass($1)::text AS relation', [relation]);
  return result.rows[0]?.relation != null;
}

async function persist(
  repository: FilingDocumentRepository,
  receiptNumber: string,
  corpCode: string,
  symbol: string,
  text: string,
) {
  return repository.persistCanonicalFiling(syntheticPersistenceInputFor({
    receiptNumber, corpCode, symbol, companyName: `TEST ${symbol}`,
    paragraphTexts: [text, `${text} 추가 합성 문단`],
  }));
}

test('Korean lexical PostgreSQL integration', async t => {
  const databaseUrl = requiredTestDatabaseUrl();
  const pool = new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 2_000,
    statement_timeout: 30_000, application_name: 'alpha-twin-lexical-integration-test' });
  t.after(async () => { await pool.end(); });

  await t.test('migration creates versioned lexical schema and GIN while down preserves D-B/C', async () => {
    await runMigrations('up', databaseUrl);
    assert.equal(await relationExists(pool, 'filing_intelligence.filing_lexical_generation'), true);
    assert.equal(await relationExists(pool, 'filing_intelligence.filing_chunk_lexical'), true);
    const columns = await pool.query<{ column_name: string; data_type: string; udt_name: string }>(
      `SELECT column_name, data_type, udt_name FROM information_schema.columns
       WHERE table_schema = 'filing_intelligence' AND table_name = 'filing_chunk_lexical'`,
    );
    const types = new Map(columns.rows.map(row => [row.column_name, `${row.data_type}:${row.udt_name}`]));
    assert.equal(types.get('search_vector'), 'tsvector:tsvector');
    const indexes = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'filing_intelligence' AND tablename = 'filing_chunk_lexical'`,
    );
    assert.match(indexes.rows.find(row => row.indexname === 'filing_chunk_lexical_search_vector_gin_idx')?.indexdef ?? '', /USING gin/iu);
    await runMigrations('up', databaseUrl);
    await runMigrations('down', databaseUrl);
    assert.equal(await relationExists(pool, 'filing_intelligence.filing_receipt'), false);
    assert.equal(await relationExists(pool, 'filing_intelligence.filing_chunk_lexical'), true);
    await runMigrations('down', databaseUrl);
    assert.equal(await relationExists(pool, 'filing_intelligence.filing_chunk_lexical'), false);
    for (const table of ['filing_document', 'filing_chunk', 'filing_ingestion_job', 'filing_ingestion_attempt']) {
      assert.equal(await relationExists(pool, `filing_intelligence.${table}`), true);
    }
    await runMigrations('up', databaseUrl);
  });

  await t.test('indexing is atomic, ready, immutable, and idempotent without activation', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool, { batchSize: 2 });
    const lexical = new FilingLexicalRepository(pool);
    const document = await persist(persistence, '20990101000101', '11111111', '111111',
      '반도체사업 시설투자 인공지능 DRAM HBM 1,000 -12.4% 2026.03.31 100억원');
    const first = await lexical.indexFilingDocumentLexically(document.documentId);
    assert.equal(first.status, 'indexed');
    assert.equal(first.profileId, FILING_LEXICAL_PROFILE.profileId);
    assert.equal(first.chunkCount, document.chunkCount);
    const before = await pool.query<{ created_at: Date; status: string; rows: number }>(
      `SELECT g.created_at, g.status,
        (SELECT count(*)::integer FROM filing_intelligence.filing_chunk_lexical l WHERE l.generation_id = g.id) AS rows
       FROM filing_intelligence.filing_lexical_generation g WHERE g.id = $1`, [first.generationId]);
    assert.deepEqual([before.rows[0]?.status, before.rows[0]?.rows], ['ready', document.chunkCount]);
    const second = await lexical.indexFilingDocumentLexically(document.documentId);
    assert.equal(second.status, 'already_indexed');
    assert.equal(second.generationId, first.generationId);
    const readiness = await pool.query<{
      is_retrieval_ready: boolean; is_current_effective: boolean; activated_at: Date | null;
    }>('SELECT is_retrieval_ready, is_current_effective, activated_at FROM filing_intelligence.filing_document WHERE id = $1',
      [document.documentId]);
    assert.deepEqual(readiness.rows[0], {
      is_retrieval_ready: false, is_current_effective: false, activated_at: null,
    });
  });

  await t.test('stored fingerprint conflict is fail-closed and never rewrites lexical rows', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool);
    const lexical = new FilingLexicalRepository(pool);
    const document = await persist(persistence, '20990101000102', '11111111', '111111', '시설투자 DRAM');
    const indexed = await lexical.indexFilingDocumentLexically(document.documentId);
    await pool.query(`UPDATE filing_intelligence.filing_lexical_generation
      SET lexical_fingerprint = repeat('f', 64) WHERE id = $1`, [indexed.generationId]);
    await assert.rejects(lexical.indexFilingDocumentLexically(document.documentId),
      lexicalError('FILING_LEXICAL_INDEX_CONFLICT'));
    const rows = await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM filing_intelligence.filing_chunk_lexical WHERE generation_id = $1',
      [indexed.generationId]);
    assert.equal(rows.rows[0]?.count, document.chunkCount);
  });

  await t.test('batch failure rolls back generation and every lexical row', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool);
    const lexical = new FilingLexicalRepository(pool);
    const document = await persist(persistence, '20990101000103', '11111111', '111111', '반도체 사업');
    await pool.query(`ALTER TABLE filing_intelligence.filing_chunk_lexical
      ADD CONSTRAINT filing_chunk_lexical_test_failure CHECK (false) NOT VALID`);
    try {
      await assert.rejects(lexical.indexFilingDocumentLexically(document.documentId),
        lexicalError('FILING_LEXICAL_INDEX_INTEGRITY_FAILURE'));
      const counts = await pool.query<{ generations: number; rows: number }>(
        `SELECT
          (SELECT count(*)::integer FROM filing_intelligence.filing_lexical_generation) AS generations,
          (SELECT count(*)::integer FROM filing_intelligence.filing_chunk_lexical) AS rows`,
      );
      assert.deepEqual(counts.rows[0], { generations: 0, rows: 0 });
    } finally {
      await pool.query('ALTER TABLE filing_intelligence.filing_chunk_lexical DROP CONSTRAINT filing_chunk_lexical_test_failure');
    }
  });

  await t.test('concurrent identical indexing converges to one ready generation', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool);
    const lexical = new FilingLexicalRepository(pool);
    const document = await persist(persistence, '20990101000104', '11111111', '111111', '인공지능 HBM');
    const results = await Promise.all([
      lexical.indexFilingDocumentLexically(document.documentId),
      lexical.indexFilingDocumentLexically(document.documentId),
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), ['already_indexed', 'indexed']);
    assert.equal(new Set(results.map(result => result.generationId)).size, 1);
  });

  await t.test('concurrent differing fingerprints produce one generation and one conflict', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool);
    const lexical = new FilingLexicalRepository(pool);
    const document = await persist(persistence, '20990101000110', '11111111', '111111', '동시성 기준 문장');
    const listener = await pool.connect();
    try {
      await listener.query('LISTEN lexical_test_prepared');
      await pool.query(`CREATE FUNCTION filing_intelligence.lexical_test_pause()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM pg_notify('lexical_test_prepared', 'ready');
          PERFORM pg_sleep(0.3);
          RETURN NEW;
        END $$`);
      await pool.query(`CREATE TRIGGER lexical_test_pause_trigger
        BEFORE INSERT ON filing_intelligence.filing_lexical_generation
        FOR EACH ROW EXECUTE FUNCTION filing_intelligence.lexical_test_pause()`);
      const notified = new Promise<void>(resolve => listener.once('notification', () => resolve()));
      const first = lexical.indexFilingDocumentLexically(document.documentId);
      await notified;
      await pool.query(`UPDATE filing_intelligence.filing_chunk
        SET retrieval_text = retrieval_text || ' 변경'
        WHERE document_id = $1`, [document.documentId]);
      const outcomes = await Promise.allSettled([
        first,
        lexical.indexFilingDocumentLexically(document.documentId),
      ]);
      assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
      const rejected = outcomes.find(value => value.status === 'rejected');
      assert.ok(rejected?.status === 'rejected');
      assert.equal(lexicalError('FILING_LEXICAL_INDEX_CONFLICT')(rejected.reason), true);
      const counts = await pool.query<{ generations: number; rows: number; expected: number }>(
        `SELECT
          (SELECT count(*)::integer FROM filing_intelligence.filing_lexical_generation) AS generations,
          (SELECT count(*)::integer FROM filing_intelligence.filing_chunk_lexical) AS rows,
          (SELECT chunk_count FROM filing_intelligence.filing_document WHERE id = $1) AS expected`,
        [document.documentId],
      );
      assert.deepEqual(counts.rows[0], {
        generations: 1, rows: document.chunkCount, expected: document.chunkCount,
      });
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS lexical_test_pause_trigger ON filing_intelligence.filing_lexical_generation');
      await pool.query('DROP FUNCTION IF EXISTS filing_intelligence.lexical_test_pause()');
      listener.release();
    }
  });

  await t.test('Korean spacing, English case, and financial formats retrieve deterministically', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool);
    const lexical = new FilingLexicalRepository(pool);
    const document = await persist(persistence, '20990101000105', '11111111', '111111',
      '반도체사업 시설투자 인공지능 DRAM HBM 001 1,000 -12.4% 2026.03.31 100억원');
    await lexical.indexFilingDocumentLexically(document.documentId);
    for (const query of ['반도체 사업', '시설 투자', '인공 지능', 'DRAM', 'dram', 'HBM',
      '001', '1,000', '-12.4%', '2026.03.31', '100억원']) {
      const candidates = await lexical.retrieveLexicalFilingChunks({
        symbol: '111111', corpCode: '11111111', documentIds: [document.documentId], query,
      });
      assert.ok(candidates.length > 0, query);
      assert.ok(candidates.every(candidate => candidate.documentId === document.documentId));
    }
    const first = await lexical.retrieveLexicalFilingChunks({
      symbol: '111111', corpCode: '11111111', documentIds: [document.documentId], query: '반도체사업',
    });
    const second = await lexical.retrieveLexicalFilingChunks({
      symbol: '111111', corpCode: '11111111', documentIds: [document.documentId], query: '반도체사업',
    });
    assert.deepEqual(second.map(value => [value.chunkId, value.lexicalRank]),
      first.map(value => [value.chunkId, value.lexicalRank]));

    for (const nonSemanticQuery of ['tbl', '11111111', '20990101000105']) {
      assert.deepEqual(await lexical.retrieveLexicalFilingChunks({
        symbol: '111111', corpCode: '11111111', documentIds: [document.documentId],
        query: nonSemanticQuery,
      }), []);
    }
  });

  await t.test('metadata and explicit document scope prevent every cross-company candidate', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool);
    const lexical = new FilingLexicalRepository(pool);
    const a = await persist(persistence, '20990101000106', '11111111', '111111', '공통위험 HBM');
    const sameCompany = await persist(persistence, '20990101000107', '11111111', '111111', '공통위험 HBM HBM');
    const b = await persist(persistence, '20990101000108', '22222222', '222222', '공통위험 HBM HBM HBM');
    await Promise.all([a, sameCompany, b].map(value => lexical.indexFilingDocumentLexically(value.documentId)));
    const scoped = await lexical.retrieveLexicalFilingChunks({
      symbol: '111111', corpCode: '11111111', documentIds: [a.documentId], query: '공통위험 HBM', topK: 20,
    });
    assert.ok(scoped.length > 0);
    assert.ok(scoped.every(candidate => candidate.documentId === a.documentId));
    const deduplicated = await lexical.retrieveLexicalFilingChunks({
      symbol: '111111', corpCode: '11111111', documentIds: [a.documentId, a.documentId], query: 'HBM',
    });
    assert.ok(deduplicated.every(candidate => candidate.documentId === a.documentId));
    await assert.rejects(lexical.retrieveLexicalFilingChunks({
      symbol: '111111', corpCode: '11111111', documentIds: [a.documentId, b.documentId], query: 'HBM',
    }), lexicalError('FILING_LEXICAL_SCOPE_INVALID'));
  });

  await t.test('composite ownership rejects a lexical row assigned to another document', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool);
    const lexical = new FilingLexicalRepository(pool);
    const a = await persist(persistence, '20990101000111', '11111111', '111111', '소유권 기준 A');
    const b = await persist(persistence, '20990101000112', '11111111', '111111', '소유권 기준 B');
    const indexed = await lexical.indexFilingDocumentLexically(a.documentId);
    await assert.rejects(
      pool.query(`UPDATE filing_intelligence.filing_chunk_lexical
        SET document_id = $1 WHERE generation_id = $2`, [b.documentId, indexed.generationId]),
      (error: unknown) => typeof error === 'object' && error !== null
        && 'code' in error && error.code === '23503',
    );
  });

  await t.test('empty, unindexed, punctuation-only, and unmatched queries return no answer', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool);
    const lexical = new FilingLexicalRepository(pool);
    const document = await persist(persistence, '20990101000109', '11111111', '111111', '반도체');
    const base = { symbol: '111111', corpCode: '11111111' };
    assert.deepEqual(await lexical.retrieveLexicalFilingChunks({ ...base, documentIds: [], query: '반도체' }), []);
    await assert.rejects(lexical.retrieveLexicalFilingChunks({
      ...base, documentIds: ['999999999'], query: '반도체',
    }), lexicalError('FILING_LEXICAL_SCOPE_INVALID'));
    await assert.rejects(lexical.retrieveLexicalFilingChunks({
      ...base, documentIds: ['999999999'], query: '...!!!',
    }), lexicalError('FILING_LEXICAL_SCOPE_INVALID'));
    await assert.rejects(lexical.retrieveLexicalFilingChunks({
      ...base, documentIds: [document.documentId, '999999999'], query: '반도체',
    }), lexicalError('FILING_LEXICAL_SCOPE_INVALID'));
    assert.deepEqual(await lexical.retrieveLexicalFilingChunks({ ...base, documentIds: [document.documentId], query: '반도체' }), []);
    await lexical.indexFilingDocumentLexically(document.documentId);
    assert.deepEqual(await lexical.retrieveLexicalFilingChunks({ ...base, documentIds: [document.documentId], query: '...!!!' }), []);
    assert.deepEqual(await lexical.retrieveLexicalFilingChunks({ ...base, documentIds: [document.documentId], query: '존재하지않는표현' }), []);
  });

  await t.test('ranking weights, query bounds, and safe input failures are enforced', async () => {
    const ranks = await pool.query<{ a: number; b: number; c: number }>(
      `SELECT
       ts_rank_cd(setweight(to_tsvector('simple', 'target'), 'A'), to_tsquery('simple', 'target')) AS a,
       ts_rank_cd(setweight(to_tsvector('simple', 'target'), 'B'), to_tsquery('simple', 'target')) AS b,
       ts_rank_cd(setweight(to_tsvector('simple', 'target'), 'C'), to_tsquery('simple', 'target')) AS c`,
    );
    assert.ok(ranks.rows[0]!.a > ranks.rows[0]!.b && ranks.rows[0]!.b > ranks.rows[0]!.c);
    for (const token of [
      '가'.repeat(FILING_LEXICAL_BOUNDS.maximumTokenLength),
      'x'.repeat(FILING_LEXICAL_BOUNDS.maximumTokenLength),
    ]) {
      const field = lexicalizeText(token);
      const roundTrip = await pool.query<{ matched: boolean; lexeme_count: number }>(
        `SELECT
           to_tsvector('simple'::regconfig, $1) @@ to_tsquery('simple'::regconfig, $2) AS matched,
           cardinality(tsvector_to_array(to_tsvector('simple'::regconfig, $1)))::integer
             AS lexeme_count`,
        [field.payload, token],
      );
      assert.deepEqual(roundTrip.rows[0], { matched: true, lexeme_count: field.lexemes.length });
    }
    const lexical = new FilingLexicalRepository(pool);
    const base = { symbol: '111111', corpCode: '11111111', documentIds: ['1'], query: 'test' };
    for (const input of [
      { ...base, symbol: 'bad' }, { ...base, corpCode: 'bad' }, { ...base, documentIds: ['0'] },
      { ...base, topK: 0 }, { ...base, topK: 21 },
      { ...base, documentIds: Array.from({ length: 21 }, (_, index) => String(index + 1)) },
    ]) await assert.rejects(lexical.retrieveLexicalFilingChunks(input));
  });

  await t.test('bounded synthetic indexing smoke completes without duplicates or leakage', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool, { batchSize: 20 });
    const lexical = new FilingLexicalRepository(pool);
    const started = performance.now();
    const documents = [];
    for (let index = 0; index < 3; index += 1) {
      const value = await persistence.persistCanonicalFiling(syntheticPersistenceInputFor({
        receiptNumber: `2099010100020${index}`, corpCode: '33333333', symbol: '333333',
        paragraphCount: 120, companyName: 'BOUNDED LEXICAL TEST',
      }));
      documents.push(value);
      await lexical.indexFilingDocumentLexically(value.documentId);
    }
    const candidates = await lexical.retrieveLexicalFilingChunks({
      symbol: '333333', corpCode: '33333333', documentIds: documents.map(value => value.documentId),
      query: '합성 검증 데이터', topK: 20,
    });
    assert.ok(candidates.length > 0 && candidates.length <= 20);
    assert.equal(new Set(candidates.map(value => value.chunkRowId)).size, candidates.length);
    assert.ok(performance.now() - started >= 0);
  });
});
