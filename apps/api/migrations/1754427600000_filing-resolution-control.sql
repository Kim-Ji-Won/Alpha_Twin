-- Up Migration

CREATE TABLE filing_intelligence.filing_family_resolution_control (
  family_id bigint PRIMARY KEY
    REFERENCES filing_intelligence.filing_report_family(id) ON DELETE RESTRICT,
  mode text NOT NULL CHECK (mode IN ('automatic', 'hold', 'select')),
  selected_receipt_id bigint,
  reason_code text NOT NULL CHECK (reason_code IN (
    'lineage_ambiguous', 'missing_authoritative_relation', 'legal_status_review',
    'emergency_hold', 'manual_verified_selection', 'rollback_candidate',
    'data_integrity_review', 'control_cleared'
  )),
  reference_hash text NOT NULL CHECK (reference_hash ~ '^[0-9a-f]{64}$'),
  actor_reference_hash text CHECK (
    actor_reference_hash IS NULL OR actor_reference_hash ~ '^[0-9a-f]{64}$'
  ),
  expires_at timestamptz,
  revision bigint NOT NULL CHECK (revision > 0),
  control_fingerprint text NOT NULL CHECK (control_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT filing_family_resolution_control_state_check CHECK (
    (mode = 'automatic' AND selected_receipt_id IS NULL AND expires_at IS NULL)
    OR (mode = 'hold' AND selected_receipt_id IS NULL)
    OR (mode = 'select' AND selected_receipt_id IS NOT NULL)
  ),
  CONSTRAINT filing_family_resolution_control_selected_member_fk
    FOREIGN KEY (family_id, selected_receipt_id)
    REFERENCES filing_intelligence.filing_report_family_member(family_id, receipt_id)
    ON DELETE RESTRICT
);

CREATE TABLE filing_intelligence.filing_family_resolution_control_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id bigint NOT NULL
    REFERENCES filing_intelligence.filing_report_family(id) ON DELETE RESTRICT,
  control_revision bigint NOT NULL CHECK (control_revision > 0),
  action text NOT NULL CHECK (action IN ('hold', 'select', 'clear')),
  resulting_mode text NOT NULL CHECK (resulting_mode IN ('automatic', 'hold', 'select')),
  selected_receipt_id bigint,
  reason_code text NOT NULL CHECK (reason_code IN (
    'lineage_ambiguous', 'missing_authoritative_relation', 'legal_status_review',
    'emergency_hold', 'manual_verified_selection', 'rollback_candidate',
    'data_integrity_review', 'control_cleared'
  )),
  reference_hash text NOT NULL CHECK (reference_hash ~ '^[0-9a-f]{64}$'),
  actor_reference_hash text CHECK (
    actor_reference_hash IS NULL OR actor_reference_hash ~ '^[0-9a-f]{64}$'
  ),
  expires_at timestamptz,
  control_fingerprint text NOT NULL CHECK (control_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT filing_family_resolution_control_history_revision_unique
    UNIQUE (family_id, control_revision),
  CONSTRAINT filing_family_resolution_control_history_state_check CHECK (
    (action = 'clear' AND resulting_mode = 'automatic'
      AND selected_receipt_id IS NULL AND expires_at IS NULL)
    OR (action = 'hold' AND resulting_mode = 'hold' AND selected_receipt_id IS NULL)
    OR (action = 'select' AND resulting_mode = 'select' AND selected_receipt_id IS NOT NULL)
  ),
  CONSTRAINT filing_family_resolution_control_history_selected_member_fk
    FOREIGN KEY (family_id, selected_receipt_id)
    REFERENCES filing_intelligence.filing_report_family_member(family_id, receipt_id)
    ON DELETE RESTRICT
);

CREATE INDEX filing_family_resolution_control_history_created_idx
  ON filing_intelligence.filing_family_resolution_control_history
  (family_id, created_at DESC, id DESC);

-- Down Migration

DROP TABLE filing_intelligence.filing_family_resolution_control_history;
DROP TABLE filing_intelligence.filing_family_resolution_control;
