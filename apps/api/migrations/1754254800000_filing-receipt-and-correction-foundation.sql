-- Up Migration

CREATE TABLE filing_intelligence.filing_receipt (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL CHECK (provider = 'opendart-fss'),
  receipt_number text NOT NULL CHECK (receipt_number ~ '^[0-9]{14}$'),
  corp_code text NOT NULL CHECK (corp_code ~ '^[0-9]{8}$'),
  symbol text NOT NULL CHECK (symbol ~ '^[0-9]{6}$'),
  company_name text,
  report_name text,
  report_code text,
  filing_date date,
  filer_name text,
  disclosure_category text,
  disclosure_detail_type text,
  correction_type text NOT NULL DEFAULT 'none'
    CHECK (correction_type IN (
      'none', 'content-correction', 'attachment-correction', 'attachment-added',
      'registration-changed', 'extension-decided', 'issuance-terms-finalized',
      'correction-order', 'correction-request', 'unknown'
    )),
  has_subsequent_correction boolean NOT NULL DEFAULT false,
  is_withdrawn boolean NOT NULL DEFAULT false,
  legal_status text NOT NULL DEFAULT 'unknown'
    CHECK (legal_status IN ('unknown', 'reported_active', 'withdrawn', 'cancelled')),
  lineage_status text NOT NULL DEFAULT 'unresolved'
    CHECK (lineage_status IN ('unresolved', 'resolved', 'conflicted', 'quarantined')),
  metadata_source text NOT NULL CHECK (metadata_source <> ''),
  metadata_observed_at timestamptz NOT NULL,
  provider_final_observed_at timestamptz,
  metadata_fingerprint text NOT NULL CHECK (metadata_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT filing_receipt_provider_number_unique UNIQUE (provider, receipt_number),
  CONSTRAINT filing_receipt_id_company_unique UNIQUE (id, provider, corp_code, symbol),
  CONSTRAINT filing_receipt_withdrawal_consistency CHECK (
    NOT is_withdrawn OR legal_status = 'withdrawn'
  )
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM filing_intelligence.filing_document AS candidate
    JOIN filing_intelligence.filing_document AS conflicting
      ON conflicting.provider = candidate.provider
     AND conflicting.receipt_number = candidate.receipt_number
     AND conflicting.id > candidate.id
    WHERE ROW(
      conflicting.corp_code, conflicting.symbol, conflicting.company_name,
      conflicting.report_name, conflicting.report_code, conflicting.filing_date
    ) IS DISTINCT FROM ROW(
      candidate.corp_code, candidate.symbol, candidate.company_name,
      candidate.report_name, candidate.report_code, candidate.filing_date
    )
  ) THEN
    RAISE EXCEPTION 'filing receipt identity conflict in existing filing_document data'
      USING ERRCODE = '23514';
  END IF;
END $$;

INSERT INTO filing_intelligence.filing_receipt (
  provider, receipt_number, corp_code, symbol, company_name, report_name,
  report_code, filing_date, correction_type, has_subsequent_correction,
  is_withdrawn, legal_status, lineage_status, metadata_source,
  metadata_observed_at, metadata_fingerprint
)
SELECT
  provider,
  receipt_number,
  corp_code,
  symbol,
  company_name,
  report_name,
  report_code,
  filing_date,
  'none',
  false,
  false,
  'unknown',
  'unresolved',
  'legacy-canonical-backfill',
  min(created_at),
  encode(sha256(convert_to(concat_ws(E'\x1f',
    'filing-receipt-legacy-v1', provider, receipt_number, corp_code, symbol,
    company_name, report_name, report_code, filing_date::text
  ), 'UTF8')), 'hex')
FROM filing_intelligence.filing_document
GROUP BY provider, receipt_number, corp_code, symbol, company_name,
  report_name, report_code, filing_date;

ALTER TABLE filing_intelligence.filing_document
  ADD COLUMN receipt_id bigint;

UPDATE filing_intelligence.filing_document AS document
SET receipt_id = receipt.id
FROM filing_intelligence.filing_receipt AS receipt
WHERE receipt.provider = document.provider
  AND receipt.receipt_number = document.receipt_number;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM filing_intelligence.filing_document WHERE receipt_id IS NULL
  ) THEN
    RAISE EXCEPTION 'filing_document receipt backfill is incomplete'
      USING ERRCODE = '23514';
  END IF;
END $$;

ALTER TABLE filing_intelligence.filing_document
  ALTER COLUMN receipt_id SET NOT NULL,
  ADD CONSTRAINT filing_document_receipt_fk
    FOREIGN KEY (receipt_id)
    REFERENCES filing_intelligence.filing_receipt(id) ON DELETE RESTRICT;

CREATE INDEX filing_document_receipt_id_idx
  ON filing_intelligence.filing_document (receipt_id);
CREATE INDEX filing_receipt_corp_date_idx
  ON filing_intelligence.filing_receipt (corp_code, filing_date DESC, id DESC);
CREATE INDEX filing_receipt_lineage_status_idx
  ON filing_intelligence.filing_receipt (lineage_status, id);

CREATE TABLE filing_intelligence.filing_report_family (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL CHECK (provider = 'opendart-fss'),
  corp_code text NOT NULL CHECK (corp_code ~ '^[0-9]{8}$'),
  symbol text NOT NULL CHECK (symbol ~ '^[0-9]{6}$'),
  lineage_root_receipt_id bigint NOT NULL,
  family_status text NOT NULL DEFAULT 'verified'
    CHECK (family_status IN ('verified', 'conflicted', 'quarantined')),
  verification_source text NOT NULL
    CHECK (verification_source IN ('provider_authoritative', 'trusted_backfill', 'manual_verified')),
  verification_reference_hash text NOT NULL
    CHECK (verification_reference_hash ~ '^[0-9a-f]{64}$'),
  family_fingerprint text NOT NULL CHECK (family_fingerprint ~ '^[0-9a-f]{64}$'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT filing_report_family_identity_unique
    UNIQUE (provider, corp_code, lineage_root_receipt_id),
  CONSTRAINT filing_report_family_id_company_unique
    UNIQUE (id, provider, corp_code, symbol),
  CONSTRAINT filing_report_family_root_fk
    FOREIGN KEY (lineage_root_receipt_id, provider, corp_code, symbol)
    REFERENCES filing_intelligence.filing_receipt(id, provider, corp_code, symbol)
    ON DELETE RESTRICT
);

CREATE TABLE filing_intelligence.filing_report_family_member (
  family_id bigint NOT NULL,
  receipt_id bigint NOT NULL,
  provider text NOT NULL,
  corp_code text NOT NULL,
  symbol text NOT NULL,
  member_role text NOT NULL CHECK (member_role IN ('root', 'correction')),
  membership_source text NOT NULL
    CHECK (membership_source IN ('provider_authoritative', 'trusted_backfill', 'manual_verified')),
  membership_fingerprint text NOT NULL CHECK (membership_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (family_id, receipt_id),
  CONSTRAINT filing_report_family_member_receipt_unique UNIQUE (receipt_id),
  CONSTRAINT filing_report_family_member_family_company_fk
    FOREIGN KEY (family_id, provider, corp_code, symbol)
    REFERENCES filing_intelligence.filing_report_family(id, provider, corp_code, symbol)
    ON DELETE CASCADE,
  CONSTRAINT filing_report_family_member_receipt_company_fk
    FOREIGN KEY (receipt_id, provider, corp_code, symbol)
    REFERENCES filing_intelligence.filing_receipt(id, provider, corp_code, symbol)
    ON DELETE RESTRICT
);

CREATE TABLE filing_intelligence.filing_correction_relation (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id bigint NOT NULL,
  correction_receipt_id bigint NOT NULL,
  corrects_receipt_id bigint NOT NULL,
  relation_type text NOT NULL CHECK (relation_type = 'corrects'),
  relation_source text NOT NULL
    CHECK (relation_source IN ('provider_authoritative', 'trusted_backfill', 'manual_verified')),
  verification_reference_hash text NOT NULL
    CHECK (verification_reference_hash ~ '^[0-9a-f]{64}$'),
  relation_fingerprint text NOT NULL CHECK (relation_fingerprint ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT filing_correction_relation_edge_unique
    UNIQUE (family_id, correction_receipt_id, corrects_receipt_id, relation_type),
  CONSTRAINT filing_correction_relation_predecessor_unique
    UNIQUE (family_id, correction_receipt_id, relation_type),
  CONSTRAINT filing_correction_relation_self_check
    CHECK (correction_receipt_id <> corrects_receipt_id),
  CONSTRAINT filing_correction_relation_correction_member_fk
    FOREIGN KEY (family_id, correction_receipt_id)
    REFERENCES filing_intelligence.filing_report_family_member(family_id, receipt_id)
    ON DELETE CASCADE,
  CONSTRAINT filing_correction_relation_corrected_member_fk
    FOREIGN KEY (family_id, corrects_receipt_id)
    REFERENCES filing_intelligence.filing_report_family_member(family_id, receipt_id)
    ON DELETE CASCADE
);

CREATE INDEX filing_correction_relation_correction_idx
  ON filing_intelligence.filing_correction_relation (correction_receipt_id, family_id);
CREATE INDEX filing_correction_relation_corrected_idx
  ON filing_intelligence.filing_correction_relation (corrects_receipt_id, family_id);

-- Down Migration

DROP TABLE filing_intelligence.filing_correction_relation;
DROP TABLE filing_intelligence.filing_report_family_member;
DROP TABLE filing_intelligence.filing_report_family;
DROP INDEX filing_intelligence.filing_document_receipt_id_idx;
ALTER TABLE filing_intelligence.filing_document
  DROP CONSTRAINT filing_document_receipt_fk,
  DROP COLUMN receipt_id;
DROP TABLE filing_intelligence.filing_receipt;
