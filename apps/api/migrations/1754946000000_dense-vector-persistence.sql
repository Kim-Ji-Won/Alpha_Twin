-- Up Migration

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION 'pgvector prerequisite missing: admin must CREATE EXTENSION vector';
  END IF;
  IF (SELECT string_to_array(extversion, '.')::integer[] FROM pg_extension WHERE extname = 'vector')
      < ARRAY[0, 8, 0] THEN
    RAISE EXCEPTION 'pgvector 0.8.0 or newer is required';
  END IF;
END $$;

CREATE TABLE filing_intelligence.filing_dense_generation (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES filing_intelligence.filing_document(id) ON DELETE RESTRICT,
  dense_profile_id text NOT NULL CHECK (dense_profile_id <> ''),
  dense_profile_fingerprint text NOT NULL CHECK (dense_profile_fingerprint ~ '^[0-9a-f]{64}$'),
  representation_fingerprint text NOT NULL CHECK (representation_fingerprint ~ '^[0-9a-f]{64}$'),
  input_manifest_fingerprint text NOT NULL CHECK (input_manifest_fingerprint ~ '^[0-9a-f]{64}$'),
  dimension integer NOT NULL CHECK (dimension = 1536),
  status text NOT NULL CHECK (status IN ('building', 'ready', 'failed')),
  expected_vector_count integer NOT NULL CHECK (expected_vector_count >= 0),
  persisted_vector_count integer NOT NULL DEFAULT 0 CHECK (persisted_vector_count >= 0 AND persisted_vector_count <= expected_vector_count),
  generation_fingerprint text CHECK (generation_fingerprint IS NULL OR generation_fingerprint ~ '^[0-9a-f]{64}$'),
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ready_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (document_id, dense_profile_id), UNIQUE (id, document_id),
  FOREIGN KEY (document_id, representation_fingerprint)
    REFERENCES filing_intelligence.filing_document_representation_manifest(document_id, representation_fingerprint) ON DELETE RESTRICT,
  CHECK ((status = 'building' AND ready_at IS NULL AND generation_fingerprint IS NULL AND failure_code IS NULL)
    OR (status = 'ready' AND ready_at IS NOT NULL AND generation_fingerprint IS NOT NULL
      AND failure_code IS NULL AND persisted_vector_count = expected_vector_count)
    OR (status = 'failed' AND ready_at IS NULL AND generation_fingerprint IS NULL AND failure_code IS NOT NULL))
);

CREATE TABLE filing_intelligence.filing_chunk_embedding (
  generation_id bigint NOT NULL, document_id bigint NOT NULL, chunk_row_id bigint NOT NULL,
  chunk_id text NOT NULL CHECK (chunk_id <> ''),
  input_fingerprint text NOT NULL CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
  vector_fingerprint text NOT NULL CHECK (vector_fingerprint ~ '^[0-9a-f]{64}$'),
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (generation_id, chunk_row_id), UNIQUE (generation_id, chunk_id),
  FOREIGN KEY (generation_id, document_id) REFERENCES filing_intelligence.filing_dense_generation(id, document_id) ON DELETE RESTRICT,
  FOREIGN KEY (document_id, chunk_row_id) REFERENCES filing_intelligence.filing_chunk(document_id, id) ON DELETE RESTRICT,
  CHECK (vector_dims(embedding) = 1536 AND vector_norm(embedding) > 0)
);

CREATE INDEX filing_dense_generation_status_profile_idx
  ON filing_intelligence.filing_dense_generation (status, dense_profile_id, document_id);
CREATE INDEX filing_chunk_embedding_document_chunk_idx
  ON filing_intelligence.filing_chunk_embedding (document_id, chunk_row_id);

-- Down Migration
DROP TABLE filing_intelligence.filing_chunk_embedding;
DROP TABLE filing_intelligence.filing_dense_generation;
