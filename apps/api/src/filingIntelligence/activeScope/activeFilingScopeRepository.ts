import { Pool } from 'pg';

export interface ActiveScopeEvidenceRow {
  readonly database_now: Date;
  readonly family_id: string | null;
  readonly family_provider: string | null;
  readonly family_corp_code: string | null;
  readonly family_symbol: string | null;
  readonly lineage_root_receipt_number: string | null;
  readonly activation_policy_id: string | null;
  readonly activation_policy_fingerprint: string | null;
  readonly activation_status: string | null;
  readonly activation_receipt_id: string | null;
  readonly activation_document_id: string | null;
  readonly activation_family_revision: string | null;
  readonly activation_family_fingerprint: string | null;
  readonly activation_resolution_fingerprint: string | null;
  readonly activation_resolver_id: string | null;
  readonly activation_resolver_version: string | null;
  readonly activation_manual_control_revision: string | null;
  readonly activation_selection_mode: string | null;
  readonly activation_eligibility_revision: string | null;
  readonly activation_eligibility_fingerprint: string | null;
  readonly activation_representation_policy_id: string | null;
  readonly activation_representation_policy_fingerprint: string | null;
  readonly activation_representation_fingerprint: string | null;
  readonly activation_lexical_generation_id: string | null;
  readonly activation_lexical_generation_fingerprint: string | null;
  readonly activation_revision: string | null;
  readonly activation_fingerprint: string | null;
  readonly activation_activated_at: Date | null;
  readonly member_family_id: string | null;
  readonly member_receipt_id: string | null;
  readonly receipt_id: string | null;
  readonly receipt_provider: string | null;
  readonly receipt_number: string | null;
  readonly receipt_corp_code: string | null;
  readonly receipt_symbol: string | null;
  readonly receipt_legal_status: string | null;
  readonly receipt_metadata_fingerprint: string | null;
  readonly document_id: string | null;
  readonly document_receipt_id: string | null;
  readonly document_provider: string | null;
  readonly document_corp_code: string | null;
  readonly document_symbol: string | null;
  readonly eligibility_document_id: string | null;
  readonly eligibility_receipt_id: string | null;
  readonly eligibility_policy_id: string | null;
  readonly eligibility_policy_fingerprint: string | null;
  readonly eligibility_representation_policy_id: string | null;
  readonly eligibility_representation_policy_fingerprint: string | null;
  readonly eligibility_status: string | null;
  readonly eligibility_representation_fingerprint: string | null;
  readonly eligibility_fingerprint: string | null;
  readonly eligibility_lexical_generation_id: string | null;
  readonly eligibility_lexical_profile_id: string | null;
  readonly eligibility_lexical_schema_version: string | null;
  readonly eligibility_lexical_normalizer_version: string | null;
  readonly eligibility_lexical_text_search_config: string | null;
  readonly eligibility_lexical_generation_fingerprint: string | null;
  readonly eligibility_lexical_chunk_count: number | null;
  readonly eligibility_lexical_total_lexeme_count: number | null;
  readonly eligibility_revision: string | null;
  readonly manifest_document_id: string | null;
  readonly manifest_version: string | null;
  readonly manifest_representation_fingerprint: string | null;
  readonly generation_id: string | null;
  readonly generation_document_id: string | null;
  readonly generation_profile_id: string | null;
  readonly generation_schema_version: string | null;
  readonly generation_normalizer_version: string | null;
  readonly generation_text_search_config: string | null;
  readonly generation_status: string | null;
  readonly generation_chunk_count: number | null;
  readonly generation_fingerprint: string | null;
  readonly generation_total_lexeme_count: number | null;
  readonly control_mode: string | null;
  readonly control_selected_receipt_id: string | null;
  readonly control_reason_code: string | null;
  readonly control_reference_hash: string | null;
  readonly control_actor_reference_hash: string | null;
  readonly control_expires_at: Date | null;
  readonly control_revision: string | null;
  readonly control_fingerprint: string | null;
}

const ACTIVATION_FIELDS = `
  activation.retrieval_policy_id AS activation_policy_id,
  activation.retrieval_policy_fingerprint AS activation_policy_fingerprint,
  activation.status AS activation_status,
  activation.receipt_id::text AS activation_receipt_id,
  activation.document_id::text AS activation_document_id,
  activation.family_revision::text AS activation_family_revision,
  activation.family_fingerprint AS activation_family_fingerprint,
  activation.resolution_fingerprint AS activation_resolution_fingerprint,
  activation.resolver_id AS activation_resolver_id,
  activation.resolver_version AS activation_resolver_version,
  activation.manual_control_revision::text AS activation_manual_control_revision,
  activation.selection_mode AS activation_selection_mode,
  activation.eligibility_revision::text AS activation_eligibility_revision,
  activation.eligibility_fingerprint AS activation_eligibility_fingerprint,
  activation.representation_policy_id AS activation_representation_policy_id,
  activation.representation_policy_fingerprint AS activation_representation_policy_fingerprint,
  activation.representation_fingerprint AS activation_representation_fingerprint,
  activation.lexical_generation_id::text AS activation_lexical_generation_id,
  activation.lexical_generation_fingerprint AS activation_lexical_generation_fingerprint,
  activation.activation_revision::text AS activation_revision,
  activation.activation_fingerprint,
  activation.activated_at AS activation_activated_at`;

const EVIDENCE_FIELDS = `
  candidate.family_id, candidate.family_provider, candidate.family_corp_code,
  candidate.family_symbol, candidate.lineage_root_receipt_number,
  candidate.activation_policy_id, candidate.activation_policy_fingerprint,
  candidate.activation_status, candidate.activation_receipt_id,
  candidate.activation_document_id, candidate.activation_family_revision,
  candidate.activation_family_fingerprint, candidate.activation_resolution_fingerprint,
  candidate.activation_resolver_id, candidate.activation_resolver_version,
  candidate.activation_manual_control_revision, candidate.activation_selection_mode,
  candidate.activation_eligibility_revision, candidate.activation_eligibility_fingerprint,
  candidate.activation_representation_policy_id,
  candidate.activation_representation_policy_fingerprint,
  candidate.activation_representation_fingerprint,
  candidate.activation_lexical_generation_id,
  candidate.activation_lexical_generation_fingerprint,
  candidate.activation_revision, candidate.activation_fingerprint,
  candidate.activation_activated_at,
  member.family_id::text AS member_family_id,
  member.receipt_id::text AS member_receipt_id,
  receipt.id::text AS receipt_id, receipt.provider AS receipt_provider,
  receipt.receipt_number, receipt.corp_code AS receipt_corp_code,
  receipt.symbol AS receipt_symbol, receipt.legal_status AS receipt_legal_status,
  receipt.metadata_fingerprint AS receipt_metadata_fingerprint,
  document.id::text AS document_id, document.receipt_id::text AS document_receipt_id,
  document.provider AS document_provider, document.corp_code AS document_corp_code,
  document.symbol AS document_symbol,
  eligibility.document_id::text AS eligibility_document_id,
  eligibility.receipt_id::text AS eligibility_receipt_id,
  eligibility.retrieval_policy_id AS eligibility_policy_id,
  eligibility.retrieval_policy_fingerprint AS eligibility_policy_fingerprint,
  eligibility.representation_policy_id AS eligibility_representation_policy_id,
  eligibility.representation_policy_fingerprint AS eligibility_representation_policy_fingerprint,
  eligibility.status AS eligibility_status,
  eligibility.representation_fingerprint AS eligibility_representation_fingerprint,
  eligibility.eligibility_fingerprint, eligibility.lexical_generation_id::text
    AS eligibility_lexical_generation_id,
  eligibility.lexical_profile_id AS eligibility_lexical_profile_id,
  eligibility.lexical_schema_version AS eligibility_lexical_schema_version,
  eligibility.lexical_normalizer_version AS eligibility_lexical_normalizer_version,
  eligibility.lexical_text_search_config AS eligibility_lexical_text_search_config,
  eligibility.lexical_generation_fingerprint AS eligibility_lexical_generation_fingerprint,
  eligibility.lexical_chunk_count AS eligibility_lexical_chunk_count,
  eligibility.lexical_total_lexeme_count AS eligibility_lexical_total_lexeme_count,
  eligibility.revision::text AS eligibility_revision,
  manifest.document_id::text AS manifest_document_id,
  manifest.representation_manifest_version AS manifest_version,
  manifest.representation_fingerprint AS manifest_representation_fingerprint,
  generation.id::text AS generation_id,
  generation.document_id::text AS generation_document_id,
  generation.profile_id AS generation_profile_id,
  generation.schema_version AS generation_schema_version,
  generation.normalizer_version AS generation_normalizer_version,
  generation.text_search_config AS generation_text_search_config,
  generation.status AS generation_status,
  generation.chunk_count AS generation_chunk_count,
  generation.lexical_fingerprint AS generation_fingerprint,
  generation.total_lexeme_count AS generation_total_lexeme_count,
  control.mode AS control_mode,
  control.selected_receipt_id::text AS control_selected_receipt_id,
  control.reason_code AS control_reason_code,
  control.reference_hash AS control_reference_hash,
  control.actor_reference_hash AS control_actor_reference_hash,
  control.expires_at AS control_expires_at,
  control.revision::text AS control_revision,
  control.control_fingerprint`;

const EVIDENCE_JOINS = `
LEFT JOIN filing_intelligence.filing_report_family_member AS member
  ON member.family_id = candidate.family_id::bigint
 AND member.receipt_id = candidate.activation_receipt_id::bigint
LEFT JOIN filing_intelligence.filing_receipt AS receipt
  ON receipt.id = candidate.activation_receipt_id::bigint
LEFT JOIN filing_intelligence.filing_document AS document
  ON document.id = candidate.activation_document_id::bigint
LEFT JOIN filing_intelligence.filing_retrieval_eligibility AS eligibility
  ON eligibility.document_id = candidate.activation_document_id::bigint
 AND eligibility.retrieval_policy_id = candidate.activation_policy_id
LEFT JOIN filing_intelligence.filing_document_representation_manifest AS manifest
  ON manifest.document_id = candidate.activation_document_id::bigint
LEFT JOIN filing_intelligence.filing_lexical_generation AS generation
  ON generation.id = eligibility.lexical_generation_id
 AND generation.document_id = eligibility.document_id
LEFT JOIN filing_intelligence.filing_family_resolution_control AS control
  ON control.family_id = candidate.family_id::bigint`;

export class ActiveFilingScopeRepository {
  constructor(private readonly pool: Pool) {}

  async loadFamily(familyId: string, retrievalPolicyId: string): Promise<ActiveScopeEvidenceRow> {
    const result = await this.pool.query<ActiveScopeEvidenceRow>(
      `WITH database_clock AS MATERIALIZED (
         SELECT clock_timestamp() AS database_now
       ), candidate AS MATERIALIZED (
         SELECT family.id::text AS family_id, family.provider AS family_provider,
                family.corp_code AS family_corp_code, family.symbol AS family_symbol,
                root.receipt_number AS lineage_root_receipt_number,
                ${ACTIVATION_FIELDS}
         FROM filing_intelligence.filing_report_family AS family
         JOIN filing_intelligence.filing_receipt AS root
           ON root.id = family.lineage_root_receipt_id
         LEFT JOIN filing_intelligence.filing_retrieval_activation AS activation
           ON activation.family_id = family.id AND activation.retrieval_policy_id = $2
         WHERE family.id = $1
       )
       SELECT database_clock.database_now, ${EVIDENCE_FIELDS}
       FROM database_clock
       LEFT JOIN candidate ON true
       ${EVIDENCE_JOINS}`,
      [familyId, retrievalPolicyId],
    );
    return result.rows[0]!;
  }

  async loadCompany(
    corpCode: string,
    symbol: string,
    retrievalPolicyId: string,
  ): Promise<readonly ActiveScopeEvidenceRow[]> {
    const result = await this.pool.query<ActiveScopeEvidenceRow>(
      `WITH database_clock AS MATERIALIZED (
         SELECT clock_timestamp() AS database_now
       ), candidate AS MATERIALIZED (
         SELECT family.id::text AS family_id, family.provider AS family_provider,
                family.corp_code AS family_corp_code, family.symbol AS family_symbol,
                root.receipt_number AS lineage_root_receipt_number,
                ${ACTIVATION_FIELDS}
         FROM filing_intelligence.filing_report_family AS family
         JOIN filing_intelligence.filing_receipt AS root
           ON root.id = family.lineage_root_receipt_id
         JOIN filing_intelligence.filing_retrieval_activation AS activation
           ON activation.family_id = family.id
          AND activation.retrieval_policy_id = $3
          AND activation.status = 'active'
         WHERE family.provider = 'opendart-fss'
           AND family.corp_code = $1 AND family.symbol = $2
         ORDER BY root.receipt_number, family.id, activation.receipt_id, activation.document_id
         LIMIT 21
       )
       SELECT database_clock.database_now, ${EVIDENCE_FIELDS}
       FROM database_clock
       LEFT JOIN candidate ON true
       ${EVIDENCE_JOINS}
       ORDER BY candidate.lineage_root_receipt_number,
                candidate.family_id::bigint,
                receipt.receipt_number,
                document.id`,
      [corpCode, symbol, retrievalPolicyId],
    );
    return result.rows;
  }
}
