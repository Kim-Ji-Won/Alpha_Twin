import { performance } from 'node:perf_hooks';

import {
  CANONICAL_FILING_SCHEMA_NAME, CANONICAL_FILING_SCHEMA_VERSION,
  FILING_CHUNKER_VERSION, FILING_CHUNK_SCHEMA_VERSION, FILING_XML_PARSER_VERSION,
  CanonicalFilingDocument, FilingChunk,
} from '../../openDart/document/canonicalFilingContracts.js';
import { ValidatedDisclosureDocumentArchive } from '../../openDart/document/documentContracts.js';
import { chunkFilingDocument } from '../../openDart/document/filingChunker.js';
import { parseFilingDocument } from '../../openDart/document/filingXmlParser.js';
import { FilingPersistenceResult, PersistCanonicalFilingInput } from '../persistence/contracts.js';
import {
  ClaimedIngestionJob, IngestionAttemptMetrics, IngestionJobStage,
  LeaseMutationResult, SafeIngestionFailure,
} from './contracts.js';
import { IngestionError } from './errors.js';
import { classifyIngestionFailure } from './retryPolicy.js';
import { FilingWorkerConfig } from './workerConfig.js';

export interface IngestionJobStore {
  reclaimExpiredLeases(input: { now: Date; limit: number }): Promise<number>;
  claimNextJob(input: { workerId: string; now: Date; leaseMs: number }): Promise<ClaimedIngestionJob | undefined>;
  heartbeatLease(jobId: string, token: string, now: Date, leaseMs: number): Promise<LeaseMutationResult>;
  updateStage(jobId: string, token: string, from: IngestionJobStage, to: IngestionJobStage, now: Date): Promise<LeaseMutationResult>;
  completeJob(jobId: string, token: string, documentId: string, metrics: IngestionAttemptMetrics, now: Date): Promise<LeaseMutationResult>;
  failJob(jobId: string, token: string, failure: SafeIngestionFailure, metrics: IngestionAttemptMetrics, now: Date): Promise<LeaseMutationResult>;
}
export interface FilingAcquisition {
  acquire(receipt: string, signal?: AbortSignal): Promise<ValidatedDisclosureDocumentArchive>;
}
export interface CanonicalFilingPersistence {
  persistCanonicalFiling(input: PersistCanonicalFilingInput): Promise<FilingPersistenceResult>;
}
export interface SafeWorkerLogger {
  info(fields: Record<string, string | number | boolean>, message: string): void;
  error(fields: Record<string, string | number | boolean>, message: string): void;
}
export interface FilingWorkerDependencies {
  readonly jobs: IngestionJobStore;
  readonly acquisition: FilingAcquisition;
  readonly persistence: CanonicalFilingPersistence;
  readonly parse?: typeof parseFilingDocument;
  readonly chunk?: typeof chunkFilingDocument;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly logger?: SafeWorkerLogger;
  readonly afterPersist?: (result: FilingPersistenceResult) => Promise<void>;
}
export type ProcessJobResult =
  | { readonly status: 'succeeded'; readonly persistence: FilingPersistenceResult['status'] }
  | { readonly status: 'failed'; readonly failure: SafeIngestionFailure }
  | { readonly status: 'lease_lost' | 'interrupted' };

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}
function duration(from: number, to: number): number { return Math.max(0, Math.round(to - from)); }
function mismatch(): never { throw new IngestionError('INGESTION_SOURCE_IDENTITY_MISMATCH', false); }

function verifyVersions(job: ClaimedIngestionJob): void {
  if (job.canonicalSchemaName !== CANONICAL_FILING_SCHEMA_NAME
    || job.canonicalSchemaVersion !== String(CANONICAL_FILING_SCHEMA_VERSION)
    || job.parserVersion !== FILING_XML_PARSER_VERSION
    || job.chunkSchemaVersion !== String(FILING_CHUNK_SCHEMA_VERSION)
    || job.chunkerVersion !== FILING_CHUNKER_VERSION) mismatch();
}
function verifyArchive(job: ClaimedIngestionJob, archive: ValidatedDisclosureDocumentArchive): void {
  if (archive.provider !== job.provider || archive.receiptNumber !== job.receiptNumber) mismatch();
}
function verifyDocument(job: ClaimedIngestionJob, archive: ValidatedDisclosureDocumentArchive, document: CanonicalFilingDocument): void {
  const entry = archive.entries.find(value => value.sha256 === document.source.entrySha256);
  if (document.provider !== job.provider || document.receiptNumber !== job.receiptNumber
    || document.schemaName !== job.canonicalSchemaName
    || String(document.schemaVersion) !== job.canonicalSchemaVersion
    || document.parserVersion !== job.parserVersion || !entry
    || entry.entryName !== document.source.entryName
    || entry.uncompressedSize !== document.source.byteLength) mismatch();
}
function verifyChunks(job: ClaimedIngestionJob, document: CanonicalFilingDocument, chunks: readonly FilingChunk[]): void {
  if (chunks.some(chunk => chunk.provider !== job.provider
    || chunk.receiptNumber !== job.receiptNumber
    || chunk.sourceEntryHash !== document.source.entrySha256
    || String(chunk.schemaVersion) !== job.chunkSchemaVersion
    || chunk.parserVersion !== job.parserVersion || chunk.chunkerVersion !== job.chunkerVersion)) mismatch();
}

export class FilingIngestionWorker {
  private readonly parse: typeof parseFilingDocument;
  private readonly chunk: typeof chunkFilingDocument;
  private readonly now: () => Date;
  private readonly monotonicNow: () => number;
  private readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly shutdownController = new AbortController();
  private activeController?: AbortController;

  constructor(private readonly config: FilingWorkerConfig, private readonly dependencies: FilingWorkerDependencies) {
    this.parse = dependencies.parse ?? parseFilingDocument;
    this.chunk = dependencies.chunk ?? chunkFilingDocument;
    this.now = dependencies.now ?? (() => new Date());
    this.monotonicNow = dependencies.monotonicNow ?? performance.now.bind(performance);
    this.wait = dependencies.sleep ?? sleep;
  }

  requestShutdown(): void {
    const reason = new IngestionError('INGESTION_WORKER_SHUTTING_DOWN', false);
    this.shutdownController.abort(reason);
    this.activeController?.abort(reason);
  }

  async run(): Promise<void> {
    let failures = 0;
    while (!this.shutdownController.signal.aborted) {
      try {
        await this.dependencies.jobs.reclaimExpiredLeases({ now: this.now(), limit: this.config.reclaimBatchSize });
        if (this.shutdownController.signal.aborted) break;
        const job = await this.dependencies.jobs.claimNextJob({
          workerId: this.config.workerId, now: this.now(), leaseMs: this.config.leaseMs,
        });
        failures = 0;
        if (job) await this.processJob(job);
        else await this.wait(this.config.pollIntervalMs, this.shutdownController.signal);
      } catch {
        if (this.shutdownController.signal.aborted) break;
        failures += 1;
        this.dependencies.logger?.error({ workerId: this.config.workerId, code: 'INGESTION_POLL_FAILED' }, 'Filing ingestion poll failed');
        const delay = Math.min(30_000, this.config.pollIntervalMs * 2 ** Math.min(failures, 4));
        await this.wait(delay, this.shutdownController.signal).catch(() => undefined);
      }
    }
  }

  async processJob(job: ClaimedIngestionJob): Promise<ProcessJobResult> {
    const started = this.monotonicNow();
    const metrics: Record<string, number> = {};
    const controller = new AbortController();
    const heartbeatController = new AbortController();
    this.activeController = controller;
    let leaseLost = false;
    let heartbeatFailure = false;
    const shutdown = () => controller.abort(this.shutdownController.signal.reason);
    if (this.shutdownController.signal.aborted) shutdown();
    else this.shutdownController.signal.addEventListener('abort', shutdown, { once: true });

    const heartbeat = (async () => {
      while (!heartbeatController.signal.aborted) {
        try {
          await this.wait(this.config.heartbeatMs, heartbeatController.signal);
          if (heartbeatController.signal.aborted) break;
          const result = await this.dependencies.jobs.heartbeatLease(job.id, job.leaseToken, this.now(), this.config.leaseMs);
          if (result.status === 'lease_lost') leaseLost = true;
          if (leaseLost) { controller.abort(new IngestionError('INGESTION_LEASE_LOST', false)); break; }
        } catch {
          if (!heartbeatController.signal.aborted) {
            heartbeatFailure = true;
            controller.abort(new IngestionError('INGESTION_LEASE_LOST', false));
          }
          break;
        }
      }
    })();
    const own = async (): Promise<void> => {
      if (controller.signal.aborted || heartbeatFailure) throw new IngestionError('INGESTION_LEASE_LOST', false);
      const result = await this.dependencies.jobs.heartbeatLease(job.id, job.leaseToken, this.now(), this.config.leaseMs);
      if (result.status === 'lease_lost') { leaseLost = true; mismatch(); }
    };
    const move = async (from: IngestionJobStage, to: IngestionJobStage): Promise<void> => {
      await own();
      const result = await this.dependencies.jobs.updateStage(job.id, job.leaseToken, from, to, this.now());
      if (result.status === 'lease_lost') { leaseLost = true; throw new IngestionError('INGESTION_LEASE_LOST', false); }
    };

    try {
      verifyVersions(job);
      await own();
      let phase = this.monotonicNow();
      const archive = await this.dependencies.acquisition.acquire(job.receiptNumber, controller.signal);
      metrics.acquisitionMs = duration(phase, this.monotonicNow());
      metrics.sourceEntryBytes = archive.extractedTotalUncompressedBytes;
      verifyArchive(job, archive);
      await move('acquiring', 'parsing');
      phase = this.monotonicNow();
      const document = this.parse(archive, { upstreamReportName: job.reportName });
      metrics.parseMs = duration(phase, this.monotonicNow());
      metrics.sectionCount = document.statistics.sectionCount;
      metrics.blockCount = document.blocks.length;
      verifyDocument(job, archive, document);
      await own();
      await move('parsing', 'chunking');
      phase = this.monotonicNow();
      const chunks = this.chunk(document);
      metrics.chunkMs = duration(phase, this.monotonicNow());
      metrics.chunkCount = chunks.length;
      verifyChunks(job, document, chunks);
      await move('chunking', 'persisting');
      await own();
      phase = this.monotonicNow();
      const result = await this.dependencies.persistence.persistCanonicalFiling({
        metadata: { corpCode: job.corpCode, symbol: job.symbol, companyName: job.companyName,
          reportName: job.reportName, reportCode: job.reportCode, filingDate: job.filingDate },
        document, chunks,
      });
      metrics.persistenceMs = duration(phase, this.monotonicNow());
      await this.dependencies.afterPersist?.(result);
      metrics.totalMs = duration(started, this.monotonicNow());
      const completed = await this.dependencies.jobs.completeJob(job.id, job.leaseToken, result.documentId, metrics, this.now());
      if (completed.status === 'lease_lost') return { status: 'lease_lost' };
      this.dependencies.logger?.info({ workerId: job.workerId, jobId: job.id, provider: job.provider,
        receipt: job.receiptNumber, attempt: job.attemptNumber, durationMs: metrics.totalMs }, 'Filing ingestion completed');
      return { status: 'succeeded', persistence: result.status };
    } catch (error) {
      metrics.totalMs = duration(started, this.monotonicNow());
      if (leaseLost || heartbeatFailure) return { status: 'lease_lost' };
      if (this.shutdownController.signal.aborted) return { status: 'interrupted' };
      const failure = classifyIngestionFailure(error);
      const failed = await this.dependencies.jobs.failJob(job.id, job.leaseToken, failure, metrics, this.now());
      if (failed.status === 'lease_lost') return { status: 'lease_lost' };
      this.dependencies.logger?.error({ workerId: job.workerId, jobId: job.id, provider: job.provider,
        receipt: job.receiptNumber, attempt: job.attemptNumber, code: failure.code,
        retryable: failure.retryable }, 'Filing ingestion failed');
      return { status: 'failed', failure };
    } finally {
      heartbeatController.abort();
      await heartbeat;
      this.shutdownController.signal.removeEventListener('abort', shutdown);
      if (this.activeController === controller) this.activeController = undefined;
    }
  }
}
