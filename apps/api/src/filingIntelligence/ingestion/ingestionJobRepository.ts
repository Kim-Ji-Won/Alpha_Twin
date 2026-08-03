import { randomUUID } from 'node:crypto';

import { Pool, PoolClient } from 'pg';

import { DatabaseError } from '../../infrastructure/database/errors.js';
import { withTransaction } from '../../infrastructure/database/transaction.js';
import {
  ClaimedIngestionJob,
  EnqueueResult,
  IngestionAttemptMetrics,
  INGESTION_ATTEMPT_OUTCOMES,
  INGESTION_ATTEMPT_STAGES,
  INGESTION_JOB_STAGES,
  INGESTION_JOB_STATUSES,
  IngestionAttemptOutcome,
  IngestionAttemptStage,
  IngestionJobSnapshot,
  IngestionJobStage,
  IngestionJobStatus,
  LeaseMutationResult,
  SafeIngestionFailure,
  VerifiedIngestionJobInput,
} from './contracts.js';
import { retryDelayMs } from './retryPolicy.js';
import { IngestionError } from './errors.js';
import { validateVerifiedIngestionJob } from './validation.js';

interface JobRow {
  id: string;
  provider: string;
  receipt_number: string;
  corp_code: string;
  symbol: string;
  company_name: string | null;
  report_name: string | null;
  report_code: string | null;
  filing_date: Date | string | null;
  canonical_schema_name: string;
  canonical_schema_version: string;
  parser_version: string;
  chunk_schema_version: string;
  chunker_version: string;
  priority: number;
  status: string;
  stage: string;
  attempt_count: number;
  max_attempts: number;
  available_at: Date;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: Date | null;
  persisted_document_id: string | null;
  last_error_code: string | null;
}

export interface AttemptSnapshot {
  readonly attemptNumber: number;
  readonly outcome: IngestionAttemptOutcome;
  readonly lastStage: IngestionAttemptStage;
  readonly errorCode?: string;
  readonly endedAt?: Date;
}

export interface ClaimNextJobInput {
  readonly workerId: string;
  readonly now: Date;
  readonly leaseMs: number;
}

export interface ReclaimExpiredInput {
  readonly now: Date;
  readonly limit: number;
}

function dateOnly(value: Date | string | null): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function databaseError(error: unknown): DatabaseError {
  const code = typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' ? error.code : undefined;
  const retryable = code == null || code.startsWith('08') || code === '40001' || code === '40P01';
  return new DatabaseError('DATABASE_UNAVAILABLE', retryable, { cause: error });
}

function checkedStatus(value: string): IngestionJobStatus {
  const matched = INGESTION_JOB_STATUSES.find(status => status === value);
  if (!matched) throw new DatabaseError('DATABASE_SCHEMA_INCOMPATIBLE', false);
  return matched;
}

function checkedStage(value: string): IngestionJobStage {
  const matched = INGESTION_JOB_STAGES.find(stage => stage === value);
  if (!matched) throw new DatabaseError('DATABASE_SCHEMA_INCOMPATIBLE', false);
  return matched;
}

function checkedAttemptOutcome(value: string): IngestionAttemptOutcome {
  const matched = INGESTION_ATTEMPT_OUTCOMES.find(outcome => outcome === value);
  if (!matched) throw new DatabaseError('DATABASE_SCHEMA_INCOMPATIBLE', false);
  return matched;
}

function checkedAttemptStage(value: string): IngestionAttemptStage {
  const matched = INGESTION_ATTEMPT_STAGES.find(stage => stage === value);
  if (!matched) throw new DatabaseError('DATABASE_SCHEMA_INCOMPATIBLE', false);
  return matched;
}

function validDuration(value: number, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new DatabaseError('DATABASE_SCHEMA_INCOMPATIBLE', false);
  }
}

function claimed(row: JobRow, workerId: string, leaseToken: string, expiresAt: Date): ClaimedIngestionJob {
  if (row.provider !== 'opendart-fss') throw new DatabaseError('DATABASE_SCHEMA_INCOMPATIBLE', false);
  return {
    id: row.id,
    provider: 'opendart-fss',
    receiptNumber: row.receipt_number,
    corpCode: row.corp_code,
    symbol: row.symbol,
    companyName: row.company_name ?? undefined,
    reportName: row.report_name ?? undefined,
    reportCode: row.report_code ?? undefined,
    filingDate: dateOnly(row.filing_date),
    canonicalSchemaName: row.canonical_schema_name,
    canonicalSchemaVersion: row.canonical_schema_version,
    parserVersion: row.parser_version,
    chunkSchemaVersion: row.chunk_schema_version,
    chunkerVersion: row.chunker_version,
    priority: row.priority,
    attemptNumber: row.attempt_count,
    maxAttempts: row.max_attempts,
    workerId,
    leaseToken,
    leaseExpiresAt: expiresAt,
  };
}

function metricValues(metrics: IngestionAttemptMetrics): readonly (number | null)[] {
  return [
    metrics.sourceEntryBytes ?? null,
    metrics.sectionCount ?? null,
    metrics.blockCount ?? null,
    metrics.chunkCount ?? null,
    metrics.acquisitionMs ?? null,
    metrics.parseMs ?? null,
    metrics.chunkMs ?? null,
    metrics.persistenceMs ?? null,
    metrics.totalMs ?? null,
  ];
}

export class IngestionJobRepository {
  constructor(
    private readonly pool: Pool,
    private readonly tokenFactory: () => string = randomUUID,
    private readonly random: () => number = Math.random,
  ) {}

  async enqueueVerifiedJob(input: VerifiedIngestionJobInput, _applicationNow = new Date()): Promise<EnqueueResult> {
    const value = validateVerifiedIngestionJob(input);
    try {
      return await withTransaction(this.pool, async client => {
        const inserted = await client.query<{ id: string; status: string }>(
          `INSERT INTO filing_intelligence.filing_ingestion_job (
             provider, receipt_number, corp_code, symbol, company_name, report_name,
             report_code, filing_date, canonical_schema_name, canonical_schema_version,
             parser_version, chunk_schema_version, chunker_version, priority,
             max_attempts, available_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14, $15, COALESCE($16, clock_timestamp())
           )
           ON CONFLICT ON CONSTRAINT filing_ingestion_job_identity_unique DO NOTHING
           RETURNING id::text, status`,
          [
            value.provider, value.receiptNumber, value.corpCode, value.symbol,
            value.companyName ?? null, value.reportName ?? null, value.reportCode ?? null,
            value.filingDate ?? null, value.canonicalSchemaName,
            value.canonicalSchemaVersion, value.parserVersion, value.chunkSchemaVersion,
            value.chunkerVersion, value.priority, value.maxAttempts,
            value.availableAt ?? null,
          ],
        );
        const created = inserted.rows[0];
        if (created) return { status: 'enqueued', jobId: created.id, jobStatus: checkedStatus(created.status) };
        const existing = await client.query<{
          id: string; status: string; corp_code: string; symbol: string;
        }>(
          `SELECT id::text, status, corp_code, symbol
           FROM filing_intelligence.filing_ingestion_job
           WHERE provider = $1 AND receipt_number = $2
             AND canonical_schema_name = $3 AND canonical_schema_version = $4
             AND parser_version = $5 AND chunk_schema_version = $6 AND chunker_version = $7
           FOR UPDATE`,
          [value.provider, value.receiptNumber, value.canonicalSchemaName,
            value.canonicalSchemaVersion, value.parserVersion,
            value.chunkSchemaVersion, value.chunkerVersion],
        );
        const row = existing.rows[0];
        if (!row) throw new DatabaseError('DATABASE_SCHEMA_INCOMPATIBLE', false);
        const jobStatus = checkedStatus(row.status);
        if (row.corp_code !== value.corpCode || row.symbol !== value.symbol) {
          throw new IngestionError('INGESTION_JOB_CONFLICT', false);
        }
        const status = jobStatus === 'succeeded'
          ? 'already_succeeded'
          : ['permanent_failed', 'quarantined', 'cancelled'].includes(jobStatus)
            ? 'terminal_failure_exists'
            : 'already_enqueued';
        return { status, jobId: row.id, jobStatus };
      });
    } catch (error) {
      if (error instanceof DatabaseError || error instanceof IngestionError) throw error;
      throw databaseError(error);
    }
  }

  async claimNextJob(input: ClaimNextJobInput): Promise<ClaimedIngestionJob | undefined> {
    validDuration(input.leaseMs, 1_000, 60 * 60_000);
    if (!input.workerId || input.workerId.length > 128) throw new DatabaseError('DATABASE_SCHEMA_INCOMPATIBLE', false);
    const leaseToken = this.tokenFactory();
    try {
      return await withTransaction(this.pool, async client => {
        const candidate = await client.query<JobRow>(
          `SELECT id::text, provider, receipt_number, corp_code, symbol,
                  company_name, report_name, report_code, filing_date,
                  canonical_schema_name, canonical_schema_version, parser_version,
                  chunk_schema_version, chunker_version, priority, status, stage,
                  attempt_count, max_attempts, available_at, lease_owner,
                  lease_token, lease_expires_at, persisted_document_id,
                  last_error_code
           FROM filing_intelligence.filing_ingestion_job
           WHERE status IN ('pending', 'retryable_failed')
             AND available_at <= clock_timestamp() AND attempt_count < max_attempts
           ORDER BY priority DESC, available_at ASC, created_at ASC, id ASC
           FOR UPDATE SKIP LOCKED LIMIT 1`,
        );
        const row = candidate.rows[0];
        if (!row) return undefined;
        const updated = await client.query<JobRow>(
          `UPDATE filing_intelligence.filing_ingestion_job
           SET status = 'leased', stage = 'acquiring', attempt_count = attempt_count + 1,
               lease_owner = $1, lease_token = $2,
               lease_expires_at = clock_timestamp() + ($3 * interval '1 millisecond'),
               heartbeat_at = clock_timestamp(), updated_at = clock_timestamp(),
               completed_at = NULL,
               last_error_code = NULL, last_error_category = NULL,
               last_error_retryable = NULL
           WHERE id = $4
           RETURNING id::text, provider, receipt_number, corp_code, symbol,
                     company_name, report_name, report_code, filing_date,
                     canonical_schema_name, canonical_schema_version, parser_version,
                     chunk_schema_version, chunker_version, priority, status, stage,
                     attempt_count, max_attempts, available_at, lease_owner,
                     lease_token, lease_expires_at, persisted_document_id,
                     last_error_code`,
          [input.workerId, leaseToken, input.leaseMs, row.id],
        );
        const job = updated.rows[0];
        if (!job) throw new DatabaseError('DATABASE_SCHEMA_INCOMPATIBLE', false);
        await client.query(
          `INSERT INTO filing_intelligence.filing_ingestion_attempt (
             job_id, attempt_number, worker_id, lease_token, started_at, last_stage
           ) VALUES ($1, $2, $3, $4, clock_timestamp(), 'acquiring')`,
          [job.id, job.attempt_count, input.workerId, leaseToken],
        );
        if (!job.lease_expires_at) throw new DatabaseError('DATABASE_SCHEMA_INCOMPATIBLE', false);
        return claimed(job, input.workerId, leaseToken, job.lease_expires_at);
      });
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw databaseError(error);
    }
  }

  async heartbeatLease(jobId: string, leaseToken: string, _applicationNow: Date, leaseMs: number): Promise<LeaseMutationResult> {
    validDuration(leaseMs, 1_000, 60 * 60_000);
    try {
      const result = await this.pool.query(
        `UPDATE filing_intelligence.filing_ingestion_job
         SET heartbeat_at = clock_timestamp(),
             lease_expires_at = clock_timestamp() + ($3 * interval '1 millisecond'),
             updated_at = clock_timestamp()
         WHERE id = $1 AND lease_token = $2 AND status = 'leased'
           AND lease_expires_at > clock_timestamp()`,
        [jobId, leaseToken, leaseMs],
      );
      return result.rowCount === 1 ? { status: 'updated' } : { status: 'lease_lost' };
    } catch (error) {
      throw databaseError(error);
    }
  }

  async updateStage(
    jobId: string,
    leaseToken: string,
    from: IngestionJobStage,
    to: IngestionJobStage,
    _applicationNow: Date,
  ): Promise<LeaseMutationResult> {
    const allowed = (from === 'acquiring' && to === 'parsing')
      || (from === 'parsing' && to === 'chunking')
      || (from === 'chunking' && to === 'persisting');
    if (!allowed) throw new IngestionError('INGESTION_INVALID_TRANSITION', false);
    try {
      return await withTransaction(this.pool, async client => {
        const result = await client.query(
          `UPDATE filing_intelligence.filing_ingestion_job
           SET stage = $3, updated_at = clock_timestamp()
           WHERE id = $1 AND lease_token = $2 AND status = 'leased'
             AND lease_expires_at > clock_timestamp() AND stage = $4`,
          [jobId, leaseToken, to, from],
        );
        if (result.rowCount !== 1) return { status: 'lease_lost' };
        await client.query(
          `UPDATE filing_intelligence.filing_ingestion_attempt
           SET last_stage = $3
           WHERE job_id = $1 AND lease_token = $2 AND outcome = 'running'`,
          [jobId, leaseToken, to],
        );
        return { status: 'updated' };
      });
    } catch (error) {
      throw databaseError(error);
    }
  }

  async completeJob(
    jobId: string,
    leaseToken: string,
    documentId: string,
    metrics: IngestionAttemptMetrics,
    _applicationNow: Date,
  ): Promise<LeaseMutationResult> {
    return this.finish(jobId, leaseToken, async client => {
      const job = await client.query(
        `UPDATE filing_intelligence.filing_ingestion_job
         SET status = 'succeeded', stage = 'completed', persisted_document_id = $3,
             completed_at = clock_timestamp(), updated_at = clock_timestamp(), lease_owner = NULL,
             lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL
         WHERE id = $1 AND lease_token = $2 AND status = 'leased'
           AND lease_expires_at > clock_timestamp() AND stage = 'persisting'`,
        [jobId, leaseToken, documentId],
      );
      if (job.rowCount !== 1) return false;
      await this.finishAttempt(client, jobId, leaseToken, 'succeeded', 'completed', undefined, metrics);
      return true;
    });
  }

  async failJob(
    jobId: string,
    leaseToken: string,
    failure: SafeIngestionFailure,
    metrics: IngestionAttemptMetrics,
    _applicationNow: Date,
  ): Promise<LeaseMutationResult> {
    return this.finish(jobId, leaseToken, async client => {
      const locked = await client.query<{ attempt_count: number; max_attempts: number }>(
        `SELECT attempt_count, max_attempts
         FROM filing_intelligence.filing_ingestion_job
         WHERE id = $1 AND lease_token = $2 AND status = 'leased'
           AND lease_expires_at > clock_timestamp() FOR UPDATE`,
        [jobId, leaseToken],
      );
      const row = locked.rows[0];
      if (!row) return false;
      const exhausted = failure.retryable && row.attempt_count >= row.max_attempts;
      const status: IngestionJobStatus = failure.category === 'quarantine'
        ? 'quarantined'
        : failure.retryable && !exhausted ? 'retryable_failed' : 'permanent_failed';
      const outcome = status === 'retryable_failed' ? 'retryable_failed'
        : status === 'quarantined' ? 'quarantined' : 'permanent_failed';
      const errorCode = exhausted ? 'INGESTION_RETRY_EXHAUSTED' : failure.code;
      const delayMs = status === 'retryable_failed'
        ? retryDelayMs(row.attempt_count, this.random, failure.retryAfterMs)
        : 0;
      await client.query(
        `UPDATE filing_intelligence.filing_ingestion_job
         SET status = $3, stage = 'failed',
             available_at = clock_timestamp() + ($4 * interval '1 millisecond'),
             last_error_code = $5, last_error_category = $6,
             last_error_retryable = $7,
             completed_at = CASE WHEN $3 = 'retryable_failed' THEN NULL ELSE clock_timestamp() END,
             updated_at = clock_timestamp(),
             lease_owner = NULL, lease_token = NULL,
             lease_expires_at = NULL, heartbeat_at = NULL
         WHERE id = $1 AND lease_token = $2 AND status = 'leased'`,
        [jobId, leaseToken, status, delayMs, errorCode,
          failure.category, failure.retryable],
      );
      await this.finishAttempt(client, jobId, leaseToken, outcome, 'failed', {
        ...failure,
        code: errorCode,
      }, metrics);
      return true;
    });
  }

  async reclaimExpiredLeases(input: ReclaimExpiredInput): Promise<number> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new DatabaseError('DATABASE_SCHEMA_INCOMPATIBLE', false);
    }
    try {
      return await withTransaction(this.pool, async client => {
        const expired = await client.query<Pick<JobRow, 'id' | 'lease_token' | 'attempt_count' | 'max_attempts' | 'stage'>>(
          `SELECT id::text, lease_token, attempt_count, max_attempts, stage
           FROM filing_intelligence.filing_ingestion_job
           WHERE status = 'leased' AND lease_expires_at <= clock_timestamp()
           ORDER BY lease_expires_at ASC, id ASC
           FOR UPDATE SKIP LOCKED LIMIT $1`,
          [input.limit],
        );
        for (const row of expired.rows) {
          const lastStage = checkedAttemptStage(row.stage);
          const exhausted = row.attempt_count >= row.max_attempts;
          const status = exhausted ? 'permanent_failed' : 'retryable_failed';
          const errorCode = exhausted ? 'INGESTION_RETRY_EXHAUSTED' : 'INGESTION_LEASE_LOST';
          const delayMs = exhausted
            ? 0
            : retryDelayMs(row.attempt_count, this.random, undefined);
          await client.query(
            `UPDATE filing_intelligence.filing_ingestion_attempt
             SET outcome = 'lease_expired', ended_at = clock_timestamp(), last_stage = $3,
                 error_code = 'INGESTION_LEASE_LOST', error_category = 'retryable',
                 error_retryable = true
             WHERE job_id = $1 AND lease_token = $2 AND outcome = 'running'`,
            [row.id, row.lease_token, lastStage],
          );
          await client.query(
            `UPDATE filing_intelligence.filing_ingestion_job
             SET status = $2, stage = 'failed',
                 available_at = clock_timestamp() + ($3 * interval '1 millisecond'),
                 last_error_code = $4, last_error_category = 'retryable',
                 last_error_retryable = true,
                 completed_at = CASE WHEN $2 = 'permanent_failed' THEN clock_timestamp() ELSE NULL END,
                 updated_at = clock_timestamp(),
                 lease_owner = NULL, lease_token = NULL,
                 lease_expires_at = NULL, heartbeat_at = NULL
             WHERE id = $1 AND status = 'leased' AND lease_token = $5`,
            [row.id, status, delayMs, errorCode, row.lease_token],
          );
        }
        return expired.rowCount ?? 0;
      });
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw databaseError(error);
    }
  }

  async findJobById(jobId: string): Promise<IngestionJobSnapshot | undefined> {
    const result = await this.pool.query<JobRow>(
      `SELECT id::text, provider, receipt_number, corp_code, symbol,
              company_name, report_name, report_code, filing_date,
              canonical_schema_name, canonical_schema_version, parser_version,
              chunk_schema_version, chunker_version, priority, status, stage,
              attempt_count, max_attempts, available_at, lease_owner,
              lease_token, lease_expires_at, persisted_document_id,
              last_error_code
       FROM filing_intelligence.filing_ingestion_job WHERE id = $1`,
      [jobId],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      status: checkedStatus(row.status),
      stage: checkedStage(row.stage),
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      availableAt: row.available_at,
      leaseToken: row.lease_token ?? undefined,
      persistedDocumentId: row.persisted_document_id ?? undefined,
      lastErrorCode: row.last_error_code ?? undefined,
    } : undefined;
  }

  async findAttempts(jobId: string): Promise<AttemptSnapshot[]> {
    const result = await this.pool.query<{
      attempt_number: number; outcome: string; last_stage: string;
      error_code: string | null; ended_at: Date | null;
    }>(
      `SELECT attempt_number, outcome, last_stage, error_code, ended_at
       FROM filing_intelligence.filing_ingestion_attempt
       WHERE job_id = $1 ORDER BY attempt_number`,
      [jobId],
    );
    return result.rows.map(row => ({
      attemptNumber: row.attempt_number,
      outcome: checkedAttemptOutcome(row.outcome),
      lastStage: checkedAttemptStage(row.last_stage),
      errorCode: row.error_code ?? undefined,
      endedAt: row.ended_at ?? undefined,
    }));
  }

  private async finish(
    jobId: string,
    leaseToken: string,
    operation: (client: PoolClient) => Promise<boolean>,
  ): Promise<LeaseMutationResult> {
    try {
      return await withTransaction(this.pool, async client =>
        await operation(client) ? { status: 'updated' } : { status: 'lease_lost' });
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw databaseError(error);
    }
  }

  private async finishAttempt(
    client: PoolClient,
    jobId: string,
    leaseToken: string,
    outcome: 'succeeded' | 'retryable_failed' | 'permanent_failed' | 'quarantined',
    stage: 'completed' | 'failed',
    failure: SafeIngestionFailure | undefined,
    metrics: IngestionAttemptMetrics,
  ): Promise<void> {
    const values = metricValues(metrics);
    const result = await client.query(
      `UPDATE filing_intelligence.filing_ingestion_attempt
       SET outcome = $3, last_stage = $4, ended_at = clock_timestamp(),
           error_code = $5, error_category = $6, error_retryable = $7,
           source_entry_bytes = $8, section_count = $9, block_count = $10,
           chunk_count = $11, acquisition_ms = $12, parse_ms = $13,
           chunk_ms = $14, persistence_ms = $15, total_ms = $16
       WHERE job_id = $1 AND lease_token = $2 AND outcome = 'running'`,
      [jobId, leaseToken, outcome, stage, failure?.code ?? null,
        failure?.category ?? null, failure?.retryable ?? null, ...values],
    );
    if (result.rowCount !== 1) throw new DatabaseError('DATABASE_SCHEMA_INCOMPATIBLE', false);
  }
}
