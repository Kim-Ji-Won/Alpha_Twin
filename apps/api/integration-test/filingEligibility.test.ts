import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { FilingEligibilityError } from '../src/filingIntelligence/eligibility/errors.js';
import { FilingEligibilityRepository } from '../src/filingIntelligence/eligibility/filingEligibilityRepository.js';
import {
  FILING_REPRESENTATION_POLICY,
  FILING_RETRIEVAL_POLICY,
} from '../src/filingIntelligence/eligibility/policies.js';
import { FilingLexicalRepository } from '../src/filingIntelligence/lexical/filingLexicalRepository.js';
import { FILING_LEXICAL_PROFILE } from '../src/filingIntelligence/lexical/profile.js';
import { FilingDocumentRepository } from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import { clearPersistence, requiredTestDatabaseUrl, runMigrations } from './helpers/database.js';
import { syntheticPersistenceInputFor } from './helpers/filingFixture.js';

const RECEIPT_A = '20990101007001';
const RECEIPT_B = '20990101007002';

function eligibilityError(code: FilingEligibilityError['code']) {
  return (error: unknown) => error instanceof FilingEligibilityError && error.code === code;
}

async function exists(pool: Pool, relation: string): Promise<boolean> {
  const result = await pool.query<{ value: string | null }>(
    'SELECT to_regclass($1)::text AS value',
    [relation],
  );
  return result.rows[0]?.value != null;
}

async function persist(
  repository: FilingDocumentRepository,
  receiptNumber: string,
  text: string,
) {
  return repository.persistCanonicalFiling(syntheticPersistenceInputFor({
    receiptNumber,
    corpCode: '77777777',
    symbol: '777777',
    companyName: 'SYNTHETIC ELIGIBILITY COMPANY',
    paragraphTexts: [text, `${text} 추가 문단`],
  }));
}

async function insertVersionedRepresentation(
  pool: Pool,
  sourceDocumentId: string,
  chunkSchemaVersion: string,
  chunkerVersion: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO filing_intelligence.filing_document (
       receipt_id, provider, receipt_number, corp_code, symbol, company_name,
       report_name, report_code, filing_date, source_title, upstream_report_name,
       source_entry_name, source_entry_hash, source_entry_byte_length,
       canonical_schema_name, canonical_schema_version, parser_version,
       chunk_schema_version, chunker_version, canonical_fingerprint,
       chunk_fingerprint, section_count, block_count, chunk_count
     )
     SELECT receipt_id, provider, receipt_number, corp_code, symbol, company_name,
            report_name, report_code, filing_date, source_title, upstream_report_name,
            source_entry_name, source_entry_hash, source_entry_byte_length,
            canonical_schema_name, canonical_schema_version, parser_version,
            $2, $3, canonical_fingerprint, repeat('f', 64), 0, 0, 0
     FROM filing_intelligence.filing_document WHERE id = $1
     RETURNING id::text`,
    [sourceDocumentId, chunkSchemaVersion, chunkerVersion],
  );
  assert.ok(result.rows[0]?.id);
  return result.rows[0].id;
}

async function refreshStoredManifest(pool: Pool, documentId: string): Promise<void> {
  await pool.query(
    `UPDATE filing_intelligence.filing_document_representation_manifest AS stored
     SET section_manifest_fingerprint = computed.section_manifest_fingerprint,
         block_manifest_fingerprint = computed.block_manifest_fingerprint,
         chunk_manifest_fingerprint = computed.chunk_manifest_fingerprint,
         representation_fingerprint = computed.representation_fingerprint
     FROM filing_intelligence.compute_filing_representation_manifest($1) AS computed
     WHERE stored.document_id = $1`,
    [documentId],
  );
}

test('filing retrieval eligibility PostgreSQL foundation', async t => {
  const databaseUrl = requiredTestDatabaseUrl();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 30_000,
    application_name: 'alpha-twin-eligibility-integration-test',
  });
  t.after(async () => pool.end());

  await t.test('migration up, down, and re-up preserve prior schemas and backfill manifests',
    async () => {
      await runMigrations('up', databaseUrl);
      await runMigrations('down', databaseUrl);
      await runMigrations('down', databaseUrl);
      assert.equal(await exists(pool,
        'filing_intelligence.filing_retrieval_eligibility'), false);
      assert.equal(await exists(pool,
        'filing_intelligence.filing_family_resolution_control'), true);
      await runMigrations('up', databaseUrl);
      assert.equal(await exists(pool,
        'filing_intelligence.filing_document_representation_manifest'), true);
      assert.equal(await exists(pool,
        'filing_intelligence.filing_retrieval_eligibility'), true);
      const constraints = await pool.query<{ constraint_name: string }>(
        `SELECT constraint_name FROM information_schema.table_constraints
         WHERE constraint_schema = 'filing_intelligence'`,
      );
      const names = new Set(constraints.rows.map(row => row.constraint_name));
      for (const name of [
        'filing_document_source_identity_unique',
        'filing_document_id_receipt_unique',
        'filing_retrieval_eligibility_pkey',
        'filing_retrieval_eligibility_document_receipt_fk',
        'filing_retrieval_eligibility_generation_document_fk',
        'filing_retrieval_eligibility_manifest_fk',
        'filing_retrieval_eligibility_ready_consistency',
      ]) assert.equal(names.has(name), true, name);

      await clearPersistence(pool);
      const persistence = new FilingDocumentRepository(pool);
      const document = await persist(persistence, RECEIPT_A, 'migration manifest backfill');
      await runMigrations('down', databaseUrl);
      await runMigrations('down', databaseUrl);
      assert.equal(await exists(pool,
        'filing_intelligence.filing_retrieval_eligibility'), false);
      assert.equal(await exists(pool,
        'filing_intelligence.filing_family_resolution_control'), true);
      assert.equal(await exists(pool,
        'filing_intelligence.filing_lexical_generation'), true);
      await runMigrations('up', databaseUrl);
      const manifest = await pool.query<{ representation_fingerprint: string }>(
        `SELECT representation_fingerprint
         FROM filing_intelligence.filing_document_representation_manifest
         WHERE document_id = $1`,
        [document.documentId],
      );
      assert.match(manifest.rows[0]?.representation_fingerprint ?? '', /^[0-9a-f]{64}$/);
    });

  await t.test('expanded identity permits versioned chunks and rejects exact duplicates',
    async () => {
      await clearPersistence(pool);
      const persistence = new FilingDocumentRepository(pool);
      const document = await persist(persistence, RECEIPT_A, 'version identity');
      await insertVersionedRepresentation(pool, document.documentId, '1', '2.0.0');
      await insertVersionedRepresentation(pool, document.documentId, '2', '1.0.1');
      await assert.rejects(
        insertVersionedRepresentation(pool, document.documentId, '1', '2.0.0'),
      );
    });

  await t.test('down migration fails before destructive work when old identity would collide',
    async () => {
      await clearPersistence(pool);
      const persistence = new FilingDocumentRepository(pool);
      const document = await persist(persistence, RECEIPT_A, 'unsafe downgrade identity');
      await insertVersionedRepresentation(pool, document.documentId, '1', '2.0.0');
      await runMigrations('down', databaseUrl);
      await assert.rejects(runMigrations('down', databaseUrl));
      assert.equal(await exists(pool,
        'filing_intelligence.filing_document_representation_manifest'), true);
      assert.equal(await exists(pool, 'filing_intelligence.filing_retrieval_eligibility'), true);
      const documents = await pool.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM filing_intelligence.filing_document
         WHERE receipt_number = $1`,
        [RECEIPT_A],
      );
      assert.equal(documents.rows[0]?.count, 2);
      await clearPersistence(pool);
      await runMigrations('down', databaseUrl);
      await runMigrations('up', databaseUrl);
    });

  await t.test('manifest is deterministic and canonical persistence remains idempotent', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool);
    const input = syntheticPersistenceInputFor({
      receiptNumber: RECEIPT_A, corpCode: '77777777', symbol: '777777',
      companyName: 'SYNTHETIC ELIGIBILITY COMPANY', paragraphCount: 12,
    });
    const first = await persistence.persistCanonicalFiling(input);
    const before = await persistence.getPersistenceSnapshot(first.documentId);
    const second = await persistence.persistCanonicalFiling(input);
    const after = await persistence.getPersistenceSnapshot(first.documentId);
    assert.equal(second.status, 'already_present');
    assert.equal(before?.document.representationFingerprint,
      after?.document.representationFingerprint);
    assert.match(after?.document.sectionManifestFingerprint ?? '', /^[0-9a-f]{64}$/);
    assert.match(after?.document.blockManifestFingerprint ?? '', /^[0-9a-f]{64}$/);
    assert.match(after?.document.chunkManifestFingerprint ?? '', /^[0-9a-f]{64}$/);

    await pool.query(
      `WITH removed AS (
         DELETE FROM filing_intelligence.filing_chunk WHERE document_id = $1
         RETURNING document_id, chunk_id, chunk_schema_version, parser_version,
                   chunker_version, ordinal, section_id, section_path, source_block_ids,
                   source_block_types, source_text, retrieval_text, content_hash,
                   source_char_count, retrieval_char_count, locator, table_id
       )
       INSERT INTO filing_intelligence.filing_chunk (
         document_id, chunk_id, chunk_schema_version, parser_version, chunker_version,
         ordinal, section_id, section_path, source_block_ids, source_block_types,
         source_text, retrieval_text, content_hash, source_char_count,
         retrieval_char_count, locator, table_id
       )
       SELECT document_id, chunk_id, chunk_schema_version, parser_version, chunker_version,
              ordinal, section_id, section_path, source_block_ids, source_block_types,
              source_text, retrieval_text, content_hash, source_char_count,
              retrieval_char_count, locator, table_id
       FROM removed ORDER BY ordinal DESC`,
      [first.documentId],
    );
    const reordered = await persistence.persistCanonicalFiling(input);
    assert.equal(reordered.status, 'already_present');
    assert.equal((await persistence.getPersistenceSnapshot(first.documentId))
      ?.document.representationFingerprint, after?.document.representationFingerprint);
  });

  await t.test('missing generation becomes eligible after exact ready indexing and then no-ops',
    async () => {
      await clearPersistence(pool);
      const persistence = new FilingDocumentRepository(pool);
      const lexical = new FilingLexicalRepository(pool);
      const eligibility = new FilingEligibilityRepository(pool);
      const document = await persist(persistence, RECEIPT_A, 'eligibility transition');
      const missing = await eligibility.evaluateDocumentEligibility(
        document.documentId, FILING_RETRIEVAL_POLICY.policyId,
      );
      assert.deepEqual([missing.persistenceStatus, missing.status, missing.reasonCode,
        missing.revision], ['inserted', 'ineligible', 'lexical_generation_missing', '1']);
      await lexical.indexFilingDocumentLexically(document.documentId);
      const eligible = await eligibility.evaluateDocumentEligibility(
        document.documentId, FILING_RETRIEVAL_POLICY.policyId,
      );
      assert.deepEqual([eligible.persistenceStatus, eligible.status, eligible.reasonCode,
        eligible.revision], ['updated', 'eligible', 'eligible', '2']);
      const repeated = await eligibility.evaluateDocumentEligibility(
        document.documentId, FILING_RETRIEVAL_POLICY.policyId,
      );
      assert.deepEqual([repeated.persistenceStatus, repeated.revision,
        repeated.evaluatedAt.toISOString()], ['already_evaluated', '2',
        eligible.evaluatedAt.toISOString()]);
      const flags = await pool.query<{
        is_current_effective: boolean; is_retrieval_ready: boolean; activated_at: Date | null;
      }>(
        `SELECT is_current_effective, is_retrieval_ready, activated_at
         FROM filing_intelligence.filing_document WHERE id = $1`,
        [document.documentId],
      );
      assert.deepEqual(flags.rows[0], {
        is_current_effective: false,
        is_retrieval_ready: false,
        activated_at: null,
      });
      await pool.query(
        `UPDATE filing_intelligence.filing_retrieval_eligibility
         SET representation_policy_id = 'corrupted-policy-id'
         WHERE document_id = $1 AND retrieval_policy_id = $2`,
        [document.documentId, FILING_RETRIEVAL_POLICY.policyId],
      );
      await assert.rejects(
        eligibility.evaluateDocumentEligibility(document.documentId,
          FILING_RETRIEVAL_POLICY.policyId),
        eligibilityError('FILING_ELIGIBILITY_PERSISTED_STATE_INTEGRITY_FAILURE'),
      );
    });

  await t.test('building and failed generations remain ineligible', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool);
    const eligibility = new FilingEligibilityRepository(pool);
    const document = await persist(persistence, RECEIPT_A, 'not ready generation');
    const generation = await pool.query<{ id: string }>(
      `INSERT INTO filing_intelligence.filing_lexical_generation (
         document_id, profile_id, schema_version, normalizer_version,
         text_search_config, status, chunk_count, lexical_fingerprint,
         total_lexeme_count
       ) VALUES ($1, $2, $3, $4, 'simple', 'building', $5, repeat('a', 64), 0)
       RETURNING id::text`,
      [document.documentId, FILING_LEXICAL_PROFILE.profileId,
        FILING_LEXICAL_PROFILE.schemaVersion, FILING_LEXICAL_PROFILE.normalizerVersion,
        document.chunkCount],
    );
    const building = await eligibility.evaluateDocumentEligibility(
      document.documentId, FILING_RETRIEVAL_POLICY.policyId,
    );
    assert.equal(building.reasonCode, 'lexical_generation_not_ready');
    await pool.query(
      `UPDATE filing_intelligence.filing_lexical_generation
       SET status = 'failed', completed_at = clock_timestamp() WHERE id = $1`,
      [generation.rows[0]!.id],
    );
    const failed = await eligibility.evaluateDocumentEligibility(
      document.documentId, FILING_RETRIEVAL_POLICY.policyId,
    );
    assert.equal(failed.reasonCode, 'lexical_generation_not_ready');
    assert.equal(failed.revision, '2');

    await clearPersistence(pool);
    const wrongProfileDocument = await persist(persistence, RECEIPT_B, 'wrong profile');
    await pool.query(
      `INSERT INTO filing_intelligence.filing_lexical_generation (
         document_id, profile_id, schema_version, normalizer_version,
         text_search_config, status, chunk_count, lexical_fingerprint,
         total_lexeme_count, completed_at
       ) VALUES ($1, 'synthetic-other-profile', '1', '1', 'simple', 'ready',
                 $2, repeat('a', 64), 0, clock_timestamp())`,
      [wrongProfileDocument.documentId, wrongProfileDocument.chunkCount],
    );
    const wrongProfile = await eligibility.evaluateDocumentEligibility(
      wrongProfileDocument.documentId, FILING_RETRIEVAL_POLICY.policyId,
    );
    assert.equal(wrongProfile.reasonCode, 'lexical_generation_missing');
  });

  await t.test('valid incompatible representation and quarantined receipt are ineligible',
    async () => {
      await clearPersistence(pool);
      const persistence = new FilingDocumentRepository(pool);
      const eligibility = new FilingEligibilityRepository(pool);
      const document = await persist(persistence, RECEIPT_A, 'policy mismatch');
      await pool.query(
        `UPDATE filing_intelligence.filing_document SET parser_version = '2.0.0'
         WHERE id = $1`,
        [document.documentId],
      );
      await refreshStoredManifest(pool, document.documentId);
      const mismatch = await eligibility.evaluateDocumentEligibility(
        document.documentId, FILING_RETRIEVAL_POLICY.policyId,
      );
      assert.equal(mismatch.reasonCode, 'representation_policy_mismatch');

      await clearPersistence(pool);
      const quarantined = await persist(persistence, RECEIPT_B, 'quarantined receipt');
      await pool.query(
        `UPDATE filing_intelligence.filing_receipt SET lineage_status = 'quarantined'
         WHERE id = (SELECT receipt_id FROM filing_intelligence.filing_document WHERE id = $1)`,
        [quarantined.documentId],
      );
      const result = await eligibility.evaluateDocumentEligibility(
        quarantined.documentId, FILING_RETRIEVAL_POLICY.policyId,
      );
      assert.equal(result.reasonCode, 'receipt_quarantined');
    });

  await t.test('representation and lexical corruption fail closed and roll back', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool);
    const lexical = new FilingLexicalRepository(pool);
    const eligibility = new FilingEligibilityRepository(pool);
    const document = await persist(persistence, RECEIPT_A, 'integrity failure');
    await lexical.indexFilingDocumentLexically(document.documentId);
    await pool.query(
      `UPDATE filing_intelligence.filing_chunk
       SET content_hash = repeat('f', 64)
       WHERE document_id = $1 AND ordinal = 0`,
      [document.documentId],
    );
    await assert.rejects(
      eligibility.evaluateDocumentEligibility(document.documentId,
        FILING_RETRIEVAL_POLICY.policyId),
      eligibilityError('FILING_ELIGIBILITY_REPRESENTATION_INTEGRITY_FAILURE'),
    );
    const rows = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM filing_intelligence.filing_retrieval_eligibility`,
    );
    assert.equal(rows.rows[0]?.count, 0);

    await clearPersistence(pool);
    const lexicalDocument = await persist(persistence, RECEIPT_B, 'lexical corruption');
    await lexical.indexFilingDocumentLexically(lexicalDocument.documentId);
    const lexicalRow = await pool.query<{
      generation_id: string; chunk_row_id: string; lexical_content_hash: string;
    }>(
      `SELECT generation_id::text, chunk_row_id::text, lexical_content_hash
       FROM filing_intelligence.filing_chunk_lexical
       WHERE document_id = $1 ORDER BY generation_id, chunk_row_id LIMIT 1`,
      [lexicalDocument.documentId],
    );
    const original = lexicalRow.rows[0]!;
    await pool.query(
      `UPDATE filing_intelligence.filing_chunk_lexical
       SET lexical_content_hash = repeat('f', 64)
       WHERE generation_id = $1 AND chunk_row_id = $2`,
      [original.generation_id, original.chunk_row_id],
    );
    await assert.rejects(
      eligibility.evaluateDocumentEligibility(lexicalDocument.documentId,
        FILING_RETRIEVAL_POLICY.policyId),
      eligibilityError('FILING_ELIGIBILITY_GENERATION_INTEGRITY_FAILURE'),
    );
    await pool.query(
      `UPDATE filing_intelligence.filing_chunk_lexical
       SET lexical_content_hash = $3
       WHERE generation_id = $1 AND chunk_row_id = $2`,
      [original.generation_id, original.chunk_row_id, original.lexical_content_hash],
    );
    await pool.query(
      `DELETE FROM filing_intelligence.filing_chunk_lexical
       WHERE generation_id = $1 AND chunk_row_id = $2`,
      [original.generation_id, original.chunk_row_id],
    );
    await assert.rejects(
      eligibility.evaluateDocumentEligibility(lexicalDocument.documentId,
        FILING_RETRIEVAL_POLICY.policyId),
      eligibilityError('FILING_ELIGIBILITY_GENERATION_INTEGRITY_FAILURE'),
    );
  });

  await t.test('missing representation manifest is an integrity failure, not a missing document',
    async () => {
      await clearPersistence(pool);
      const persistence = new FilingDocumentRepository(pool);
      const eligibility = new FilingEligibilityRepository(pool);
      const document = await persist(persistence, RECEIPT_A, 'missing manifest');
      await pool.query(
        `DELETE FROM filing_intelligence.filing_document_representation_manifest
         WHERE document_id = $1`,
        [document.documentId],
      );
      await assert.rejects(
        eligibility.evaluateDocumentEligibility(document.documentId,
          FILING_RETRIEVAL_POLICY.policyId),
        eligibilityError('FILING_ELIGIBILITY_REPRESENTATION_INTEGRITY_FAILURE'),
      );

      await clearPersistence(pool);
      const corrupted = await persist(persistence, RECEIPT_B, 'corrupt manifest');
      await pool.query(
        `UPDATE filing_intelligence.filing_document_representation_manifest
         SET chunk_manifest_fingerprint = repeat('f', 64) WHERE document_id = $1`,
        [corrupted.documentId],
      );
      await assert.rejects(
        eligibility.evaluateDocumentEligibility(corrupted.documentId,
          FILING_RETRIEVAL_POLICY.policyId),
        eligibilityError('FILING_ELIGIBILITY_REPRESENTATION_INTEGRITY_FAILURE'),
      );

      await clearPersistence(pool);
      const countMismatch = await persist(persistence, RECEIPT_A, 'child count mismatch');
      await pool.query(
        `DELETE FROM filing_intelligence.filing_chunk
         WHERE document_id = $1 AND ordinal = (
           SELECT max(ordinal) FROM filing_intelligence.filing_chunk WHERE document_id = $1
         )`,
        [countMismatch.documentId],
      );
      await assert.rejects(
        eligibility.evaluateDocumentEligibility(countMismatch.documentId,
          FILING_RETRIEVAL_POLICY.policyId),
        eligibilityError('FILING_ELIGIBILITY_REPRESENTATION_INTEGRITY_FAILURE'),
      );
    });

  await t.test('client-bound evaluation participates in its caller transaction', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool);
    const lexical = new FilingLexicalRepository(pool);
    const eligibility = new FilingEligibilityRepository(pool);
    const document = await persist(persistence, RECEIPT_A, 'client bound evaluation');
    await lexical.indexFilingDocumentLexically(document.documentId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await eligibility.evaluateDocumentEligibilityWithClient(
        client, document.documentId, FILING_RETRIEVAL_POLICY.policyId,
      );
      assert.equal(result.status, 'eligible');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const persisted = await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM filing_intelligence.filing_retrieval_eligibility',
    );
    assert.equal(persisted.rows[0]?.count, 0);
  });

  await t.test('receipt selector returns not-found, selected, and ambiguity without tie-breaks',
    async () => {
      await clearPersistence(pool);
      const persistence = new FilingDocumentRepository(pool);
      const lexical = new FilingLexicalRepository(pool);
      const eligibility = new FilingEligibilityRepository(pool);
      const first = await persist(persistence, RECEIPT_A, 'first compatible representation');
      const receipt = await pool.query<{ receipt_id: string }>(
        `SELECT receipt_id::text FROM filing_intelligence.filing_document WHERE id = $1`,
        [first.documentId],
      );
      const receiptId = receipt.rows[0]!.receipt_id;
      assert.equal((await eligibility.selectReceiptEligibleRepresentation(
        receiptId, FILING_RETRIEVAL_POLICY.policyId)).status, 'not_found');
      await lexical.indexFilingDocumentLexically(first.documentId);
      await eligibility.evaluateDocumentEligibility(first.documentId,
        FILING_RETRIEVAL_POLICY.policyId);
      const selected = await eligibility.selectReceiptEligibleRepresentation(
        receiptId, FILING_RETRIEVAL_POLICY.policyId,
      );
      assert.equal(selected.status, 'selected');
      if (selected.status === 'selected') assert.equal(selected.documentId, first.documentId);

      const second = await persist(persistence, RECEIPT_A, 'second compatible representation');
      await lexical.indexFilingDocumentLexically(second.documentId);
      await eligibility.evaluateDocumentEligibility(second.documentId,
        FILING_RETRIEVAL_POLICY.policyId);
      const ambiguous = await eligibility.selectReceiptEligibleRepresentation(
        receiptId, FILING_RETRIEVAL_POLICY.policyId,
      );
      assert.equal(ambiguous.status, 'ambiguous');
      if (ambiguous.status === 'ambiguous') {
        assert.deepEqual(new Set(ambiguous.documentIds),
          new Set([first.documentId, second.documentId]));
      }
    });

  await t.test('concurrent evaluation converges and eligibility FKs restrict deletion', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool);
    const lexical = new FilingLexicalRepository(pool);
    const eligibility = new FilingEligibilityRepository(pool);
    const document = await persist(persistence, RECEIPT_B, 'concurrent eligibility');
    const generation = await lexical.indexFilingDocumentLexically(document.documentId);
    const results = await Promise.all([
      eligibility.evaluateDocumentEligibility(document.documentId,
        FILING_RETRIEVAL_POLICY.policyId),
      eligibility.evaluateDocumentEligibility(document.documentId,
        FILING_RETRIEVAL_POLICY.policyId),
    ]);
    assert.deepEqual(new Set(results.map(result => result.persistenceStatus)),
      new Set(['inserted', 'already_evaluated']));
    assert.equal(results[0]?.eligibilityFingerprint, results[1]?.eligibilityFingerprint);
    const count = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM filing_intelligence.filing_retrieval_eligibility`,
    );
    assert.equal(count.rows[0]?.count, 1);
    await assert.rejects(pool.query(
      'DELETE FROM filing_intelligence.filing_lexical_generation WHERE id = $1',
      [generation.generationId],
    ));
    await assert.rejects(pool.query(
      'DELETE FROM filing_intelligence.filing_document WHERE id = $1',
      [document.documentId],
    ));
    await assert.rejects(pool.query(
      `DELETE FROM filing_intelligence.filing_document_representation_manifest
       WHERE document_id = $1`,
      [document.documentId],
    ));
  });

  await t.test('policy metadata is persisted without dense or activation pointer state', async () => {
    await clearPersistence(pool);
    const persistence = new FilingDocumentRepository(pool);
    const lexical = new FilingLexicalRepository(pool);
    const eligibility = new FilingEligibilityRepository(pool);
    const document = await persist(persistence, RECEIPT_A, 'policy persistence');
    await lexical.indexFilingDocumentLexically(document.documentId);
    await eligibility.evaluateDocumentEligibility(document.documentId,
      FILING_RETRIEVAL_POLICY.policyId);
    const row = await pool.query<{
      retrieval_policy_id: string; retrieval_policy_fingerprint: string;
      representation_policy_id: string; representation_policy_fingerprint: string;
      lexical_profile_id: string;
    }>(
      `SELECT retrieval_policy_id, retrieval_policy_fingerprint,
              representation_policy_id, representation_policy_fingerprint,
              lexical_profile_id
       FROM filing_intelligence.filing_retrieval_eligibility`,
    );
    assert.deepEqual(row.rows[0], {
      retrieval_policy_id: FILING_RETRIEVAL_POLICY.policyId,
      retrieval_policy_fingerprint: FILING_RETRIEVAL_POLICY.fingerprint,
      representation_policy_id: FILING_REPRESENTATION_POLICY.policyId,
      representation_policy_fingerprint: FILING_REPRESENTATION_POLICY.fingerprint,
      lexical_profile_id: FILING_LEXICAL_PROFILE.profileId,
    });
    assert.equal(await exists(pool, 'filing_intelligence.filing_retrieval_activation'), true);
    const activations = await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM filing_intelligence.filing_retrieval_activation',
    );
    assert.equal(activations.rows[0]?.count, 0);
  });

  await t.test('policy identities coexist without overwriting and bounded evaluation stays scoped',
    async () => {
      await clearPersistence(pool);
      const persistence = new FilingDocumentRepository(pool, { batchSize: 20 });
      const lexical = new FilingLexicalRepository(pool);
      const eligibility = new FilingEligibilityRepository(pool);
      const documents = [];
      for (let index = 0; index < 3; index += 1) {
        const document = await persistence.persistCanonicalFiling(
          syntheticPersistenceInputFor({
            receiptNumber: `2099010100710${index}`,
            corpCode: '77777777', symbol: '777777',
            companyName: 'SYNTHETIC ELIGIBILITY COMPANY', paragraphCount: 120,
          }),
        );
        await lexical.indexFilingDocumentLexically(document.documentId);
        const evaluated = await eligibility.evaluateDocumentEligibility(
          document.documentId, FILING_RETRIEVAL_POLICY.policyId,
        );
        assert.equal(evaluated.status, 'eligible');
        documents.push(document);
      }
      await pool.query(
        `INSERT INTO filing_intelligence.filing_retrieval_eligibility (
           document_id, receipt_id, retrieval_policy_id, retrieval_policy_fingerprint,
           representation_policy_id, representation_policy_fingerprint, status,
           reason_code, representation_fingerprint, lexical_generation_id,
           lexical_profile_id, lexical_schema_version, lexical_normalizer_version,
           lexical_text_search_config, lexical_generation_fingerprint,
           lexical_chunk_count, lexical_total_lexeme_count, eligibility_fingerprint,
           revision, evaluated_at, created_at, updated_at
         )
         SELECT document_id, receipt_id, 'synthetic-retrieval-v2', repeat('a', 64),
                representation_policy_id, representation_policy_fingerprint, status,
                reason_code, representation_fingerprint, lexical_generation_id,
                lexical_profile_id, lexical_schema_version, lexical_normalizer_version,
                lexical_text_search_config, lexical_generation_fingerprint,
                lexical_chunk_count, lexical_total_lexeme_count, repeat('b', 64),
                1, clock_timestamp(), clock_timestamp(), clock_timestamp()
         FROM filing_intelligence.filing_retrieval_eligibility
         WHERE document_id = $1 AND retrieval_policy_id = $2`,
        [documents[0]!.documentId, FILING_RETRIEVAL_POLICY.policyId],
      );
      const counts = await pool.query<{ policy_count: number; document_count: number }>(
        `SELECT count(DISTINCT retrieval_policy_id)::integer AS policy_count,
                count(DISTINCT document_id)::integer AS document_count
         FROM filing_intelligence.filing_retrieval_eligibility`,
      );
      assert.deepEqual(counts.rows[0], { policy_count: 2, document_count: 3 });
    });
});
