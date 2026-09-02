-- Up Migration

CREATE TABLE filing_intelligence.filing_dense_generation_job (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  generation_id bigint NOT NULL,
  document_id bigint NOT NULL,
  dense_profile_id text NOT NULL CHECK (dense_profile_id <> ''),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'retry_wait', 'succeeded', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts smallint NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  last_failure_code text
    CHECK (last_failure_code IS NULL OR last_failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT filing_dense_generation_job_identity_unique
    UNIQUE (document_id, dense_profile_id),
  CONSTRAINT filing_dense_generation_job_generation_unique UNIQUE (generation_id),
  CONSTRAINT filing_dense_generation_job_generation_fk
    FOREIGN KEY (generation_id, document_id)
    REFERENCES filing_intelligence.filing_dense_generation(id, document_id) ON DELETE RESTRICT,
  CONSTRAINT filing_dense_generation_job_attempt_bound CHECK (attempt_count <= max_attempts),
  CONSTRAINT filing_dense_generation_job_lease_consistency CHECK (
    (status = 'running'
      AND lease_owner IS NOT NULL AND lease_owner <> ''
      AND lease_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND lease_expires_at IS NOT NULL AND heartbeat_at IS NOT NULL)
    OR
    (status <> 'running' AND lease_owner IS NULL AND lease_token IS NULL
      AND lease_expires_at IS NULL AND heartbeat_at IS NULL)
  ),
  CONSTRAINT filing_dense_generation_job_terminal_consistency CHECK (
    (status IN ('succeeded', 'failed')) = (completed_at IS NOT NULL)
  )
);

CREATE TABLE filing_intelligence.filing_dense_generation_attempt (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id bigint NOT NULL
    REFERENCES filing_intelligence.filing_dense_generation_job(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  worker_id text NOT NULL CHECK (worker_id <> ''),
  lease_token text NOT NULL
    CHECK (lease_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  outcome text NOT NULL DEFAULT 'running'
    CHECK (outcome IN ('running', 'succeeded', 'retryable_failed', 'permanent_failed', 'lease_expired')),
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  failure_category text CHECK (failure_category IS NULL OR failure_category IN ('retryable', 'permanent')),
  provider_status_class text CHECK (provider_status_class IS NULL OR provider_status_class ~ '^[1-5]xx$'),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  input_count integer NOT NULL DEFAULT 0 CHECK (input_count >= 0),
  vector_count integer NOT NULL DEFAULT 0 CHECK (vector_count >= 0),
  token_count integer NOT NULL DEFAULT 0 CHECK (token_count >= 0),
  utf8_bytes bigint NOT NULL DEFAULT 0 CHECK (utf8_bytes >= 0),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT filing_dense_generation_attempt_job_number_unique UNIQUE (job_id, attempt_number),
  CONSTRAINT filing_dense_generation_attempt_terminal_consistency CHECK (
    (outcome = 'running') = (ended_at IS NULL)
  )
);

CREATE INDEX filing_dense_generation_job_claim_idx
  ON filing_intelligence.filing_dense_generation_job (available_at, created_at, id)
  WHERE status IN ('queued', 'retry_wait');
CREATE INDEX filing_dense_generation_job_expired_idx
  ON filing_intelligence.filing_dense_generation_job (lease_expires_at, id)
  WHERE status = 'running';
CREATE INDEX filing_dense_generation_attempt_job_idx
  ON filing_intelligence.filing_dense_generation_attempt (job_id, attempt_number DESC);

-- Down Migration
DROP TABLE filing_intelligence.filing_dense_generation_attempt;
DROP TABLE filing_intelligence.filing_dense_generation_job;
