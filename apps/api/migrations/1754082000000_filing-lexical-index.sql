-- Up Migration

CREATE UNIQUE INDEX filing_chunk_document_row_unique
  ON filing_intelligence.filing_chunk (document_id, id);

CREATE TABLE filing_intelligence.filing_lexical_generation (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id bigint NOT NULL
    REFERENCES filing_intelligence.filing_document(id) ON DELETE CASCADE,
  profile_id text NOT NULL CHECK (profile_id <> ''),
  schema_version text NOT NULL CHECK (schema_version <> ''),
  normalizer_version text NOT NULL CHECK (normalizer_version <> ''),
  text_search_config text NOT NULL CHECK (text_search_config = 'simple'),
  status text NOT NULL CHECK (status IN ('building', 'ready', 'failed')),
  chunk_count integer NOT NULL CHECK (chunk_count >= 0),
  lexical_fingerprint text NOT NULL CHECK (lexical_fingerprint ~ '^[0-9a-f]{64}$'),
  total_lexeme_count integer NOT NULL CHECK (total_lexeme_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT filing_lexical_generation_document_profile_unique
    UNIQUE (document_id, profile_id),
  CONSTRAINT filing_lexical_generation_document_identity_unique
    UNIQUE (id, document_id),
  CONSTRAINT filing_lexical_generation_status_consistency CHECK (
    (status = 'building' AND completed_at IS NULL)
    OR (status IN ('ready', 'failed') AND completed_at IS NOT NULL)
  )
);

CREATE TABLE filing_intelligence.filing_chunk_lexical (
  generation_id bigint NOT NULL,
  document_id bigint NOT NULL,
  chunk_row_id bigint NOT NULL,
  chunk_id text NOT NULL CHECK (chunk_id <> ''),
  search_vector tsvector NOT NULL,
  lexical_content_hash text NOT NULL CHECK (lexical_content_hash ~ '^[0-9a-f]{64}$'),
  lexeme_count integer NOT NULL CHECK (lexeme_count >= 0),
  weight_a_lexeme_count integer NOT NULL CHECK (weight_a_lexeme_count >= 0),
  weight_b_lexeme_count integer NOT NULL CHECK (weight_b_lexeme_count >= 0),
  weight_c_lexeme_count integer NOT NULL CHECK (weight_c_lexeme_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (generation_id, chunk_row_id),
  CONSTRAINT filing_chunk_lexical_generation_chunk_unique
    UNIQUE (generation_id, chunk_id),
  CONSTRAINT filing_chunk_lexical_generation_document_fk
    FOREIGN KEY (generation_id, document_id)
    REFERENCES filing_intelligence.filing_lexical_generation(id, document_id)
    ON DELETE CASCADE,
  CONSTRAINT filing_chunk_lexical_chunk_document_fk
    FOREIGN KEY (document_id, chunk_row_id)
    REFERENCES filing_intelligence.filing_chunk(document_id, id)
    ON DELETE CASCADE,
  CONSTRAINT filing_chunk_lexical_count_consistency CHECK (
    lexeme_count = weight_a_lexeme_count + weight_b_lexeme_count + weight_c_lexeme_count
  )
);

CREATE INDEX filing_chunk_lexical_search_vector_gin_idx
  ON filing_intelligence.filing_chunk_lexical USING GIN (search_vector);
CREATE INDEX filing_chunk_lexical_document_generation_idx
  ON filing_intelligence.filing_chunk_lexical (document_id, generation_id);

-- Down Migration

DROP TABLE filing_intelligence.filing_chunk_lexical;
DROP TABLE filing_intelligence.filing_lexical_generation;
DROP INDEX filing_intelligence.filing_chunk_document_row_unique;
