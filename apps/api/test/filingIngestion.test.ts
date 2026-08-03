import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { DatabaseError } from '../src/infrastructure/database/errors.js';
import {
  CANONICAL_FILING_SCHEMA_NAME, CANONICAL_FILING_SCHEMA_VERSION,
  FILING_CHUNKER_VERSION, FILING_CHUNK_SCHEMA_VERSION, FILING_XML_PARSER_VERSION,
} from '../src/openDart/document/canonicalFilingContracts.js';
import { ValidatedDisclosureDocumentArchive } from '../src/openDart/document/documentContracts.js';
import { OpenDartError } from '../src/openDart/errors.js';
import { FilingPersistenceError } from '../src/filingIntelligence/persistence/errors.js';
import { ClaimedIngestionJob, LeaseMutationResult, SafeIngestionFailure } from '../src/filingIntelligence/ingestion/contracts.js';
import { FilingIngestionWorker, IngestionJobStore } from '../src/filingIntelligence/ingestion/filingIngestionWorker.js';
import { classifyIngestionFailure, retryDelayMs } from '../src/filingIntelligence/ingestion/retryPolicy.js';
import { validateVerifiedIngestionJob } from '../src/filingIntelligence/ingestion/validation.js';
import { loadFilingWorkerConfig } from '../src/filingIntelligence/ingestion/workerConfig.js';

const RECEIPT = '20990101000001';
const NOW = new Date('2099-01-02T00:00:00.000Z');
const TOKEN = '00000000-0000-4000-8000-000000000001';

function sha(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function archive(receipt = RECEIPT): ValidatedDisclosureDocumentArchive {
  const content = Buffer.from('<?xml version="1.0" encoding="utf-8"?><DOCUMENT><DOCUMENT-NAME>TEST</DOCUMENT-NAME><BODY><SECTION-1><TITLE>사업 정보</TITLE><P>합성 검증 문단입니다.</P></SECTION-1></BODY></DOCUMENT>');
  const hash = sha(content);
  return {
    provider: 'opendart-fss', receiptNumber: receipt, archiveByteLength: content.length,
    archiveSha256: hash, archiveEntryCount: 1, declaredTotalUncompressedBytes: content.length,
    extractedTotalUncompressedBytes: content.length,
    entries: [{ entryName: `${receipt}.xml`, format: 'xml', mediaType: 'application/xml',
      compressedSize: content.length, uncompressedSize: content.length, sha256: hash, content }],
  };
}
function claimed(): ClaimedIngestionJob {
  return {
    id: '1', provider: 'opendart-fss', receiptNumber: RECEIPT, corpCode: '99999999',
    symbol: '999999', reportName: '합성 사업보고서', canonicalSchemaName: CANONICAL_FILING_SCHEMA_NAME,
    canonicalSchemaVersion: String(CANONICAL_FILING_SCHEMA_VERSION), parserVersion: FILING_XML_PARSER_VERSION,
    chunkSchemaVersion: String(FILING_CHUNK_SCHEMA_VERSION), chunkerVersion: FILING_CHUNKER_VERSION,
    priority: 0, attemptNumber: 1, maxAttempts: 5, workerId: 'test-worker', leaseToken: TOKEN,
    leaseExpiresAt: new Date(NOW.getTime() + 300_000),
  };
}

class FakeJobs implements IngestionJobStore {
  readonly stages: string[] = [];
  completed = 0;
  failed?: SafeIngestionFailure;
  heartbeatCount = 0;
  loseAtHeartbeat?: number;
  loseOnComplete = false;
  async reclaimExpiredLeases(): Promise<number> { return 0; }
  async claimNextJob(): Promise<ClaimedIngestionJob | undefined> { return undefined; }
  async heartbeatLease(): Promise<LeaseMutationResult> {
    this.heartbeatCount += 1;
    return this.heartbeatCount === this.loseAtHeartbeat
      ? { status: 'lease_lost' }
      : { status: 'updated' };
  }
  async updateStage(_id: string, _token: string, from: string, to: string): Promise<LeaseMutationResult> {
    this.stages.push(`${from}:${to}`); return { status: 'updated' };
  }
  async completeJob(): Promise<LeaseMutationResult> {
    this.completed += 1;
    return this.loseOnComplete ? { status: 'lease_lost' } : { status: 'updated' };
  }
  async failJob(_id: string, _token: string, failure: SafeIngestionFailure): Promise<LeaseMutationResult> {
    this.failed = failure; return { status: 'updated' };
  }
}
const config = {
  workerId: 'test-worker', pollIntervalMs: 100, leaseMs: 300_000,
  heartbeatMs: 30_000, shutdownGraceMs: 1_000, reclaimBatchSize: 20,
};

test('verified enqueue contract validates exact identities, versions, dates, and bounds', () => {
  const valid = validateVerifiedIngestionJob({
    ...claimed(), priority: 100, maxAttempts: 20, filingDate: '2099-01-01',
  });
  assert.equal(valid.priority, 100);
  for (const input of [
    { ...valid, receiptNumber: '1' }, { ...valid, corpCode: '123' },
    { ...valid, symbol: 'ABC123' }, { ...valid, parserVersion: '../bad' },
    { ...valid, filingDate: '2099-02-30' }, { ...valid, priority: 101 },
  ]) assert.throws(() => validateVerifiedIngestionJob(input));
});

test('worker config is bounded and requires heartbeat shorter than lease', () => {
  const loaded = loadFilingWorkerConfig({ FILING_WORKER_ID: 'worker-1' });
  assert.equal(loaded.leaseMs, 300_000);
  assert.throws(() => loadFilingWorkerConfig({ FILING_WORKER_LEASE_MS: '30000', FILING_WORKER_HEARTBEAT_MS: '30000' }));
  assert.throws(() => loadFilingWorkerConfig({ FILING_WORKER_ID: 'unsafe id' }));
});

test('retry backoff is exponential, capped, jittered, and deterministic', () => {
  assert.equal(retryDelayMs(1, () => 0, undefined), 5_000);
  assert.equal(retryDelayMs(2, () => 0, undefined), 10_000);
  assert.equal(retryDelayMs(3, () => 1, undefined), 24_000);
  assert.equal(retryDelayMs(20, () => 1, undefined), 900_000);
  assert.equal(retryDelayMs(1, () => 0, 60_000), 60_000);
});

test('typed failures map to retryable, permanent, quarantine, and safe unknown defaults', () => {
  assert.deepEqual(classifyIngestionFailure(new OpenDartError('OPENDART_TIMEOUT', 'filing-document', true)),
    { code: 'OPENDART_TIMEOUT', category: 'retryable', retryable: true });
  assert.equal(classifyIngestionFailure(new OpenDartError('INVALID_RECEIPT', 'filing-document', false)).category, 'permanent');
  assert.equal(classifyIngestionFailure(new OpenDartError('OPENDART_DOCUMENT_UNSAFE_ARCHIVE', 'filing-document', false)).category, 'quarantine');
  assert.equal(classifyIngestionFailure(new FilingPersistenceError('FILING_PERSISTENCE_CONFLICT', false)).category, 'quarantine');
  assert.equal(classifyIngestionFailure(new DatabaseError('DATABASE_UNAVAILABLE', true)).category, 'retryable');
  assert.deepEqual(classifyIngestionFailure(new Error('raw')), {
    code: 'INGESTION_UNCLASSIFIED_FAILURE', category: 'quarantine', retryable: false,
  });
});

test('worker uses production parser and chunker then completes inserted persistence', async () => {
  const jobs = new FakeJobs();
  let persisted = 0;
  const worker = new FilingIngestionWorker(config, {
    jobs, acquisition: { async acquire() { return archive(); } },
    persistence: { async persistCanonicalFiling(input) {
      persisted += 1;
      assert.equal(input.document.receiptNumber, RECEIPT);
      assert.ok(input.chunks.length > 0);
      return { status: 'inserted', documentId: '10', canonicalFingerprint: 'a'.repeat(64),
        chunkFingerprint: 'b'.repeat(64), sectionCount: 1, blockCount: 2, chunkCount: input.chunks.length };
    } }, now: () => NOW, monotonicNow: (() => { let value = 0; return () => value += 5; })(),
  });
  const result = await worker.processJob(claimed());
  assert.deepEqual(result, { status: 'succeeded', persistence: 'inserted' });
  assert.equal(persisted, 1);
  assert.equal(jobs.completed, 1);
  assert.deepEqual(jobs.stages, ['acquiring:parsing', 'parsing:chunking', 'chunking:persisting']);
});

test('already-present persistence is also a successful worker outcome', async () => {
  const jobs = new FakeJobs();
  const worker = new FilingIngestionWorker(config, {
    jobs, acquisition: { async acquire() { return archive(); } },
    persistence: { async persistCanonicalFiling(input) { return {
      status: 'already_present', documentId: '10', canonicalFingerprint: 'a'.repeat(64),
      chunkFingerprint: 'b'.repeat(64), sectionCount: 1, blockCount: 2, chunkCount: input.chunks.length,
    }; } }, now: () => NOW,
  });
  assert.deepEqual(await worker.processJob(claimed()), { status: 'succeeded', persistence: 'already_present' });
  assert.equal(jobs.completed, 1);
});

test('completion lease loss preserves persisted data for idempotent recovery', async () => {
  const jobs = new FakeJobs();
  jobs.loseOnComplete = true;
  let persisted = 0;
  const worker = new FilingIngestionWorker(config, {
    jobs, acquisition: { async acquire() { return archive(); } },
    persistence: { async persistCanonicalFiling(input) {
      persisted += 1;
      return { status: 'inserted', documentId: '10', canonicalFingerprint: 'a'.repeat(64),
        chunkFingerprint: 'b'.repeat(64), sectionCount: 1, blockCount: 2,
        chunkCount: input.chunks.length };
    } }, now: () => NOW,
  });
  assert.deepEqual(await worker.processJob(claimed()), { status: 'lease_lost' });
  assert.equal(persisted, 1);
  assert.equal(jobs.completed, 1);
  assert.equal(jobs.failed, undefined);
});

test('lease loss immediately before persistence prevents the write and terminal transition', async () => {
  const jobs = new FakeJobs();
  jobs.loseAtHeartbeat = 6;
  let acquisitions = 0;
  let persisted = 0;
  const worker = new FilingIngestionWorker(config, {
    jobs, acquisition: { async acquire() { acquisitions += 1; return archive(); } },
    persistence: { async persistCanonicalFiling() { persisted += 1; throw new Error('unreachable'); } },
    now: () => NOW,
  });
  assert.deepEqual(await worker.processJob(claimed()), { status: 'lease_lost' });
  assert.equal(acquisitions, 1);
  assert.equal(persisted, 0);
  assert.deepEqual(jobs.stages, ['acquiring:parsing', 'parsing:chunking', 'chunking:persisting']);
  assert.equal(jobs.completed, 0);
  assert.equal(jobs.failed, undefined);
});

test('typed retryable acquisition failure never reaches persistence', async () => {
  const jobs = new FakeJobs();
  let persisted = 0;
  const worker = new FilingIngestionWorker(config, {
    jobs, acquisition: { async acquire() { throw new OpenDartError('OPENDART_RATE_LIMITED', 'filing-document', true); } },
    persistence: { async persistCanonicalFiling() { persisted += 1; throw new Error('unreachable'); } },
    now: () => NOW,
  });
  const result = await worker.processJob(claimed());
  assert.equal(result.status, 'failed');
  assert.equal(jobs.failed?.code, 'OPENDART_RATE_LIMITED');
  assert.equal(persisted, 0);
});

test('malformed XML is a permanent worker failure with no persistence', async () => {
  const jobs = new FakeJobs();
  const invalid = archive();
  const content = Buffer.from('<DOCUMENT><BODY>');
  const entryHash = sha(content);
  const malformed: ValidatedDisclosureDocumentArchive = {
    ...invalid,
    archiveByteLength: content.length,
    archiveSha256: entryHash,
    declaredTotalUncompressedBytes: content.length,
    extractedTotalUncompressedBytes: content.length,
    entries: [{ ...invalid.entries[0]!, compressedSize: content.length,
      uncompressedSize: content.length, sha256: entryHash, content }],
  };
  let persisted = 0;
  const worker = new FilingIngestionWorker(config, {
    jobs, acquisition: { async acquire() { return malformed; } },
    persistence: { async persistCanonicalFiling() { persisted += 1; throw new Error('unreachable'); } },
    now: () => NOW,
  });
  const result = await worker.processJob(claimed());
  assert.equal(result.status, 'failed');
  assert.equal(jobs.failed?.category, 'permanent');
  assert.equal(persisted, 0);
});

test('persistence identity conflict quarantines the job without success', async () => {
  const jobs = new FakeJobs();
  const worker = new FilingIngestionWorker(config, {
    jobs, acquisition: { async acquire() { return archive(); } },
    persistence: { async persistCanonicalFiling() {
      throw new FilingPersistenceError('FILING_PERSISTENCE_CONFLICT', false);
    } },
    now: () => NOW,
  });
  const result = await worker.processJob(claimed());
  assert.equal(result.status, 'failed');
  assert.equal(jobs.failed?.category, 'quarantine');
  assert.equal(jobs.completed, 0);
});

test('shutdown aborts acquisition and leaves lease recovery to expiry', async () => {
  const jobs = new FakeJobs();
  let sawAbort = false;
  const worker = new FilingIngestionWorker(config, {
    jobs, acquisition: { acquire(_receipt, signal) { return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => { sawAbort = true; reject(signal.reason); }, { once: true });
    }); } },
    persistence: { async persistCanonicalFiling() { throw new Error('unreachable'); } }, now: () => NOW,
  });
  const processing = worker.processJob(claimed());
  await new Promise(resolve => setImmediate(resolve));
  worker.requestShutdown();
  assert.deepEqual(await processing, { status: 'interrupted' });
  assert.equal(sawAbort, true);
  assert.equal(jobs.failed, undefined);
});

test('worker entry import has no automatic startup side effect', async () => {
  const entry = await import('../src/filingIntelligence/ingestion/workerMain.js');
  assert.equal(typeof entry.runFilingWorker, 'function');
});
