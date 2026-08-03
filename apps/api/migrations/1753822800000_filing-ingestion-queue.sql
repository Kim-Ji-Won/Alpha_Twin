-- Up Migration

CREATE TABLE filing_intelligence.filing_ingestion_job (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL CHECK (provider = 'opendart-fss'),
  receipt_number text NOT NULL CHECK (receipt_number ~ '^[0-9]{14}$'),
  corp_code text NOT NULL CHECK (corp_code ~ '^[0-9]{8}$'),
  symbol text NOT NULL CHECK (symbol ~ '^[0-9]{6}$'),
  company_name text,
  report_name text,
  report_code text,
  filing_date date,
  canonical_schema_name text NOT NULL CHECK (canonical_schema_name <> ''),
  canonical_schema_version text NOT NULL CHECK (canonical_schema_version <> ''),
  parser_version text NOT NULL CHECK (parser_version <> ''),
  chunk_schema_version text NOT NULL CHECK (chunk_schema_version <> ''),
  chunker_version text NOT NULL CHECK (chunker_version <> ''),
  priority smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN -100 AND 100),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'leased', 'retryable_failed', 'succeeded',
      'permanent_failed', 'quarantined', 'cancelled'
    )),
  stage text NOT NULL DEFAULT 'queued'
    CHECK (stage IN (
      'queued', 'acquiring', 'parsing', 'chunking',
      'persisting', 'completed', 'failed'
    )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts smallint NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  last_error_code text,
  last_error_category text,
  last_error_retryable boolean,
  persisted_document_id bigint
    REFERENCES filing_intelligence.filing_document(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT filing_ingestion_job_identity_unique UNIQUE (
    provider, receipt_number, canonical_schema_name, canonical_schema_version,
    parser_version, chunk_schema_version, chunker_version
  ),
  CONSTRAINT filing_ingestion_job_attempt_bound CHECK (attempt_count <= max_attempts),
  CONSTRAINT filing_ingestion_job_lease_consistency CHECK (
    (status = 'leased'
      AND lease_owner IS NOT NULL AND lease_owner <> ''
      AND lease_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND lease_expires_at IS NOT NULL AND heartbeat_at IS NOT NULL)
    OR
    (status <> 'leased'
      AND lease_owner IS NULL AND lease_token IS NULL
      AND lease_expires_at IS NULL AND heartbeat_at IS NULL)
  ),
  CONSTRAINT filing_ingestion_job_terminal_consistency CHECK (
    (status IN ('succeeded', 'permanent_failed', 'quarantined', 'cancelled'))
      = (completed_at IS NOT NULL)
  ),
  CONSTRAINT filing_ingestion_job_success_consistency CHECK (
    (status = 'succeeded' AND stage = 'completed' AND persisted_document_id IS NOT NULL)
    OR (status <> 'succeeded' AND persisted_document_id IS NULL)
  )
);

CREATE TABLE filing_intelligence.filing_ingestion_attempt (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id bigint NOT NULL
    REFERENCES filing_intelligence.filing_ingestion_job(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  worker_id text NOT NULL CHECK (worker_id <> ''),
  lease_token text NOT NULL
    CHECK (lease_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  outcome text NOT NULL DEFAULT 'running'
    CHECK (outcome IN (
      'running', 'succeeded', 'retryable_failed', 'permanent_failed',
      'quarantined', 'lease_expired', 'cancelled'
    )),
  last_stage text NOT NULL DEFAULT 'acquiring'
    CHECK (last_stage IN (
      'acquiring', 'parsing', 'chunking', 'persisting', 'completed', 'failed'
    )),
  error_code text,
  error_category text,
  error_retryable boolean,
  source_entry_bytes bigint CHECK (source_entry_bytes IS NULL OR source_entry_bytes >= 0),
  section_count integer CHECK (section_count IS NULL OR section_count >= 0),
  block_count integer CHECK (block_count IS NULL OR block_count >= 0),
  chunk_count integer CHECK (chunk_count IS NULL OR chunk_count >= 0),
  acquisition_ms integer CHECK (acquisition_ms IS NULL OR acquisition_ms >= 0),
  parse_ms integer CHECK (parse_ms IS NULL OR parse_ms >= 0),
  chunk_ms integer CHECK (chunk_ms IS NULL OR chunk_ms >= 0),
  persistence_ms integer CHECK (persistence_ms IS NULL OR persistence_ms >= 0),
  total_ms integer CHECK (total_ms IS NULL OR total_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT filing_ingestion_attempt_job_number_unique UNIQUE (job_id, attempt_number),
  CONSTRAINT filing_ingestion_attempt_terminal_consistency CHECK (
    (outcome = 'running') = (ended_at IS NULL)
  )
);

CREATE INDEX filing_ingestion_job_claim_idx
  ON filing_intelligence.filing_ingestion_job
    (priority DESC, available_at ASC, created_at ASC, id ASC)
  WHERE status IN ('pending', 'retryable_failed');
CREATE INDEX filing_ingestion_job_expired_lease_idx
  ON filing_intelligence.filing_ingestion_job (lease_expires_at ASC, id ASC)
  WHERE status = 'leased';
CREATE INDEX filing_ingestion_job_provider_receipt_idx
  ON filing_intelligence.filing_ingestion_job (provider, receipt_number);
CREATE INDEX filing_ingestion_job_persisted_document_idx
  ON filing_intelligence.filing_ingestion_job (persisted_document_id)
  WHERE persisted_document_id IS NOT NULL;
CREATE INDEX filing_ingestion_attempt_job_idx
  ON filing_intelligence.filing_ingestion_attempt (job_id, attempt_number DESC);

-- Down Migration

DROP TABLE filing_intelligence.filing_ingestion_attempt;
DROP TABLE filing_intelligence.filing_ingestion_job;
