import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { IngestionError } from './errors.js';

export interface FilingWorkerConfig {
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly leaseMs: number;
  readonly heartbeatMs: number;
  readonly shutdownGraceMs: number;
  readonly reclaimBatchSize: number;
}

function bounded(name: string, value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new IngestionError('INGESTION_WORKER_NOT_CONFIGURED', false, { cause: new Error(`${name} is invalid`) });
  }
  return parsed;
}

export function createWorkerId(): string {
  const host = hostname().replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 48) || 'host';
  return `${host}:${process.pid}:${randomUUID().slice(0, 12)}`;
}

export function loadFilingWorkerConfig(env: NodeJS.ProcessEnv = process.env): FilingWorkerConfig {
  const leaseMs = bounded('FILING_WORKER_LEASE_MS', env.FILING_WORKER_LEASE_MS, 300_000, 30_000, 3_600_000);
  const heartbeatMs = bounded('FILING_WORKER_HEARTBEAT_MS', env.FILING_WORKER_HEARTBEAT_MS, 30_000, 1_000, 600_000);
  if (heartbeatMs >= leaseMs) throw new IngestionError('INGESTION_WORKER_NOT_CONFIGURED', false);
  const configuredId = env.FILING_WORKER_ID?.trim();
  if (configuredId && !/^[A-Za-z0-9._:-]{1,128}$/.test(configuredId)) {
    throw new IngestionError('INGESTION_WORKER_NOT_CONFIGURED', false);
  }
  return {
    workerId: configuredId || createWorkerId(),
    pollIntervalMs: bounded('FILING_WORKER_POLL_INTERVAL_MS', env.FILING_WORKER_POLL_INTERVAL_MS, 2_000, 100, 60_000),
    leaseMs,
    heartbeatMs,
    shutdownGraceMs: bounded('FILING_WORKER_SHUTDOWN_GRACE_MS', env.FILING_WORKER_SHUTDOWN_GRACE_MS, 30_000, 1_000, 600_000),
    reclaimBatchSize: 20,
  };
}
