export const LEGACY_PROJECTION_RETRIEVAL_POLICY_ID = 'filing-retrieval-lexical-v1';

export interface ReconcileLegacyFilingProjectionInput {
  readonly familyId: string;
}

export type LegacyFilingProjectionResult = {
  readonly familyId: string;
  readonly designatedPolicyId: typeof LEGACY_PROJECTION_RETRIEVAL_POLICY_ID;
  readonly activationRevision: string | null;
  readonly activeDocumentId: string | null;
  readonly updatedDocumentCount: number;
} & (
  | { readonly status: 'already_current' }
  | { readonly status: 'updated' }
  | { readonly status: 'cleared' }
);
