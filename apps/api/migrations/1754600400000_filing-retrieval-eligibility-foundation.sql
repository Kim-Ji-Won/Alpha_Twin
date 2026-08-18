-- Up Migration

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM filing_intelligence.filing_document
    GROUP BY provider, receipt_number, source_entry_hash, canonical_schema_name,
      canonical_schema_version, parser_version, chunk_schema_version, chunker_version
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'conflicting expanded filing representation identities exist'
      USING ERRCODE = '23514';
  END IF;
END $$;

ALTER TABLE filing_intelligence.filing_document
  DROP CONSTRAINT filing_document_source_identity_unique,
  ADD CONSTRAINT filing_document_source_identity_unique UNIQUE (
    provider,
    receipt_number,
    source_entry_hash,
    canonical_schema_name,
    canonical_schema_version,
    parser_version,
    chunk_schema_version,
    chunker_version
  ),
  ADD CONSTRAINT filing_document_id_receipt_unique UNIQUE (id, receipt_id);

CREATE FUNCTION filing_intelligence.compute_filing_representation_manifest(
  requested_document_id bigint
)
RETURNS TABLE (
  section_manifest_fingerprint text,
  block_manifest_fingerprint text,
  chunk_manifest_fingerprint text,
  representation_fingerprint text
)
LANGUAGE sql
STABLE
STRICT
AS $$
  WITH document AS (
    SELECT id, receipt_id, provider, receipt_number, source_entry_hash,
           canonical_schema_name, canonical_schema_version, parser_version,
           chunk_schema_version, chunker_version, canonical_fingerprint,
           chunk_fingerprint, section_count, block_count, chunk_count
    FROM filing_intelligence.filing_document
    WHERE id = requested_document_id
  ),
  section_manifest AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'blockIds', to_jsonb(section.block_ids),
      'depth', section.depth,
      'ordinal', section.ordinal,
      'parentSectionId', section.parent_section_id,
      'path', to_jsonb(section.path),
      'sectionId', section.section_id,
      'title', section.title
    ) ORDER BY section.ordinal, section.section_id), '[]'::jsonb) AS value
    FROM filing_intelligence.filing_section AS section
    WHERE section.document_id = requested_document_id
  ),
  block_manifest AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'blockId', block.block_id,
      'contentHash', block.content_hash,
      'ordinal', block.ordinal,
      'sectionId', block.section_id,
      'sectionPath', to_jsonb(block.section_path),
      'type', block.block_type
    ) ORDER BY block.ordinal, block.block_id), '[]'::jsonb) AS value
    FROM filing_intelligence.filing_block AS block
    WHERE block.document_id = requested_document_id
  ),
  chunk_manifest AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'chunkId', chunk.chunk_id,
      'chunkerVersion', chunk.chunker_version,
      'contentHash', chunk.content_hash,
      'ordinal', chunk.ordinal,
      'parserVersion', chunk.parser_version,
      'schemaVersion', chunk.chunk_schema_version,
      'sectionId', chunk.section_id,
      'sectionPath', to_jsonb(chunk.section_path),
      'sourceBlockIds', to_jsonb(chunk.source_block_ids),
      'sourceBlockTypes', to_jsonb(chunk.source_block_types),
      'sourceCharCount', chunk.source_char_count,
      'retrievalCharCount', chunk.retrieval_char_count,
      'tableId', chunk.table_id
    ) ORDER BY chunk.ordinal, chunk.chunk_id), '[]'::jsonb) AS value
    FROM filing_intelligence.filing_chunk AS chunk
    WHERE chunk.document_id = requested_document_id
  ),
  fingerprints AS (
    SELECT
      encode(sha256(convert_to(section_manifest.value::text, 'UTF8')), 'hex') AS section_hash,
      encode(sha256(convert_to(block_manifest.value::text, 'UTF8')), 'hex') AS block_hash,
      encode(sha256(convert_to(chunk_manifest.value::text, 'UTF8')), 'hex') AS chunk_hash
    FROM section_manifest, block_manifest, chunk_manifest
  )
  SELECT
    fingerprints.section_hash,
    fingerprints.block_hash,
    fingerprints.chunk_hash,
    encode(sha256(convert_to(jsonb_build_object(
      'blockCount', document.block_count,
      'blockManifestFingerprint', fingerprints.block_hash,
      'canonicalFingerprint', document.canonical_fingerprint,
      'canonicalSchemaName', document.canonical_schema_name,
      'canonicalSchemaVersion', document.canonical_schema_version,
      'chunkCount', document.chunk_count,
      'chunkFingerprint', document.chunk_fingerprint,
      'chunkManifestFingerprint', fingerprints.chunk_hash,
      'chunkSchemaVersion', document.chunk_schema_version,
      'chunkerVersion', document.chunker_version,
      'documentId', document.id::text,
      'manifestVersion', 'filing-representation-manifest@1',
      'parserVersion', document.parser_version,
      'provider', document.provider,
      'receiptId', document.receipt_id::text,
      'receiptNumber', document.receipt_number,
      'sectionCount', document.section_count,
      'sectionManifestFingerprint', fingerprints.section_hash,
      'sourceEntryHash', document.source_entry_hash
    )::text, 'UTF8')), 'hex')
  FROM document, fingerprints;
$$;

CREATE TABLE filing_intelligence.filing_document_representation_manifest (
  document_id bigint PRIMARY KEY
    REFERENCES filing_intelligence.filing_document(id) ON DELETE CASCADE,
  representation_manifest_version text NOT NULL,
  section_manifest_fingerprint text NOT NULL,
  block_manifest_fingerprint text NOT NULL,
  chunk_manifest_fingerprint text NOT NULL,
  representation_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT filing_document_manifest_version_check
    CHECK (representation_manifest_version = 'filing-representation-manifest@1'),
  CONSTRAINT filing_document_section_manifest_hash_check
    CHECK (section_manifest_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT filing_document_block_manifest_hash_check
    CHECK (block_manifest_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT filing_document_chunk_manifest_hash_check
    CHECK (chunk_manifest_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT filing_document_representation_hash_check
    CHECK (representation_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT filing_document_manifest_document_fingerprint_unique
    UNIQUE (document_id, representation_fingerprint)
);

INSERT INTO filing_intelligence.filing_document_representation_manifest (
  document_id, representation_manifest_version, section_manifest_fingerprint,
  block_manifest_fingerprint, chunk_manifest_fingerprint,
  representation_fingerprint
)
SELECT document.id, 'filing-representation-manifest@1',
       manifest.section_manifest_fingerprint,
       manifest.block_manifest_fingerprint,
       manifest.chunk_manifest_fingerprint,
       manifest.representation_fingerprint
FROM filing_intelligence.filing_document AS document
CROSS JOIN LATERAL
  filing_intelligence.compute_filing_representation_manifest(document.id) AS manifest;

CREATE TABLE filing_intelligence.filing_retrieval_eligibility (
  document_id bigint NOT NULL,
  receipt_id bigint NOT NULL,
  retrieval_policy_id text NOT NULL CHECK (retrieval_policy_id <> ''),
  retrieval_policy_fingerprint text NOT NULL
    CHECK (retrieval_policy_fingerprint ~ '^[0-9a-f]{64}$'),
  representation_policy_id text NOT NULL CHECK (representation_policy_id <> ''),
  representation_policy_fingerprint text NOT NULL
    CHECK (representation_policy_fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('eligible', 'ineligible')),
  reason_code text NOT NULL CHECK (reason_code IN (
    'eligible',
    'representation_policy_mismatch',
    'receipt_quarantined',
    'lexical_generation_missing',
    'lexical_generation_not_ready'
  )),
  representation_fingerprint text NOT NULL
    CHECK (representation_fingerprint ~ '^[0-9a-f]{64}$'),
  lexical_generation_id bigint,
  lexical_profile_id text,
  lexical_schema_version text,
  lexical_normalizer_version text,
  lexical_text_search_config text,
  lexical_generation_fingerprint text
    CHECK (lexical_generation_fingerprint IS NULL
      OR lexical_generation_fingerprint ~ '^[0-9a-f]{64}$'),
  lexical_chunk_count integer CHECK (lexical_chunk_count IS NULL OR lexical_chunk_count >= 0),
  lexical_total_lexeme_count integer
    CHECK (lexical_total_lexeme_count IS NULL OR lexical_total_lexeme_count >= 0),
  eligibility_fingerprint text NOT NULL
    CHECK (eligibility_fingerprint ~ '^[0-9a-f]{64}$'),
  revision bigint NOT NULL CHECK (revision > 0),
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (document_id, retrieval_policy_id),
  CONSTRAINT filing_retrieval_eligibility_document_receipt_fk
    FOREIGN KEY (document_id, receipt_id)
    REFERENCES filing_intelligence.filing_document(id, receipt_id)
    ON DELETE RESTRICT,
  CONSTRAINT filing_retrieval_eligibility_generation_document_fk
    FOREIGN KEY (lexical_generation_id, document_id)
    REFERENCES filing_intelligence.filing_lexical_generation(id, document_id)
    ON DELETE RESTRICT,
  CONSTRAINT filing_retrieval_eligibility_manifest_fk
    FOREIGN KEY (document_id, representation_fingerprint)
    REFERENCES filing_intelligence.filing_document_representation_manifest(
      document_id, representation_fingerprint
    )
    ON DELETE RESTRICT,
  CONSTRAINT filing_retrieval_eligibility_ready_consistency CHECK (
    (status = 'eligible' AND reason_code = 'eligible'
      AND lexical_generation_id IS NOT NULL
      AND lexical_profile_id IS NOT NULL
      AND lexical_schema_version IS NOT NULL
      AND lexical_normalizer_version IS NOT NULL
      AND lexical_text_search_config IS NOT NULL
      AND lexical_generation_fingerprint IS NOT NULL
      AND lexical_chunk_count IS NOT NULL
      AND lexical_total_lexeme_count IS NOT NULL)
    OR (status = 'ineligible' AND reason_code <> 'eligible')
  )
);

CREATE INDEX filing_retrieval_eligibility_policy_status_idx
  ON filing_intelligence.filing_retrieval_eligibility
  (retrieval_policy_id, status, document_id);
CREATE INDEX filing_retrieval_eligibility_receipt_policy_idx
  ON filing_intelligence.filing_retrieval_eligibility
  (receipt_id, retrieval_policy_id, status, document_id);
CREATE INDEX filing_retrieval_eligibility_generation_idx
  ON filing_intelligence.filing_retrieval_eligibility (lexical_generation_id)
  WHERE lexical_generation_id IS NOT NULL;

-- Down Migration

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM filing_intelligence.filing_document
    GROUP BY provider, receipt_number, source_entry_hash, canonical_schema_name,
      canonical_schema_version, parser_version
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'versioned filing representations prevent safe migration downgrade'
      USING ERRCODE = '23514';
  END IF;
END $$;

DROP TABLE filing_intelligence.filing_retrieval_eligibility;
DROP TABLE filing_intelligence.filing_document_representation_manifest;

ALTER TABLE filing_intelligence.filing_document
  DROP CONSTRAINT filing_document_source_identity_unique,
  DROP CONSTRAINT filing_document_id_receipt_unique,
  ADD CONSTRAINT filing_document_source_identity_unique UNIQUE (
    provider,
    receipt_number,
    source_entry_hash,
    canonical_schema_name,
    canonical_schema_version,
    parser_version
  );

DROP FUNCTION filing_intelligence.compute_filing_representation_manifest(bigint);
