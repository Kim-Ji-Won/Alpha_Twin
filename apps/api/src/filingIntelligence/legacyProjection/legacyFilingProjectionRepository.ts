import { Pool, PoolClient } from 'pg';

import { withTransaction } from '../../infrastructure/database/transaction.js';

export interface ProjectionActivationRow {
  readonly family_id: string;
  readonly retrieval_policy_id: string;
  readonly retrieval_policy_fingerprint: string;
  readonly status: string;
  readonly receipt_id: string | null;
  readonly document_id: string | null;
  readonly family_revision: string;
  readonly family_fingerprint: string;
  readonly resolution_fingerprint: string;
  readonly resolver_id: string;
  readonly resolver_version: string;
  readonly manual_control_revision: string | null;
  readonly selection_mode: string;
  readonly eligibility_revision: string | null;
  readonly eligibility_fingerprint: string | null;
  readonly representation_policy_id: string | null;
  readonly representation_policy_fingerprint: string | null;
  readonly representation_fingerprint: string | null;
  readonly lexical_generation_id: string | null;
  readonly lexical_generation_fingerprint: string | null;
  readonly activation_revision: string;
  readonly activation_fingerprint: string;
  readonly activated_at: Date | null;
}

export interface ProjectionDocumentRow {
  readonly id: string;
  readonly receipt_id: string;
  readonly is_current_effective: boolean;
  readonly is_retrieval_ready: boolean;
  readonly activated_at: Date | null;
}

export interface ProjectionEligibilityRow {
  readonly document_id: string;
  readonly receipt_id: string;
  readonly retrieval_policy_id: string;
  readonly retrieval_policy_fingerprint: string;
  readonly status: string;
  readonly eligibility_revision: string;
  readonly eligibility_fingerprint: string;
  readonly representation_policy_id: string;
  readonly representation_policy_fingerprint: string;
  readonly representation_fingerprint: string;
  readonly lexical_generation_id: string | null;
  readonly lexical_generation_fingerprint: string | null;
}

export interface LegacyProjectionSession {
  lockFamily(familyId: string): Promise<boolean>;
  lockDesignatedActivation(
    familyId: string,
    policyId: string,
  ): Promise<ProjectionActivationRow | null>;
  lockFamilyDocuments(familyId: string): Promise<readonly ProjectionDocumentRow[]>;
  lockEligibility(
    documentId: string,
    policyId: string,
  ): Promise<ProjectionEligibilityRow | null>;
  updateLegacyFlags(
    documentIds: readonly string[],
    activeDocumentId: string | null,
    activatedAt: Date | null,
  ): Promise<number>;
}

export interface LegacyProjectionStore {
  transaction<T>(operation: (session: LegacyProjectionSession) => Promise<T>): Promise<T>;
}

class PostgresLegacyProjectionSession implements LegacyProjectionSession {
  constructor(private readonly client: PoolClient) {}

  async lockFamily(familyId: string): Promise<boolean> {
    const result = await this.client.query(
      `SELECT id
       FROM filing_intelligence.filing_report_family
       WHERE id = $1
       FOR UPDATE`,
      [familyId],
    );
    return result.rowCount === 1;
  }

  async lockDesignatedActivation(
    familyId: string,
    policyId: string,
  ): Promise<ProjectionActivationRow | null> {
    const result = await this.client.query<ProjectionActivationRow>(
      `SELECT family_id::text, retrieval_policy_id, retrieval_policy_fingerprint,
              status, receipt_id::text, document_id::text, family_revision::text,
              family_fingerprint, resolution_fingerprint, resolver_id, resolver_version,
              manual_control_revision::text, selection_mode, eligibility_revision::text,
              eligibility_fingerprint, representation_policy_id,
              representation_policy_fingerprint, representation_fingerprint,
              lexical_generation_id::text, lexical_generation_fingerprint,
              activation_revision::text, activation_fingerprint, activated_at
       FROM filing_intelligence.filing_retrieval_activation
       WHERE family_id = $1 AND retrieval_policy_id = $2
       FOR SHARE`,
      [familyId, policyId],
    );
    return result.rows[0] ?? null;
  }

  async lockFamilyDocuments(familyId: string): Promise<readonly ProjectionDocumentRow[]> {
    const result = await this.client.query<ProjectionDocumentRow>(
      `SELECT document.id::text, document.receipt_id::text,
              document.is_current_effective, document.is_retrieval_ready,
              document.activated_at
       FROM filing_intelligence.filing_report_family_member AS member
       JOIN filing_intelligence.filing_document AS document
         ON document.receipt_id = member.receipt_id
       WHERE member.family_id = $1
       ORDER BY document.id
       FOR UPDATE OF document`,
      [familyId],
    );
    return result.rows;
  }

  async lockEligibility(
    documentId: string,
    policyId: string,
  ): Promise<ProjectionEligibilityRow | null> {
    const result = await this.client.query<ProjectionEligibilityRow>(
      `SELECT document_id::text, receipt_id::text, retrieval_policy_id,
              retrieval_policy_fingerprint, status, revision::text AS eligibility_revision,
              eligibility_fingerprint, representation_policy_id,
              representation_policy_fingerprint, representation_fingerprint,
              lexical_generation_id::text, lexical_generation_fingerprint
       FROM filing_intelligence.filing_retrieval_eligibility
       WHERE document_id = $1 AND retrieval_policy_id = $2
       FOR SHARE`,
      [documentId, policyId],
    );
    return result.rows[0] ?? null;
  }

  async updateLegacyFlags(
    documentIds: readonly string[],
    activeDocumentId: string | null,
    activatedAt: Date | null,
  ): Promise<number> {
    if (documentIds.length === 0) return 0;
    const result = await this.client.query(
      `UPDATE filing_intelligence.filing_document AS document
       SET is_current_effective = $2::bigint IS NOT NULL AND document.id = $2::bigint,
           is_retrieval_ready = $2::bigint IS NOT NULL AND document.id = $2::bigint,
           activated_at = CASE WHEN document.id = $2::bigint THEN $3::timestamptz ELSE NULL END
       WHERE document.id = ANY($1::bigint[])
       RETURNING document.id`,
      [documentIds, activeDocumentId, activatedAt],
    );
    return result.rowCount ?? 0;
  }
}

export class LegacyFilingProjectionRepository implements LegacyProjectionStore {
  constructor(private readonly pool: Pool) {}

  transaction<T>(operation: (session: LegacyProjectionSession) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, client => operation(new PostgresLegacyProjectionSession(client)));
  }
}
