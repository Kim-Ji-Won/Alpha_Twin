-- Up Migration

CREATE SCHEMA filing_intelligence;

CREATE TABLE filing_intelligence.filing_document (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL CHECK (provider <> ''),
  receipt_number text NOT NULL CHECK (receipt_number ~ '^[0-9]{14}$'),
  corp_code text NOT NULL CHECK (corp_code ~ '^[0-9]{8}$'),
  symbol text NOT NULL CHECK (symbol ~ '^[0-9]{6}$'),
  company_name text,
  report_name text,
  report_code text,
  filing_date date,
  source_title text,
  upstream_report_name text,
  source_entry_name text NOT NULL CHECK (source_entry_name <> ''),
  source_entry_hash text NOT NULL CHECK (source_entry_hash ~ '^[0-9a-f]{64}$'),
  source_entry_byte_length bigint NOT NULL CHECK (source_entry_byte_length >= 0),
  canonical_schema_name text NOT NULL CHECK (canonical_schema_name <> ''),
  canonical_schema_version text NOT NULL CHECK (canonical_schema_version <> ''),
  parser_version text NOT NULL CHECK (parser_version <> ''),
  chunk_schema_version text NOT NULL CHECK (chunk_schema_version <> ''),
  chunker_version text NOT NULL CHECK (chunker_version <> ''),
  canonical_fingerprint text NOT NULL CHECK (canonical_fingerprint ~ '^[0-9a-f]{64}$'),
  chunk_fingerprint text NOT NULL CHECK (chunk_fingerprint ~ '^[0-9a-f]{64}$'),
  section_count integer NOT NULL CHECK (section_count >= 0),
  block_count integer NOT NULL CHECK (block_count >= 0),
  chunk_count integer NOT NULL CHECK (chunk_count >= 0),
  eligibility_status text NOT NULL DEFAULT 'pending'
    CHECK (eligibility_status IN ('pending', 'eligible', 'ineligible')),
  is_current_effective boolean NOT NULL DEFAULT false,
  is_retrieval_ready boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT filing_document_source_identity_unique UNIQUE (
    provider,
    receipt_number,
    source_entry_hash,
    canonical_schema_name,
    canonical_schema_version,
    parser_version
  )
);

CREATE TABLE filing_intelligence.filing_section (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id bigint NOT NULL
    REFERENCES filing_intelligence.filing_document(id) ON DELETE CASCADE,
  section_id text NOT NULL CHECK (section_id <> ''),
  parent_section_id text,
  title text,
  depth integer NOT NULL CHECK (depth >= 0),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  path text[] NOT NULL,
  block_ids text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT filing_section_document_section_unique UNIQUE (document_id, section_id),
  CONSTRAINT filing_section_document_ordinal_unique UNIQUE (document_id, ordinal),
  CONSTRAINT filing_section_parent_fk FOREIGN KEY (document_id, parent_section_id)
    REFERENCES filing_intelligence.filing_section(document_id, section_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE filing_intelligence.filing_block (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id bigint NOT NULL
    REFERENCES filing_intelligence.filing_document(id) ON DELETE CASCADE,
  section_id text,
  block_id text NOT NULL CHECK (block_id <> ''),
  block_type text NOT NULL
    CHECK (block_type IN ('heading', 'paragraph', 'note', 'table')),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  section_path text[] NOT NULL,
  source_text text NOT NULL CHECK (source_text <> ''),
  retrieval_text text NOT NULL CHECK (retrieval_text <> ''),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  locator jsonb NOT NULL,
  table_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT filing_block_document_block_unique UNIQUE (document_id, block_id),
  CONSTRAINT filing_block_document_ordinal_unique UNIQUE (document_id, ordinal),
  CONSTRAINT filing_block_section_fk FOREIGN KEY (document_id, section_id)
    REFERENCES filing_intelligence.filing_section(document_id, section_id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT filing_block_table_data_check CHECK (
    (block_type = 'table' AND table_data IS NOT NULL)
    OR (block_type <> 'table' AND table_data IS NULL)
  )
);

CREATE TABLE filing_intelligence.filing_chunk (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id bigint NOT NULL
    REFERENCES filing_intelligence.filing_document(id) ON DELETE CASCADE,
  chunk_id text NOT NULL CHECK (chunk_id <> ''),
  chunk_schema_version text NOT NULL CHECK (chunk_schema_version <> ''),
  parser_version text NOT NULL CHECK (parser_version <> ''),
  chunker_version text NOT NULL CHECK (chunker_version <> ''),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  section_id text,
  section_path text[] NOT NULL,
  source_block_ids text[] NOT NULL CHECK (cardinality(source_block_ids) > 0),
  source_block_types text[] NOT NULL CHECK (cardinality(source_block_types) > 0),
  source_text text NOT NULL CHECK (source_text <> ''),
  retrieval_text text NOT NULL CHECK (retrieval_text <> ''),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  source_char_count integer NOT NULL CHECK (source_char_count > 0),
  retrieval_char_count integer NOT NULL CHECK (retrieval_char_count > 0),
  locator jsonb NOT NULL,
  table_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT filing_chunk_document_chunk_unique
    UNIQUE (document_id, chunker_version, chunk_id),
  CONSTRAINT filing_chunk_document_ordinal_unique
    UNIQUE (document_id, chunker_version, ordinal),
  CONSTRAINT filing_chunk_section_fk FOREIGN KEY (document_id, section_id)
    REFERENCES filing_intelligence.filing_section(document_id, section_id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT filing_chunk_block_types_check CHECK (
    cardinality(source_block_types) > 0
    AND source_block_types <@ ARRAY['heading', 'paragraph', 'note', 'table']::text[]
  )
);

CREATE INDEX filing_document_symbol_filing_date_idx
  ON filing_intelligence.filing_document (symbol, filing_date DESC);
CREATE INDEX filing_document_corp_code_filing_date_idx
  ON filing_intelligence.filing_document (corp_code, filing_date DESC);
CREATE INDEX filing_section_parent_idx
  ON filing_intelligence.filing_section (document_id, parent_section_id);
CREATE INDEX filing_block_section_ordinal_idx
  ON filing_intelligence.filing_block (document_id, section_id, ordinal);
CREATE INDEX filing_chunk_section_ordinal_idx
  ON filing_intelligence.filing_chunk (document_id, section_id, ordinal);
CREATE INDEX filing_chunk_content_hash_idx
  ON filing_intelligence.filing_chunk (content_hash);

-- Down Migration

DROP TABLE filing_intelligence.filing_chunk;
DROP TABLE filing_intelligence.filing_block;
DROP TABLE filing_intelligence.filing_section;
DROP TABLE filing_intelligence.filing_document;
DROP SCHEMA filing_intelligence;
