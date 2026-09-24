export const BENCHMARK_IDENTITY = Object.freeze({
  markerId: 'alpha-twin-dense-benchmark@1',
  purpose: 'disposable-evaluation',
  databaseName: 'alpha_twin_benchmark_test',
  contractRevision: 'benchmark-marker-persistence@1',
} as const);

export const REQUIRED_BENCHMARK_MIGRATIONS = Object.freeze([
  '1753650000000_canonical-filing-persistence',
  '1753822800000_filing-ingestion-queue',
  '1754082000000_filing-lexical-index',
  '1754254800000_filing-receipt-and-correction-foundation',
  '1754427600000_filing-resolution-control',
  '1754600400000_filing-retrieval-eligibility-foundation',
  '1754773200000_filing-retrieval-activation',
  '1754946000000_dense-vector-persistence',
  '1755122400000_dense-generation-queue',
  '1755295200000_legacy-filing-decoding-provenance',
  '1755468000000_versioned-legacy-retrieval-admission',
]);

export type BenchmarkFailure =
  | 'BENCHMARK_VERIFY_OPT_IN_REQUIRED' | 'BOOTSTRAP_OPT_IN_REQUIRED'
  | 'BENCHMARK_TARGET_INVALID' | 'BENCHMARK_TARGET_NOT_LOOPBACK'
  | 'BENCHMARK_TARGET_NAME_MISMATCH' | 'BENCHMARK_PRODUCTION_ENVIRONMENT'
  | 'BENCHMARK_READ_ONLY_NOT_ENFORCED' | 'BENCHMARK_RUNTIME_DB_MISMATCH'
  | 'BENCHMARK_MARKER_MISSING' | 'BENCHMARK_MARKER_CONFLICT'
  | 'BENCHMARK_MARKER_SCHEMA_INVALID' | 'BENCHMARK_SCHEMA_INCOMPLETE'
  | 'BENCHMARK_EMPTY_OR_REINITIALIZED' | 'BENCHMARK_CONNECTION_FAILED'
  | 'BOOTSTRAP_EXISTING_MARKER_CONFLICT' | 'BOOTSTRAP_CORPUS_IDENTITY_INSUFFICIENT'
  | 'BOOTSTRAP_SCHEMA_INCOMPATIBLE' | 'BOOTSTRAP_FAILED';

export class BenchmarkSafetyError extends Error {
  constructor(readonly code: BenchmarkFailure) { super(code); }
}

export function safeBenchmarkFailure(error: unknown, fallback: BenchmarkFailure): BenchmarkFailure {
  return error instanceof BenchmarkSafetyError ? error.code : fallback;
}
