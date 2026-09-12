import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { FilingEligibilityRepository } from '../src/filingIntelligence/eligibility/filingEligibilityRepository.js';
import { FILING_RETRIEVAL_POLICY } from '../src/filingIntelligence/eligibility/policies.js';
import { FilingLexicalRepository } from '../src/filingIntelligence/lexical/filingLexicalRepository.js';
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
  syntheticLegacyPersistenceInput,
  syntheticPersistenceInput,
  syntheticPersistenceInputFor,
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
      'filing_intelligence.filing_ingestion_job',
      'filing_intelligence.filing_ingestion_attempt',
      'filing_intelligence.filing_lexical_generation',
      'filing_intelligence.filing_chunk_lexical',
      'filing_intelligence.filing_receipt',
      'filing_intelligence.filing_report_family',
      'filing_intelligence.filing_report_family_member',
      'filing_intelligence.filing_correction_relation',
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
      'filing_document_receipt_fk',
      'filing_report_family_root_fk',
      'filing_correction_relation_self_check',
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
    assert.equal(columnTypes.get('filing_document.receipt_id'), 'bigint:int8');
    assert.equal(columnTypes.get('filing_receipt.id'), 'bigint:int8');

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
      'filing_document_receipt_id_idx',
      'filing_receipt_corp_date_idx',
    ]) {
      assert.equal(indexNames.has(name), true, name);
    }

    await runMigrations('up', databaseUrl);
    await runMigrations('down', databaseUrl);
    await runMigrations('down', databaseUrl);
    await runMigrations('down', databaseUrl);
    assert.equal(
      await relationExists(pool, 'filing_intelligence.filing_retrieval_eligibility'),
      false,
    );
    assert.equal(
      await relationExists(pool, 'filing_intelligence.filing_family_resolution_control'),
      true,
    );
    await runMigrations('down', databaseUrl);
    assert.equal(
      await relationExists(pool, 'filing_intelligence.filing_family_resolution_control'),
      false,
    );
    assert.equal(
      await relationExists(pool, 'filing_intelligence.filing_receipt'),
      true,
    );
    await runMigrations('down', databaseUrl);
    assert.equal(
      await relationExists(pool, 'filing_intelligence.filing_receipt'),
      false,
    );
    assert.equal(
      await relationExists(pool, 'filing_intelligence.filing_lexical_generation'),
      true,
    );

    await pool.query(
      `INSERT INTO filing_intelligence.filing_document (
         provider, receipt_number, corp_code, symbol, company_name, report_name,
         report_code, filing_date, source_entry_name, source_entry_hash,
         source_entry_byte_length, canonical_schema_name, canonical_schema_version,
         parser_version, chunk_schema_version, chunker_version,
         canonical_fingerprint, chunk_fingerprint, section_count, block_count, chunk_count
       ) VALUES
       ('opendart-fss', '20990101990001', '11111111', '111111', 'MIGRATION COMPANY',
        '합성 사업보고서', '11011', '2099-01-01', 'first.xml', repeat('a', 64), 1,
        'alpha-twin-filing', '1', '1.0.1', '1', '1.0.1', repeat('b', 64),
        repeat('c', 64), 0, 0, 0),
       ('opendart-fss', '20990101990001', '11111111', '111111', 'MIGRATION COMPANY',
        '합성 사업보고서', '11011', '2099-01-01', 'second.xml', repeat('d', 64), 1,
        'alpha-twin-filing', '1', '1.0.1', '1', '1.0.1', repeat('e', 64),
        repeat('f', 64), 0, 0, 0)`,
    );
    await runMigrations('up', databaseUrl);
    const backfill = await pool.query<{
      receipts: number; documents: number; linked_receipts: number;
      lineage_status: string; families: number; relations: number;
    }>(`SELECT
      (SELECT count(*)::integer FROM filing_intelligence.filing_receipt
        WHERE receipt_number = '20990101990001') AS receipts,
      count(*)::integer AS documents,
      count(DISTINCT receipt_id)::integer AS linked_receipts,
      min(receipt.lineage_status) AS lineage_status,
      (SELECT count(*)::integer FROM filing_intelligence.filing_report_family) AS families,
      (SELECT count(*)::integer FROM filing_intelligence.filing_correction_relation) AS relations
      FROM filing_intelligence.filing_document document
      JOIN filing_intelligence.filing_receipt receipt ON receipt.id = document.receipt_id
      WHERE document.receipt_number = '20990101990001'`);
    assert.deepEqual(backfill.rows[0], {
      receipts: 1, documents: 2, linked_receipts: 1,
      lineage_status: 'unresolved', families: 0, relations: 0,
    });

    await runMigrations('down', databaseUrl);
    await runMigrations('down', databaseUrl);
    await runMigrations('down', databaseUrl);
    await runMigrations('down', databaseUrl);
    await runMigrations('down', databaseUrl);
    await pool.query(
      `UPDATE filing_intelligence.filing_document SET corp_code = '22222222'
       WHERE source_entry_name = 'second.xml'`,
    );
    await assert.rejects(runMigrations('up', databaseUrl));
    assert.equal(await relationExists(pool, 'filing_intelligence.filing_receipt'), false);
    await pool.query(
      `UPDATE filing_intelligence.filing_document SET corp_code = '11111111'
       WHERE source_entry_name = 'second.xml'`,
    );
    await pool.query(
      `UPDATE filing_intelligence.filing_document SET company_name = NULL
       WHERE source_entry_name = 'second.xml'`,
    );
    await assert.rejects(runMigrations('up', databaseUrl));
    assert.equal(await relationExists(pool, 'filing_intelligence.filing_receipt'), false);
    await pool.query(
      `UPDATE filing_intelligence.filing_document SET company_name = 'MIGRATION COMPANY'
       WHERE source_entry_name = 'second.xml'`,
    );
    await runMigrations('up', databaseUrl);
    await runMigrations('down', databaseUrl);
    await runMigrations('down', databaseUrl);
    await runMigrations('down', databaseUrl);
    await runMigrations('down', databaseUrl);
    await runMigrations('down', databaseUrl);
    await runMigrations('down', databaseUrl);
    assert.equal(
      await relationExists(pool, 'filing_intelligence.filing_lexical_generation'),
      false,
    );
    assert.equal(
      await relationExists(pool, 'filing_intelligence.filing_ingestion_job'),
      true,
    );
    await runMigrations('down', databaseUrl);
    assert.equal(
      await relationExists(pool, 'filing_intelligence.filing_ingestion_job'),
      false,
    );
    assert.equal(
      await relationExists(pool, 'filing_intelligence.filing_document'),
      true,
    );
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

  await t.test('starting-HEAD schema upgrades last without mutating existing UTF-8 evidence',
    async () => {
      await runMigrations('up', databaseUrl, true);
      await clearPersistence(pool);
      const repository = new FilingDocumentRepository(pool);
      const stored = await repository.persistCanonicalFiling(syntheticPersistenceInputFor({
        receiptNumber: '20990101990011',
        paragraphTexts: ['existing schema upgrade evidence'],
      }));
      await new FilingLexicalRepository(pool).indexFilingDocumentLexically(stored.documentId);
      const eligibility = await new FilingEligibilityRepository(pool)
        .evaluateDocumentEligibility(stored.documentId, FILING_RETRIEVAL_POLICY.policyId);
      assert.equal(eligibility.status, 'eligible');

      const before = await pool.query<{
        id: string;
        canonical_fingerprint: string;
        chunk_fingerprint: string;
        representation_fingerprint: string;
        eligibility_fingerprint: string;
      }>(
        `SELECT document.id::text, document.canonical_fingerprint,
                document.chunk_fingerprint, manifest.representation_fingerprint,
                eligibility.eligibility_fingerprint
         FROM filing_intelligence.filing_document AS document
         JOIN filing_intelligence.filing_document_representation_manifest AS manifest
           ON manifest.document_id = document.id
         JOIN filing_intelligence.filing_retrieval_eligibility AS eligibility
           ON eligibility.document_id = document.id
         WHERE document.id = $1`,
        [stored.documentId],
      );
      assert.equal(before.rowCount, 1);

      await runMigrations('down', databaseUrl, true);
      const baselineHistory = await pool.query<{ name: string }>(
        'SELECT name FROM public.pgmigrations ORDER BY id DESC LIMIT 1',
      );
      assert.equal(
        baselineHistory.rows[0]?.name,
        '1755122400000_dense-generation-queue',
      );
      const baseline = await pool.query<{
        id: string;
        canonical_fingerprint: string;
        chunk_fingerprint: string;
        representation_fingerprint: string;
        eligibility_fingerprint: string;
      }>(
        `SELECT document.id::text, document.canonical_fingerprint,
                document.chunk_fingerprint, manifest.representation_fingerprint,
                eligibility.eligibility_fingerprint
         FROM filing_intelligence.filing_document AS document
         JOIN filing_intelligence.filing_document_representation_manifest AS manifest
           ON manifest.document_id = document.id
         JOIN filing_intelligence.filing_retrieval_eligibility AS eligibility
           ON eligibility.document_id = document.id
         WHERE document.id = $1`,
        [stored.documentId],
      );
      assert.deepEqual(baseline.rows, before.rows);

      await runMigrations('up', databaseUrl, true);
      const after = await pool.query<{
        id: string;
        canonical_fingerprint: string;
        chunk_fingerprint: string;
        representation_fingerprint: string;
        eligibility_fingerprint: string;
        decoding_profile_id: string | null;
        decoding_profile_fingerprint: string | null;
        canonical_utf8_hash: string | null;
      }>(
        `SELECT document.id::text, document.canonical_fingerprint,
                document.chunk_fingerprint, manifest.representation_fingerprint,
                eligibility.eligibility_fingerprint, document.decoding_profile_id,
                document.decoding_profile_fingerprint, document.canonical_utf8_hash
         FROM filing_intelligence.filing_document AS document
         JOIN filing_intelligence.filing_document_representation_manifest AS manifest
           ON manifest.document_id = document.id
         JOIN filing_intelligence.filing_retrieval_eligibility AS eligibility
           ON eligibility.document_id = document.id
         WHERE document.id = $1`,
        [stored.documentId],
      );
      assert.deepEqual(after.rows, before.rows.map(row => ({
        ...row,
        decoding_profile_id: null,
        decoding_profile_fingerprint: null,
        canonical_utf8_hash: null,
      })));
      const history = await pool.query<{ name: string }>(
        'SELECT name FROM public.pgmigrations ORDER BY id ASC',
      );
      assert.equal(
        history.rows.at(-1)?.name,
        '1755295200000_legacy-filing-decoding-provenance',
      );
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

  await t.test('legacy decoding provenance persists immutably and remains idempotent', async () => {
    await clearPersistence(pool);
    const input = syntheticLegacyPersistenceInput();
    const repository = new FilingDocumentRepository(pool);
    const inserted = await repository.persistCanonicalFiling(input);
    const repeated = await repository.persistCanonicalFiling(input);
    assert.equal(inserted.status, 'inserted');
    assert.equal(repeated.status, 'already_present');
    assert.equal(repeated.documentId, inserted.documentId);
    const snapshot = await repository.getPersistenceSnapshot(inserted.documentId);
    assert.ok(snapshot);
    assert.equal(
      snapshot.document.decodingProfileId,
      'opendart-korean-legacy-compatible-v1',
    );
    assert.equal(
      snapshot.document.decodingProfileFingerprint,
      input.document.source.decoding?.decodingProfileFingerprint,
    );
    assert.equal(snapshot.document.sourceDeclaredEncoding, 'utf-8');
    assert.equal(snapshot.document.sourceBomKind, 'none');
    assert.equal(snapshot.document.sourceUtf8Validity, 'invalid');
    assert.equal(
      snapshot.document.canonicalUtf8Hash,
      input.document.source.decoding?.canonicalUtf8Sha256,
    );
    await assert.rejects(runMigrations('down', databaseUrl));
    assert.equal(
      await relationExists(pool, 'filing_intelligence.filing_document'),
      true,
    );
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
    assert.equal(snapshot.document.decodingProfileId, null);
    assert.equal(snapshot.document.decodingProfileFingerprint, null);
    assert.equal(snapshot.document.canonicalUtf8Hash, null);
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

  await t.test('a stored chunk version coexists with a newly persisted exact representation', async () => {
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

    const second = await repository.persistCanonicalFiling(input);
    assert.equal(second.status, 'inserted');
    assert.notEqual(second.documentId, first.documentId);
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
    const current = await repository.getPersistenceSnapshot(second.documentId);
    assert.equal(current?.document.chunkerVersion, '1.0.1');
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
    const second = await repository.persistCanonicalFiling(syntheticPersistenceInputFor({
      receiptNumber: '20990101000002', corpCode: '99999998', symbol: '999998',
      companyName: 'SECOND SYNTHETIC COMPANY',
    }));
    const secondId = second.documentId;
    await assert.rejects(
      pool.query(
        `INSERT INTO filing_intelligence.filing_section (
           document_id, section_id, parent_section_id, title, depth, ordinal,
           path, block_ids
         ) VALUES ($1, 'sec_second', $2, 'invalid parent', 1, 999, ARRAY['x'], ARRAY[]::text[])`,
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
           $1, $2, 'blk_second', 'paragraph', 999, ARRAY['x'], 'x', 'x',
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
           $1, 'chk_second', '1', '1.0.1', '1.0.1', 999, $2, ARRAY['x'],
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

  await t.test('actual PostgreSQL version and admin-installed pgvector prerequisite are available', async () => {
    const version = await pool.query<{ server_version: string }>(
      "SELECT current_setting('server_version') AS server_version",
    );
    assert.match(version.rows[0]!.server_version, /^16\./);
    const vector = await pool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM pg_extension WHERE extname = 'vector'",
    );
    assert.equal(vector.rows[0]?.count, 1);
  });
});
