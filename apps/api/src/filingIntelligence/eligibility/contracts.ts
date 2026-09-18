export type FilingEligibilityStatus = 'eligible' | 'ineligible';

export type FilingEligibilityReason =
  | 'eligible'
  | 'representation_policy_mismatch'
  | 'receipt_quarantined'
  | 'lexical_generation_missing'
  | 'lexical_generation_not_ready';

export interface FilingEligibilityResult {
  readonly persistenceStatus: 'inserted' | 'updated' | 'already_evaluated';
  readonly documentId: string;
  readonly receiptId: string;
  readonly retrievalPolicyId: string;
  readonly retrievalPolicyFingerprint: string;
  readonly representationPolicyId: string | null;
  readonly representationPolicyFingerprint: string | null;
  readonly status: FilingEligibilityStatus;
  readonly reasonCode: FilingEligibilityReason;
  readonly representationFingerprint: string;
  readonly eligibilityFingerprint: string;
  readonly lexicalGenerationId?: string;
  readonly lexicalGenerationFingerprint?: string;
  readonly revision: string;
  readonly evaluatedAt: Date;
}

export type FilingRepresentationSelection =
  | {
      readonly status: 'selected';
      readonly receiptId: string;
      readonly documentId: string;
      readonly eligibilityFingerprint: string;
      readonly representationFingerprint: string;
    }
  | {
      readonly status: 'not_found';
      readonly receiptId: string;
    }
  | {
      readonly status: 'ambiguous';
      readonly receiptId: string;
      readonly documentIds: readonly string[];
    };
