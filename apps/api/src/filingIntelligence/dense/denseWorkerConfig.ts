import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { DenseGenerationError } from './embeddingProvider.js';

export interface DenseWorkerConfig {
  readonly workerId: string;
  readonly concurrency: number;
  readonly pollIntervalMs: number;
  readonly leaseMs: number;
  readonly heartbeatMs: number;
  readonly shutdownGraceMs: number;
  readonly reclaimBatchSize: number;
}

function bounded(name: string, value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value == null || !value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new DenseGenerationError('DENSE_PROVIDER_NOT_CONFIGURED', false, undefined, undefined,
      { cause: new Error(`${name} is invalid`) });
  }
  return parsed;
}

export function createDenseWorkerId(): string {
  const host = hostname().replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 48) || 'host';
  return `${host}:${process.pid}:${randomUUID().slice(0, 12)}`;
}

export function loadDenseWorkerConfig(env: NodeJS.ProcessEnv = process.env): DenseWorkerConfig {
  const leaseMs = bounded('DENSE_WORKER_LEASE_MS', env.DENSE_WORKER_LEASE_MS, 300_000, 30_000, 3_600_000);
  const heartbeatMs = bounded('DENSE_WORKER_HEARTBEAT_MS', env.DENSE_WORKER_HEARTBEAT_MS, 30_000, 1_000, 600_000);
  if (heartbeatMs >= leaseMs) throw new DenseGenerationError('DENSE_PROVIDER_NOT_CONFIGURED', false);
  const configured = env.DENSE_WORKER_ID?.trim();
  if (configured && !/^[A-Za-z0-9._:-]{1,128}$/.test(configured)) {
    throw new DenseGenerationError('DENSE_PROVIDER_NOT_CONFIGURED', false);
  }
  return {
    workerId: configured || createDenseWorkerId(),
    concurrency: bounded('DENSE_WORKER_CONCURRENCY', env.DENSE_WORKER_CONCURRENCY, 1, 1, 4),
    pollIntervalMs: bounded('DENSE_WORKER_POLL_INTERVAL_MS', env.DENSE_WORKER_POLL_INTERVAL_MS, 2_000, 100, 60_000),
    leaseMs,
    heartbeatMs,
    shutdownGraceMs: bounded('DENSE_WORKER_SHUTDOWN_GRACE_MS', env.DENSE_WORKER_SHUTDOWN_GRACE_MS, 30_000, 1_000, 600_000),
    reclaimBatchSize: 20,
  };
}
