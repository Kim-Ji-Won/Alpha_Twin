-- Up Migration

ALTER TABLE filing_intelligence.filing_document
  DROP CONSTRAINT filing_document_source_identity_unique,
  ADD COLUMN decoding_profile_id text,
  ADD COLUMN decoding_profile_fingerprint text,
  ADD COLUMN source_declared_encoding text,
  ADD COLUMN source_bom_kind text,
  ADD COLUMN source_utf8_validity text,
  ADD COLUMN canonical_utf8_hash text,
  ADD COLUMN decoder_runtime_label text,
  ADD COLUMN decoding_compatibility_reason text,
  ADD CONSTRAINT filing_document_decoding_provenance_check CHECK (
    (decoding_profile_id IS NULL
      AND decoding_profile_fingerprint IS NULL
      AND source_declared_encoding IS NULL
      AND source_bom_kind IS NULL
      AND source_utf8_validity IS NULL
      AND canonical_utf8_hash IS NULL
      AND decoder_runtime_label IS NULL
      AND decoding_compatibility_reason IS NULL)
    OR
    (decoding_profile_id = 'opendart-korean-legacy-compatible-v1'
      AND decoding_profile_fingerprint ~ '^[0-9a-f]{64}$'
      AND source_declared_encoding IN ('utf-8', 'utf8')
      AND source_bom_kind = 'none'
      AND source_utf8_validity = 'invalid'
      AND canonical_utf8_hash ~ '^[0-9a-f]{64}$'
      AND decoder_runtime_label = 'node-whatwg-textdecoder:euc-kr'
      AND decoding_compatibility_reason = 'declaration-actual-byte-mismatch')
  ),
  ADD CONSTRAINT filing_document_source_identity_unique UNIQUE NULLS NOT DISTINCT (
    provider,
    receipt_number,
    source_entry_hash,
    canonical_schema_name,
    canonical_schema_version,
    parser_version,
    chunk_schema_version,
    chunker_version,
    decoding_profile_id,
    decoding_profile_fingerprint,
    canonical_utf8_hash
  );

-- Down Migration

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM filing_intelligence.filing_document
    WHERE decoding_profile_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'legacy filing representations must be removed before downgrade'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM filing_intelligence.filing_document
    GROUP BY provider, receipt_number, source_entry_hash, canonical_schema_name,
      canonical_schema_version, parser_version, chunk_schema_version, chunker_version
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'legacy and UTF-8 filing representations must be reconciled before downgrade'
      USING ERRCODE = '23514';
  END IF;
END $$;

ALTER TABLE filing_intelligence.filing_document
  DROP CONSTRAINT filing_document_source_identity_unique,
  DROP CONSTRAINT filing_document_decoding_provenance_check,
  DROP COLUMN decoding_profile_id,
  DROP COLUMN decoding_profile_fingerprint,
  DROP COLUMN source_declared_encoding,
  DROP COLUMN source_bom_kind,
  DROP COLUMN source_utf8_validity,
  DROP COLUMN canonical_utf8_hash,
  DROP COLUMN decoder_runtime_label,
  DROP COLUMN decoding_compatibility_reason,
  ADD CONSTRAINT filing_document_source_identity_unique UNIQUE (
    provider,
    receipt_number,
    source_entry_hash,
    canonical_schema_name,
    canonical_schema_version,
    parser_version,
    chunk_schema_version,
    chunker_version
  );
