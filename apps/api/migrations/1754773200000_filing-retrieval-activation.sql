-- Up Migration

CREATE TABLE filing_intelligence.filing_retrieval_activation (
  family_id bigint NOT NULL
    REFERENCES filing_intelligence.filing_report_family(id) ON DELETE RESTRICT,
  retrieval_policy_id text NOT NULL CHECK (retrieval_policy_id <> ''),
  retrieval_policy_fingerprint text NOT NULL
    CHECK (retrieval_policy_fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('active', 'inactive')),
  receipt_id bigint,
  document_id bigint,
  family_revision bigint NOT NULL CHECK (family_revision > 0),
  family_fingerprint text NOT NULL CHECK (family_fingerprint ~ '^[0-9a-f]{64}$'),
  resolution_fingerprint text NOT NULL CHECK (resolution_fingerprint ~ '^[0-9a-f]{64}$'),
  resolver_id text NOT NULL CHECK (resolver_id <> ''),
  resolver_version text NOT NULL CHECK (resolver_version <> ''),
  manual_control_revision bigint CHECK (manual_control_revision IS NULL OR manual_control_revision > 0),
  selection_mode text NOT NULL CHECK (selection_mode IN ('automatic', 'manual', 'none')),
  eligibility_revision bigint CHECK (eligibility_revision IS NULL OR eligibility_revision > 0),
  eligibility_fingerprint text
    CHECK (eligibility_fingerprint IS NULL OR eligibility_fingerprint ~ '^[0-9a-f]{64}$'),
  representation_policy_id text,
  representation_policy_fingerprint text
    CHECK (representation_policy_fingerprint IS NULL
      OR representation_policy_fingerprint ~ '^[0-9a-f]{64}$'),
  representation_fingerprint text
    CHECK (representation_fingerprint IS NULL OR representation_fingerprint ~ '^[0-9a-f]{64}$'),
  lexical_generation_id bigint,
  lexical_generation_fingerprint text
    CHECK (lexical_generation_fingerprint IS NULL
      OR lexical_generation_fingerprint ~ '^[0-9a-f]{64}$'),
  activation_revision bigint NOT NULL CHECK (activation_revision > 0),
  activation_fingerprint text NOT NULL CHECK (activation_fingerprint ~ '^[0-9a-f]{64}$'),
  activated_at timestamptz,
  state_changed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (family_id, retrieval_policy_id),
  CONSTRAINT filing_retrieval_activation_family_receipt_fk
    FOREIGN KEY (family_id, receipt_id)
    REFERENCES filing_intelligence.filing_report_family_member(family_id, receipt_id)
    ON DELETE RESTRICT,
  CONSTRAINT filing_retrieval_activation_document_receipt_fk
    FOREIGN KEY (document_id, receipt_id)
    REFERENCES filing_intelligence.filing_document(id, receipt_id)
    ON DELETE RESTRICT,
  CONSTRAINT filing_retrieval_activation_eligibility_fk
    FOREIGN KEY (document_id, retrieval_policy_id)
    REFERENCES filing_intelligence.filing_retrieval_eligibility(document_id, retrieval_policy_id)
    ON DELETE RESTRICT,
  CONSTRAINT filing_retrieval_activation_state_check CHECK (
    (status = 'active'
      AND receipt_id IS NOT NULL AND document_id IS NOT NULL
      AND eligibility_revision IS NOT NULL AND eligibility_fingerprint IS NOT NULL
      AND representation_policy_id IS NOT NULL
      AND representation_policy_fingerprint IS NOT NULL
      AND representation_fingerprint IS NOT NULL
      AND lexical_generation_id IS NOT NULL AND lexical_generation_fingerprint IS NOT NULL
      AND activated_at IS NOT NULL AND selection_mode IN ('automatic', 'manual'))
    OR
    (status = 'inactive'
      AND receipt_id IS NULL AND document_id IS NULL
      AND eligibility_revision IS NULL AND eligibility_fingerprint IS NULL
      AND representation_policy_id IS NULL
      AND representation_policy_fingerprint IS NULL
      AND representation_fingerprint IS NULL
      AND lexical_generation_id IS NULL AND lexical_generation_fingerprint IS NULL
      AND activated_at IS NULL AND selection_mode = 'none')
  )
);

CREATE INDEX filing_retrieval_activation_active_document_idx
  ON filing_intelligence.filing_retrieval_activation (retrieval_policy_id, document_id)
  WHERE status = 'active';

CREATE TABLE filing_intelligence.filing_retrieval_activation_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id bigint NOT NULL
    REFERENCES filing_intelligence.filing_report_family(id) ON DELETE RESTRICT,
  retrieval_policy_id text NOT NULL CHECK (retrieval_policy_id <> ''),
  activation_revision bigint NOT NULL CHECK (activation_revision > 0),
  event_type text NOT NULL CHECK (event_type IN ('activate', 'switch', 'deactivate', 'refresh')),
  previous_receipt_id bigint,
  previous_document_id bigint,
  new_receipt_id bigint,
  new_document_id bigint,
  family_revision bigint NOT NULL CHECK (family_revision > 0),
  family_fingerprint text NOT NULL CHECK (family_fingerprint ~ '^[0-9a-f]{64}$'),
  resolution_fingerprint text NOT NULL CHECK (resolution_fingerprint ~ '^[0-9a-f]{64}$'),
  resolver_id text NOT NULL CHECK (resolver_id <> ''),
  resolver_version text NOT NULL CHECK (resolver_version <> ''),
  manual_control_revision bigint CHECK (manual_control_revision IS NULL OR manual_control_revision > 0),
  selection_mode text NOT NULL CHECK (selection_mode IN ('automatic', 'manual', 'none')),
  eligibility_revision bigint CHECK (eligibility_revision IS NULL OR eligibility_revision > 0),
  eligibility_fingerprint text
    CHECK (eligibility_fingerprint IS NULL OR eligibility_fingerprint ~ '^[0-9a-f]{64}$'),
  representation_policy_id text,
  representation_policy_fingerprint text
    CHECK (representation_policy_fingerprint IS NULL
      OR representation_policy_fingerprint ~ '^[0-9a-f]{64}$'),
  representation_fingerprint text
    CHECK (representation_fingerprint IS NULL OR representation_fingerprint ~ '^[0-9a-f]{64}$'),
  lexical_generation_id bigint,
  lexical_generation_fingerprint text
    CHECK (lexical_generation_fingerprint IS NULL
      OR lexical_generation_fingerprint ~ '^[0-9a-f]{64}$'),
  reason_code text NOT NULL CHECK (reason_code IN (
    'initial_activation', 'automatic_resolution', 'manual_selection',
    'manual_hold', 'terminal_legally_ineligible', 'representation_refresh',
    'eligibility_refresh'
  )),
  activation_fingerprint text NOT NULL CHECK (activation_fingerprint ~ '^[0-9a-f]{64}$'),
  event_fingerprint text NOT NULL CHECK (event_fingerprint ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT filing_retrieval_activation_history_revision_unique
    UNIQUE (family_id, retrieval_policy_id, activation_revision),
  CONSTRAINT filing_retrieval_activation_history_previous_receipt_fk
    FOREIGN KEY (family_id, previous_receipt_id)
    REFERENCES filing_intelligence.filing_report_family_member(family_id, receipt_id)
    ON DELETE RESTRICT,
  CONSTRAINT filing_retrieval_activation_history_new_receipt_fk
    FOREIGN KEY (family_id, new_receipt_id)
    REFERENCES filing_intelligence.filing_report_family_member(family_id, receipt_id)
    ON DELETE RESTRICT,
  CONSTRAINT filing_retrieval_activation_history_previous_document_fk
    FOREIGN KEY (previous_document_id, previous_receipt_id)
    REFERENCES filing_intelligence.filing_document(id, receipt_id)
    ON DELETE RESTRICT,
  CONSTRAINT filing_retrieval_activation_history_new_document_fk
    FOREIGN KEY (new_document_id, new_receipt_id)
    REFERENCES filing_intelligence.filing_document(id, receipt_id)
    ON DELETE RESTRICT,
  CONSTRAINT filing_retrieval_activation_history_target_pairs_check CHECK (
    (previous_receipt_id IS NULL) = (previous_document_id IS NULL)
    AND (new_receipt_id IS NULL) = (new_document_id IS NULL)
  )
);

CREATE INDEX filing_retrieval_activation_history_timeline_idx
  ON filing_intelligence.filing_retrieval_activation_history
  (family_id, retrieval_policy_id, occurred_at DESC);

-- Down Migration

DROP TABLE filing_intelligence.filing_retrieval_activation_history;
DROP TABLE filing_intelligence.filing_retrieval_activation;
