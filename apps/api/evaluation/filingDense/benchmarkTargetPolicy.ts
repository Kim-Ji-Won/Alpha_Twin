import { Client } from 'pg';
import { BENCHMARK_IDENTITY, BenchmarkFailure, BenchmarkSafetyError } from './benchmarkMarkerContract.js';

export const BOOTSTRAP_OPT_IN = 'ALPHA_TWIN_BENCHMARK_BOOTSTRAP_OPT_IN';
export const VERIFY_OPT_IN = 'ALPHA_TWIN_BENCHMARK_VERIFY_OPT_IN';
export type BenchmarkIntent = 'bootstrap' | 'verify';

// Static rejection never instantiates a driver. Ambient PG* options are not used.
export function benchmarkTargetRejection(
  intent: BenchmarkIntent, env: NodeJS.ProcessEnv = process.env,
): BenchmarkFailure | null {
  if (env[intent === 'bootstrap' ? BOOTSTRAP_OPT_IN : VERIFY_OPT_IN] !== '1') {
    return intent === 'bootstrap' ? 'BOOTSTRAP_OPT_IN_REQUIRED' : 'BENCHMARK_VERIFY_OPT_IN_REQUIRED';
  }
  if (env.NODE_ENV?.trim().toLowerCase() === 'production') return 'BENCHMARK_PRODUCTION_ENVIRONMENT';
  try {
    const raw = env.TEST_DATABASE_URL;
    // Reject the original input before URL normalization can discard controls or empty delimiters.
    if (!raw || /[\x00-\x1f\x7f-\x9f\s\\?#]/.test(raw)) return 'BENCHMARK_TARGET_INVALID';
    const url = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash
      || !url.username || (url.port && (Number(url.port) < 1 || Number(url.port) > 65535))) {
      return 'BENCHMARK_TARGET_INVALID';
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return 'BENCHMARK_TARGET_NOT_LOOPBACK';
    if (url.pathname !== `/${BENCHMARK_IDENTITY.databaseName}`) return 'BENCHMARK_TARGET_NAME_MISMATCH';
    for (const value of [url.username, url.password]) {
      if (/[\x00-\x1f\x7f]/.test(decodeURIComponent(value))) return 'BENCHMARK_TARGET_INVALID';
    }
    return null;
  } catch { return 'BENCHMARK_TARGET_INVALID'; }
}

export function createBenchmarkClient(intent: BenchmarkIntent): Client {
  const rejected = benchmarkTargetRejection(intent);
  if (rejected) throw new BenchmarkSafetyError(rejected);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  const client = new Client({
    host: url.hostname === '[::1]' ? '::1' : url.hostname,
    port: Number(url.port || 5432), database: BENCHMARK_IDENTITY.databaseName,
    user: decodeURIComponent(url.username), password: async () => decodeURIComponent(url.password),
    ssl: false, options: '-c search_path=pg_catalog', application_name: 'alpha-twin-benchmark-safety',
    connectionTimeoutMillis: 3_000, statement_timeout: 10_000, query_timeout: 12_000,
    lock_timeout: 3_000, idle_in_transaction_session_timeout: 15_000,
  });
  // Do not expose asynchronous driver diagnostics, which can contain secrets.
  client.on('error', () => {});
  return client;
}

export async function closeBenchmarkClient(client: Client | undefined): Promise<void> {
  if (!client) return;
  try { await client.query('ROLLBACK'); } catch { /* Connection may already be closed. */ }
  try { await client.end(); } catch { /* Never expose driver errors. */ }
}
