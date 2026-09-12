import { Pool, PoolClient } from 'pg';

import {
  FILING_CHUNKER_VERSION,
  FILING_CHUNK_SCHEMA_VERSION,
} from '../../openDart/document/canonicalFilingContracts.js';
import { withTransaction } from '../../infrastructure/database/transaction.js';
import { FilingLineageError } from '../lineage/errors.js';
import { persistReceiptWithClient } from '../lineage/filingLineageRepository.js';
import {
  FilingPersistenceResult,
  FilingPersistenceSnapshot,
  PersistCanonicalFilingInput,
} from './contracts.js';
import { FilingPersistenceError } from './errors.js';
import {
  calculatePersistenceFingerprints,
  serializeJson,
} from './fingerprints.js';
import { validatePersistenceInput } from './validation.js';
import {
  persistRepresentationManifestWithClient,
  verifyStoredRepresentationManifestWithClient,
} from './representationManifest.js';

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 1_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 60_000;

interface ExistingDocumentRow {
  id: string;
  receipt_id: string;
  canonical_fingerprint: string;
  chunk_fingerprint: string;
  chunk_schema_version: string;
  chunker_version: string;
  decoding_profile_id: string | null;
  decoding_profile_fingerprint: string | null;
  canonical_utf8_hash: string | null;
  section_count: number;
  block_count: number;
  chunk_count: number;
}

interface CountRow {
  section_count: number;
  block_count: number;
  chunk_count: number;
}

export interface FilingPersistencePolicy {
  readonly batchSize?: number;
  readonly statementTimeoutMs?: number;
}

function checkedBatchSize(value: number | undefined): number {
  if (value == null) return DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > MAX_BATCH_SIZE) {
    throw new FilingPersistenceError('FILING_PERSISTENCE_INVALID_INPUT', false);
  }
  return value;
}

function checkedStatementTimeout(value: number | undefined): number {
  if (value == null) return DEFAULT_STATEMENT_TIMEOUT_MS;
  if (!Number.isInteger(value) || value < 1_000 || value > 10 * 60_000) {
    throw new FilingPersistenceError('FILING_PERSISTENCE_INVALID_INPUT', false);
  }
  return value;
}

function postgresCode(error: unknown): string | undefined {
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
  ) {
    return error.code;
  }
  return undefined;
}

function mapPersistenceError(error: unknown): FilingPersistenceError {
  if (error instanceof FilingPersistenceError) return error;
  if (error instanceof FilingLineageError) {
    const conflict = error.code === 'FILING_RECEIPT_IDENTITY_CONFLICT'
      || error.code === 'FILING_RECEIPT_OBSERVATION_CONFLICT';
    return new FilingPersistenceError(
      conflict ? 'FILING_PERSISTENCE_CONFLICT' : 'FILING_PERSISTENCE_INTEGRITY_FAILURE',
      error.retryable,
      { cause: error },
    );
  }
  const code = postgresCode(error);
  if (code === '23505') {
    return new FilingPersistenceError('FILING_PERSISTENCE_CONFLICT', false, {
      cause: error,
    });
  }
  if (code === '23503' || code === '23514' || code === '22P02') {
    return new FilingPersistenceError(
      'FILING_PERSISTENCE_INTEGRITY_FAILURE',
      false,
      { cause: error },
    );
  }
  const retryable = code == null
    || code.startsWith('08')
    || code === '40P01'
    || code === '40001'
    || code === '57014';
  return new FilingPersistenceError(
    'FILING_PERSISTENCE_TRANSACTION_FAILED',
    retryable,
    { cause: error },
  );
}

async function insertBatches(
  client: PoolClient,
  table: 'filing_section' | 'filing_block' | 'filing_chunk',
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  batchSize: number,
): Promise<void> {
  if (rows.some(row => row.length !== columns.length)) {
    throw new FilingPersistenceError('FILING_PERSISTENCE_INVALID_INPUT', false);
  }
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = batch.flatMap(row => [...row]);
    const tuples = batch.map((_, rowIndex) => {
      const base = rowIndex * columns.length;
      return `(${columns.map((__, columnIndex) => `$${base + columnIndex + 1}`).join(', ')})`;
    });
    await client.query(
      `INSERT INTO filing_intelligence.${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`,
      values,
    );
  }
}

async function actualCounts(
  client: PoolClient,
  documentId: string,
): Promise<CountRow> {
  const result = await client.query<CountRow>(
    `SELECT
       (SELECT count(*)::integer FROM filing_intelligence.filing_section WHERE document_id = $1) AS section_count,
       (SELECT count(*)::integer FROM filing_intelligence.filing_block WHERE document_id = $1) AS block_count,
       (SELECT count(*)::integer FROM filing_intelligence.filing_chunk WHERE document_id = $1) AS chunk_count`,
    [documentId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new FilingPersistenceError(
      'FILING_PERSISTENCE_INTEGRITY_FAILURE',
      false,
    );
  }
  return row;
}

function resultFor(
  status: FilingPersistenceResult['status'],
  documentId: string,
  canonicalFingerprint: string,
  chunkFingerprint: string,
  sectionCount: number,
  blockCount: number,
  chunkCount: number,
): FilingPersistenceResult {
  return {
    status,
    documentId,
    canonicalFingerprint,
    chunkFingerprint,
    sectionCount,
    blockCount,
    chunkCount,
  };
}

export class FilingDocumentRepository {
  private readonly batchSize: number;
  private readonly statementTimeoutMs: number;

  constructor(
    private readonly pool: Pool,
    policy: FilingPersistencePolicy = {},
  ) {
    this.batchSize = checkedBatchSize(policy.batchSize);
    this.statementTimeoutMs = checkedStatementTimeout(policy.statementTimeoutMs);
  }

  async persistCanonicalFiling(
    input: PersistCanonicalFilingInput,
  ): Promise<FilingPersistenceResult> {
    const prepared = validatePersistenceInput(input);
    const fingerprints = calculatePersistenceFingerprints(input);
    try {
      return await withTransaction(this.pool, async client => {
        await client.query(
          "SELECT set_config('statement_timeout', $1, true)",
          [`${this.statementTimeoutMs}ms`],
        );
        const observedAt = input.metadata.metadataObservedAt
          ?? (input.metadata.filingDate == null
            ? '1970-01-01T00:00:00.000Z'
            : `${input.metadata.filingDate}T00:00:00.000Z`);
        const receipt = await persistReceiptWithClient(client, {
          provider: input.document.provider,
          receiptNumber: input.document.receiptNumber,
          corpCode: input.metadata.corpCode,
          symbol: input.metadata.symbol,
          companyName: input.metadata.companyName,
          reportName: input.metadata.reportName,
          reportCode: input.metadata.reportCode,
          filingDate: input.metadata.filingDate,
          filerName: input.metadata.filerName,
          disclosureCategory: input.metadata.disclosureCategory,
          disclosureDetailType: input.metadata.disclosureDetailType,
          correctionType: input.metadata.correctionType,
          hasSubsequentCorrection: input.metadata.hasSubsequentCorrection,
          isWithdrawn: input.metadata.isWithdrawn,
          legalStatus: input.metadata.legalStatus,
          metadataSource: input.metadata.metadataSource ?? 'canonical-persistence',
          metadataObservedAt: observedAt,
          providerFinalObservedAt: input.metadata.providerFinalObservedAt,
        });
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO filing_intelligence.filing_document (
             receipt_id, provider, receipt_number, corp_code, symbol, company_name,
             report_name, report_code, filing_date, source_title,
             upstream_report_name, source_entry_name, source_entry_hash,
             source_entry_byte_length, canonical_schema_name,
             canonical_schema_version, parser_version, chunk_schema_version,
             chunker_version, decoding_profile_id, decoding_profile_fingerprint,
             source_declared_encoding, source_bom_kind, source_utf8_validity,
             canonical_utf8_hash, decoder_runtime_label,
             decoding_compatibility_reason, canonical_fingerprint, chunk_fingerprint,
             section_count, block_count, chunk_count
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
             $25, $26, $27, $28, $29, $30, $31, $32
           )
           ON CONFLICT ON CONSTRAINT filing_document_source_identity_unique
           DO NOTHING
           RETURNING id::text`,
          [
            receipt.receiptId,
            input.document.provider,
            input.document.receiptNumber,
            input.metadata.corpCode,
            input.metadata.symbol,
            input.metadata.companyName ?? null,
            input.metadata.reportName ?? null,
            input.metadata.reportCode ?? null,
            input.metadata.filingDate ?? null,
            input.document.sourceTitle,
            input.document.upstreamReportName,
            input.document.source.entryName,
            input.document.source.entrySha256,
            input.document.source.byteLength,
            input.document.schemaName,
            String(input.document.schemaVersion),
            input.document.parserVersion,
            String(FILING_CHUNK_SCHEMA_VERSION),
            FILING_CHUNKER_VERSION,
            input.document.source.decoding?.decodingProfileId ?? null,
            input.document.source.decoding?.decodingProfileFingerprint ?? null,
            input.document.source.decoding?.sourceDeclaredEncoding ?? null,
            input.document.source.decoding?.sourceBomKind ?? null,
            input.document.source.decoding?.sourceUtf8Validity ?? null,
            input.document.source.decoding?.canonicalUtf8Sha256 ?? null,
            input.document.source.decoding?.decoderRuntimeLabel ?? null,
            input.document.source.decoding?.compatibilityReason ?? null,
            fingerprints.canonicalFingerprint,
            fingerprints.chunkFingerprint,
            prepared.sections.length,
            prepared.blocks.length,
            prepared.chunks.length,
          ],
        );
        const insertedId = inserted.rows[0]?.id;
        if (!insertedId) {
          return this.resolveExisting(client, receipt.receiptId, input, fingerprints);
        }

        await insertBatches(
          client,
          'filing_section',
          [
            'document_id',
            'section_id',
            'parent_section_id',
            'title',
            'depth',
            'ordinal',
            'path',
            'block_ids',
          ],
          prepared.sections.map(({ section, parentSectionId }) => [
            insertedId,
            section.sectionId,
            parentSectionId,
            section.title,
            section.depth,
            section.ordinal,
            [...section.path],
            [...section.blockIds],
          ]),
          this.batchSize,
        );
        await insertBatches(
          client,
          'filing_block',
          [
            'document_id',
            'section_id',
            'block_id',
            'block_type',
            'ordinal',
            'section_path',
            'source_text',
            'retrieval_text',
            'content_hash',
            'locator',
            'table_data',
          ],
          prepared.blocks.map(block => [
            insertedId,
            block.sectionId,
            block.blockId,
            block.type,
            block.ordinal,
            [...block.sectionPath],
            block.sourceText,
            block.retrievalText,
            block.contentHash,
            serializeJson(block.locator),
            block.type === 'table' ? serializeJson(block.table) : null,
          ]),
          this.batchSize,
        );
        await insertBatches(
          client,
          'filing_chunk',
          [
            'document_id',
            'chunk_id',
            'chunk_schema_version',
            'parser_version',
            'chunker_version',
            'ordinal',
            'section_id',
            'section_path',
            'source_block_ids',
            'source_block_types',
            'source_text',
            'retrieval_text',
            'content_hash',
            'source_char_count',
            'retrieval_char_count',
            'locator',
            'table_id',
          ],
          prepared.chunks.map(chunk => [
            insertedId,
            chunk.chunkId,
            String(chunk.schemaVersion),
            chunk.parserVersion,
            chunk.chunkerVersion,
            chunk.ordinal,
            chunk.sectionId,
            [...chunk.sectionPath],
            [...chunk.sourceBlockIds],
            [...chunk.blockTypes],
            chunk.sourceText,
            chunk.retrievalText,
            chunk.contentHash,
            chunk.sourceText.length,
            chunk.charCount,
            serializeJson(chunk.locator),
            chunk.locator.tableId ?? null,
          ]),
          this.batchSize,
        );

        const counts = await actualCounts(client, insertedId);
        if (
          counts.section_count !== prepared.sections.length
          || counts.block_count !== prepared.blocks.length
          || counts.chunk_count !== prepared.chunks.length
        ) {
          throw new FilingPersistenceError(
            'FILING_PERSISTENCE_INTEGRITY_FAILURE',
            false,
          );
        }
        await persistRepresentationManifestWithClient(client, insertedId);
        return resultFor(
          'inserted',
          insertedId,
          fingerprints.canonicalFingerprint,
          fingerprints.chunkFingerprint,
          prepared.sections.length,
          prepared.blocks.length,
          prepared.chunks.length,
        );
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  private async resolveExisting(
    client: PoolClient,
    receiptId: string,
    input: PersistCanonicalFilingInput,
    fingerprints: ReturnType<typeof calculatePersistenceFingerprints>,
  ): Promise<FilingPersistenceResult> {
    const existingResult = await client.query<ExistingDocumentRow>(
      `SELECT id::text, receipt_id::text, canonical_fingerprint, chunk_fingerprint,
              chunk_schema_version, chunker_version, decoding_profile_id,
              decoding_profile_fingerprint, canonical_utf8_hash,
              section_count, block_count, chunk_count
       FROM filing_intelligence.filing_document
       WHERE provider = $1
         AND receipt_number = $2
         AND source_entry_hash = $3
         AND canonical_schema_name = $4
         AND canonical_schema_version = $5
         AND parser_version = $6
         AND chunk_schema_version = $7
         AND chunker_version = $8
         AND decoding_profile_id IS NOT DISTINCT FROM $9
         AND decoding_profile_fingerprint IS NOT DISTINCT FROM $10
         AND canonical_utf8_hash IS NOT DISTINCT FROM $11
       FOR UPDATE`,
      [
        input.document.provider,
        input.document.receiptNumber,
        input.document.source.entrySha256,
        input.document.schemaName,
        String(input.document.schemaVersion),
        input.document.parserVersion,
        String(FILING_CHUNK_SCHEMA_VERSION),
        FILING_CHUNKER_VERSION,
        input.document.source.decoding?.decodingProfileId ?? null,
        input.document.source.decoding?.decodingProfileFingerprint ?? null,
        input.document.source.decoding?.canonicalUtf8Sha256 ?? null,
      ],
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      throw new FilingPersistenceError(
        'FILING_PERSISTENCE_TRANSACTION_FAILED',
        true,
      );
    }
    if (
      existing.receipt_id !== receiptId
      || existing.canonical_fingerprint !== fingerprints.canonicalFingerprint
      || existing.chunk_fingerprint !== fingerprints.chunkFingerprint
      || existing.chunk_schema_version !== String(FILING_CHUNK_SCHEMA_VERSION)
      || existing.chunker_version !== FILING_CHUNKER_VERSION
      || existing.decoding_profile_id
        !== (input.document.source.decoding?.decodingProfileId ?? null)
      || existing.decoding_profile_fingerprint
        !== (input.document.source.decoding?.decodingProfileFingerprint ?? null)
      || existing.canonical_utf8_hash
        !== (input.document.source.decoding?.canonicalUtf8Sha256 ?? null)
    ) {
      throw new FilingPersistenceError('FILING_PERSISTENCE_CONFLICT', false);
    }
    const counts = await actualCounts(client, existing.id);
    if (
      existing.section_count !== counts.section_count
      || existing.block_count !== counts.block_count
      || existing.chunk_count !== counts.chunk_count
      || existing.section_count !== input.document.statistics.sectionCount
      || existing.block_count !== input.document.blocks.length
      || existing.chunk_count !== input.chunks.length
    ) {
      throw new FilingPersistenceError(
        'FILING_PERSISTENCE_INTEGRITY_FAILURE',
        false,
      );
    }
    await verifyStoredRepresentationManifestWithClient(client, existing.id);
    return resultFor(
      'already_present',
      existing.id,
      fingerprints.canonicalFingerprint,
      fingerprints.chunkFingerprint,
      existing.section_count,
      existing.block_count,
      existing.chunk_count,
    );
  }

  async getPersistenceSnapshot(
    documentId: string,
  ): Promise<FilingPersistenceSnapshot | undefined> {
    try {
      const documentResult = await this.pool.query<{
        id: string;
        receipt_id: string;
        provider: string;
        receipt_number: string;
        corp_code: string;
        symbol: string;
        canonical_schema_version: string;
        parser_version: string;
        decoding_profile_id: string | null;
        decoding_profile_fingerprint: string | null;
        source_declared_encoding: string | null;
        source_bom_kind: string | null;
        source_utf8_validity: string | null;
        canonical_utf8_hash: string | null;
        chunk_schema_version: string;
        chunker_version: string;
        canonical_fingerprint: string;
        chunk_fingerprint: string;
        representation_manifest_version: string;
        section_manifest_fingerprint: string;
        block_manifest_fingerprint: string;
        chunk_manifest_fingerprint: string;
        representation_fingerprint: string;
        section_count: number;
        block_count: number;
        chunk_count: number;
        is_retrieval_ready: boolean;
        is_current_effective: boolean;
        activated_at: Date | null;
        created_at: Date;
      }>(
        `SELECT id::text, receipt_id::text, provider, receipt_number, corp_code, symbol,
                canonical_schema_version, parser_version, chunk_schema_version,
                chunker_version, decoding_profile_id, decoding_profile_fingerprint,
                source_declared_encoding, source_bom_kind, source_utf8_validity,
                canonical_utf8_hash, canonical_fingerprint, chunk_fingerprint,
                manifest.representation_manifest_version,
                manifest.section_manifest_fingerprint,
                manifest.block_manifest_fingerprint,
                manifest.chunk_manifest_fingerprint,
                manifest.representation_fingerprint,
                section_count, block_count, chunk_count, is_retrieval_ready,
                is_current_effective, activated_at, document.created_at
         FROM filing_intelligence.filing_document AS document
         JOIN filing_intelligence.filing_document_representation_manifest AS manifest
           ON manifest.document_id = document.id
         WHERE document.id = $1`,
        [documentId],
      );
      const document = documentResult.rows[0];
      if (!document) return undefined;

      const [sectionResult, blockResult, chunkResult] = await Promise.all([
        this.pool.query<{
          section_id: string;
          parent_section_id: string | null;
          title: string | null;
          depth: number;
          ordinal: number;
          path: string[];
          block_ids: string[];
        }>(
          `SELECT section_id, parent_section_id, title, depth, ordinal, path, block_ids
           FROM filing_intelligence.filing_section
           WHERE document_id = $1
           ORDER BY ordinal`,
          [documentId],
        ),
        this.pool.query<{
          block_id: string;
          section_id: string | null;
          block_type: string;
          ordinal: number;
          source_text: string;
          retrieval_text: string;
          content_hash: string;
          locator: unknown;
          table_data: unknown | null;
        }>(
          `SELECT block_id, section_id, block_type, ordinal, source_text,
                  retrieval_text, content_hash, locator, table_data
           FROM filing_intelligence.filing_block
           WHERE document_id = $1
           ORDER BY ordinal`,
          [documentId],
        ),
        this.pool.query<{
          chunk_id: string;
          ordinal: number;
          section_id: string | null;
          source_block_ids: string[];
          source_text: string;
          retrieval_text: string;
          content_hash: string;
          locator: unknown;
        }>(
          `SELECT chunk_id, ordinal, section_id, source_block_ids, source_text,
                  retrieval_text, content_hash, locator
           FROM filing_intelligence.filing_chunk
           WHERE document_id = $1
           ORDER BY ordinal`,
          [documentId],
        ),
      ]);
      return {
        document: {
          id: document.id,
          receiptId: document.receipt_id,
          provider: document.provider,
          receiptNumber: document.receipt_number,
          corpCode: document.corp_code,
          symbol: document.symbol,
          canonicalSchemaVersion: document.canonical_schema_version,
          parserVersion: document.parser_version,
          decodingProfileId: document.decoding_profile_id,
          decodingProfileFingerprint: document.decoding_profile_fingerprint,
          sourceDeclaredEncoding: document.source_declared_encoding,
          sourceBomKind: document.source_bom_kind,
          sourceUtf8Validity: document.source_utf8_validity,
          canonicalUtf8Hash: document.canonical_utf8_hash,
          chunkSchemaVersion: document.chunk_schema_version,
          chunkerVersion: document.chunker_version,
          canonicalFingerprint: document.canonical_fingerprint,
          chunkFingerprint: document.chunk_fingerprint,
          representationManifestVersion: document.representation_manifest_version,
          sectionManifestFingerprint: document.section_manifest_fingerprint,
          blockManifestFingerprint: document.block_manifest_fingerprint,
          chunkManifestFingerprint: document.chunk_manifest_fingerprint,
          representationFingerprint: document.representation_fingerprint,
          sectionCount: document.section_count,
          blockCount: document.block_count,
          chunkCount: document.chunk_count,
          isRetrievalReady: document.is_retrieval_ready,
          isCurrentEffective: document.is_current_effective,
          activatedAt: document.activated_at,
          createdAt: document.created_at,
        },
        sections: sectionResult.rows.map(row => ({
          sectionId: row.section_id,
          parentSectionId: row.parent_section_id,
          title: row.title,
          depth: row.depth,
          ordinal: row.ordinal,
          path: row.path,
          blockIds: row.block_ids,
        })),
        blocks: blockResult.rows.map(row => ({
          blockId: row.block_id,
          sectionId: row.section_id,
          blockType: row.block_type,
          ordinal: row.ordinal,
          sourceText: row.source_text,
          retrievalText: row.retrieval_text,
          contentHash: row.content_hash,
          locator: row.locator,
          tableData: row.table_data,
        })),
        chunks: chunkResult.rows.map(row => ({
          chunkId: row.chunk_id,
          ordinal: row.ordinal,
          sectionId: row.section_id,
          sourceBlockIds: row.source_block_ids,
          sourceText: row.source_text,
          retrievalText: row.retrieval_text,
          contentHash: row.content_hash,
          locator: row.locator,
        })),
      };
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
