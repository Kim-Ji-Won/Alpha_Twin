import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import {
  FilingDocumentRepository,
} from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import {
  FilingPersistenceError,
} from '../src/filingIntelligence/persistence/errors.js';
import { loadConfig } from '../src/config.js';
import { DatabaseRuntime } from '../src/infrastructure/database/runtime.js';
import {
  clearPersistence,
  requiredTestDatabaseUrl,
  runMigrations,
} from './helpers/database.js';
import {
  syntheticPersistenceInput,
} from './helpers/filingFixture.js';

function persistenceError(code: FilingPersistenceError['code']) {
  return (error: unknown) =>
    error instanceof FilingPersistenceError
    && error.code === code;
}

async function relationExists(
  pool: Pool,
  relation: string,
): Promise<boolean> {
  const result = await pool.query<{ relation: string | null }>(
    'SELECT to_regclass($1)::text AS relation',
    [relation],
  );
  return result.rows[0]?.relation != null;
}

test('canonical filing PostgreSQL integration', async t => {
  const databaseUrl = requiredTestDatabaseUrl();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 30_000,
    application_name: 'alpha-twin-db-integration-test',
  });
  t.after(async () => {
    await pool.end();
  });

  await t.test('migration up, no-op up, down, and re-up preserve the expected schema', async () => {
    await runMigrations('up', databaseUrl);
    for (const table of [
      'filing_intelligence.filing_document',
      'filing_intelligence.filing_section',
      'filing_intelligence.filing_block',
      'filing_intelligence.filing_chunk',
      'public.pgmigrations',
    ]) {
      assert.equal(await relationExists(pool, table), true);
    }

    const constraints = await pool.query<{ constraint_name: string }>(
      `SELECT constraint_name
       FROM information_schema.table_constraints
       WHERE constraint_schema = 'filing_intelligence'`,
    );
    const constraintNames = new Set(constraints.rows.map(row => row.constraint_name));
    for (const name of [
      'filing_document_source_identity_unique',
      'filing_section_parent_fk',
      'filing_block_section_fk',
      'filing_chunk_section_fk',
      'filing_block_table_data_check',
      'filing_chunk_block_types_check',
    ]) {
      assert.equal(constraintNames.has(name), true, name);
    }

    const columns = await pool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
    }>(
      `SELECT table_name, column_name, data_type, udt_name
       FROM information_schema.columns
       WHERE table_schema = 'filing_intelligence'`,
    );
    const columnTypes = new Map(
      columns.rows.map(row => [
        `${row.table_name}.${row.column_name}`,
        `${row.data_type}:${row.udt_name}`,
      ]),
    );
    assert.equal(columnTypes.get('filing_document.id'), 'bigint:int8');
    assert.equal(
      columnTypes.get('filing_document.canonical_schema_version'),
      'text:text',
    );
    assert.equal(columnTypes.get('filing_block.locator'), 'jsonb:jsonb');
    assert.equal(columnTypes.get('filing_block.table_data'), 'jsonb:jsonb');
    assert.equal(columnTypes.get('filing_chunk.source_block_ids'), 'ARRAY:_text');
    assert.equal(columnTypes.get('filing_chunk.locator'), 'jsonb:jsonb');

    const indexes = await pool.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'filing_intelligence'`,
    );
    const indexNames = new Set(indexes.rows.map(row => row.indexname));
    for (const name of [
      'filing_document_symbol_filing_date_idx',
      'filing_document_corp_code_filing_date_idx',
      'filing_section_parent_idx',
      'filing_block_section_ordinal_idx',
      'filing_chunk_section_ordinal_idx',
      'filing_chunk_content_hash_idx',
    ]) {
      assert.equal(indexNames.has(name), true, name);
    }

    await runMigrations('up', databaseUrl);
    await runMigrations('down', databaseUrl);
    assert.equal(
      await relationExists(pool, 'filing_intelligence.filing_document'),
      false,
    );
    assert.equal(
      await relationExists(pool, 'filing_intelligence.filing_chunk'),
      false,
    );
    await runMigrations('up', databaseUrl);
  });

  await t.test('readiness reports ready against the migrated schema', async () => {
    const runtime = new DatabaseRuntime(loadConfig({
      LOG_LEVEL: 'silent',
      FILING_PERSISTENCE_ENABLED: 'true',
      DATABASE_URL: databaseUrl,
    }));
    assert.deepEqual(await runtime.probeReadiness(), { status: 'ready' });
    await runtime.close();
  });

  await t.test('happy path is lossless and ordered across bounded batches', async () => {
    await clearPersistence(pool);
    const input = syntheticPersistenceInput(12);
    const reordered = {
      ...input,
      document: {
        ...input.document,
        blocks: [...input.document.blocks].reverse(),
      },
      chunks: [...input.chunks].reverse(),
    };
    const repository = new FilingDocumentRepository(pool, { batchSize: 2 });
    const result = await repository.persistCanonicalFiling(reordered);
    assert.equal(result.status, 'inserted');
    const snapshot = await repository.getPersistenceSnapshot(result.documentId);
    assert.ok(snapshot);
    assert.equal(snapshot.document.sectionCount, input.document.statistics.sectionCount);
    assert.equal(snapshot.document.blockCount, input.document.blocks.length);
    assert.equal(snapshot.document.chunkCount, input.chunks.length);
    assert.equal(snapshot.document.isRetrievalReady, false);
    assert.deepEqual(
      snapshot.sections.map(section => section.ordinal),
      snapshot.sections.map((_, index) => index),
    );
    assert.deepEqual(
      snapshot.blocks.map(block => block.ordinal),
      snapshot.blocks.map((_, index) => index),
    );
    assert.deepEqual(
      snapshot.chunks.map(chunk => chunk.ordinal),
      snapshot.chunks.map((_, index) => index),
    );

    const canonicalTableBlock = input.document.blocks.find(
      block => block.type === 'table',
    );
    assert.ok(canonicalTableBlock?.type === 'table');
    const storedTableBlock = snapshot.blocks.find(
      block => block.blockId === canonicalTableBlock.blockId,
    );
    assert.deepEqual(storedTableBlock?.tableData, canonicalTableBlock.table);
    assert.deepEqual(storedTableBlock?.locator, canonicalTableBlock.locator);
    assert.equal(storedTableBlock?.sourceText, canonicalTableBlock.sourceText);
    assert.equal(storedTableBlock?.retrievalText, canonicalTableBlock.retrievalText);
    const storedTableText = JSON.stringify(storedTableBlock?.tableData);
    for (const numericText of ['001', '1,000', '-12.4%', '0.00']) {
      assert.match(storedTableText, new RegExp(numericText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  await t.test('identical persistence is a write-free no-op with stable identity', async () => {
    await clearPersistence(pool);
    const input = syntheticPersistenceInput();
    const repository = new FilingDocumentRepository(pool);
    const first = await repository.persistCanonicalFiling(input);
    const before = await repository.getPersistenceSnapshot(first.documentId);
    const second = await repository.persistCanonicalFiling(input);
    const after = await repository.getPersistenceSnapshot(first.documentId);
    assert.equal(first.status, 'inserted');
    assert.equal(second.status, 'already_present');
    assert.equal(second.documentId, first.documentId);
    assert.equal(after?.document.createdAt.toISOString(), before?.document.createdAt.toISOString());
    assert.deepEqual(
      [after?.sections.length, after?.blocks.length, after?.chunks.length],
      [before?.sections.length, before?.blocks.length, before?.chunks.length],
    );
  });

  await t.test('same source identity with a different fingerprint is a safe conflict', async () => {
    await clearPersistence(pool);
    const input = syntheticPersistenceInput();
    const repository = new FilingDocumentRepository(pool);
    const first = await repository.persistCanonicalFiling(input);
    const conflicting = {
      ...input,
      metadata: {
        ...input.metadata,
        companyName: 'ALPHA TWIN DIFFERENT TEST COMPANY',
      },
    };
    await assert.rejects(
      repository.persistCanonicalFiling(conflicting),
      persistenceError('FILING_PERSISTENCE_CONFLICT'),
    );
    const counts = await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM filing_intelligence.filing_document',
    );
    assert.equal(counts.rows[0]?.count, 1);
    assert.ok(await repository.getPersistenceSnapshot(first.documentId));
  });

  await t.test('a stored chunk generation is never overwritten by another version', async () => {
    await clearPersistence(pool);
    const input = syntheticPersistenceInput();
    const repository = new FilingDocumentRepository(pool);
    const first = await repository.persistCanonicalFiling(input);
    await pool.query(
      `UPDATE filing_intelligence.filing_document
       SET chunker_version = '0.9.0', chunk_fingerprint = repeat('f', 64)
       WHERE id = $1`,
      [first.documentId],
    );
    await pool.query(
      `UPDATE filing_intelligence.filing_chunk
       SET chunker_version = '0.9.0'
       WHERE document_id = $1`,
      [first.documentId],
    );

    await assert.rejects(
      repository.persistCanonicalFiling(input),
      persistenceError('FILING_PERSISTENCE_CONFLICT'),
    );
    const snapshot = await repository.getPersistenceSnapshot(first.documentId);
    assert.equal(snapshot?.document.chunkerVersion, '0.9.0');
    assert.equal(snapshot?.document.chunkFingerprint, 'f'.repeat(64));
    assert.equal(snapshot?.chunks.length, input.chunks.length);
    const versions = await pool.query<{ chunker_version: string }>(
      `SELECT DISTINCT chunker_version
       FROM filing_intelligence.filing_chunk
       WHERE document_id = $1`,
      [first.documentId],
    );
    assert.deepEqual(versions.rows, [{ chunker_version: '0.9.0' }]);
  });

  await t.test('a middle batch failure rolls back document and all child rows', async () => {
    await clearPersistence(pool);
    await pool.query(`
      CREATE FUNCTION filing_intelligence.reject_synthetic_block()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.ordinal = 4 THEN
          RAISE EXCEPTION 'synthetic rollback check' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_synthetic_block
      BEFORE INSERT ON filing_intelligence.filing_block
      FOR EACH ROW EXECUTE FUNCTION filing_intelligence.reject_synthetic_block();
    `);
    try {
      const repository = new FilingDocumentRepository(pool, { batchSize: 2 });
      await assert.rejects(
        repository.persistCanonicalFiling(syntheticPersistenceInput(12)),
        persistenceError('FILING_PERSISTENCE_INTEGRITY_FAILURE'),
      );
      for (const table of [
        'filing_document',
        'filing_section',
        'filing_block',
        'filing_chunk',
      ]) {
        const result = await pool.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM filing_intelligence.${table}`,
        );
        assert.equal(result.rows[0]?.count, 0, table);
      }
    } finally {
      await pool.query(`
        DROP TRIGGER reject_synthetic_block ON filing_intelligence.filing_block;
        DROP FUNCTION filing_intelligence.reject_synthetic_block();
      `);
    }
  });

  await t.test('composite foreign keys reject cross-document section references', async () => {
    await clearPersistence(pool);
    const input = syntheticPersistenceInput();
    const repository = new FilingDocumentRepository(pool);
    const first = await repository.persistCanonicalFiling(input);
    const firstSectionId = input.document.sections[0]!.sectionId;
    const second = await pool.query<{ id: string }>(
      `INSERT INTO filing_intelligence.filing_document (
         provider, receipt_number, corp_code, symbol, source_entry_name,
         source_entry_hash, source_entry_byte_length, canonical_schema_name,
         canonical_schema_version, parser_version, chunk_schema_version,
         chunker_version, canonical_fingerprint, chunk_fingerprint,
         section_count, block_count, chunk_count
       ) VALUES (
         'opendart-fss', '20990101000002', '99999998', '999998', 'second.xml',
         repeat('a', 64), 1, 'canonical-filing-document', '1', '1.0.1', '1',
         '1.0.1', repeat('b', 64), repeat('c', 64), 0, 0, 0
       ) RETURNING id::text`,
    );
    const secondId = second.rows[0]!.id;
    await assert.rejects(
      pool.query(
        `INSERT INTO filing_intelligence.filing_section (
           document_id, section_id, parent_section_id, title, depth, ordinal,
           path, block_ids
         ) VALUES ($1, 'sec_second', $2, 'invalid parent', 1, 0, ARRAY['x'], ARRAY[]::text[])`,
        [secondId, firstSectionId],
      ),
      (error: unknown) =>
        typeof error === 'object' && error !== null
        && 'code' in error && error.code === '23503',
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO filing_intelligence.filing_block (
           document_id, section_id, block_id, block_type, ordinal, section_path,
           source_text, retrieval_text, content_hash, locator, table_data
         ) VALUES (
           $1, $2, 'blk_second', 'paragraph', 0, ARRAY['x'], 'x', 'x',
           repeat('d', 64), '{}'::jsonb, NULL
         )`,
        [secondId, firstSectionId],
      ),
      (error: unknown) =>
        typeof error === 'object' && error !== null
        && 'code' in error && error.code === '23503',
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO filing_intelligence.filing_chunk (
           document_id, chunk_id, chunk_schema_version, parser_version,
           chunker_version, ordinal, section_id, section_path, source_block_ids,
           source_block_types, source_text, retrieval_text, content_hash,
           source_char_count, retrieval_char_count, locator
         ) VALUES (
           $1, 'chk_second', '1', '1.0.1', '1.0.1', 0, $2, ARRAY['x'],
           ARRAY['blk_second'], ARRAY['paragraph'], 'x', 'x', repeat('e', 64),
           1, 1, '{}'::jsonb
         )`,
        [secondId, firstSectionId],
      ),
      (error: unknown) =>
        typeof error === 'object' && error !== null
        && 'code' in error && error.code === '23503',
    );
    assert.ok(await repository.getPersistenceSnapshot(first.documentId));
  });

  await t.test('unknown chunk source blocks fail before any database write', async () => {
    await clearPersistence(pool);
    const input = syntheticPersistenceInput();
    const firstChunk = input.chunks[0]!;
    const invalid = {
      ...input,
      chunks: [
        {
          ...firstChunk,
          sourceBlockIds: ['blk_missing'],
          blockTypes: ['paragraph'] as const,
        },
        ...input.chunks.slice(1),
      ],
    };
    const repository = new FilingDocumentRepository(pool);
    await assert.rejects(
      repository.persistCanonicalFiling(invalid),
      persistenceError('FILING_PERSISTENCE_INVALID_INPUT'),
    );
    const result = await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM filing_intelligence.filing_document',
    );
    assert.equal(result.rows[0]?.count, 0);
  });

  await t.test('concurrent identical persistence converges without duplicates', async () => {
    await clearPersistence(pool);
    const input = syntheticPersistenceInput(20);
    const repository = new FilingDocumentRepository(pool, { batchSize: 3 });
    const results = await Promise.all([
      repository.persistCanonicalFiling(input),
      repository.persistCanonicalFiling(input),
    ]);
    assert.deepEqual(
      results.map(result => result.status).sort(),
      ['already_present', 'inserted'],
    );
    assert.equal(results[0]?.documentId, results[1]?.documentId);
    const counts = await pool.query<{
      documents: number;
      sections: number;
      blocks: number;
      chunks: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM filing_intelligence.filing_document) AS documents,
         (SELECT count(*)::integer FROM filing_intelligence.filing_section) AS sections,
         (SELECT count(*)::integer FROM filing_intelligence.filing_block) AS blocks,
         (SELECT count(*)::integer FROM filing_intelligence.filing_chunk) AS chunks`,
    );
    assert.deepEqual(counts.rows[0], {
      documents: 1,
      sections: input.document.statistics.sectionCount,
      blocks: input.document.blocks.length,
      chunks: input.chunks.length,
    });
  });

  await t.test('concurrent differing fingerprints insert once and conflict once', async () => {
    await clearPersistence(pool);
    const input = syntheticPersistenceInput(20);
    const conflicting = {
      ...input,
      metadata: {
        ...input.metadata,
        companyName: 'ALPHA TWIN CONCURRENT CONFLICT COMPANY',
      },
    };
    const repository = new FilingDocumentRepository(pool, { batchSize: 3 });
    const outcomes = await Promise.allSettled([
      repository.persistCanonicalFiling(input),
      repository.persistCanonicalFiling(conflicting),
    ]);
    const fulfilled = outcomes.filter(outcome => outcome.status === 'fulfilled');
    const rejected = outcomes.filter(outcome => outcome.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(fulfilled[0]!.value.status, 'inserted');
    const rejection: unknown = rejected[0]!.reason;
    assert.ok(rejection instanceof FilingPersistenceError);
    assert.equal(rejection.code, 'FILING_PERSISTENCE_CONFLICT');

    const inserted = fulfilled[0]!.value;
    const snapshot = await repository.getPersistenceSnapshot(inserted.documentId);
    assert.equal(
      snapshot?.document.canonicalFingerprint,
      inserted.canonicalFingerprint,
    );
    assert.deepEqual(
      [snapshot?.sections.length, snapshot?.blocks.length, snapshot?.chunks.length],
      [
        input.document.statistics.sectionCount,
        input.document.blocks.length,
        input.chunks.length,
      ],
    );
    const documentCount = await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM filing_intelligence.filing_document',
    );
    assert.equal(documentCount.rows[0]?.count, 1);
  });

  await t.test('stored count corruption is detected instead of treated as a no-op', async () => {
    await clearPersistence(pool);
    const input = syntheticPersistenceInput();
    const repository = new FilingDocumentRepository(pool);
    const result = await repository.persistCanonicalFiling(input);
    await pool.query(
      `UPDATE filing_intelligence.filing_document
       SET block_count = block_count + 1
       WHERE id = $1`,
      [result.documentId],
    );
    await assert.rejects(
      repository.persistCanonicalFiling(input),
      persistenceError('FILING_PERSISTENCE_INTEGRITY_FAILURE'),
    );
  });

  await t.test('actual PostgreSQL version is available without extension dependencies', async () => {
    const version = await pool.query<{ server_version: string }>(
      "SELECT current_setting('server_version') AS server_version",
    );
    assert.match(version.rows[0]!.server_version, /^16\./);
    const vector = await pool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM pg_extension WHERE extname = 'vector'",
    );
    assert.equal(vector.rows[0]?.count, 0);
  });
});
