-- Up Migration

-- Reuse the committed provenance predicate, but require TRUE rather than UNKNOWN.
DO $$
DECLARE
  provenance_predicate text;
  invalid_rows boolean;
BEGIN
  SELECT pg_get_expr(conbin, conrelid) INTO STRICT provenance_predicate
  FROM pg_constraint
  WHERE conrelid = 'filing_intelligence.filing_document'::regclass
    AND conname = 'filing_document_decoding_provenance_check';
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM filing_intelligence.filing_document
    WHERE (%s) IS NOT TRUE)', provenance_predicate) INTO invalid_rows;
  IF invalid_rows THEN
    RAISE EXCEPTION 'invalid existing filing decoding provenance' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM filing_intelligence.filing_retrieval_eligibility
    WHERE representation_policy_id IS NULL OR representation_policy_fingerprint IS NULL) THEN
    RAISE EXCEPTION 'invalid existing eligibility policy pair' USING ERRCODE = '23514';
  END IF;
  EXECUTE format('ALTER TABLE filing_intelligence.filing_document
    ADD CONSTRAINT filing_document_decoding_provenance_strict_check CHECK ((%s) IS TRUE)',
    provenance_predicate);
END $$;

ALTER TABLE filing_intelligence.filing_retrieval_eligibility
  ALTER COLUMN representation_policy_id DROP NOT NULL,
  ALTER COLUMN representation_policy_fingerprint DROP NOT NULL,
  ADD CONSTRAINT filing_eligibility_matched_pair_check CHECK ((
    (representation_policy_id IS NOT NULL AND representation_policy_fingerprint IS NOT NULL)
    OR
    (representation_policy_id IS NULL AND representation_policy_fingerprint IS NULL
      AND retrieval_policy_id = 'filing-retrieval-lexical-v2'
      AND status = 'ineligible' AND reason_code = 'representation_policy_mismatch')
  ) IS TRUE);

-- Down Migration

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM filing_intelligence.filing_retrieval_eligibility
    WHERE representation_policy_id IS NULL OR representation_policy_fingerprint IS NULL) THEN
    RAISE EXCEPTION 'unmatched policy results prevent safe downgrade' USING ERRCODE = '23514';
  END IF;
END $$;

ALTER TABLE filing_intelligence.filing_retrieval_eligibility
  ALTER COLUMN representation_policy_id SET NOT NULL,
  ALTER COLUMN representation_policy_fingerprint SET NOT NULL,
  DROP CONSTRAINT filing_eligibility_matched_pair_check;

ALTER TABLE filing_intelligence.filing_document
  DROP CONSTRAINT filing_document_decoding_provenance_strict_check;
