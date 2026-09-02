import { randomUUID } from 'node:crypto';

import { Pool, PoolClient } from 'pg';

import { withTransaction } from '../../infrastructure/database/transaction.js';
import { DenseChunkInput, DenseGeneration, DenseVectorInput } from './contracts.js';
import { denseInputFingerprint, denseInputManifestFingerprint, denseVectorFingerprint } from './fingerprints.js';
import { FilingDenseRepository } from './filingDenseRepository.js';
import { DenseGenerationError, SafeDenseFailure } from './embeddingProvider.js';
import { denseRetryDelayMs, exhaustedFailure } from './denseRetryPolicy.js';
import { getFilingDenseProfile } from './profile.js';

const ID = /^[1-9]\d{0,18}$/;
const HASH = /^[0-9a-f]{64}$/;

export interface DenseAttemptMetrics {
  readonly requestCount: number;
  readonly inputCount: number;
  readonly vectorCount: number;
  readonly tokenCount: number;
  readonly utf8Bytes: number;
  readonly durationMs: number;
}

export interface ClaimedDenseJob {
  readonly id: string;
  readonly generationId: string;
  readonly documentId: string;
  readonly denseProfileId: string;
  readonly attemptNumber: number;
  readonly maxAttempts: number;
  readonly workerId: string;
  readonly leaseToken: string;
}

export interface PreparedDenseJob {
  readonly generation: DenseGeneration;
  readonly chunks: readonly DenseChunkInput[];
  readonly missingChunks: readonly DenseChunkInput[];
}

export type DenseLeaseResult = { readonly status: 'updated' | 'lease_lost' };

interface JobRow {
  id: string; generation_id: string; document_id: string; dense_profile_id: string;
  attempt_count: number; max_attempts: number; lease_token: string | null;
}

interface GenerationRow {
  id: string; document_id: string; dense_profile_id: string; dense_profile_fingerprint: string;
  representation_fingerprint: string; input_manifest_fingerprint: string; dimension: number;
  status: 'building' | 'ready' | 'failed'; expected_vector_count: number;
  persisted_vector_count: number; generation_fingerprint: string | null;
  chunker_version: string; chunk_count: number;
}

function generation(row: GenerationRow): DenseGeneration {
  return {
    generationId: row.id, documentId: row.document_id, denseProfileId: row.dense_profile_id,
    status: row.status, expectedVectorCount: row.expected_vector_count,
    persistedVectorCount: row.persisted_vector_count,
    inputManifestFingerprint: row.input_manifest_fingerprint,
    ...(row.generation_fingerprint ? { generationFingerprint: row.generation_fingerprint } : {}),
  };
}

function dbFailure(value: unknown): never {
  if (value instanceof DenseGenerationError) throw value;
  const code = typeof value === 'object' && value !== null && 'code' in value
    && typeof value.code === 'string' ? value.code : undefined;
  const retryable = code == null || code.startsWith('08') || code === '40001' || code === '40P01';
  throw new DenseGenerationError(retryable ? 'DENSE_DATABASE_UNAVAILABLE' : 'DENSE_GENERATION_CONFLICT',
    retryable, undefined, undefined, { cause: value });
}

export class DenseGenerationJobRepository {
  private readonly dense: FilingDenseRepository;

  constructor(
    private readonly pool: Pool,
    private readonly tokenFactory: () => string = randomUUID,
    private readonly random: () => number = Math.random,
  ) {
    this.dense = new FilingDenseRepository(pool);
  }

  async enqueue(documentId: string, denseProfileId: string): Promise<{
    status: 'enqueued' | 'already_enqueued' | 'already_ready' | 'terminal_failure_exists';
    jobId: string;
    generationId: string;
  }> {
    if (!ID.test(documentId) || !getFilingDenseProfile(denseProfileId)) {
      throw new DenseGenerationError('DENSE_GENERATION_CONFLICT', false);
    }
    const created = await this.dense.createGeneration(documentId, denseProfileId);
    try {
      return await withTransaction(this.pool, async client => {
        const inserted = await client.query<{ id: string; status: string }>(
          `INSERT INTO filing_intelligence.filing_dense_generation_job
             (generation_id,document_id,dense_profile_id,status,completed_at)
           VALUES($1,$2,$3,$4,CASE WHEN $4='succeeded' THEN clock_timestamp() ELSE NULL END)
           ON CONFLICT ON CONSTRAINT filing_dense_generation_job_identity_unique DO NOTHING
           RETURNING id::text,status`,
          [created.generation.generationId, documentId, denseProfileId,
            created.generation.status === 'ready' ? 'succeeded' : 'queued'],
        );
        const row = inserted.rows[0] ?? (await client.query<{ id: string; status: string; generation_id: string }>(
          `SELECT id::text,status,generation_id::text FROM filing_intelligence.filing_dense_generation_job
           WHERE document_id=$1 AND dense_profile_id=$2 FOR UPDATE`,
          [documentId, denseProfileId],
        )).rows[0];
        if (!row) throw new DenseGenerationError('DENSE_GENERATION_CONFLICT', false);
        const generationId = 'generation_id' in row ? row.generation_id : created.generation.generationId;
        if (generationId !== created.generation.generationId) {
          throw new DenseGenerationError('DENSE_GENERATION_CONFLICT', false);
        }
        const status = row.status === 'succeeded' ? 'already_ready'
          : row.status === 'failed' ? 'terminal_failure_exists'
            : inserted.rows[0] ? 'enqueued' : 'already_enqueued';
        return { status, jobId: row.id, generationId };
      });
    } catch (value) { return dbFailure(value); }
  }

  async claimNext(workerId: string, leaseMs: number): Promise<ClaimedDenseJob | undefined> {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(workerId) || leaseMs < 1_000 || leaseMs > 3_600_000) {
      throw new DenseGenerationError('DENSE_GENERATION_CONFLICT', false);
    }
    const token = this.tokenFactory();
    try {
      return await withTransaction(this.pool, async client => {
        const candidate = await client.query<JobRow>(
          `SELECT id::text,generation_id::text,document_id::text,dense_profile_id,
                  attempt_count,max_attempts,lease_token
           FROM filing_intelligence.filing_dense_generation_job
           WHERE status IN ('queued','retry_wait') AND available_at<=clock_timestamp()
             AND attempt_count<max_attempts
           ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
        );
        const row = candidate.rows[0]; if (!row) return undefined;
        const updated = await client.query<JobRow>(
          `UPDATE filing_intelligence.filing_dense_generation_job
           SET status='running',attempt_count=attempt_count+1,lease_owner=$2,lease_token=$3,
             lease_expires_at=clock_timestamp()+($4*interval '1 millisecond'),
             heartbeat_at=clock_timestamp(),updated_at=clock_timestamp(),last_failure_code=NULL
           WHERE id=$1 RETURNING id::text,generation_id::text,document_id::text,dense_profile_id,
             attempt_count,max_attempts,lease_token`,
          [row.id, workerId, token, leaseMs],
        );
        const claimed = updated.rows[0]!;
        await client.query(
          `INSERT INTO filing_intelligence.filing_dense_generation_attempt
             (job_id,attempt_number,worker_id,lease_token)
           VALUES($1,$2,$3,$4)`, [claimed.id, claimed.attempt_count, workerId, token],
        );
        return { id: claimed.id, generationId: claimed.generation_id,
          documentId: claimed.document_id, denseProfileId: claimed.dense_profile_id,
          attemptNumber: claimed.attempt_count, maxAttempts: claimed.max_attempts,
          workerId, leaseToken: token };
      });
    } catch (value) { return dbFailure(value); }
  }

  async heartbeat(jobId: string, token: string, leaseMs: number): Promise<DenseLeaseResult> {
    const result = await this.pool.query(
      `UPDATE filing_intelligence.filing_dense_generation_job
       SET heartbeat_at=clock_timestamp(),
         lease_expires_at=clock_timestamp()+($3*interval '1 millisecond'),updated_at=clock_timestamp()
       WHERE id=$1 AND lease_token=$2 AND status='running'
         AND lease_expires_at>clock_timestamp()`, [jobId, token, leaseMs],
    );
    return result.rowCount === 1 ? { status: 'updated' } : { status: 'lease_lost' };
  }

  async prepare(job: ClaimedDenseJob): Promise<PreparedDenseJob | { readonly ready: true }> {
    try {
      return await withTransaction(this.pool, async client => {
        await this.lockLease(client, job);
        const current = await this.loadGeneration(client, job.generationId);
        if (current.status === 'ready') return { ready: true as const };
        if (current.status !== 'building') throw new DenseGenerationError('DENSE_GENERATION_CONFLICT', false);
        const profile = getFilingDenseProfile(job.denseProfileId);
        if (!profile || current.dense_profile_id !== job.denseProfileId
          || current.document_id !== job.documentId
          || current.dense_profile_fingerprint !== profile.profileFingerprint
          || current.dimension !== profile.dimensions) {
          throw new DenseGenerationError('DENSE_PROFILE_DRIFT', false);
        }
        const rows = await client.query<{ id: string; chunk_id: string; ordinal: number;
          content_hash: string; retrieval_text: string }>(
          `SELECT id::text,chunk_id,ordinal,content_hash,retrieval_text
           FROM filing_intelligence.filing_chunk
           WHERE document_id=$1 AND chunker_version=$2 ORDER BY ordinal,chunk_id`,
          [job.documentId, current.chunker_version],
        );
        const chunks = rows.rows.map(row => ({ chunkRowId: row.id, chunkId: row.chunk_id,
          ordinal: row.ordinal, contentHash: row.content_hash, retrievalText: row.retrieval_text,
          inputFingerprint: denseInputFingerprint(profile, current.representation_fingerprint,
            { chunkId: row.chunk_id, contentHash: row.content_hash, retrievalText: row.retrieval_text }) }));
        if (chunks.length !== current.chunk_count || chunks.length !== current.expected_vector_count
          || denseInputManifestFingerprint(profile, chunks) !== current.input_manifest_fingerprint) {
          throw new DenseGenerationError('DENSE_PROFILE_DRIFT', false);
        }
        const persisted = await client.query<{ chunk_row_id: string; input_fingerprint: string;
          vector_fingerprint: string; embedding: string }>(
          `SELECT chunk_row_id::text,input_fingerprint,vector_fingerprint,embedding::text
           FROM filing_intelligence.filing_chunk_embedding WHERE generation_id=$1`, [job.generationId],
        );
        const byId = new Map(chunks.map(chunk => [chunk.chunkRowId, chunk]));
        for (const row of persisted.rows) {
          const chunk = byId.get(row.chunk_row_id);
          let values: number[];
          try { values = JSON.parse(row.embedding) as number[]; } catch {
            throw new DenseGenerationError('DENSE_GENERATION_CONFLICT', false);
          }
          if (!chunk || row.input_fingerprint !== chunk.inputFingerprint
            || row.vector_fingerprint !== denseVectorFingerprint(values)) {
            throw new DenseGenerationError('DENSE_GENERATION_CONFLICT', false);
          }
        }
        const present = new Set(persisted.rows.map(row => row.chunk_row_id));
        return { generation: generation(current), chunks,
          missingChunks: chunks.filter(chunk => !present.has(chunk.chunkRowId)) };
      });
    } catch (value) { return dbFailure(value); }
  }

  async persistBatch(job: ClaimedDenseJob, vectors: readonly DenseVectorInput[]): Promise<DenseLeaseResult> {
    try {
      return await withTransaction(this.pool, async client => {
        if (!await this.hasLease(client, job)) return { status: 'lease_lost' as const };
        await this.dense.persistVectorBatchInTransaction(client, job.generationId, vectors);
        return { status: 'updated' as const };
      });
    } catch (value) { return dbFailure(value); }
  }

  async complete(job: ClaimedDenseJob, metrics: DenseAttemptMetrics): Promise<DenseLeaseResult> {
    try {
      return await withTransaction(this.pool, async client => {
        if (!await this.hasLease(client, job)) return { status: 'lease_lost' as const };
        const ready = await this.dense.finalizeGenerationInTransaction(client, job.generationId);
        if (ready.status !== 'ready') throw new DenseGenerationError('DENSE_GENERATION_CONFLICT', false);
        await client.query(
          `UPDATE filing_intelligence.filing_dense_generation_job
           SET status='succeeded',completed_at=clock_timestamp(),updated_at=clock_timestamp(),
             lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,heartbeat_at=NULL
           WHERE id=$1 AND lease_token=$2`, [job.id, job.leaseToken],
        );
        await this.finishAttempt(client, job, 'succeeded', undefined, metrics);
        return { status: 'updated' as const };
      });
    } catch (value) { return dbFailure(value); }
  }

  async completeReady(job: ClaimedDenseJob, metrics: DenseAttemptMetrics): Promise<DenseLeaseResult> {
    return this.complete(job, metrics);
  }

  async fail(job: ClaimedDenseJob, failure: SafeDenseFailure, metrics: DenseAttemptMetrics): Promise<DenseLeaseResult> {
    try {
      return await withTransaction(this.pool, async client => {
        if (!await this.hasLease(client, job)) return { status: 'lease_lost' as const };
        const terminal = !failure.retryable || job.attemptNumber >= job.maxAttempts;
        const finalFailure = terminal ? exhaustedFailure(failure) : failure;
        const delay = terminal ? 0 : denseRetryDelayMs(job.attemptNumber, this.random, failure.retryAfterMs);
        if (terminal) await this.dense.failGenerationInTransaction(client, job.generationId, finalFailure.code);
        await client.query(
          `UPDATE filing_intelligence.filing_dense_generation_job
           SET status=$3,available_at=clock_timestamp()+($4*interval '1 millisecond'),
             last_failure_code=$5,completed_at=CASE WHEN $3='failed' THEN clock_timestamp() ELSE NULL END,
             updated_at=clock_timestamp(),lease_owner=NULL,lease_token=NULL,
             lease_expires_at=NULL,heartbeat_at=NULL
           WHERE id=$1 AND lease_token=$2`,
          [job.id, job.leaseToken, terminal ? 'failed' : 'retry_wait', delay, finalFailure.code],
        );
        await this.finishAttempt(client, job, terminal ? 'permanent_failed' : 'retryable_failed', finalFailure, metrics);
        return { status: 'updated' as const };
      });
    } catch (value) { return dbFailure(value); }
  }

  async reclaimExpired(limit: number): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new DenseGenerationError('DENSE_GENERATION_CONFLICT', false);
    }
    try {
      return await withTransaction(this.pool, async client => {
        const rows = await client.query<JobRow>(
          `SELECT id::text,generation_id::text,document_id::text,dense_profile_id,
             attempt_count,max_attempts,lease_token
           FROM filing_intelligence.filing_dense_generation_job
           WHERE status='running' AND lease_expires_at<=clock_timestamp()
           ORDER BY lease_expires_at,id FOR UPDATE SKIP LOCKED LIMIT $1`, [limit],
        );
        for (const row of rows.rows) {
          const terminal = row.attempt_count >= row.max_attempts;
          const code = terminal ? 'DENSE_RETRY_EXHAUSTED' : 'DENSE_PROVIDER_TIMEOUT';
          if (terminal) await this.dense.failGenerationInTransaction(client, row.generation_id, code);
          const delay = terminal ? 0 : denseRetryDelayMs(row.attempt_count, this.random);
          await client.query(
            `UPDATE filing_intelligence.filing_dense_generation_attempt
             SET outcome='lease_expired',ended_at=clock_timestamp(),failure_code='DENSE_PROVIDER_TIMEOUT',
               failure_category='retryable'
             WHERE job_id=$1 AND lease_token=$2 AND outcome='running'`, [row.id, row.lease_token],
          );
          await client.query(
            `UPDATE filing_intelligence.filing_dense_generation_job
             SET status=$2,available_at=clock_timestamp()+($3*interval '1 millisecond'),
               last_failure_code=$4,completed_at=CASE WHEN $2='failed' THEN clock_timestamp() ELSE NULL END,
               updated_at=clock_timestamp(),lease_owner=NULL,lease_token=NULL,
               lease_expires_at=NULL,heartbeat_at=NULL WHERE id=$1`,
            [row.id, terminal ? 'failed' : 'retry_wait', delay, code],
          );
        }
        return rows.rows.length;
      });
    } catch (value) { return dbFailure(value); }
  }

  async queueDepth(): Promise<Readonly<Record<'queued' | 'running' | 'retry_wait' | 'failed', number>>> {
    try {
      const result = await this.pool.query<{ status: string; count: number }>(
        `SELECT status,count(*)::integer count
         FROM filing_intelligence.filing_dense_generation_job
         WHERE status IN ('queued','running','retry_wait','failed') GROUP BY status`,
      );
      const depth = { queued: 0, running: 0, retry_wait: 0, failed: 0 };
      for (const row of result.rows) {
        if (row.status in depth) depth[row.status as keyof typeof depth] = row.count;
      }
      return depth;
    } catch (value) { return dbFailure(value); }
  }

  private async hasLease(client: PoolClient, job: ClaimedDenseJob): Promise<boolean> {
    const result = await client.query(
      `SELECT 1 FROM filing_intelligence.filing_dense_generation_job
       WHERE id=$1 AND generation_id=$2 AND document_id=$3 AND dense_profile_id=$4
         AND status='running' AND lease_token=$5 AND lease_expires_at>clock_timestamp()
       FOR UPDATE`, [job.id, job.generationId, job.documentId, job.denseProfileId, job.leaseToken],
    );
    return result.rowCount === 1;
  }

  private async lockLease(client: PoolClient, job: ClaimedDenseJob): Promise<void> {
    if (!await this.hasLease(client, job)) throw new DenseGenerationError('DENSE_GENERATION_CONFLICT', false);
  }

  private async loadGeneration(client: PoolClient, generationId: string): Promise<GenerationRow> {
    const result = await client.query<GenerationRow>(
      `SELECT g.id::text,g.document_id::text,g.dense_profile_id,g.dense_profile_fingerprint,
         g.representation_fingerprint,g.input_manifest_fingerprint,g.dimension,g.status,
         g.expected_vector_count,g.persisted_vector_count,g.generation_fingerprint,
         d.chunker_version,d.chunk_count
       FROM filing_intelligence.filing_dense_generation g
       JOIN filing_intelligence.filing_document d ON d.id=g.document_id
       JOIN filing_intelligence.filing_document_representation_manifest m
         ON m.document_id=g.document_id AND m.representation_fingerprint=g.representation_fingerprint
       WHERE g.id=$1 FOR SHARE OF g,d,m`, [generationId],
    );
    if (!result.rows[0] || !HASH.test(result.rows[0].input_manifest_fingerprint)) {
      throw new DenseGenerationError('DENSE_GENERATION_CONFLICT', false);
    }
    return result.rows[0];
  }

  private async finishAttempt(
    client: PoolClient,
    job: ClaimedDenseJob,
    outcome: 'succeeded' | 'retryable_failed' | 'permanent_failed',
    failure: SafeDenseFailure | undefined,
    metrics: DenseAttemptMetrics,
  ): Promise<void> {
    const result = await client.query(
      `UPDATE filing_intelligence.filing_dense_generation_attempt
       SET outcome=$3,ended_at=clock_timestamp(),failure_code=$4,failure_category=$5,
         provider_status_class=$6,request_count=$7,input_count=$8,vector_count=$9,
         token_count=$10,utf8_bytes=$11,duration_ms=$12
       WHERE job_id=$1 AND lease_token=$2 AND outcome='running'`,
      [job.id, job.leaseToken, outcome, failure?.code ?? null, failure?.category ?? null,
        failure?.providerStatusClass ?? null, metrics.requestCount, metrics.inputCount,
        metrics.vectorCount, metrics.tokenCount, metrics.utf8Bytes, metrics.durationMs],
    );
    if (result.rowCount !== 1) throw new DenseGenerationError('DENSE_GENERATION_CONFLICT', false);
  }
}
