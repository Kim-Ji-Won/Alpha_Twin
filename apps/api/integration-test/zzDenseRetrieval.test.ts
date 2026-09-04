import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { FilingDenseError } from '../src/filingIntelligence/dense/errors.js';
import { FilingDenseRepository } from '../src/filingIntelligence/dense/filingDenseRepository.js';
import {
  EXACT_DENSE_RETRIEVAL_SQL,
  FilingDenseRetrievalRepository,
} from '../src/filingIntelligence/dense/filingDenseRetrievalRepository.js';
import { FILING_DENSE_PROFILES } from '../src/filingIntelligence/dense/profile.js';
import {
  DenseReadyGenerationReference,
  RetrieveDenseFilingChunksInput,
} from '../src/filingIntelligence/dense/retrievalContracts.js';
import { FilingDocumentRepository } from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import { clearPersistence, requiredTestDatabaseUrl, runMigrations } from './helpers/database.js';
import { syntheticPersistenceInputFor } from './helpers/filingFixture.js';

const COMPANY = { corpCode: '77777777', symbol: '777777' };
const OTHER_COMPANY = { corpCode: '88888888', symbol: '888888' };
const PROFILE = FILING_DENSE_PROFILES.openAiSmall1536;

const axis = (x: number, y = 0): number[] => {
  const value = Array<number>(1536).fill(0);
  value[0] = x;
  value[1] = y;
  return value;
};

const denseError = (code: FilingDenseError['code']) => (value: unknown) =>
  value instanceof FilingDenseError && value.code === code;

async function persistDocument(
  pool: Pool,
  receiptNumber: string,
  company = COMPANY,
) {
  return new FilingDocumentRepository(pool).persistCanonicalFiling(
    syntheticPersistenceInputFor({
      receiptNumber,
      ...company,
      paragraphTexts: [`${receiptNumber} dense retrieval evidence`],
    }),
  );
}

async function createReadyGeneration(
  pool: Pool,
  receiptNumber: string,
  vector: readonly number[],
  company = COMPANY,
) {
  const document = await persistDocument(pool, receiptNumber, company);
  const dense = new FilingDenseRepository(pool);
  const created = await dense.createGeneration(document.documentId, PROFILE.profileId);
  for (let offset = 0; offset < created.chunks.length; offset += 100) {
    await dense.persistVectorBatch(
      created.generation.generationId,
      created.chunks.slice(offset, offset + 100).map(chunk => ({ ...chunk, vector })),
    );
  }
  const generation = await dense.finalizeGeneration(created.generation.generationId);
  assert.equal(generation.status, 'ready');
  return { document, created, generation };
}

function countedPool(pool: Pool, count: () => void): Pool {
  return {
    query(text: string, values?: unknown[]) {
      count();
      return pool.query(text, values);
    },
  } as unknown as Pool;
}

async function authoritativeState(pool: Pool): Promise<readonly string[]> {
  const tables = [
    'filing_dense_generation',
    'filing_chunk_embedding',
    'filing_dense_generation_job',
    'filing_dense_generation_attempt',
    'filing_retrieval_eligibility',
    'filing_retrieval_activation',
    'filing_retrieval_activation_history',
    'filing_family_resolution_control',
  ];
  const result: string[] = [];
  for (const table of tables) {
    const rows = await pool.query<{ snapshot: unknown }>(
      `SELECT coalesce(jsonb_agg(to_jsonb(value) ORDER BY to_jsonb(value)::text), '[]')
         AS snapshot FROM filing_intelligence.${table} AS value`,
    );
    result.push(JSON.stringify(rows.rows[0]?.snapshot));
  }
  const legacy = await pool.query<{ snapshot: unknown }>(
    `SELECT coalesce(jsonb_agg(jsonb_build_object(
       'id', id::text,
       'isCurrentEffective', is_current_effective,
       'isRetrievalReady', is_retrieval_ready,
       'activatedAt', activated_at
     ) ORDER BY id), '[]') AS snapshot
     FROM filing_intelligence.filing_document`,
  );
  result.push(JSON.stringify(legacy.rows[0]?.snapshot));
  return result;
}

function exactParameters(input: RetrieveDenseFilingChunksInput): readonly unknown[] {
  const topK = input.topK ?? 8;
  return [
    input.generations.map(value => value.documentId),
    input.generations.map(value => value.generationId),
    input.generations.map(value => value.generationFingerprint),
    input.generations.map(value => value.representationFingerprint),
    input.generations.map(value => value.inputManifestFingerprint),
    input.generations.map(value => value.expectedVectorCount),
    input.corpCode,
    input.symbol,
    input.denseProfileId,
    input.denseProfileFingerprint,
    1536,
    `[${input.queryVector.map(value => Math.fround(value)).join(',')}]`,
    topK,
  ];
}

function explainMetrics(value: unknown) {
  if (!Array.isArray(value) || typeof value[0] !== 'object' || value[0] === null) {
    throw new Error('EXPLAIN JSON result is invalid');
  }
  const report = value[0] as Record<string, unknown>;
  if (typeof report.Plan !== 'object' || report.Plan === null
    || typeof report['Execution Time'] !== 'number') {
    throw new Error('EXPLAIN JSON report is incomplete');
  }
  const plan = report.Plan as Record<string, unknown>;
  if (typeof plan['Node Type'] !== 'string' || typeof plan['Actual Rows'] !== 'number') {
    throw new Error('EXPLAIN root plan is incomplete');
  }
  const hits = typeof plan['Shared Hit Blocks'] === 'number' ? plan['Shared Hit Blocks'] : 0;
  const reads = typeof plan['Shared Read Blocks'] === 'number' ? plan['Shared Read Blocks'] : 0;
  return {
    node: plan['Node Type'],
    actualRows: plan['Actual Rows'],
    sharedBuffers: hits + reads,
    executionMs: report['Execution Time'],
  };
}

test('verified dense readiness and exact cosine PostgreSQL integration', async t => {
  const databaseUrl = requiredTestDatabaseUrl();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 8,
    statement_timeout: 60_000,
    application_name: 'alpha-twin-dense-retrieval-integration-test',
  });
  t.after(async () => pool.end());
  await runMigrations('up', databaseUrl, true);

  await t.test('full-scope readiness preserves order and exact geometry is read-only', async () => {
    await clearPersistence(pool);
    const positive = await createReadyGeneration(pool, '20990201000001', axis(1));
    const orthogonal = await createReadyGeneration(pool, '20990201000002', axis(0, 1));
    const negative = await createReadyGeneration(pool, '20990201000003', axis(-1));
    let queryCount = 0;
    const repository = new FilingDenseRetrievalRepository(countedPool(pool, () => {
      queryCount += 1;
    }));
    const before = await authoritativeState(pool);
    const documentIds = [
      negative.document.documentId,
      positive.document.documentId,
      orthogonal.document.documentId,
    ];
    const readiness = await repository.resolveDenseReadiness({
      ...COMPANY,
      documentIds,
      denseProfileId: PROFILE.profileId,
    });
    assert.equal(readiness.status, 'ready');
    if (readiness.status !== 'ready') return;
    assert.deepEqual(readiness.generations.map(value => value.documentId), documentIds);
    const candidates = await repository.retrieveDenseFilingChunks({
      ...COMPANY,
      generations: readiness.generations,
      denseProfileId: PROFILE.profileId,
      denseProfileFingerprint: PROFILE.profileFingerprint,
      queryVector: axis(1),
      topK: 20,
    });
    const after = await authoritativeState(pool);
    assert.equal(queryCount, 2);
    assert.deepEqual(after, before);
    assert.ok(candidates.length > 0);
    assert.deepEqual(candidates.map(value => value.denseRank),
      candidates.map((_, index) => index + 1));
    for (let index = 1; index < candidates.length; index += 1) {
      assert.ok(candidates[index - 1]!.denseSimilarity >= candidates[index]!.denseSimilarity);
    }
    assert.equal(candidates[0]!.documentId, positive.document.documentId);
    assert.equal(candidates.at(-1)!.documentId, negative.document.documentId);
    assert.ok(candidates.some(value => value.documentId === orthogonal.document.documentId
      && Math.abs(value.denseSimilarity) < 1e-12));
  });

  await t.test('missing, building, and failed generations make the full scope not ready', async () => {
    await clearPersistence(pool);
    const ready = await createReadyGeneration(pool, '20990202000001', axis(1));
    const buildingDocument = await persistDocument(pool, '20990202000002');
    const failedDocument = await persistDocument(pool, '20990202000003');
    const missingDocument = await persistDocument(pool, '20990202000004');
    const dense = new FilingDenseRepository(pool);
    const building = await dense.createGeneration(buildingDocument.documentId, PROFILE.profileId);
    const failed = await dense.createGeneration(failedDocument.documentId, PROFILE.profileId);
    await pool.query(
      `UPDATE filing_intelligence.filing_dense_generation
       SET status = 'failed', failure_code = 'DENSE_TEST_FAILURE'
       WHERE id = $1`,
      [failed.generation.generationId],
    );
    const readiness = await new FilingDenseRetrievalRepository(pool).resolveDenseReadiness({
      ...COMPANY,
      documentIds: [ready.document.documentId, buildingDocument.documentId,
        failedDocument.documentId, missingDocument.documentId],
      denseProfileId: PROFILE.profileId,
    });
    assert.equal(readiness.status, 'not_ready');
    if (readiness.status !== 'not_ready') return;
    assert.deepEqual(readiness.generations, []);
    assert.deepEqual(readiness.reasons, [
      { documentId: buildingDocument.documentId, reason: 'generation_building' },
      { documentId: failedDocument.documentId, reason: 'generation_failed' },
      { documentId: missingDocument.documentId, reason: 'generation_missing' },
    ]);
    assert.equal(building.generation.status, 'building');
  });

  await t.test('search-time generation drift fails the whole scope without subset results', async () => {
    await clearPersistence(pool);
    const first = await createReadyGeneration(pool, '20990202500001', axis(1));
    const second = await createReadyGeneration(pool, '20990202500002', axis(0, 1));
    const repository = new FilingDenseRetrievalRepository(pool);
    const readiness = await repository.resolveDenseReadiness({
      ...COMPANY,
      documentIds: [first.document.documentId, second.document.documentId],
      denseProfileId: PROFILE.profileId,
    });
    assert.equal(readiness.status, 'ready');
    if (readiness.status !== 'ready') return;

    await pool.query(
      `UPDATE filing_intelligence.filing_dense_generation
       SET status = 'building', generation_fingerprint = NULL, ready_at = NULL
       WHERE id = $1`,
      [second.generation.generationId],
    );
    await assert.rejects(repository.retrieveDenseFilingChunks({
      ...COMPANY,
      generations: readiness.generations,
      denseProfileId: PROFILE.profileId,
      denseProfileFingerprint: PROFILE.profileFingerprint,
      queryVector: axis(1),
      topK: 20,
    }), denseError('FILING_DENSE_RETRIEVAL_SCOPE_FAILURE'));
  });

  await t.test('profile, representation, input manifest, and vector count drift fail closed',
    async () => {
      const cases = [
        {
          receipt: '20990203000001',
          corrupt: (generationId: string) => pool.query(
            `UPDATE filing_intelligence.filing_dense_generation
             SET dense_profile_fingerprint = repeat('a', 64) WHERE id = $1`,
            [generationId],
          ),
        },
        {
          receipt: '20990203000002',
          corrupt: (_generationId: string, documentId: string) => pool.query(
            `UPDATE filing_intelligence.filing_chunk
             SET content_hash = repeat('b', 64) WHERE document_id = $1`,
            [documentId],
          ),
        },
        {
          receipt: '20990203000003',
          corrupt: (generationId: string) => pool.query(
            `UPDATE filing_intelligence.filing_dense_generation
             SET input_manifest_fingerprint = repeat('c', 64) WHERE id = $1`,
            [generationId],
          ),
        },
        {
          receipt: '20990203000004',
          corrupt: (generationId: string) => pool.query(
            `DELETE FROM filing_intelligence.filing_chunk_embedding
             WHERE generation_id = $1 AND chunk_row_id = (
               SELECT min(chunk_row_id) FROM filing_intelligence.filing_chunk_embedding
               WHERE generation_id = $1
             )`,
            [generationId],
          ),
        },
      ];
      for (const current of cases) {
        await clearPersistence(pool);
        const value = await createReadyGeneration(pool, current.receipt, axis(1));
        await current.corrupt(value.generation.generationId, value.document.documentId);
        await assert.rejects(
          new FilingDenseRetrievalRepository(pool).resolveDenseReadiness({
            ...COMPANY,
            documentIds: [value.document.documentId],
            denseProfileId: PROFILE.profileId,
          }),
          denseError('FILING_DENSE_GENERATION_INTEGRITY_FAILURE'),
        );
      }
    });

  await t.test('same-distance candidates use numeric document, ordinal, and chunk ID ties', async () => {
    await clearPersistence(pool);
    const second = await createReadyGeneration(pool, '20990204000002', axis(1));
    const first = await createReadyGeneration(pool, '20990204000001', axis(1));
    const repository = new FilingDenseRetrievalRepository(pool);
    const readiness = await repository.resolveDenseReadiness({
      ...COMPANY,
      documentIds: [second.document.documentId, first.document.documentId],
      denseProfileId: PROFILE.profileId,
    });
    assert.equal(readiness.status, 'ready');
    if (readiness.status !== 'ready') return;
    const input = {
      ...COMPANY,
      generations: readiness.generations,
      denseProfileId: PROFILE.profileId,
      denseProfileFingerprint: PROFILE.profileFingerprint,
      queryVector: axis(1),
      topK: 20,
    } as const;
    const firstRun = await repository.retrieveDenseFilingChunks(input);
    const secondRun = await repository.retrieveDenseFilingChunks(input);
    assert.deepEqual(secondRun, firstRun);
    const ordering = firstRun.map(value => [BigInt(value.documentId), value.ordinal, value.chunkId] as const);
    assert.deepEqual(ordering, [...ordering].sort((left, right) =>
      left[0] < right[0] ? -1 : left[0] > right[0] ? 1
        : left[1] - right[1] || left[2].localeCompare(right[2])));
  });

  await t.test('cross-company and mismatched generation scopes fail closed', async () => {
    await clearPersistence(pool);
    const local = await createReadyGeneration(pool, '20990205000001', axis(0, 1));
    const foreign = await createReadyGeneration(pool, '20990205000002', axis(1), OTHER_COMPANY);
    const repository = new FilingDenseRetrievalRepository(pool);
    const localReady = await repository.resolveDenseReadiness({
      ...COMPANY,
      documentIds: [local.document.documentId],
      denseProfileId: PROFILE.profileId,
    });
    const foreignReady = await repository.resolveDenseReadiness({
      ...OTHER_COMPANY,
      documentIds: [foreign.document.documentId],
      denseProfileId: PROFILE.profileId,
    });
    assert.equal(localReady.status, 'ready');
    assert.equal(foreignReady.status, 'ready');
    if (localReady.status !== 'ready' || foreignReady.status !== 'ready') return;
    const common = {
      ...COMPANY,
      denseProfileId: PROFILE.profileId,
      denseProfileFingerprint: PROFILE.profileFingerprint,
      queryVector: axis(1),
    } as const;
    await assert.rejects(repository.retrieveDenseFilingChunks({
      ...common,
      generations: foreignReady.generations,
    }), denseError('FILING_DENSE_RETRIEVAL_SCOPE_FAILURE'));
    const forged: DenseReadyGenerationReference = {
      ...localReady.generations[0]!,
      generationId: foreignReady.generations[0]!.generationId,
      generationFingerprint: foreignReady.generations[0]!.generationFingerprint,
    };
    await assert.rejects(repository.retrieveDenseFilingChunks({
      ...common,
      generations: [forged],
    }), denseError('FILING_DENSE_RETRIEVAL_SCOPE_FAILURE'));
    await assert.rejects(repository.retrieveDenseFilingChunks({
      ...common,
      generations: [{
        ...localReady.generations[0]!,
        generationFingerprint: 'f'.repeat(64),
      }],
    }), denseError('FILING_DENSE_RETRIEVAL_SCOPE_FAILURE'));
    const historicalTechnicalResult = await repository.retrieveDenseFilingChunks({
      ...common,
      generations: localReady.generations,
    });
    assert.ok(historicalTechnicalResult.length > 0);
  });

  await t.test('exact plans remain scoped for 1, 5, and 20 requested generations', async t => {
    await clearPersistence(pool);
    const documents = [];
    for (let index = 0; index < 20; index += 1) {
      documents.push(await createReadyGeneration(
        pool,
        `20990206${String(index).padStart(6, '0')}`,
        axis(1, index / 100),
      ));
    }
    const repository = new FilingDenseRetrievalRepository(pool);
    for (const scopeSize of [1, 5, 20]) {
      const readiness = await repository.resolveDenseReadiness({
        ...COMPANY,
        documentIds: documents.slice(0, scopeSize).map(value => value.document.documentId),
        denseProfileId: PROFILE.profileId,
      });
      assert.equal(readiness.status, 'ready');
      if (readiness.status !== 'ready') continue;
      const input: RetrieveDenseFilingChunksInput = {
        ...COMPANY,
        denseProfileId: PROFILE.profileId,
        denseProfileFingerprint: PROFILE.profileFingerprint,
        generations: readiness.generations,
        queryVector: axis(1),
        topK: scopeSize === 1 ? 5 : scopeSize === 5 ? 10 : 20,
      };
      const explain = await pool.query<Record<string, unknown>>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${EXACT_DENSE_RETRIEVAL_SQL}`,
        [...exactParameters(input)],
      );
      const plan = JSON.stringify(explain.rows[0]?.['QUERY PLAN']);
      assert.match(plan, /filing_chunk_embedding/u);
      assert.match(plan, /filing_dense_generation/u);
      assert.doesNotMatch(plan, /filing_retrieval_activation|filing_retrieval_activation_history/u);
      assert.doesNotMatch(plan, /hnsw|ivfflat/iu);
      const metrics = explainMetrics(explain.rows[0]?.['QUERY PLAN']);
      assert.ok(metrics.actualRows > 0 && metrics.actualRows <= (input.topK ?? 8));
      assert.ok(metrics.sharedBuffers >= 0);
      assert.ok(metrics.executionMs >= 0);
      const candidateRows = readiness.generations.reduce(
        (sum, value) => sum + value.expectedVectorCount,
        0,
      );
      t.diagnostic(`scope=${scopeSize} candidates=${candidateRows} topK=${input.topK}`
        + ` root=${metrics.node} rows=${metrics.actualRows}`
        + ` sharedBuffers=${metrics.sharedBuffers} executionMs=${metrics.executionMs}`);
    }
  });
});
