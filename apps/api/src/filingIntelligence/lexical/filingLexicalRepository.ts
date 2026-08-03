import { Pool, PoolClient } from 'pg';

import { withTransaction } from '../../infrastructure/database/transaction.js';
import {
  FilingLexicalCandidate,
  FilingLexicalIndexResult,
  RetrieveLexicalFilingChunksInput,
} from './contracts.js';
import { FilingLexicalError } from './errors.js';
import {
  lexicalContentHash,
  lexicalGenerationFingerprint,
  WeightedLexemes,
} from './lexicalFingerprints.js';
import { lexicalizeText, safeOrTsquery } from './lexicalNormalizer.js';
import { FILING_LEXICAL_BOUNDS, FILING_LEXICAL_PROFILE } from './profile.js';
import { filingLexicalWeightAText, filingLexicalWeightCText } from './semanticFields.js';

const BIGINT = /^[1-9]\d*$/;
const SYMBOL = /^\d{6}$/;
const CORP_CODE = /^\d{8}$/;

interface DocumentRow {
  id: string;
  provider: string;
  receipt_number: string;
  corp_code: string;
  symbol: string;
  company_name: string | null;
  report_name: string | null;
  report_code: string | null;
  filing_date: Date | string | null;
  source_title: string | null;
  upstream_report_name: string | null;
  parser_version: string;
  chunker_version: string;
  chunk_count: number;
}

interface ChunkRow {
  id: string;
  chunk_id: string;
  ordinal: number;
  section_id: string | null;
  section_path: string[];
  source_text: string;
  retrieval_text: string;
  content_hash: string;
  locator: unknown;
  table_id: string | null;
}

interface PreparedChunk {
  readonly row: ChunkRow;
  readonly weighted: WeightedLexemes;
  readonly hash: string;
  readonly weightAPayload: string;
  readonly weightBPayload: string;
  readonly weightCPayload: string;
  readonly lexemeCount: number;
}

interface ExistingGenerationRow {
  id: string;
  status: string;
  schema_version: string;
  normalizer_version: string;
  text_search_config: string;
  chunk_count: number;
  lexical_fingerprint: string;
  total_lexeme_count: number;
}

function lexicalError(code: FilingLexicalError['code']): FilingLexicalError {
  return new FilingLexicalError(code, false);
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' ? error.code : undefined;
}

function mapError(error: unknown): FilingLexicalError {
  if (error instanceof FilingLexicalError) return error;
  const code = postgresCode(error);
  if (code === '23505') return lexicalError('FILING_LEXICAL_INDEX_CONFLICT');
  if (code === '23503' || code === '23514' || code === '22P02') {
    return lexicalError('FILING_LEXICAL_INDEX_INTEGRITY_FAILURE');
  }
  return new FilingLexicalError('FILING_LEXICAL_TRANSACTION_FAILED',
    code == null || code.startsWith('08') || code === '40001' || code === '40P01' || code === '57014',
    { cause: error });
}

function dateOnly(value: Date | string | null): string | undefined {
  if (value == null) return undefined;
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function locator(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw lexicalError('FILING_LEXICAL_RETRIEVAL_INTEGRITY_FAILURE');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.entryName !== 'string'
    || !Number.isInteger(record.firstBlockOrdinal)
    || !Number.isInteger(record.lastBlockOrdinal)) {
    throw lexicalError('FILING_LEXICAL_RETRIEVAL_INTEGRITY_FAILURE');
  }
  return record;
}

function validateDocumentId(value: string): void {
  if (!BIGINT.test(value) || value.length > 19) throw lexicalError('FILING_LEXICAL_INVALID_INPUT');
}

function prepareChunks(document: DocumentRow, rows: readonly ChunkRow[]): PreparedChunk[] {
  const weightC = lexicalizeText(filingLexicalWeightCText({
    companyName: document.company_name,
    symbol: document.symbol,
    corpCode: document.corp_code,
    receiptNumber: document.receipt_number,
    reportName: document.report_name,
    reportCode: document.report_code,
    filingDate: dateOnly(document.filing_date),
    sourceTitle: document.source_title,
    upstreamReportName: document.upstream_report_name,
  }));
  return rows.map(row => {
    const weightA = lexicalizeText(filingLexicalWeightAText({
      sectionPath: row.section_path,
      tableId: row.table_id,
    }));
    const weightB = lexicalizeText(row.retrieval_text);
    const lexemeCount = weightA.lexemes.length + weightB.lexemes.length + weightC.lexemes.length;
    if (lexemeCount > FILING_LEXICAL_BOUNDS.maximumLexemesPerChunk) {
      throw lexicalError('FILING_LEXICAL_INVALID_INPUT');
    }
    const weighted: WeightedLexemes = {
      chunkRowId: row.id,
      chunkId: row.chunk_id,
      chunkContentHash: row.content_hash,
      weightA: weightA.lexemes,
      weightB: weightB.lexemes,
      weightC: weightC.lexemes,
    };
    return { row, weighted, hash: lexicalContentHash(weighted),
      weightAPayload: weightA.payload, weightBPayload: weightB.payload,
      weightCPayload: weightC.payload, lexemeCount };
  });
}

function indexResult(
  status: FilingLexicalIndexResult['status'],
  generationId: string,
  documentId: string,
  fingerprint: string,
  chunkCount: number,
  totalLexemeCount: number,
): FilingLexicalIndexResult {
  return { status, generationId, documentId, profileId: FILING_LEXICAL_PROFILE.profileId,
    lexicalFingerprint: fingerprint, chunkCount, totalLexemeCount };
}

async function insertLexicalBatches(
  client: PoolClient,
  generationId: string,
  documentId: string,
  chunks: readonly PreparedChunk[],
): Promise<void> {
  const columnsPerRow = 12;
  for (let offset = 0; offset < chunks.length; offset += FILING_LEXICAL_BOUNDS.insertionBatchSize) {
    const batch = chunks.slice(offset, offset + FILING_LEXICAL_BOUNDS.insertionBatchSize);
    const values: unknown[] = [];
    const tuples = batch.map((chunk, index) => {
      const base = index * columnsPerRow;
      values.push(generationId, documentId, chunk.row.id, chunk.row.chunk_id,
        chunk.weightAPayload, chunk.weightBPayload, chunk.weightCPayload, chunk.hash,
        chunk.lexemeCount, chunk.weighted.weightA.length, chunk.weighted.weightB.length,
        chunk.weighted.weightC.length);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4},
        setweight(to_tsvector('simple'::regconfig, $${base + 5}), 'A') ||
        setweight(to_tsvector('simple'::regconfig, $${base + 6}), 'B') ||
        setweight(to_tsvector('simple'::regconfig, $${base + 7}), 'C'),
        $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12})`;
    });
    await client.query(
      `INSERT INTO filing_intelligence.filing_chunk_lexical (
         generation_id, document_id, chunk_row_id, chunk_id, search_vector,
         lexical_content_hash, lexeme_count, weight_a_lexeme_count,
         weight_b_lexeme_count, weight_c_lexeme_count
       ) VALUES ${tuples.join(', ')}`,
      values,
    );
  }
}

export class FilingLexicalRepository {
  constructor(private readonly pool: Pool) {}

  async indexFilingDocumentLexically(documentId: string): Promise<FilingLexicalIndexResult> {
    validateDocumentId(documentId);
    try {
      return await withTransaction(this.pool, async client => {
        const documentResult = await client.query<DocumentRow>(
          `SELECT id::text, provider, receipt_number, corp_code, symbol, company_name,
                  report_name, report_code, filing_date, source_title,
                  upstream_report_name, parser_version, chunker_version, chunk_count
           FROM filing_intelligence.filing_document WHERE id = $1 FOR SHARE`,
          [documentId],
        );
        const document = documentResult.rows[0];
        if (!document) throw lexicalError('FILING_LEXICAL_INVALID_INPUT');
        const chunkResult = await client.query<ChunkRow>(
          `SELECT id::text, chunk_id, ordinal, section_id, section_path, source_text,
                  retrieval_text, content_hash, locator, table_id
           FROM filing_intelligence.filing_chunk
           WHERE document_id = $1 AND chunker_version = $2
           ORDER BY ordinal ASC, chunk_id ASC`,
          [documentId, document.chunker_version],
        );
        if (chunkResult.rows.length !== document.chunk_count) {
          throw lexicalError('FILING_LEXICAL_INDEX_INTEGRITY_FAILURE');
        }
        const prepared = prepareChunks(document, chunkResult.rows);
        const fingerprint = lexicalGenerationFingerprint(prepared.map(chunk => ({
          chunkId: chunk.row.chunk_id, hash: chunk.hash, lexemeCount: chunk.lexemeCount,
        })));
        const totalLexemeCount = prepared.reduce((total, chunk) => total + chunk.lexemeCount, 0);
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO filing_intelligence.filing_lexical_generation (
             document_id, profile_id, schema_version, normalizer_version,
             text_search_config, status, chunk_count, lexical_fingerprint,
             total_lexeme_count
           ) VALUES ($1, $2, $3, $4, $5, 'building', $6, $7, $8)
           ON CONFLICT ON CONSTRAINT filing_lexical_generation_document_profile_unique DO NOTHING
           RETURNING id::text`,
          [documentId, FILING_LEXICAL_PROFILE.profileId, FILING_LEXICAL_PROFILE.schemaVersion,
            FILING_LEXICAL_PROFILE.normalizerVersion, FILING_LEXICAL_PROFILE.textSearchConfig,
            prepared.length, fingerprint, totalLexemeCount],
        );
        const generationId = inserted.rows[0]?.id;
        if (!generationId) {
          const existingResult = await client.query<ExistingGenerationRow>(
            `SELECT id::text, status, schema_version, normalizer_version,
                    text_search_config, chunk_count, lexical_fingerprint,
                    total_lexeme_count
             FROM filing_intelligence.filing_lexical_generation
             WHERE document_id = $1 AND profile_id = $2 FOR UPDATE`,
            [documentId, FILING_LEXICAL_PROFILE.profileId],
          );
          const existing = existingResult.rows[0];
          if (!existing || existing.status !== 'ready'
            || existing.schema_version !== FILING_LEXICAL_PROFILE.schemaVersion
            || existing.normalizer_version !== FILING_LEXICAL_PROFILE.normalizerVersion
            || existing.text_search_config !== FILING_LEXICAL_PROFILE.textSearchConfig
            || existing.chunk_count !== prepared.length
            || existing.lexical_fingerprint !== fingerprint
            || existing.total_lexeme_count !== totalLexemeCount) {
            throw lexicalError('FILING_LEXICAL_INDEX_CONFLICT');
          }
          return indexResult('already_indexed', existing.id, documentId, fingerprint,
            prepared.length, totalLexemeCount);
        }
        await insertLexicalBatches(client, generationId, documentId, prepared);
        const countResult = await client.query<{ count: number; lexemes: number }>(
          `SELECT count(*)::integer AS count, COALESCE(sum(lexeme_count), 0)::integer AS lexemes
           FROM filing_intelligence.filing_chunk_lexical WHERE generation_id = $1`,
          [generationId],
        );
        const counts = countResult.rows[0];
        if (!counts || counts.count !== prepared.length || counts.lexemes !== totalLexemeCount) {
          throw lexicalError('FILING_LEXICAL_INDEX_INTEGRITY_FAILURE');
        }
        const ready = await client.query(
          `UPDATE filing_intelligence.filing_lexical_generation
           SET status = 'ready', completed_at = clock_timestamp()
           WHERE id = $1 AND status = 'building'`,
          [generationId],
        );
        if (ready.rowCount !== 1) throw lexicalError('FILING_LEXICAL_INDEX_INTEGRITY_FAILURE');
        return indexResult('indexed', generationId, documentId, fingerprint,
          prepared.length, totalLexemeCount);
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  async retrieveLexicalFilingChunks(
    input: RetrieveLexicalFilingChunksInput,
  ): Promise<FilingLexicalCandidate[]> {
    const topK = input.topK ?? FILING_LEXICAL_BOUNDS.defaultTopK;
    if (!SYMBOL.test(input.symbol) || !CORP_CODE.test(input.corpCode)
      || !Number.isInteger(topK) || topK < 1 || topK > FILING_LEXICAL_BOUNDS.maximumTopK
      || input.documentIds.length > FILING_LEXICAL_BOUNDS.maximumDocumentScope) {
      throw lexicalError('FILING_LEXICAL_SCOPE_INVALID');
    }
    const documentIds = [...new Set(input.documentIds)];
    documentIds.forEach(value => {
      if (!BIGINT.test(value) || value.length > 19) throw lexicalError('FILING_LEXICAL_SCOPE_INVALID');
    });
    if (documentIds.length === 0) return [];
    const query = lexicalizeText(input.query, { query: true });
    try {
      const scope = await this.pool.query<{ id: string; corp_code: string; symbol: string }>(
        `SELECT id::text, corp_code, symbol
         FROM filing_intelligence.filing_document WHERE id = ANY($1::bigint[])`,
        [documentIds],
      );
      if (scope.rows.length !== documentIds.length
        || scope.rows.some(row => row.corp_code !== input.corpCode || row.symbol !== input.symbol)) {
        throw lexicalError('FILING_LEXICAL_SCOPE_INVALID');
      }
      if (query.lexemes.length === 0) return [];
      const tsquery = safeOrTsquery(query.lexemes);
      const result = await this.pool.query<{
        document_id: string; chunk_row_id: string; chunk_id: string; provider: string;
        receipt_number: string; corp_code: string; symbol: string; report_name: string | null;
        filing_date: Date | string | null; section_id: string | null; section_path: string[];
        ordinal: number; source_text: string; retrieval_text: string; locator: unknown;
        content_hash: string; parser_version: string; chunker_version: string;
        profile_id: string; lexical_rank: number;
      }>(
        `WITH lexical_query AS (
           SELECT to_tsquery('simple'::regconfig, $5) AS query
         )
         SELECT d.id::text AS document_id, c.id::text AS chunk_row_id, c.chunk_id,
                d.provider, d.receipt_number, d.corp_code, d.symbol, d.report_name,
                d.filing_date, c.section_id, c.section_path, c.ordinal, c.source_text,
                c.retrieval_text, c.locator, c.content_hash, c.parser_version,
                c.chunker_version, g.profile_id,
                ts_rank_cd(l.search_vector, q.query) AS lexical_rank
         FROM filing_intelligence.filing_document d
         JOIN filing_intelligence.filing_lexical_generation g
           ON g.document_id = d.id AND g.profile_id = $4 AND g.status = 'ready'
         JOIN filing_intelligence.filing_chunk_lexical l
           ON l.generation_id = g.id AND l.document_id = d.id
         JOIN filing_intelligence.filing_chunk c
           ON c.id = l.chunk_row_id AND c.document_id = l.document_id
         CROSS JOIN lexical_query q
         WHERE d.id = ANY($1::bigint[]) AND d.corp_code = $2 AND d.symbol = $3
           AND l.search_vector @@ q.query
         ORDER BY lexical_rank DESC, d.id ASC, c.ordinal ASC, c.chunk_id ASC
         LIMIT $6`,
        [documentIds, input.corpCode, input.symbol, FILING_LEXICAL_PROFILE.profileId,
          tsquery, topK],
      );
      const allowed = new Set(documentIds);
      return result.rows.map(row => {
        const rank = Number(row.lexical_rank);
        if (!allowed.has(row.document_id) || row.corp_code !== input.corpCode
          || row.symbol !== input.symbol || row.profile_id !== FILING_LEXICAL_PROFILE.profileId
          || !Number.isFinite(rank) || rank < 0) {
          throw lexicalError('FILING_LEXICAL_RETRIEVAL_INTEGRITY_FAILURE');
        }
        return {
          documentId: row.document_id, chunkRowId: row.chunk_row_id, chunkId: row.chunk_id,
          provider: row.provider, receiptNumber: row.receipt_number, corpCode: row.corp_code,
          symbol: row.symbol, reportName: row.report_name ?? undefined,
          filingDate: dateOnly(row.filing_date), sectionId: row.section_id ?? undefined,
          sectionPath: row.section_path, ordinal: row.ordinal, sourceText: row.source_text,
          retrievalText: row.retrieval_text, locator: locator(row.locator),
          contentHash: row.content_hash, parserVersion: row.parser_version,
          chunkerVersion: row.chunker_version, lexicalProfileId: row.profile_id,
          lexicalRank: rank,
        };
      });
    } catch (error) {
      throw mapError(error);
    }
  }
}
