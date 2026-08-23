import { Pool, PoolClient } from 'pg';

import { withTransaction } from '../../infrastructure/database/transaction.js';
import { lexicalGenerationFingerprint } from '../lexical/lexicalFingerprints.js';
import { FILING_LEXICAL_PROFILE } from '../lexical/profile.js';
import { FilingPersistenceError } from '../persistence/errors.js';
import {
  computeRepresentationManifestWithClient,
  REPRESENTATION_MANIFEST_VERSION,
} from '../persistence/representationManifest.js';
import {
  FilingEligibilityReason,
  FilingEligibilityResult,
  FilingEligibilityStatus,
  FilingRepresentationSelection,
} from './contracts.js';
import { FilingEligibilityError } from './errors.js';
import { calculateEligibilityFingerprint } from './fingerprints.js';
import {
  FILING_REPRESENTATION_POLICY,
  getRetrievalPolicy,
} from './policies.js';

const BIGINT = /^[1-9]\d{0,18}$/;
const HASH = /^[0-9a-f]{64}$/;

interface DocumentRow {
  id: string;
  receipt_id: string;
  provider: string;
  receipt_number: string;
  source_entry_hash: string;
  canonical_schema_name: string;
  canonical_schema_version: string;
  parser_version: string;
  chunk_schema_version: string;
  chunker_version: string;
  canonical_fingerprint: string;
  chunk_fingerprint: string;
  section_count: number;
  block_count: number;
  chunk_count: number;
  representation_manifest_version: string;
  section_manifest_fingerprint: string;
  block_manifest_fingerprint: string;
  chunk_manifest_fingerprint: string;
  representation_fingerprint: string;
  lineage_status: string;
}

interface GenerationRow {
  id: string;
  document_id: string;
  profile_id: string;
  schema_version: string;
  normalizer_version: string;
  text_search_config: string;
  status: string;
  chunk_count: number;
  lexical_fingerprint: string;
  total_lexeme_count: number;
}

interface LexicalRow {
  chunk_id: string;
  lexical_content_hash: string;
  lexeme_count: number;
}

interface EligibilityRow {
  document_id: string;
  receipt_id: string;
  retrieval_policy_id: string;
  retrieval_policy_fingerprint: string;
  representation_policy_id: string;
  representation_policy_fingerprint: string;
  status: FilingEligibilityStatus;
  reason_code: FilingEligibilityReason;
  representation_fingerprint: string;
  eligibility_fingerprint: string;
  lexical_generation_id: string | null;
  lexical_profile_id: string | null;
  lexical_schema_version: string | null;
  lexical_normalizer_version: string | null;
  lexical_text_search_config: string | null;
  lexical_generation_fingerprint: string | null;
  lexical_chunk_count: number | null;
  lexical_total_lexeme_count: number | null;
  revision: string;
  evaluated_at: Date;
}

interface EvaluationState {
  readonly status: FilingEligibilityStatus;
  readonly reasonCode: FilingEligibilityReason;
  readonly generation: GenerationRow | null;
}

function eligibilityError(code: FilingEligibilityError['code']): FilingEligibilityError {
  return new FilingEligibilityError(code, false);
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' ? error.code : undefined;
}

function mapError(error: unknown): FilingEligibilityError {
  if (error instanceof FilingEligibilityError) return error;
  if (error instanceof FilingPersistenceError) {
    return new FilingEligibilityError(
      'FILING_ELIGIBILITY_REPRESENTATION_INTEGRITY_FAILURE',
      false,
      { cause: error },
    );
  }
  const code = postgresCode(error);
  if (code === '23505') return eligibilityError('FILING_ELIGIBILITY_CONFLICT');
  if (code === '23503' || code === '23514' || code === '22P02') {
    return eligibilityError('FILING_ELIGIBILITY_REPRESENTATION_INTEGRITY_FAILURE');
  }
  return new FilingEligibilityError(
    'FILING_ELIGIBILITY_TRANSACTION_FAILED',
    code == null || code.startsWith('08') || code === '40001'
      || code === '40P01' || code === '57014',
    { cause: error },
  );
}

function checkedId(value: string): void {
  if (!BIGINT.test(value)) throw eligibilityError('FILING_ELIGIBILITY_INVALID_INPUT');
}

function assertHash(value: string): void {
  if (!HASH.test(value)) {
    throw eligibilityError('FILING_ELIGIBILITY_REPRESENTATION_INTEGRITY_FAILURE');
  }
}

function representationMatches(document: DocumentRow): boolean {
  return document.canonical_schema_name === FILING_REPRESENTATION_POLICY.canonicalSchemaName
    && document.canonical_schema_version === FILING_REPRESENTATION_POLICY.canonicalSchemaVersion
    && document.parser_version === FILING_REPRESENTATION_POLICY.parserVersion
    && document.chunk_schema_version === FILING_REPRESENTATION_POLICY.chunkSchemaVersion
    && document.chunker_version === FILING_REPRESENTATION_POLICY.chunkerVersion;
}

async function loadDocument(
  client: PoolClient,
  documentId: string,
): Promise<DocumentRow> {
  const result = await client.query<DocumentRow>(
    `SELECT document.id::text, document.receipt_id::text, document.provider,
            document.receipt_number, document.source_entry_hash,
            document.canonical_schema_name, document.canonical_schema_version,
            document.parser_version, document.chunk_schema_version,
            document.chunker_version, document.canonical_fingerprint,
            document.chunk_fingerprint, document.section_count,
            document.block_count, document.chunk_count,
            manifest.representation_manifest_version,
            manifest.section_manifest_fingerprint,
            manifest.block_manifest_fingerprint,
            manifest.chunk_manifest_fingerprint,
            manifest.representation_fingerprint, receipt.lineage_status
     FROM filing_intelligence.filing_document AS document
     JOIN filing_intelligence.filing_receipt AS receipt
       ON receipt.id = document.receipt_id
      AND receipt.provider = document.provider
      AND receipt.receipt_number = document.receipt_number
     LEFT JOIN filing_intelligence.filing_document_representation_manifest AS manifest
       ON manifest.document_id = document.id
     WHERE document.id = $1
     FOR SHARE OF document, receipt`,
    [documentId],
  );
  const document = result.rows[0];
  if (!document) throw eligibilityError('FILING_ELIGIBILITY_DOCUMENT_NOT_FOUND');
  for (const value of [
    document.source_entry_hash,
    document.canonical_fingerprint,
    document.chunk_fingerprint,
    document.section_manifest_fingerprint,
    document.block_manifest_fingerprint,
    document.chunk_manifest_fingerprint,
    document.representation_fingerprint,
  ]) assertHash(value);
  if (document.representation_manifest_version !== REPRESENTATION_MANIFEST_VERSION) {
    throw eligibilityError('FILING_ELIGIBILITY_REPRESENTATION_INTEGRITY_FAILURE');
  }
  return document;
}

async function verifyRepresentation(
  client: PoolClient,
  document: DocumentRow,
): Promise<void> {
  const manifest = await computeRepresentationManifestWithClient(client, document.id);
  const counts = await client.query<{
    section_count: number; block_count: number; chunk_count: number;
  }>(
    `SELECT
       (SELECT count(*)::integer FROM filing_intelligence.filing_section
        WHERE document_id = $1) AS section_count,
       (SELECT count(*)::integer FROM filing_intelligence.filing_block
        WHERE document_id = $1) AS block_count,
       (SELECT count(*)::integer FROM filing_intelligence.filing_chunk
        WHERE document_id = $1) AS chunk_count`,
    [document.id],
  );
  const count = counts.rows[0];
  if (!count
    || count.section_count !== document.section_count
    || count.block_count !== document.block_count
    || count.chunk_count !== document.chunk_count
    || manifest.sectionManifestFingerprint !== document.section_manifest_fingerprint
    || manifest.blockManifestFingerprint !== document.block_manifest_fingerprint
    || manifest.chunkManifestFingerprint !== document.chunk_manifest_fingerprint
    || manifest.representationFingerprint !== document.representation_fingerprint) {
    throw eligibilityError('FILING_ELIGIBILITY_REPRESENTATION_INTEGRITY_FAILURE');
  }
}

async function loadGeneration(
  client: PoolClient,
  document: DocumentRow,
): Promise<GenerationRow | null> {
  const result = await client.query<GenerationRow>(
    `SELECT id::text, document_id::text, profile_id, schema_version,
            normalizer_version, text_search_config, status, chunk_count,
            lexical_fingerprint, total_lexeme_count
     FROM filing_intelligence.filing_lexical_generation
     WHERE document_id = $1 AND profile_id = $2
     FOR SHARE`,
    [document.id, FILING_LEXICAL_PROFILE.profileId],
  );
  const generation = result.rows[0] ?? null;
  if (!generation) return null;
  if (generation.document_id !== document.id) {
    throw eligibilityError('FILING_ELIGIBILITY_GENERATION_INTEGRITY_FAILURE');
  }
  if (!HASH.test(generation.lexical_fingerprint)) {
    throw eligibilityError('FILING_ELIGIBILITY_GENERATION_INTEGRITY_FAILURE');
  }
  return generation;
}

async function verifyReadyGeneration(
  client: PoolClient,
  document: DocumentRow,
  generation: GenerationRow,
): Promise<void> {
  if (generation.profile_id !== FILING_LEXICAL_PROFILE.profileId
    || generation.schema_version !== FILING_LEXICAL_PROFILE.schemaVersion
    || generation.normalizer_version !== FILING_LEXICAL_PROFILE.normalizerVersion
    || generation.text_search_config !== FILING_LEXICAL_PROFILE.textSearchConfig
    || generation.chunk_count !== document.chunk_count) {
    throw eligibilityError('FILING_ELIGIBILITY_GENERATION_INTEGRITY_FAILURE');
  }
  const rows = await client.query<LexicalRow>(
    `SELECT lexical.chunk_id, lexical.lexical_content_hash, lexical.lexeme_count
     FROM filing_intelligence.filing_chunk_lexical AS lexical
     JOIN filing_intelligence.filing_chunk AS chunk
       ON chunk.id = lexical.chunk_row_id
      AND chunk.document_id = lexical.document_id
      AND chunk.chunk_id = lexical.chunk_id
     WHERE lexical.generation_id = $1 AND lexical.document_id = $2
     ORDER BY chunk.ordinal, chunk.chunk_id`,
    [generation.id, document.id],
  );
  const totalLexemeCount = rows.rows.reduce((total, row) => total + row.lexeme_count, 0);
  const fingerprint = lexicalGenerationFingerprint(rows.rows.map(row => ({
    chunkId: row.chunk_id,
    hash: row.lexical_content_hash,
    lexemeCount: row.lexeme_count,
  })));
  if (rows.rows.length !== generation.chunk_count
    || totalLexemeCount !== generation.total_lexeme_count
    || fingerprint !== generation.lexical_fingerprint) {
    throw eligibilityError('FILING_ELIGIBILITY_GENERATION_INTEGRITY_FAILURE');
  }
}

function resultFor(
  persistenceStatus: FilingEligibilityResult['persistenceStatus'],
  row: EligibilityRow,
): FilingEligibilityResult {
  return {
    persistenceStatus,
    documentId: row.document_id,
    receiptId: row.receipt_id,
    retrievalPolicyId: row.retrieval_policy_id,
    retrievalPolicyFingerprint: row.retrieval_policy_fingerprint,
    representationPolicyId: row.representation_policy_id,
    representationPolicyFingerprint: row.representation_policy_fingerprint,
    status: row.status,
    reasonCode: row.reason_code,
    representationFingerprint: row.representation_fingerprint,
    eligibilityFingerprint: row.eligibility_fingerprint,
    ...(row.lexical_generation_id == null ? {} : {
      lexicalGenerationId: row.lexical_generation_id,
      lexicalGenerationFingerprint: row.lexical_generation_fingerprint!,
    }),
    revision: row.revision,
    evaluatedAt: row.evaluated_at,
  };
}

function storedRowMatchesEvaluation(
  row: EligibilityRow,
  document: DocumentRow,
  state: EvaluationState,
  retrievalPolicyId: string,
  retrievalPolicyFingerprint: string,
): boolean {
  const generation = state.generation;
  return row.document_id === document.id
    && row.receipt_id === document.receipt_id
    && row.retrieval_policy_id === retrievalPolicyId
    && row.retrieval_policy_fingerprint === retrievalPolicyFingerprint
    && row.representation_policy_id === FILING_REPRESENTATION_POLICY.policyId
    && row.representation_policy_fingerprint === FILING_REPRESENTATION_POLICY.fingerprint
    && row.status === state.status
    && row.reason_code === state.reasonCode
    && row.representation_fingerprint === document.representation_fingerprint
    && row.lexical_generation_id === (generation?.id ?? null)
    && row.lexical_profile_id === (generation?.profile_id ?? null)
    && row.lexical_schema_version === (generation?.schema_version ?? null)
    && row.lexical_normalizer_version === (generation?.normalizer_version ?? null)
    && row.lexical_text_search_config === (generation?.text_search_config ?? null)
    && row.lexical_generation_fingerprint === (generation?.lexical_fingerprint ?? null)
    && row.lexical_chunk_count === (generation?.chunk_count ?? null)
    && row.lexical_total_lexeme_count === (generation?.total_lexeme_count ?? null);
}

export class FilingEligibilityRepository {
  constructor(private readonly pool: Pool) {}

  async evaluateDocumentEligibility(
    documentId: string,
    retrievalPolicyId: string,
  ): Promise<FilingEligibilityResult> {
    checkedId(documentId);
    try {
      return await withTransaction(this.pool, client =>
        this.evaluateDocumentEligibilityWithClient(client, documentId, retrievalPolicyId));
    } catch (error) {
      throw mapError(error);
    }
  }

  async evaluateDocumentEligibilityWithClient(
    client: PoolClient,
    documentId: string,
    retrievalPolicyId: string,
    transactionDatabaseNow?: Date,
  ): Promise<FilingEligibilityResult> {
    checkedId(documentId);
    const policy = getRetrievalPolicy(retrievalPolicyId);
    try {
      const timeResult = transactionDatabaseNow == null
        ? await client.query<{ database_now: Date }>('SELECT clock_timestamp() AS database_now')
        : null;
      const databaseNow = transactionDatabaseNow ?? timeResult?.rows[0]?.database_now;
      if (!(databaseNow instanceof Date)) {
        throw eligibilityError('FILING_ELIGIBILITY_TRANSACTION_FAILED');
      }
      const document = await loadDocument(client, documentId);
      await verifyRepresentation(client, document);

      let state: EvaluationState;
      if (!representationMatches(document)) {
        state = {
          status: 'ineligible',
          reasonCode: 'representation_policy_mismatch',
          generation: null,
        };
      } else if (document.lineage_status === 'quarantined') {
        state = {
          status: 'ineligible',
          reasonCode: 'receipt_quarantined',
          generation: null,
        };
      } else {
        const generation = await loadGeneration(client, document);
        if (!generation) {
          state = {
            status: 'ineligible',
            reasonCode: 'lexical_generation_missing',
            generation: null,
          };
        } else if (generation.status !== 'ready') {
          state = {
            status: 'ineligible',
            reasonCode: 'lexical_generation_not_ready',
            generation,
          };
        } else {
          await verifyReadyGeneration(client, document, generation);
          state = { status: 'eligible', reasonCode: 'eligible', generation };
        }
      }

      const eligibilityFingerprint = calculateEligibilityFingerprint({
        retrievalPolicyId: policy.policyId,
        retrievalPolicyFingerprint: policy.fingerprint,
        representationPolicyId: FILING_REPRESENTATION_POLICY.policyId,
        representationPolicyFingerprint: FILING_REPRESENTATION_POLICY.fingerprint,
        documentId: document.id,
        receiptId: document.receipt_id,
        provider: document.provider,
        receiptNumber: document.receipt_number,
        sourceEntryHash: document.source_entry_hash,
        canonicalSchemaName: document.canonical_schema_name,
        canonicalSchemaVersion: document.canonical_schema_version,
        parserVersion: document.parser_version,
        chunkSchemaVersion: document.chunk_schema_version,
        chunkerVersion: document.chunker_version,
        canonicalFingerprint: document.canonical_fingerprint,
        chunkFingerprint: document.chunk_fingerprint,
        representationFingerprint: document.representation_fingerprint,
        sectionCount: document.section_count,
        blockCount: document.block_count,
        chunkCount: document.chunk_count,
        status: state.status,
        reasonCode: state.reasonCode,
        lexicalGeneration: state.generation == null ? null : {
          id: state.generation.id,
          profileId: state.generation.profile_id,
          schemaVersion: state.generation.schema_version,
          normalizerVersion: state.generation.normalizer_version,
          textSearchConfig: state.generation.text_search_config,
          status: state.generation.status,
          chunkCount: state.generation.chunk_count,
          lexicalFingerprint: state.generation.lexical_fingerprint,
          totalLexemeCount: state.generation.total_lexeme_count,
        },
      });
      return await this.persistEvaluation(client, document, state, policy.policyId,
        policy.fingerprint, eligibilityFingerprint, databaseNow);
    } catch (error) {
      throw mapError(error);
    }
  }

  private async persistEvaluation(
    client: PoolClient,
    document: DocumentRow,
    state: EvaluationState,
    retrievalPolicyId: string,
    retrievalPolicyFingerprint: string,
    eligibilityFingerprint: string,
    databaseNow: Date,
  ): Promise<FilingEligibilityResult> {
    const generation = state.generation;
    const values = [
      document.id,
      document.receipt_id,
      retrievalPolicyId,
      retrievalPolicyFingerprint,
      FILING_REPRESENTATION_POLICY.policyId,
      FILING_REPRESENTATION_POLICY.fingerprint,
      state.status,
      state.reasonCode,
      document.representation_fingerprint,
      generation?.id ?? null,
      generation?.profile_id ?? null,
      generation?.schema_version ?? null,
      generation?.normalizer_version ?? null,
      generation?.text_search_config ?? null,
      generation?.lexical_fingerprint ?? null,
      generation?.chunk_count ?? null,
      generation?.total_lexeme_count ?? null,
      eligibilityFingerprint,
      databaseNow,
    ];
    const inserted = await client.query<EligibilityRow>(
      `INSERT INTO filing_intelligence.filing_retrieval_eligibility (
         document_id, receipt_id, retrieval_policy_id, retrieval_policy_fingerprint,
         representation_policy_id, representation_policy_fingerprint, status,
         reason_code, representation_fingerprint, lexical_generation_id,
         lexical_profile_id, lexical_schema_version, lexical_normalizer_version,
         lexical_text_search_config, lexical_generation_fingerprint, lexical_chunk_count,
         lexical_total_lexeme_count, eligibility_fingerprint, revision,
         evaluated_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18, 1, $19, $19, $19
       )
       ON CONFLICT (document_id, retrieval_policy_id) DO NOTHING
       RETURNING document_id::text, receipt_id::text, retrieval_policy_id,
                 retrieval_policy_fingerprint, representation_policy_id,
                 representation_policy_fingerprint, status, reason_code,
                 representation_fingerprint, eligibility_fingerprint,
                 lexical_generation_id::text, lexical_profile_id,
                 lexical_schema_version, lexical_normalizer_version,
                 lexical_text_search_config, lexical_generation_fingerprint,
                 lexical_chunk_count, lexical_total_lexeme_count,
                 revision::text, evaluated_at`,
      values,
    );
    const insertedRow = inserted.rows[0];
    if (insertedRow) return resultFor('inserted', insertedRow);

    const existingResult = await client.query<EligibilityRow>(
      `SELECT document_id::text, receipt_id::text, retrieval_policy_id,
              retrieval_policy_fingerprint, representation_policy_id,
              representation_policy_fingerprint, status, reason_code,
              representation_fingerprint, eligibility_fingerprint,
              lexical_generation_id::text, lexical_profile_id,
              lexical_schema_version, lexical_normalizer_version,
              lexical_text_search_config, lexical_generation_fingerprint,
              lexical_chunk_count, lexical_total_lexeme_count,
              revision::text, evaluated_at
       FROM filing_intelligence.filing_retrieval_eligibility
       WHERE document_id = $1 AND retrieval_policy_id = $2
       FOR UPDATE`,
      [document.id, retrievalPolicyId],
    );
    const existing = existingResult.rows[0];
    if (!existing) throw eligibilityError('FILING_ELIGIBILITY_CONFLICT');
    if (existing.eligibility_fingerprint === eligibilityFingerprint) {
      if (!storedRowMatchesEvaluation(existing, document, state, retrievalPolicyId,
        retrievalPolicyFingerprint)) {
        throw eligibilityError('FILING_ELIGIBILITY_PERSISTED_STATE_INTEGRITY_FAILURE');
      }
      return resultFor('already_evaluated', existing);
    }
    const updated = await client.query<EligibilityRow>(
      `UPDATE filing_intelligence.filing_retrieval_eligibility
       SET receipt_id = $2,
           retrieval_policy_fingerprint = $4,
           representation_policy_id = $5,
           representation_policy_fingerprint = $6,
           status = $7,
           reason_code = $8,
           representation_fingerprint = $9,
           lexical_generation_id = $10,
           lexical_profile_id = $11,
           lexical_schema_version = $12,
           lexical_normalizer_version = $13,
           lexical_text_search_config = $14,
           lexical_generation_fingerprint = $15,
           lexical_chunk_count = $16,
           lexical_total_lexeme_count = $17,
           eligibility_fingerprint = $18,
           revision = revision + 1,
           evaluated_at = $19,
           updated_at = $19
       WHERE document_id = $1 AND retrieval_policy_id = $3
       RETURNING document_id::text, receipt_id::text, retrieval_policy_id,
                 retrieval_policy_fingerprint, representation_policy_id,
                 representation_policy_fingerprint, status, reason_code,
                 representation_fingerprint, eligibility_fingerprint,
                 lexical_generation_id::text, lexical_profile_id,
                 lexical_schema_version, lexical_normalizer_version,
                 lexical_text_search_config, lexical_generation_fingerprint,
                 lexical_chunk_count, lexical_total_lexeme_count,
                 revision::text, evaluated_at`,
      values,
    );
    const row = updated.rows[0];
    if (!row) throw eligibilityError('FILING_ELIGIBILITY_CONFLICT');
    return resultFor('updated', row);
  }

  async selectReceiptEligibleRepresentation(
    receiptId: string,
    retrievalPolicyId: string,
  ): Promise<FilingRepresentationSelection> {
    checkedId(receiptId);
    const policy = getRetrievalPolicy(retrievalPolicyId);
    try {
      const result = await this.pool.query<{
        document_id: string;
        eligibility_fingerprint: string;
        representation_fingerprint: string;
      }>(
        `SELECT document_id::text, eligibility_fingerprint, representation_fingerprint
         FROM filing_intelligence.filing_retrieval_eligibility
         WHERE receipt_id = $1
           AND retrieval_policy_id = $2
           AND retrieval_policy_fingerprint = $3
           AND representation_policy_id = $4
           AND representation_policy_fingerprint = $5
           AND status = 'eligible'
         ORDER BY document_id`,
        [receiptId, policy.policyId, policy.fingerprint,
          FILING_REPRESENTATION_POLICY.policyId,
          FILING_REPRESENTATION_POLICY.fingerprint],
      );
      if (result.rows.length === 0) return { status: 'not_found', receiptId };
      if (result.rows.length > 1) {
        return {
          status: 'ambiguous',
          receiptId,
          documentIds: result.rows.map(row => row.document_id),
        };
      }
      const selected = result.rows[0]!;
      return {
        status: 'selected',
        receiptId,
        documentId: selected.document_id,
        eligibilityFingerprint: selected.eligibility_fingerprint,
        representationFingerprint: selected.representation_fingerprint,
      };
    } catch (error) {
      throw mapError(error);
    }
  }
}
