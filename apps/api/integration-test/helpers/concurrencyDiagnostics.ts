import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';

export const STAGES = [
  'PRECHECK_START', 'PRECHECK_DONE', 'CONNECTION_STARTED', 'CONNECTION_ESTABLISHED',
  'BASELINE_CAPTURED', 'FIXTURE_SETUP_STARTED', 'SESSION_ISOLATION_SET',
  'BOOTSTRAP_STARTED', 'BOOTSTRAP_ISOLATION_CONFIRMED', 'ADVISORY_LOCK_ACQUIRED',
  'RELATION_LOCK_WAIT_ENTERED', 'WRITER_STARTED', 'WRITER_MUTATION_APPLIED',
  'WRITER_COMMITTED', 'BOOTSTRAP_RESUMED', 'POST_LOCK_INSPECTION_DONE',
  'FINGERPRINT_MISMATCH_CONFIRMED', 'MARKER_MUTATION_BLOCKED',
  'BOOTSTRAP_ROLLBACK_CONFIRMED', 'FIXTURE_CLEANUP_STARTED', 'FIXTURE_CLEANUP_DONE',
  'POST_BASELINE_CONFIRMED',
] as const;
type Stage = typeof STAGES[number];
const NODE_CODES = ['ERR_ASSERTION', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND',
  'ERR_UNKNOWN_FILE_EXTENSION', 'ERR_INVALID_URL', 'ERR_TEST_FAILURE',
  'EACCES', 'EPERM', 'ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'] as const;
const SQL_CODES = ['28P01', '28000', '42703', '42601', '42501', '42P01',
  '40001', '40P01', '57014', '55P03', '25006', '23505', '08006'] as const;
const NAMES = ['Error', 'TypeError', 'SyntaxError', 'AssertionError', 'DatabaseError'] as const;

export function sanitizedError(value: unknown) {
  const error = value instanceof Error ? value : null;
  const code = error && 'code' in error ? error.code : null;
  const nodeCode = NODE_CODES.find(item => item === code) ?? null;
  const sqlstate = SQL_CODES.find(item => item === code) ?? null;
  return {
    name: NAMES.find(item => item === error?.name) ?? 'UnknownError',
    nodeCode, sqlstate,
    message: sqlstate ? 'database error' : nodeCode === 'ERR_ASSERTION'
      ? 'assertion failure' : nodeCode ? 'runtime error' : 'unclassified error',
  };
}

export class ConcurrencyDiagnostics {
  private stage: Stage = 'PRECHECK_START';
  private failed = false;
  private sequence = 0;
  connected = false;
  transactionBegun = false;
  constructor(private readonly emit: (line: string) => void = line => {
    // Synchronous delivery survives a child crash; no on-disk artifact or raw error.
    writeSync(1, `${line}\n`);
  }) {}
  mark(stage: Stage): void {
    this.stage = stage;
    this.emit(`CONCURRENCY_DIAGNOSTIC ${JSON.stringify({ kind: 'stage', sequence: ++this.sequence, stage })}`);
  }
  failure(error: unknown): void {
    this.emit(`CONCURRENCY_DIAGNOSTIC ${JSON.stringify({ kind: 'failure',
      primary: !this.failed, stage: this.stage, ...sanitizedError(error),
      connected: this.connected, transactionBegun: this.transactionBegun })}`);
    this.failed = true;
  }
}

export function classifyChildFailure(input: {
  spawnError?: unknown; exitCode: number | null; signal: string | null;
  output: string; bodyEntered: boolean; connected: boolean;
}) {
  const patterns = [
    ['module import/preload failure', /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find (?:module|package)|SyntaxError|ERR_UNKNOWN_FILE_EXTENSION/],
    ['permission denied', /EACCES|EPERM|permission denied/i],
    ['connection refused', /ECONNREFUSED/],
    ['authentication failed', /28P01|password authentication failed/i],
    ['assertion failure', /ERR_ASSERTION|AssertionError/],
  ] as const;
  return {
    phase: input.spawnError ? 'spawn failure' : !input.bodyEntered
      ? 'before test body' : input.connected ? 'after DB connection' : 'before DB connection',
    category: input.spawnError ? sanitizedError(input.spawnError).message
      : patterns.find(([, pattern]) => pattern.test(input.output))?.[0] ?? 'unclassified',
    exitCode: Number.isInteger(input.exitCode) ? input.exitCode : null,
    signal: ['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT'].includes(input.signal ?? '')
      ? input.signal : null,
  };
}

// Explicit invocation only. The caller must first verify the disposable DB and baseline.
// No preload wrapper, shell, retries, environment dumps, or raw child output forwarding.
export async function runConcurrencyDiagnosticChild(): Promise<number | null> {
  if (process.env.ALPHA_TWIN_SYNTHETIC_BENCHMARK_TEST !== '1') {
    throw new Error('Disposable test opt-in required');
  }
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap',
    '--test-name-pattern=^fixture-local snapshot concurrency on prepared disposable corpus$',
    'integration-test/zzzzzzBenchmarkSafety.test.ts'], {
    cwd: new URL('../../', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', pending = '', bodyEntered = false, connected = false;
  let spawnError: unknown;
  const receive = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    output = (output + text).slice(-65536);
    pending = (pending + text).slice(-65536);
    const lines = pending.split('\n'); pending = lines.pop() ?? '';
    for (const line of lines) {
      const prefix = 'CONCURRENCY_DIAGNOSTIC ';
      const position = line.indexOf(prefix);
      if (position < 0) continue;
      try {
        const event = JSON.parse(line.slice(position + prefix.length));
        if (!STAGES.includes(event.stage)) continue;
        if (event.kind === 'stage') {
          bodyEntered ||= event.stage === 'PRECHECK_START';
          connected ||= event.stage === 'CONNECTION_ESTABLISHED';
          writeSync(1, `${prefix}${JSON.stringify({ kind: 'stage', stage: event.stage })}\n`);
        } else if (event.kind === 'failure') {
          // Reconstruct only fixed-vocabulary fields, never relay arbitrary child JSON.
          writeSync(1, `${prefix}${JSON.stringify({ kind: 'failure', stage: event.stage,
            primary: event.primary === true, connected: event.connected === true,
            transactionBegun: event.transactionBegun === true,
            name: NAMES.find(x => x === event.name) ?? 'UnknownError',
            nodeCode: NODE_CODES.find(x => x === event.nodeCode) ?? null,
            sqlstate: SQL_CODES.find(x => x === event.sqlstate) ?? null })}\n`);
        }
      } catch { /* Raw TAP/stderr is never printed. */ }
    }
  };
  child.stdout.on('data', receive); child.stderr.on('data', receive);
  child.on('error', error => { spawnError = error; });
  return new Promise(resolve => child.on('close', (exitCode, signal) => {
    writeSync(1, `${JSON.stringify({ kind: 'child-exit', ...classifyChildFailure({
      spawnError, exitCode, signal, output, bodyEntered, connected,
    }) })}\n`);
    output = ''; pending = '';
    resolve(exitCode);
  }));
}
