import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../../config.js';
import { DatabaseRuntime } from '../../infrastructure/database/runtime.js';
import { DisclosureDocumentAcquisitionService } from '../../openDart/document/disclosureDocumentAcquisitionService.js';
import { OpenDartHttpClient } from '../../openDart/openDartHttpClient.js';
import { OpenDartProvider } from '../../openDart/providers/openDartProvider.js';
import { FilingDocumentRepository } from '../persistence/filingDocumentRepository.js';
import { FilingIngestionWorker, SafeWorkerLogger } from './filingIngestionWorker.js';
import { IngestionJobRepository } from './ingestionJobRepository.js';
import { loadFilingWorkerConfig } from './workerConfig.js';

const logger: SafeWorkerLogger = {
  info(fields, message) { console.info(message, fields); },
  error(fields, message) { console.error(message, fields); },
};

export async function runFilingWorker(): Promise<void> {
  const config = loadConfig();
  const workerConfig = loadFilingWorkerConfig();
  if (!config.filingPersistenceEnabled || !config.databaseUrl || !config.openDartApiKey) {
    throw new Error('INGESTION_WORKER_NOT_CONFIGURED');
  }
  const database = new DatabaseRuntime(config, 'alpha-twin-filing-worker');
  const readiness = await database.probeIngestionReadiness();
  if (readiness.status !== 'ready') {
    await database.close();
    throw new Error(readiness.status === 'disabled' ? 'INGESTION_WORKER_NOT_CONFIGURED' : readiness.code);
  }
  const client = new OpenDartHttpClient({
    apiKey: config.openDartApiKey,
    baseUrl: config.openDartBaseUrl,
    timeoutMs: config.openDartTimeoutMs,
    documentTimeoutMs: config.openDartArchiveTimeoutMs,
  });
  const pool = database.getPool();
  const worker = new FilingIngestionWorker(workerConfig, {
    jobs: new IngestionJobRepository(pool),
    acquisition: new DisclosureDocumentAcquisitionService(new OpenDartProvider(client)),
    persistence: new FilingDocumentRepository(pool),
    logger,
  });
  let stopping = false;
  let forceExitTimer: NodeJS.Timeout | undefined;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    worker.requestShutdown();
    forceExitTimer = setTimeout(() => process.exit(0), workerConfig.shutdownGraceMs);
    forceExitTimer.unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await worker.run();
  } finally {
    if (forceExitTimer) clearTimeout(forceExitTimer);
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    await database.close();
  }
}

const entry = process.argv[1];
if (entry != null && fileURLToPath(import.meta.url) === resolve(entry)) {
  runFilingWorker().catch(() => { process.exitCode = 1; });
}
