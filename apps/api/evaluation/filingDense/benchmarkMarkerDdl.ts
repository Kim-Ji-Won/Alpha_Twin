import { BENCHMARK_IDENTITY } from './benchmarkMarkerContract.js';

// Benchmark bootstrap authority only; never imported by application migrations or verifier.
export const BENCHMARK_MARKER_DDL = `CREATE TABLE public.benchmark_environment_marker (
  marker_id text NOT NULL CONSTRAINT benchmark_environment_marker_pkey PRIMARY KEY,
  purpose text NOT NULL,
  database_name text NOT NULL,
  CONSTRAINT benchmark_marker_id_check CHECK (marker_id = '${BENCHMARK_IDENTITY.markerId}'),
  CONSTRAINT benchmark_marker_purpose_check CHECK (purpose = '${BENCHMARK_IDENTITY.purpose}'),
  CONSTRAINT benchmark_marker_database_check CHECK (database_name = '${BENCHMARK_IDENTITY.databaseName}')
)`;
