import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../../config.js';
import { DatabaseRuntime } from '../../infrastructure/database/runtime.js';
import { DenseGenerationJobRepository } from './denseGenerationJobRepository.js';
import { DenseGenerationWorker, DenseWorkerLogger } from './denseGenerationWorker.js';
import { loadDenseWorkerConfig } from './denseWorkerConfig.js';
import { OpenAiEmbeddingProvider } from './openAiEmbeddingProvider.js';

const logger: DenseWorkerLogger = {
  info(fields, message) { console.info(message, fields); },
  error(fields, message) { console.error(message, fields); },
};

export async function runDenseWorker(): Promise<void> {
  const config = loadConfig();
  const workerConfig = loadDenseWorkerConfig();
  if (!config.filingPersistenceEnabled || !config.databaseUrl || !config.openAiApiKey) {
    throw new Error('DENSE_WORKER_NOT_CONFIGURED');
  }
  const database = new DatabaseRuntime(config, 'alpha-twin-dense-worker');
  const readiness = await database.probeDenseReadiness();
  if (readiness.status !== 'ready') {
    await database.close();
    throw new Error(readiness.status === 'disabled' ? 'DENSE_WORKER_NOT_CONFIGURED' : readiness.code);
  }
  const worker = new DenseGenerationWorker(workerConfig, {
    jobs: new DenseGenerationJobRepository(database.getPool()),
    provider: new OpenAiEmbeddingProvider(config.openAiApiKey, config.openAiTimeoutMs),
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
  try { await worker.run(); }
  finally {
    if (forceExitTimer) clearTimeout(forceExitTimer);
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    await database.close();
  }
}

const entry = process.argv[1];
if (entry != null && fileURLToPath(import.meta.url) === resolve(entry)) {
  runDenseWorker().catch(() => { process.exitCode = 1; });
}
