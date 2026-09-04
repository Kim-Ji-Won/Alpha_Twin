import { Pool } from 'pg';

import { FilingDenseError } from './errors.js';
import { denseInputFingerprint, denseInputManifestFingerprint } from './fingerprints.js';
import { FILING_DENSE_DIMENSION, getFilingDenseProfile } from './profile.js';
import {
  DenseNotReadyReason,
  DenseReadinessResult,
  DenseReadyGenerationReference,
  FilingDenseCandidate,
  FILING_DENSE_RETRIEVAL_BOUNDS,
  ResolveDenseReadinessInput,
  RetrieveDenseFilingChunksInput,
} from './retrievalContracts.js';
import { prepareDenseVector } from './vector.js';

const ID = /^[1-9]\d{0,18}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const CORP_CODE = /^\d{8}$/u;
const SYMBOL = /^\d{6}$/u;

interface ReadinessChunkRow {
  readonly chunkRowId: string;
  readonly ordinal: number;
  readonly chunkId: string;
  readonly contentHash: string;
  readonly retrievalText: string;
}

interface ReadinessRow {
  readonly scope_ordinal: string | number;
  readonly requested_document_id: string;
  readonly document_id: string | null;
  readonly corp_code: string | null;
  readonly symbol: string | null;
  readonly document_chunk_count: number | null;
  readonly stored_representation_fingerprint: string | null;
  readonly computed_representation_fingerprint: string | null;
  readonly generation_id: string | null;
  readonly dense_profile_id: string | null;
  readonly dense_profile_fingerprint: string | null;
  readonly generation_representation_fingerprint: string | null;
  readonly input_manifest_fingerprint: string | null;
  readonly dimension: number | null;
  readonly status: string | null;
  readonly expected_vector_count: number | null;
  readonly persisted_vector_count: number | null;
  readonly generation_fingerprint: string | null;
  readonly actual_vector_count: number;
  readonly chunks: unknown;
}

interface RetrievalRow {
  readonly requested_count: string | number;
  readonly verified_count: string | number;
  readonly document_id: string | null;
  readonly chunk_row_id: string | null;
  readonly chunk_id: string | null;
  readonly generation_id: string | null;
  readonly generation_fingerprint: string | null;
  readonly provider: string | null;
  readonly receipt_number: string | null;
  readonly corp_code: string | null;
  readonly symbol: string | null;
  readonly report_name: string | null;
  readonly filing_date: Date | string | null;
  readonly section_id: string | null;
  readonly section_path: string[] | null;
  readonly ordinal: number | null;
  readonly source_text: string | null;
  readonly retrieval_text: string | null;
  readonly locator: unknown;
  readonly content_hash: string | null;
  readonly parser_version: string | null;
  readonly chunker_version: string | null;
  readonly dense_profile_id: string | null;
  readonly cosine_distance: number | string | null;
}

export const DENSE_READINESS_SQL = `WITH requested AS MATERIALIZED (
  SELECT value.document_id, value.scope_ordinal
  FROM unnest($1::bigint[]) WITH ORDINALITY AS value(document_id, scope_ordinal)
)
SELECT requested.scope_ordinal, requested.document_id::text AS requested_document_id,
       document.id::text AS document_id, document.corp_code, document.symbol,
       document.chunk_count AS document_chunk_count,
       manifest.representation_fingerprint AS stored_representation_fingerprint,
       computed.representation_fingerprint AS computed_representation_fingerprint,
       generation.id::text AS generation_id, generation.dense_profile_id,
       generation.dense_profile_fingerprint,
       generation.representation_fingerprint AS generation_representation_fingerprint,
       generation.input_manifest_fingerprint, generation.dimension, generation.status,
       generation.expected_vector_count, generation.persisted_vector_count,
       generation.generation_fingerprint,
       coalesce(vector_count.actual_vector_count, 0)::integer AS actual_vector_count,
       coalesce(chunk_evidence.chunks, '[]'::jsonb) AS chunks
FROM requested
LEFT JOIN filing_intelligence.filing_document AS document
  ON document.id = requested.document_id
LEFT JOIN filing_intelligence.filing_document_representation_manifest AS manifest
  ON manifest.document_id = document.id
LEFT JOIN LATERAL (
  SELECT value.representation_fingerprint
  FROM filing_intelligence.compute_filing_representation_manifest(document.id) AS value
  WHERE document.id IS NOT NULL
) AS computed ON true
LEFT JOIN filing_intelligence.filing_dense_generation AS generation
  ON generation.document_id = document.id AND generation.dense_profile_id = $2
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS actual_vector_count
  FROM filing_intelligence.filing_chunk_embedding AS embedding
  WHERE embedding.generation_id = generation.id
) AS vector_count ON true
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
    'chunkRowId', chunk.id::text,
    'ordinal', chunk.ordinal,
    'chunkId', chunk.chunk_id,
    'contentHash', chunk.content_hash,
    'retrievalText', chunk.retrieval_text
  ) ORDER BY chunk.ordinal, chunk.chunk_id) AS chunks
  FROM filing_intelligence.filing_chunk AS chunk
  WHERE chunk.document_id = document.id
    AND chunk.chunker_version = document.chunker_version
) AS chunk_evidence ON true
ORDER BY requested.scope_ordinal`;

export const EXACT_DENSE_RETRIEVAL_SQL = `WITH requested AS MATERIALIZED (
  SELECT value.document_id, value.generation_id, value.generation_fingerprint,
         value.representation_fingerprint, value.input_manifest_fingerprint,
         value.expected_vector_count
  FROM unnest(
    $1::bigint[], $2::bigint[], $3::text[], $4::text[], $5::text[], $6::integer[]
  ) AS value(document_id, generation_id, generation_fingerprint,
             representation_fingerprint, input_manifest_fingerprint,
             expected_vector_count)
), embedding_counts AS MATERIALIZED (
  SELECT embedding.generation_id, count(*)::integer AS actual_vector_count
  FROM filing_intelligence.filing_chunk_embedding AS embedding
  JOIN requested ON requested.generation_id = embedding.generation_id
  GROUP BY embedding.generation_id
), verified_generations AS MATERIALIZED (
  SELECT generation.id, generation.document_id, generation.generation_fingerprint,
         generation.dense_profile_id
  FROM requested
  JOIN filing_intelligence.filing_dense_generation AS generation
    ON generation.id = requested.generation_id
   AND generation.document_id = requested.document_id
   AND generation.generation_fingerprint = requested.generation_fingerprint
   AND generation.representation_fingerprint = requested.representation_fingerprint
   AND generation.input_manifest_fingerprint = requested.input_manifest_fingerprint
   AND generation.expected_vector_count = requested.expected_vector_count
   AND generation.persisted_vector_count = requested.expected_vector_count
   AND generation.dense_profile_id = $9
   AND generation.dense_profile_fingerprint = $10
   AND generation.dimension = $11
   AND generation.status = 'ready'
  JOIN filing_intelligence.filing_document AS document
    ON document.id = generation.document_id
   AND document.corp_code = $7 AND document.symbol = $8
  JOIN filing_intelligence.filing_document_representation_manifest AS manifest
    ON manifest.document_id = document.id
   AND manifest.representation_fingerprint = generation.representation_fingerprint
  LEFT JOIN embedding_counts
    ON embedding_counts.generation_id = generation.id
  WHERE coalesce(embedding_counts.actual_vector_count, 0) = requested.expected_vector_count
), verification AS (
  SELECT (SELECT count(*) FROM requested) AS requested_count,
         count(*) AS verified_count
  FROM verified_generations
)
SELECT verification.requested_count, verification.verified_count,
       ranked.document_id, ranked.chunk_row_id, ranked.chunk_id,
       ranked.generation_id, ranked.generation_fingerprint, ranked.provider,
       ranked.receipt_number, ranked.corp_code, ranked.symbol, ranked.report_name,
       ranked.filing_date, ranked.section_id, ranked.section_path, ranked.ordinal,
       ranked.source_text, ranked.retrieval_text, ranked.locator,
       ranked.content_hash, ranked.parser_version, ranked.chunker_version,
       ranked.dense_profile_id, ranked.cosine_distance
FROM verification
LEFT JOIN LATERAL (
  SELECT document.id::text AS document_id, chunk.id::text AS chunk_row_id,
         chunk.chunk_id, generation.id::text AS generation_id,
         generation.generation_fingerprint, document.provider,
         document.receipt_number, document.corp_code, document.symbol,
         document.report_name, document.filing_date, chunk.section_id,
         chunk.section_path, chunk.ordinal, chunk.source_text,
         chunk.retrieval_text, chunk.locator, chunk.content_hash,
         chunk.parser_version, chunk.chunker_version, generation.dense_profile_id,
         embedding.embedding <=> $12::vector(1536) AS cosine_distance
  FROM verified_generations AS generation
  JOIN filing_intelligence.filing_document AS document
    ON document.id = generation.document_id
  JOIN filing_intelligence.filing_chunk_embedding AS embedding
    ON embedding.generation_id = generation.id
   AND embedding.document_id = generation.document_id
  JOIN filing_intelligence.filing_chunk AS chunk
    ON chunk.id = embedding.chunk_row_id
   AND chunk.document_id = embedding.document_id
   AND chunk.chunk_id = embedding.chunk_id
  ORDER BY cosine_distance ASC, document.id ASC, chunk.ordinal ASC, chunk.chunk_id ASC
  LIMIT $13
) AS ranked ON true
ORDER BY ranked.cosine_distance ASC NULLS LAST,
         ranked.document_id::bigint ASC NULLS LAST,
         ranked.ordinal ASC NULLS LAST,
         ranked.chunk_id ASC NULLS LAST`;

function denseError(code: FilingDenseError['code'], retryable = false, cause?: unknown) {
  return new FilingDenseError(code, retryable, cause === undefined ? undefined : { cause });
}

function postgresCode(value: unknown): string | undefined {
  return typeof value === 'object' && value !== null && 'code' in value
    && typeof value.code === 'string' ? value.code : undefined;
}

function mapDatabaseError(value: unknown): FilingDenseError {
  if (value instanceof FilingDenseError) return value;
  const code = postgresCode(value);
  return denseError('FILING_DENSE_RETRIEVAL_FAILED',
    code == null || code.startsWith('08') || code === '40001'
      || code === '40P01' || code === '57014', value);
}

function validateCompany(corpCode: string, symbol: string, code: FilingDenseError['code']): void {
  if (!CORP_CODE.test(corpCode) || !SYMBOL.test(symbol)) throw denseError(code);
}

function validateDocumentIds(documentIds: readonly string[], code: FilingDenseError['code']): void {
  if (documentIds.length > FILING_DENSE_RETRIEVAL_BOUNDS.maximumDocumentScope
    || new Set(documentIds).size !== documentIds.length
    || documentIds.some(documentId => !ID.test(documentId))) {
    throw denseError(code);
  }
}

function readinessChunks(value: unknown): readonly ReadinessChunkRow[] {
  if (!Array.isArray(value)) throw denseError('FILING_DENSE_GENERATION_INTEGRITY_FAILURE');
  return value.map(chunk => {
    if (typeof chunk !== 'object' || chunk === null || Array.isArray(chunk)) {
      throw denseError('FILING_DENSE_GENERATION_INTEGRITY_FAILURE');
    }
    const row = chunk as Record<string, unknown>;
    if (typeof row.chunkRowId !== 'string' || !ID.test(row.chunkRowId)
      || !Number.isInteger(row.ordinal) || typeof row.chunkId !== 'string'
      || typeof row.contentHash !== 'string' || !HASH.test(row.contentHash)
      || typeof row.retrievalText !== 'string' || row.retrievalText.length === 0) {
      throw denseError('FILING_DENSE_GENERATION_INTEGRITY_FAILURE');
    }
    return {
      chunkRowId: row.chunkRowId,
      ordinal: row.ordinal as number,
      chunkId: row.chunkId,
      contentHash: row.contentHash,
      retrievalText: row.retrievalText,
    };
  });
}

function dateOnly(value: Date | string | null): string | undefined {
  if (value == null) return undefined;
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function checkedLocator(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw denseError('FILING_DENSE_RETRIEVAL_INTEGRITY_FAILURE');
  }
  const locator = value as Readonly<Record<string, unknown>>;
  if (typeof locator.entryName !== 'string'
    || !Number.isInteger(locator.firstBlockOrdinal)
    || !Number.isInteger(locator.lastBlockOrdinal)) {
    throw denseError('FILING_DENSE_RETRIEVAL_INTEGRITY_FAILURE');
  }
  return locator;
}

export function denseSimilarityFromCosineDistance(distance: number): number {
  const epsilon = FILING_DENSE_RETRIEVAL_BOUNDS.cosineDistanceEpsilon;
  if (!Number.isFinite(distance) || distance < -epsilon || distance > 2 + epsilon) {
    throw denseError('FILING_DENSE_RETRIEVAL_INTEGRITY_FAILURE');
  }
  return Math.max(-1, Math.min(1, 1 - distance));
}

export class FilingDenseRetrievalRepository {
  constructor(private readonly pool: Pool) {}

  async resolveDenseReadiness(input: ResolveDenseReadinessInput): Promise<DenseReadinessResult> {
    validateCompany(input.corpCode, input.symbol, 'FILING_DENSE_READINESS_INVALID_INPUT');
    validateDocumentIds(input.documentIds, 'FILING_DENSE_READINESS_INVALID_INPUT');
    const profile = getFilingDenseProfile(input.denseProfileId);
    if (!profile) throw denseError('FILING_DENSE_READINESS_INVALID_INPUT');
    const common = {
      denseProfileId: profile.profileId,
      denseProfileFingerprint: profile.profileFingerprint,
    } as const;
    if (input.documentIds.length === 0) return { ...common, status: 'ready', generations: [] };

    try {
      const result = await this.pool.query<ReadinessRow>(
        DENSE_READINESS_SQL,
        [input.documentIds, profile.profileId],
      );
      if (result.rows.length !== input.documentIds.length) {
        throw denseError('FILING_DENSE_READINESS_SCOPE_FAILURE');
      }
      const ready: DenseReadyGenerationReference[] = [];
      const reasons: Array<{ documentId: string; reason: DenseNotReadyReason }> = [];
      for (const [index, row] of result.rows.entries()) {
        const documentId = input.documentIds[index]!;
        if (Number(row.scope_ordinal) !== index + 1
          || row.requested_document_id !== documentId || row.document_id !== documentId
          || row.corp_code !== input.corpCode || row.symbol !== input.symbol) {
          throw denseError('FILING_DENSE_READINESS_SCOPE_FAILURE');
        }
        if (!HASH.test(row.stored_representation_fingerprint ?? '')
          || row.stored_representation_fingerprint !== row.computed_representation_fingerprint) {
          throw denseError('FILING_DENSE_GENERATION_INTEGRITY_FAILURE');
        }
        if (row.generation_id == null) {
          reasons.push({ documentId, reason: 'generation_missing' });
          continue;
        }
        if (row.status === 'building' || row.status === 'failed') {
          reasons.push({ documentId,
            reason: row.status === 'building' ? 'generation_building' : 'generation_failed' });
          continue;
        }
        if (row.status !== 'ready' || !ID.test(row.generation_id)
          || row.dense_profile_id !== profile.profileId
          || row.dense_profile_fingerprint !== profile.profileFingerprint
          || row.generation_representation_fingerprint !== row.stored_representation_fingerprint
          || !HASH.test(row.input_manifest_fingerprint ?? '')
          || row.dimension !== FILING_DENSE_DIMENSION
          || !Number.isInteger(row.document_chunk_count)
          || !Number.isInteger(row.expected_vector_count)
          || row.expected_vector_count !== row.document_chunk_count
          || row.persisted_vector_count !== row.expected_vector_count
          || row.actual_vector_count !== row.expected_vector_count
          || !HASH.test(row.generation_fingerprint ?? '')) {
          throw denseError('FILING_DENSE_GENERATION_INTEGRITY_FAILURE');
        }
        const chunks = readinessChunks(row.chunks);
        if (chunks.length !== row.document_chunk_count) {
          throw denseError('FILING_DENSE_GENERATION_INTEGRITY_FAILURE');
        }
        const expectedManifest = denseInputManifestFingerprint(profile, chunks.map(chunk => ({
          chunkRowId: chunk.chunkRowId,
          ordinal: chunk.ordinal,
          chunkId: chunk.chunkId,
          contentHash: chunk.contentHash,
          retrievalText: chunk.retrievalText,
          inputFingerprint: denseInputFingerprint(profile,
            row.stored_representation_fingerprint!, chunk),
        })));
        if (expectedManifest !== row.input_manifest_fingerprint) {
          throw denseError('FILING_DENSE_GENERATION_INTEGRITY_FAILURE');
        }
        const generationFingerprint = row.generation_fingerprint;
        const representationFingerprint = row.stored_representation_fingerprint;
        if (generationFingerprint == null || representationFingerprint == null) {
          throw denseError('FILING_DENSE_GENERATION_INTEGRITY_FAILURE');
        }
        ready.push({
          documentId,
          generationId: row.generation_id,
          generationFingerprint,
          representationFingerprint,
          inputManifestFingerprint: row.input_manifest_fingerprint,
          expectedVectorCount: row.expected_vector_count,
        });
      }
      if (reasons.length > 0) {
        return { ...common, status: 'not_ready', generations: [],
          reasons: [reasons[0]!, ...reasons.slice(1)] };
      }
      return { ...common, status: 'ready', generations: ready };
    } catch (value) {
      throw mapDatabaseError(value);
    }
  }

  async retrieveDenseFilingChunks(
    input: RetrieveDenseFilingChunksInput,
  ): Promise<readonly FilingDenseCandidate[]> {
    validateCompany(input.corpCode, input.symbol, 'FILING_DENSE_RETRIEVAL_INVALID_INPUT');
    const topK = input.topK ?? FILING_DENSE_RETRIEVAL_BOUNDS.defaultTopK;
    if (!Number.isInteger(topK) || topK < 1
      || topK > FILING_DENSE_RETRIEVAL_BOUNDS.maximumTopK) {
      throw denseError('FILING_DENSE_RETRIEVAL_INVALID_INPUT');
    }
    const profile = getFilingDenseProfile(input.denseProfileId);
    if (!profile || input.denseProfileFingerprint !== profile.profileFingerprint) {
      throw denseError('FILING_DENSE_RETRIEVAL_INVALID_INPUT');
    }
    const documentIds = input.generations.map(value => value.documentId);
    validateDocumentIds(documentIds, 'FILING_DENSE_RETRIEVAL_INVALID_INPUT');
    if (new Set(input.generations.map(value => value.generationId)).size
      !== input.generations.length
      || input.generations.some(value => !ID.test(value.generationId)
        || !HASH.test(value.generationFingerprint)
        || !HASH.test(value.representationFingerprint)
        || !HASH.test(value.inputManifestFingerprint)
        || !Number.isInteger(value.expectedVectorCount) || value.expectedVectorCount < 0)) {
      throw denseError('FILING_DENSE_RETRIEVAL_INVALID_INPUT');
    }
    const queryVector = prepareDenseVector(input.queryVector);
    if (input.generations.length === 0) return [];

    try {
      const result = await this.pool.query<RetrievalRow>(EXACT_DENSE_RETRIEVAL_SQL, [
        documentIds,
        input.generations.map(value => value.generationId),
        input.generations.map(value => value.generationFingerprint),
        input.generations.map(value => value.representationFingerprint),
        input.generations.map(value => value.inputManifestFingerprint),
        input.generations.map(value => value.expectedVectorCount),
        input.corpCode,
        input.symbol,
        profile.profileId,
        profile.profileFingerprint,
        profile.dimensions,
        queryVector.pgVector,
        topK,
      ]);
      const first = result.rows[0];
      if (!first || Number(first.requested_count) !== input.generations.length
        || Number(first.verified_count) !== input.generations.length) {
        throw denseError('FILING_DENSE_RETRIEVAL_SCOPE_FAILURE');
      }
      if (first.document_id == null) {
        if (result.rows.length !== 1) {
          throw denseError('FILING_DENSE_RETRIEVAL_INTEGRITY_FAILURE');
        }
        return [];
      }
      const requested = new Map(input.generations.map(value => [value.documentId, value]));
      return result.rows.map((row, index) => {
        const documentId = row.document_id;
        const generation = documentId == null ? undefined : requested.get(documentId);
        const distance = Number(row.cosine_distance);
        if (documentId == null || !generation || row.generation_id !== generation.generationId
          || row.generation_fingerprint !== generation.generationFingerprint
          || row.corp_code !== input.corpCode || row.symbol !== input.symbol
          || row.dense_profile_id !== profile.profileId || row.chunk_row_id == null
          || row.chunk_id == null || row.provider == null || row.receipt_number == null
          || row.ordinal == null || !Number.isInteger(row.ordinal)
          || row.source_text == null || row.retrieval_text == null
          || row.content_hash == null || !HASH.test(row.content_hash)
          || row.parser_version == null || row.chunker_version == null
          || row.section_path == null || !Array.isArray(row.section_path)) {
          throw denseError('FILING_DENSE_RETRIEVAL_INTEGRITY_FAILURE');
        }
        return {
          documentId,
          chunkRowId: row.chunk_row_id,
          chunkId: row.chunk_id,
          generationId: row.generation_id,
          generationFingerprint: row.generation_fingerprint,
          provider: row.provider,
          receiptNumber: row.receipt_number,
          corpCode: row.corp_code,
          symbol: row.symbol,
          ...(row.report_name == null ? {} : { reportName: row.report_name }),
          ...(dateOnly(row.filing_date) == null ? {} : { filingDate: dateOnly(row.filing_date) }),
          ...(row.section_id == null ? {} : { sectionId: row.section_id }),
          sectionPath: row.section_path,
          ordinal: row.ordinal,
          sourceText: row.source_text,
          retrievalText: row.retrieval_text,
          locator: checkedLocator(row.locator),
          contentHash: row.content_hash,
          parserVersion: row.parser_version,
          chunkerVersion: row.chunker_version,
          denseProfileId: row.dense_profile_id,
          denseRank: index + 1,
          denseSimilarity: denseSimilarityFromCosineDistance(distance),
        };
      });
    } catch (value) {
      throw mapDatabaseError(value);
    }
  }
}
