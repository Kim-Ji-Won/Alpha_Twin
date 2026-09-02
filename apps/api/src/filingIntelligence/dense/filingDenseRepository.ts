import { Pool, PoolClient } from 'pg';

import { withTransaction } from '../../infrastructure/database/transaction.js';
import { DenseChunkInput, DenseGeneration, DenseVectorInput } from './contracts.js';
import { FilingDenseError } from './errors.js';
import { canonicalizeDenseVector, denseGenerationFingerprint, denseInputFingerprint,
  denseInputManifestFingerprint, denseVectorFingerprint } from './fingerprints.js';
import { FILING_DENSE_DIMENSION, getFilingDenseProfile } from './profile.js';

const ID = /^[1-9]\d{0,18}$/; const HASH = /^[0-9a-f]{64}$/;
const error = (code: FilingDenseError['code']) => new FilingDenseError(code, false);
function pgCode(value: unknown): string | undefined { return typeof value === 'object' && value !== null
  && 'code' in value && typeof value.code === 'string' ? value.code : undefined; }
function mapped(value: unknown): FilingDenseError { if (value instanceof FilingDenseError) return value;
  const code = pgCode(value); if (['23503', '23514', '22P02'].includes(code ?? '')) return error('FILING_DENSE_INTEGRITY_FAILURE');
  if (code === '23505') return error('FILING_DENSE_GENERATION_CONFLICT');
  return new FilingDenseError('FILING_DENSE_TRANSACTION_FAILED', code?.startsWith('08') ?? false, { cause: value }); }
function canonicalVector(values: readonly number[]): { readonly text: string; readonly fingerprint: string } {
  if (values.length !== FILING_DENSE_DIMENSION || values.some(value => !Number.isFinite(value))) {
    throw error('FILING_DENSE_VECTOR_INVALID');
  }
  const canonical = canonicalizeDenseVector(values);
  if (!canonical.some(value => value !== 0)) throw error('FILING_DENSE_VECTOR_INVALID');
  return { text: `[${canonical.join(',')}]`, fingerprint: denseVectorFingerprint(canonical) };
}

interface GenerationRow { id: string; document_id: string; dense_profile_id: string; dense_profile_fingerprint: string;
  representation_fingerprint: string; input_manifest_fingerprint: string; dimension: number; status: string;
  expected_vector_count: number; persisted_vector_count: number; generation_fingerprint: string | null; }
function generation(row: GenerationRow): DenseGeneration { return { generationId: row.id, documentId: row.document_id,
  denseProfileId: row.dense_profile_id, status: row.status as DenseGeneration['status'],
  expectedVectorCount: row.expected_vector_count, persistedVectorCount: row.persisted_vector_count,
  inputManifestFingerprint: row.input_manifest_fingerprint,
  ...(row.generation_fingerprint ? { generationFingerprint: row.generation_fingerprint } : {}) }; }

export class FilingDenseRepository {
  constructor(private readonly pool: Pool) {}

  async createGeneration(documentId: string, profileId: string): Promise<{ generation: DenseGeneration; chunks: readonly DenseChunkInput[] }> {
    if (!ID.test(documentId)) throw error('FILING_DENSE_INVALID_INPUT');
    const profile = getFilingDenseProfile(profileId); if (!profile) throw error('FILING_DENSE_PROFILE_UNKNOWN');
    try { return await withTransaction(this.pool, async client => {
      const document = await client.query<{ representation_fingerprint: string; chunk_count: number; chunker_version: string }>(
        `SELECT m.representation_fingerprint, d.chunk_count, d.chunker_version
         FROM filing_intelligence.filing_document d
         JOIN filing_intelligence.filing_document_representation_manifest m ON m.document_id=d.id
         JOIN filing_intelligence.filing_receipt r ON r.id=d.receipt_id
         WHERE d.id=$1 AND r.lineage_status <> 'quarantined' FOR SHARE OF d, m`, [documentId]);
      const doc = document.rows[0]; if (!doc || !HASH.test(doc.representation_fingerprint)) throw error('FILING_DENSE_REPRESENTATION_INVALID');
      const rows = await client.query<{ id: string; chunk_id: string; ordinal: number; content_hash: string; retrieval_text: string }>(
        `SELECT id::text, chunk_id, ordinal, content_hash, retrieval_text FROM filing_intelligence.filing_chunk
         WHERE document_id=$1 AND chunker_version=$2 ORDER BY ordinal, chunk_id`, [documentId, doc.chunker_version]);
      if (rows.rows.length !== doc.chunk_count) throw error('FILING_DENSE_REPRESENTATION_INVALID');
      const chunks = rows.rows.map(row => { const source = { chunkId: row.chunk_id,
        contentHash: row.content_hash, retrievalText: row.retrieval_text }; return {
        chunkRowId: row.id, ordinal: row.ordinal, ...source,
        inputFingerprint: denseInputFingerprint(profile, doc.representation_fingerprint, source),
      }; });
      const manifest = denseInputManifestFingerprint(profile, chunks);
      const inserted = await client.query<GenerationRow>(`INSERT INTO filing_intelligence.filing_dense_generation
        (document_id,dense_profile_id,dense_profile_fingerprint,representation_fingerprint,input_manifest_fingerprint,
         dimension,status,expected_vector_count) VALUES($1,$2,$3,$4,$5,$6,'building',$7)
        ON CONFLICT (document_id,dense_profile_id) DO NOTHING RETURNING *`,
      [documentId, profile.profileId, profile.profileFingerprint, doc.representation_fingerprint, manifest, profile.dimensions, chunks.length]);
      const existing = inserted.rows[0] ?? (await client.query<GenerationRow>(
        'SELECT * FROM filing_intelligence.filing_dense_generation WHERE document_id=$1 AND dense_profile_id=$2 FOR UPDATE',
        [documentId, profile.profileId])).rows[0];
      if (!existing || existing.dense_profile_fingerprint !== profile.profileFingerprint
        || existing.representation_fingerprint !== doc.representation_fingerprint
        || existing.input_manifest_fingerprint !== manifest || existing.expected_vector_count !== chunks.length) {
        throw error('FILING_DENSE_PROFILE_DRIFT');
      }
      return { generation: generation(existing), chunks };
    }); } catch (value) { throw mapped(value); }
  }

  async persistVectorBatch(generationId: string, vectors: readonly DenseVectorInput[]): Promise<DenseGeneration> {
    try { return await withTransaction(this.pool, async client =>
      this.persistVectorBatchInTransaction(client, generationId, vectors));
    } catch (value) { throw mapped(value); }
  }

  async persistVectorBatchInTransaction(
    client: PoolClient,
    generationId: string,
    vectors: readonly DenseVectorInput[],
  ): Promise<DenseGeneration> {
    if (!ID.test(generationId) || vectors.length === 0 || new Set(vectors.map(v => v.chunkRowId)).size !== vectors.length) throw error('FILING_DENSE_INVALID_INPUT');
      const current = await this.lockGeneration(client, generationId); if (current.status !== 'building') throw error('FILING_DENSE_GENERATION_CONFLICT');
      const profile = getFilingDenseProfile(current.dense_profile_id)!;
      if (vectors.length > profile.maximumInputsPerBatch) throw error('FILING_DENSE_INVALID_INPUT');
      if (vectors.some(value => !ID.test(value.chunkRowId) || !HASH.test(value.inputFingerprint))) {
        throw error('FILING_DENSE_VECTOR_INVALID');
      }
      const source = await client.query<{ id: string; chunk_id: string; content_hash: string; retrieval_text: string }>(
        `SELECT id::text,chunk_id,content_hash,retrieval_text
         FROM filing_intelligence.filing_chunk WHERE document_id=$1 AND id=ANY($2::bigint[])`,
        [current.document_id, vectors.map(value => value.chunkRowId)]);
      const chunks = new Map(source.rows.map(row => [row.id, row]));
      const prepared = vectors.map(value => {
        const chunk = chunks.get(value.chunkRowId);
        if (!chunk || chunk.chunk_id !== value.chunkId || denseInputFingerprint(profile,
          current.representation_fingerprint, { chunkId: chunk.chunk_id, contentHash: chunk.content_hash,
            retrievalText: chunk.retrieval_text }) !== value.inputFingerprint) throw error('FILING_DENSE_VECTOR_INVALID');
        return { ...value, ...canonicalVector(value.vector) };
      });
      const parameters = [generationId, current.document_id, prepared.map(value => value.chunkRowId),
        prepared.map(value => value.chunkId), prepared.map(value => value.inputFingerprint),
        prepared.map(value => value.fingerprint), prepared.map(value => value.text)];
      await client.query(`WITH input AS (
          SELECT * FROM unnest($3::bigint[],$4::text[],$5::text[],$6::text[],$7::text[])
            AS value(chunk_row_id,chunk_id,input_fingerprint,vector_fingerprint,embedding_text)
        ) INSERT INTO filing_intelligence.filing_chunk_embedding
          (generation_id,document_id,chunk_row_id,chunk_id,input_fingerprint,vector_fingerprint,embedding)
        SELECT $1,$2,c.id,c.chunk_id,input.input_fingerprint,input.vector_fingerprint,input.embedding_text::vector
        FROM input JOIN filing_intelligence.filing_chunk c
          ON c.id=input.chunk_row_id AND c.document_id=$2 AND c.chunk_id=input.chunk_id
        ON CONFLICT DO NOTHING`, parameters);
      const found = await client.query<{ chunk_row_id: string; input_fingerprint: string;
        vector_fingerprint: string; vector_matches: boolean }>(`WITH input AS (
          SELECT * FROM unnest($3::bigint[],$4::text[],$5::text[],$6::text[],$7::text[])
            AS value(chunk_row_id,chunk_id,input_fingerprint,vector_fingerprint,embedding_text)
        ) SELECT e.chunk_row_id::text,e.input_fingerprint,e.vector_fingerprint,
          e.embedding=input.embedding_text::vector AS vector_matches
        FROM input JOIN filing_intelligence.filing_chunk_embedding e
          ON e.generation_id=$1 AND e.document_id=$2 AND e.chunk_row_id=input.chunk_row_id`, parameters);
      const expectedByChunk = new Map(prepared.map(value => [value.chunkRowId, value]));
      if (found.rows.length !== prepared.length || found.rows.some(row => {
        const expected = expectedByChunk.get(row.chunk_row_id);
        return !expected || row.input_fingerprint !== expected.inputFingerprint
          || row.vector_fingerprint !== expected.fingerprint || !row.vector_matches;
      })) throw error('FILING_DENSE_VECTOR_CONFLICT');
      const count = await client.query<{ count: number }>('SELECT count(*)::integer count FROM filing_intelligence.filing_chunk_embedding WHERE generation_id=$1',[generationId]);
      await client.query(`UPDATE filing_intelligence.filing_dense_generation
        SET persisted_vector_count=$2,updated_at=clock_timestamp()
        WHERE id=$1 AND persisted_vector_count<>$2`, [generationId,count.rows[0]!.count]);
      return generation({ ...current, persisted_vector_count: count.rows[0]!.count });
  }

  async finalizeGeneration(generationId: string): Promise<DenseGeneration> {
    try { return await withTransaction(this.pool, async client =>
      this.finalizeGenerationInTransaction(client, generationId));
    } catch(value){ throw mapped(value); }
  }

  async finalizeGenerationInTransaction(client: PoolClient, generationId: string): Promise<DenseGeneration> {
      const current = await this.lockGeneration(client,generationId);
      if (current.status === 'ready') return generation(current); if (current.status !== 'building') throw error('FILING_DENSE_GENERATION_CONFLICT');
      const rows = await client.query<{ chunk_id:string; input_fingerprint:string; vector_fingerprint:string }>(
        `SELECT e.chunk_id,e.input_fingerprint,e.vector_fingerprint FROM filing_intelligence.filing_chunk_embedding e
         JOIN filing_intelligence.filing_chunk c ON c.id=e.chunk_row_id AND c.document_id=e.document_id
         WHERE e.generation_id=$1 ORDER BY c.ordinal,c.chunk_id`,[generationId]);
      if (rows.rows.length !== current.expected_vector_count) throw error('FILING_DENSE_GENERATION_INCOMPLETE');
      const fingerprint = denseGenerationFingerprint({ profileFingerprint: current.dense_profile_fingerprint,
        representationFingerprint: current.representation_fingerprint, inputManifestFingerprint: current.input_manifest_fingerprint,
        dimension: current.dimension, vectors: rows.rows.map(row => ({ chunkId: row.chunk_id,
          inputFingerprint: row.input_fingerprint, vectorFingerprint: row.vector_fingerprint })) });
      const result = await client.query<GenerationRow>(`WITH database_now AS (SELECT clock_timestamp() AS value)
        UPDATE filing_intelligence.filing_dense_generation SET status='ready',persisted_vector_count=$2,
          generation_fingerprint=$3,ready_at=database_now.value,updated_at=database_now.value
        FROM database_now WHERE id=$1 RETURNING filing_dense_generation.*`,
      [generationId,rows.rows.length,fingerprint]); return generation(result.rows[0]!);
  }

  async failGenerationInTransaction(
    client: PoolClient,
    generationId: string,
    failureCode: string,
  ): Promise<void> {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(failureCode)) throw error('FILING_DENSE_INVALID_INPUT');
    const current = await this.lockGeneration(client, generationId);
    if (current.status === 'ready') throw error('FILING_DENSE_GENERATION_CONFLICT');
    if (current.status === 'failed') return;
    await client.query(
      `UPDATE filing_intelligence.filing_dense_generation
       SET status='failed',failure_code=$2,updated_at=clock_timestamp()
       WHERE id=$1 AND status='building'`,
      [generationId, failureCode],
    );
  }

  private async lockGeneration(client: PoolClient,id:string):Promise<GenerationRow>{ if(!ID.test(id)) throw error('FILING_DENSE_INVALID_INPUT');
    const result=await client.query<GenerationRow>('SELECT * FROM filing_intelligence.filing_dense_generation WHERE id=$1 FOR UPDATE',[id]);
    if(!result.rows[0]) throw error('FILING_DENSE_INVALID_INPUT'); const profile=getFilingDenseProfile(result.rows[0].dense_profile_id);
    if(!profile || profile.profileFingerprint!==result.rows[0].dense_profile_fingerprint) throw error('FILING_DENSE_PROFILE_DRIFT'); return result.rows[0]; }
}
