import { performance } from 'node:perf_hooks';

import { createOpenAiEmbeddingTokenizer, DenseTokenizer, planDenseBatches } from './batchPlanner.js';
import {
  ClaimedDenseJob,
  DenseAttemptMetrics,
  DenseGenerationJobRepository,
} from './denseGenerationJobRepository.js';
import {
  classifyDenseFailure,
  DenseGenerationError,
  EmbeddingBatchResult,
  EmbeddingProvider,
  isCompatibleEmbeddingResponseModel,
} from './embeddingProvider.js';
import { getFilingDenseProfile } from './profile.js';
import { DenseWorkerConfig } from './denseWorkerConfig.js';

export interface DenseJobStore {
  reclaimExpired(limit: number): Promise<number>;
  claimNext(workerId: string, leaseMs: number): Promise<ClaimedDenseJob | undefined>;
  heartbeat(jobId: string, token: string, leaseMs: number): Promise<{ status: 'updated' | 'lease_lost' }>;
  prepare(job: ClaimedDenseJob): ReturnType<DenseGenerationJobRepository['prepare']>;
  persistBatch(job: ClaimedDenseJob, vectors: Parameters<DenseGenerationJobRepository['persistBatch']>[1]):
    ReturnType<DenseGenerationJobRepository['persistBatch']>;
  complete(job: ClaimedDenseJob, metrics: DenseAttemptMetrics): Promise<{ status: 'updated' | 'lease_lost' }>;
  fail(job: ClaimedDenseJob, failure: ReturnType<typeof classifyDenseFailure>, metrics: DenseAttemptMetrics):
    Promise<{ status: 'updated' | 'lease_lost' }>;
}

export interface DenseWorkerLogger {
  info(fields: Record<string, string | number | boolean>, message: string): void;
  error(fields: Record<string, string | number | boolean>, message: string): void;
}

export interface DenseWorkerDependencies {
  readonly jobs: DenseJobStore;
  readonly provider: EmbeddingProvider;
  readonly tokenizer?: DenseTokenizer;
  readonly monotonicNow?: () => number;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly logger?: DenseWorkerLogger;
}

export type DenseJobResult = { readonly status: 'succeeded' | 'failed' | 'lease_lost' | 'interrupted' };

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function emptyMetrics(): DenseAttemptMetrics {
  return { requestCount: 0, inputCount: 0, vectorCount: 0, tokenCount: 0, utf8Bytes: 0, durationMs: 0 };
}

function validateProviderResult(
  result: EmbeddingBatchResult,
  profile: NonNullable<ReturnType<typeof getFilingDenseProfile>>,
  inputIds: readonly string[],
): ReadonlyMap<string, readonly number[]> {
  if (result.provider !== profile.provider || !isCompatibleEmbeddingResponseModel(profile.modelId, result.model)
    || result.vectors.length !== inputIds.length
    || !Number.isInteger(result.tokenCount) || result.tokenCount < 0) {
    throw new DenseGenerationError('DENSE_PROVIDER_RESPONSE_INVALID', false);
  }
  const expected = new Set(inputIds);
  const vectors = new Map<string, readonly number[]>();
  for (const item of result.vectors) {
    if (!expected.has(item.inputId) || vectors.has(item.inputId)
      || item.vector.length !== profile.dimensions
      || item.vector.some(value => !Number.isFinite(value))
      || !item.vector.some(value => value !== 0)) {
      throw new DenseGenerationError('DENSE_PROVIDER_RESPONSE_INVALID', false);
    }
    vectors.set(item.inputId, item.vector);
  }
  return vectors;
}

export class DenseGenerationWorker {
  private readonly shutdown = new AbortController();
  private readonly active = new Set<AbortController>();
  private readonly tokenizer: DenseTokenizer;
  private readonly clock: () => number;
  private readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;

  constructor(private readonly config: DenseWorkerConfig, private readonly dependencies: DenseWorkerDependencies) {
    this.tokenizer = dependencies.tokenizer ?? createOpenAiEmbeddingTokenizer();
    this.clock = dependencies.monotonicNow ?? performance.now.bind(performance);
    this.wait = dependencies.sleep ?? wait;
  }

  requestShutdown(): void {
    const reason = new DenseGenerationError('DENSE_WORKER_SHUTTING_DOWN', false);
    this.shutdown.abort(reason);
    for (const controller of this.active) controller.abort(reason);
  }

  async run(): Promise<void> {
    await Promise.all(Array.from({ length: this.config.concurrency }, (_, index) => this.runLane(index)));
  }

  private async runLane(index: number): Promise<void> {
    let failures = 0;
    while (!this.shutdown.signal.aborted) {
      try {
        if (index === 0) await this.dependencies.jobs.reclaimExpired(this.config.reclaimBatchSize);
        const workerId = this.config.concurrency === 1
          ? this.config.workerId
          : `${this.config.workerId.slice(0, 125)}:${index}`;
        const job = await this.dependencies.jobs.claimNext(workerId, this.config.leaseMs);
        failures = 0;
        if (job) await this.processJob(job);
        else await this.wait(this.config.pollIntervalMs, this.shutdown.signal);
      } catch {
        if (this.shutdown.signal.aborted) return;
        failures += 1;
        this.dependencies.logger?.error({ code: 'DENSE_POLL_FAILED', lane: index }, 'Dense worker poll failed');
        await this.wait(Math.min(30_000, this.config.pollIntervalMs * 2 ** Math.min(4, failures)), this.shutdown.signal)
          .catch(() => undefined);
      }
    }
  }

  async processJob(job: ClaimedDenseJob): Promise<DenseJobResult> {
    const started = this.clock();
    const values = { ...emptyMetrics() };
    const controller = new AbortController();
    const heartbeatController = new AbortController();
    this.active.add(controller);
    let leaseLost = false;
    const shutdown = () => controller.abort(this.shutdown.signal.reason);
    if (this.shutdown.signal.aborted) shutdown();
    else this.shutdown.signal.addEventListener('abort', shutdown, { once: true });
    const heartbeat = (async () => {
      while (!heartbeatController.signal.aborted) {
        try {
          await this.wait(this.config.heartbeatMs, heartbeatController.signal);
          if (heartbeatController.signal.aborted) return;
          const result = await this.dependencies.jobs.heartbeat(job.id, job.leaseToken, this.config.leaseMs);
          if (result.status === 'lease_lost') {
            leaseLost = true;
            controller.abort(new DenseGenerationError('DENSE_GENERATION_CONFLICT', false));
            return;
          }
        } catch {
          if (!heartbeatController.signal.aborted) {
            leaseLost = true;
            controller.abort(new DenseGenerationError('DENSE_GENERATION_CONFLICT', false));
          }
          return;
        }
      }
    })();
    try {
      const prepared = await this.dependencies.jobs.prepare(job);
      if ('ready' in prepared) {
        values.durationMs = Math.max(0, Math.round(this.clock() - started));
        const completed = await this.dependencies.jobs.complete(job, values);
        return { status: completed.status === 'updated' ? 'succeeded' : 'lease_lost' };
      }
      const profile = getFilingDenseProfile(job.denseProfileId);
      if (!profile) throw new DenseGenerationError('DENSE_PROFILE_DRIFT', false);
      // Preflight the whole document before making the first potentially billable request.
      planDenseBatches(profile, prepared.chunks, this.tokenizer);
      const missingPlan = planDenseBatches(profile, prepared.missingChunks, this.tokenizer);
      for (const batch of missingPlan.batches) {
        if (controller.signal.aborted) throw controller.signal.reason;
        const response = await this.dependencies.provider.embedBatch(profile,
          batch.map(input => ({ inputId: input.chunkRowId, text: input.retrievalText })), controller.signal);
        const byId = validateProviderResult(response, profile, batch.map(input => input.chunkRowId));
        values.requestCount += 1;
        values.inputCount += batch.length;
        values.vectorCount += response.vectors.length;
        values.tokenCount += response.tokenCount;
        values.utf8Bytes += batch.reduce((sum, input) => sum + input.utf8Bytes, 0);
        const persisted = await this.dependencies.jobs.persistBatch(job, batch.map(input => {
          const vector = byId.get(input.chunkRowId);
          if (!vector) throw new DenseGenerationError('DENSE_PROVIDER_RESPONSE_INVALID', false);
          return { chunkRowId: input.chunkRowId, chunkId: input.chunkId,
            inputFingerprint: input.inputFingerprint, vector };
        }));
        if (persisted.status === 'lease_lost') return { status: 'lease_lost' };
      }
      values.durationMs = Math.max(0, Math.round(this.clock() - started));
      const completed = await this.dependencies.jobs.complete(job, values);
      if (completed.status === 'lease_lost') return { status: 'lease_lost' };
      this.dependencies.logger?.info({ jobId: job.id, generationId: job.generationId,
        profile: job.denseProfileId, attempt: job.attemptNumber, requests: values.requestCount,
        inputs: values.inputCount }, 'Dense generation completed');
      return { status: 'succeeded' };
    } catch (value) {
      values.durationMs = Math.max(0, Math.round(this.clock() - started));
      if (leaseLost) return { status: 'lease_lost' };
      if (this.shutdown.signal.aborted) return { status: 'interrupted' };
      const failure = classifyDenseFailure(value);
      const failed = await this.dependencies.jobs.fail(job, failure, values);
      if (failed.status === 'lease_lost') return { status: 'lease_lost' };
      this.dependencies.logger?.error({ jobId: job.id, generationId: job.generationId,
        profile: job.denseProfileId, attempt: job.attemptNumber, code: failure.code,
        retryable: failure.retryable }, 'Dense generation failed');
      return { status: 'failed' };
    } finally {
      heartbeatController.abort();
      await heartbeat;
      this.shutdown.signal.removeEventListener('abort', shutdown);
      this.active.delete(controller);
    }
  }
}
