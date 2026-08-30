import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';

import { FilingDenseError } from '../src/filingIntelligence/dense/errors.js';
import { FilingDenseRepository } from '../src/filingIntelligence/dense/filingDenseRepository.js';
import { denseVectorFingerprint } from '../src/filingIntelligence/dense/fingerprints.js';
import { FILING_DENSE_PROFILES } from '../src/filingIntelligence/dense/profile.js';
import { FilingDocumentRepository } from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import { clearPersistence, requiredTestDatabaseUrl, runMigrations } from './helpers/database.js';
import { syntheticPersistenceInputFor } from './helpers/filingFixture.js';

const vector = (seed = 1) => Array.from({ length: 1536 }, (_, index) => ((index + seed) % 31 + 1) / 100);
const denseError = (code: FilingDenseError['code']) => (value: unknown) => value instanceof FilingDenseError && value.code === code;

test('dense vector PostgreSQL integration', async t => {
  const databaseUrl = requiredTestDatabaseUrl();
  const pool = new Pool({ connectionString: databaseUrl, max: 4, statement_timeout: 30_000 });
  t.after(async () => pool.end());
  await runMigrations('up', databaseUrl, true);

  await t.test('pgvector prerequisite and physical dimension are enforced', async () => {
    const version = await pool.query<{ extversion: string }>("SELECT extversion FROM pg_extension WHERE extname='vector'");
    assert.match(version.rows[0]!.extversion, /^0\.8\./);
    await pool.query('CREATE TEMP TABLE dense_smoke(v vector(1536) CHECK (vector_norm(v) > 0))');
    const value = `[${vector().join(',')}]`;
    await pool.query('BEGIN'); await pool.query('INSERT INTO dense_smoke VALUES($1::vector)', [value]);
    assert.equal(Number((await pool.query<{ distance: number }>('SELECT v <=> $1::vector AS distance FROM dense_smoke',[value])).rows[0]!.distance), 0);
    await pool.query('ROLLBACK');
    for (const size of [1535, 1537]) await assert.rejects(pool.query('INSERT INTO dense_smoke VALUES($1::vector)', [`[${Array(size).fill(0.1).join(',')}]`]));
    await assert.rejects(pool.query('INSERT INTO dense_smoke VALUES($1::vector)', [`[${Array(1536).fill(0).join(',')}]`]));
  });

  await t.test('building batches finalize atomically, remain immutable, and coexist by profile', async () => {
    await clearPersistence(pool);
    const persisted = await new FilingDocumentRepository(pool).persistCanonicalFiling(syntheticPersistenceInputFor({
      receiptNumber: '20990101000901', corpCode: '11111111', symbol: '111111', paragraphTexts: ['HBM 수익성 원인', '설비투자 계획'],
    }));
    const dense = new FilingDenseRepository(pool);
    const first = await dense.createGeneration(persisted.documentId, FILING_DENSE_PROFILES.openAiSmall1536.profileId);
    assert.equal(first.generation.status, 'building');
    await dense.persistVectorBatch(first.generation.generationId, [
      { ...first.chunks[0]!, vector: vector(1) },
    ]);
    await assert.rejects(dense.finalizeGeneration(first.generation.generationId), denseError('FILING_DENSE_GENERATION_INCOMPLETE'));
    const remaining = first.chunks.slice(1).map((chunk, index) => ({ ...chunk, vector: vector(index + 2) }));
    if (remaining.length) await dense.persistVectorBatch(first.generation.generationId, remaining);
    const ready = await dense.finalizeGeneration(first.generation.generationId);
    assert.equal(ready.status, 'ready'); assert.equal(ready.persistedVectorCount, ready.expectedVectorCount);
    const readyTimes = await pool.query<{ ready_at: Date; updated_at: Date }>(
      'SELECT ready_at,updated_at FROM filing_intelligence.filing_dense_generation WHERE id=$1',
      [first.generation.generationId]);
    assert.equal(readyTimes.rows[0]!.ready_at.getTime(), readyTimes.rows[0]!.updated_at.getTime());
    assert.deepEqual(await dense.finalizeGeneration(first.generation.generationId), ready);
    const reused = await dense.createGeneration(persisted.documentId, FILING_DENSE_PROFILES.openAiSmall1536.profileId);
    assert.equal(reused.generation.status, 'ready');
    const second = await dense.createGeneration(persisted.documentId, FILING_DENSE_PROFILES.openAiLargeReduced1536.profileId);
    await dense.persistVectorBatch(second.generation.generationId, second.chunks.map((chunk,index)=>({ ...chunk, vector: vector(index+7) })));
    assert.equal((await dense.finalizeGeneration(second.generation.generationId)).status, 'ready');
    assert.notEqual(first.generation.generationId, second.generation.generationId);
    const retainedBefore = await pool.query<{ evidence: unknown }>(
      `SELECT jsonb_agg(to_jsonb(e) ORDER BY e.chunk_row_id) AS evidence
       FROM filing_intelligence.filing_chunk_embedding e WHERE generation_id=$1`,
      [first.generation.generationId]);
    const historical = await new FilingDocumentRepository(pool).persistCanonicalFiling(syntheticPersistenceInputFor({
      receiptNumber: '20990101000901', corpCode: '11111111', symbol: '111111',
      paragraphTexts: ['후속 canonical representation'],
    }));
    assert.notEqual(historical.documentId, persisted.documentId);
    const retainedAfter = await pool.query<{ evidence: unknown }>(
      `SELECT jsonb_agg(to_jsonb(e) ORDER BY e.chunk_row_id) AS evidence
       FROM filing_intelligence.filing_chunk_embedding e WHERE generation_id=$1`,
      [first.generation.generationId]);
    assert.deepEqual(retainedAfter.rows[0]!.evidence, retainedBefore.rows[0]!.evidence);
  });

  await t.test('duplicate evidence is idempotent and conflicting evidence is rejected', async () => {
    await clearPersistence(pool);
    const persisted = await new FilingDocumentRepository(pool).persistCanonicalFiling(syntheticPersistenceInputFor({
      receiptNumber: '20990101000902', corpCode: '11111111', symbol: '111111', paragraphTexts: ['위험 요인'],
    }));
    const dense = new FilingDenseRepository(pool); const created = await dense.createGeneration(persisted.documentId, FILING_DENSE_PROFILES.openAiSmall1536.profileId);
    const roundingVector = vector(); roundingVector[0] = 0.123456789012345; roundingVector[1] = -0;
    const value = { ...created.chunks[0]!, vector: roundingVector };
    await dense.persistVectorBatch(created.generation.generationId, [value]);
    const stored = await pool.query<{ embedding: string; vector_fingerprint: string; created_at: Date }>(
      `SELECT embedding::text,vector_fingerprint,created_at
       FROM filing_intelligence.filing_chunk_embedding WHERE generation_id=$1 AND chunk_row_id=$2`,
      [created.generation.generationId, value.chunkRowId]);
    const storedFingerprint = denseVectorFingerprint(JSON.parse(stored.rows[0]!.embedding) as number[]);
    assert.equal(stored.rows[0]!.vector_fingerprint, storedFingerprint);
    assert.equal(stored.rows[0]!.vector_fingerprint, denseVectorFingerprint(roundingVector));
    const generationBeforeDuplicate = await pool.query<{ updated_at: Date }>(
      'SELECT updated_at FROM filing_intelligence.filing_dense_generation WHERE id=$1',
      [created.generation.generationId]);
    await dense.persistVectorBatch(created.generation.generationId, [value]);
    const duplicate = await pool.query<{ created_at: Date }>(
      'SELECT created_at FROM filing_intelligence.filing_chunk_embedding WHERE generation_id=$1 AND chunk_row_id=$2',
      [created.generation.generationId, value.chunkRowId]);
    assert.equal(duplicate.rows[0]!.created_at.getTime(), stored.rows[0]!.created_at.getTime());
    const generationAfterDuplicate = await pool.query<{ updated_at: Date }>(
      'SELECT updated_at FROM filing_intelligence.filing_dense_generation WHERE id=$1',
      [created.generation.generationId]);
    assert.equal(generationAfterDuplicate.rows[0]!.updated_at.getTime(),
      generationBeforeDuplicate.rows[0]!.updated_at.getTime());
    await assert.rejects(dense.persistVectorBatch(created.generation.generationId, [{ ...value, vector: vector(9) }]), denseError('FILING_DENSE_VECTOR_CONFLICT'));
    await assert.rejects(dense.persistVectorBatch(created.generation.generationId, [{ ...value, vector: Array(1535).fill(0.1) }]), denseError('FILING_DENSE_VECTOR_INVALID'));
    await assert.rejects(dense.persistVectorBatch(created.generation.generationId, [{ ...value, vector: Array(1536).fill(0) }]), denseError('FILING_DENSE_VECTOR_INVALID'));
    await assert.rejects(dense.persistVectorBatch(created.generation.generationId, [{ ...value, vector: Array(1536).fill(Number.NaN) }]), denseError('FILING_DENSE_VECTOR_INVALID'));
    await assert.rejects(dense.persistVectorBatch(created.generation.generationId, [{ ...value, vector: Array(1536).fill(Number.POSITIVE_INFINITY) }]), denseError('FILING_DENSE_VECTOR_INVALID'));
  });

  await t.test('database ownership, delete, and generation state constraints fail closed', async () => {
    await clearPersistence(pool);
    const repository = new FilingDocumentRepository(pool);
    const firstDocument = await repository.persistCanonicalFiling(syntheticPersistenceInputFor({
      receiptNumber: '20990101000903', corpCode: '11111111', symbol: '111111', paragraphTexts: ['첫 번째 문서'],
    }));
    const secondDocument = await repository.persistCanonicalFiling(syntheticPersistenceInputFor({
      receiptNumber: '20990101000904', corpCode: '22222222', symbol: '222222', paragraphTexts: ['두 번째 문서'],
    }));
    const dense = new FilingDenseRepository(pool);
    const first = await dense.createGeneration(firstDocument.documentId, FILING_DENSE_PROFILES.openAiSmall1536.profileId);
    const second = await dense.createGeneration(secondDocument.documentId, FILING_DENSE_PROFILES.openAiSmall1536.profileId);
    await dense.persistVectorBatch(first.generation.generationId, [{ ...first.chunks[0]!, vector: vector() }]);
    const insertCrossDocument = (documentId: string) => pool.query(
      `INSERT INTO filing_intelligence.filing_chunk_embedding
        (generation_id,document_id,chunk_row_id,chunk_id,input_fingerprint,vector_fingerprint,embedding)
       VALUES($1,$2,$3,$4,$5,$6,$7::vector)`,
      [first.generation.generationId, documentId, second.chunks[0]!.chunkRowId, second.chunks[0]!.chunkId,
        second.chunks[0]!.inputFingerprint, 'a'.repeat(64), `[${vector(3).join(',')}]`],
    );
    await assert.rejects(insertCrossDocument(firstDocument.documentId));
    await assert.rejects(insertCrossDocument(secondDocument.documentId));
    await assert.rejects(pool.query('DELETE FROM filing_intelligence.filing_chunk WHERE id=$1', [first.chunks[0]!.chunkRowId]));
    await assert.rejects(pool.query('DELETE FROM filing_intelligence.filing_dense_generation WHERE id=$1', [first.generation.generationId]));
    await assert.rejects(pool.query('DELETE FROM filing_intelligence.filing_document WHERE id=$1', [firstDocument.documentId]));
    await assert.rejects(pool.query("UPDATE filing_intelligence.filing_dense_generation SET status='ready' WHERE id=$1", [second.generation.generationId]));
    await assert.rejects(pool.query("UPDATE filing_intelligence.filing_dense_generation SET status='failed' WHERE id=$1", [second.generation.generationId]));
    await pool.query(
      "UPDATE filing_intelligence.filing_dense_generation SET status='failed',failure_code='DENSE_TEST_FAILURE' WHERE id=$1",
      [second.generation.generationId],
    );
    const failed = await pool.query<{ status: string; failure_code: string }>(
      'SELECT status,failure_code FROM filing_intelligence.filing_dense_generation WHERE id=$1',
      [second.generation.generationId],
    );
    assert.deepEqual(failed.rows[0], { status: 'failed', failure_code: 'DENSE_TEST_FAILURE' });
  });

  await t.test('inactive documents support bounded 100-vector batch persistence', async () => {
    await clearPersistence(pool);
    const paragraphTexts = Array.from({ length: 100 }, (_, index) => `${index} ${'가'.repeat(260)}`);
    const persisted = await new FilingDocumentRepository(pool).persistCanonicalFiling(syntheticPersistenceInputFor({
      receiptNumber: '20990101000905', corpCode: '33333333', symbol: '333333', paragraphTexts,
    }));
    const activationCount = await pool.query<{ count: number }>(
      'SELECT count(*)::integer count FROM filing_intelligence.filing_retrieval_activation',
    );
    assert.equal(activationCount.rows[0]!.count, 0);
    const dense = new FilingDenseRepository(pool);
    const created = await dense.createGeneration(persisted.documentId, FILING_DENSE_PROFILES.openAiSmall1536.profileId);
    assert.ok(created.chunks.length >= 100);
    for (let offset = 0; offset < created.chunks.length; offset += 100) {
      const batch = created.chunks.slice(offset, offset + 100)
        .map((chunk, index) => ({ ...chunk, vector: vector(offset + index + 1) }));
      await dense.persistVectorBatch(created.generation.generationId, batch);
    }
    const ready = await dense.finalizeGeneration(created.generation.generationId);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.persistedVectorCount, created.chunks.length);
  });
});
