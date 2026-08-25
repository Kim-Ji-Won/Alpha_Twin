export const ACTIVE_FILING_SCOPE_ID = 'opendart-active-filing-scope';
export const ACTIVE_FILING_SCOPE_VERSION = '1.0.0';
export const ACTIVE_FILING_SCOPE_MAX_ENTRIES = 20;

export const ACTIVE_FILING_SCOPE_VETO_REASONS = [
  'manual_hold',
  'receipt_withdrawn',
  'receipt_cancelled',
] as const;
export type ActiveFilingScopeVetoReason =
  typeof ACTIVE_FILING_SCOPE_VETO_REASONS[number];

export interface ResolveActiveFamilyFilingScopeInput {
  readonly familyId: string;
  readonly retrievalPolicyId: string;
}

export interface ResolveActiveCompanyFilingScopeInput {
  readonly corpCode: string;
  readonly symbol: string;
  readonly retrievalPolicyId: string;
}

export interface ActiveFilingScopeEntry {
  readonly familyId: string;
  readonly lineageRootReceiptNumber: string;
  readonly receiptId: string;
  readonly receiptNumber: string;
  readonly documentId: string;
  readonly activationRevision: string;
  readonly activationFingerprint: string;
  readonly eligibilityRevision: string;
  readonly eligibilityFingerprint: string;
  readonly representationFingerprint: string;
  readonly lexicalGenerationId: string;
  readonly lexicalGenerationFingerprint: string;
  readonly activatedAt: string;
  readonly selectionMode: 'automatic' | 'manual';
}

export interface ActiveFilingScopeVeto {
  readonly familyId: string;
  readonly lineageRootReceiptNumber: string;
  readonly reason: ActiveFilingScopeVetoReason;
  readonly evidenceRevision: string | null;
  readonly evidenceFingerprint: string;
}

interface ActiveScopeResultBase {
  readonly scopeId: typeof ACTIVE_FILING_SCOPE_ID;
  readonly scopeVersion: typeof ACTIVE_FILING_SCOPE_VERSION;
  readonly retrievalPolicyId: string;
  readonly retrievalPolicyFingerprint: string;
  readonly corpCode: string;
  readonly symbol: string;
  readonly resolvedAt: string;
  readonly scopeFingerprint: string;
}

export type ActiveFamilyFilingScope = ActiveScopeResultBase & {
  readonly familyId: string;
  readonly status: 'active' | 'empty' | 'vetoed';
  readonly entry: ActiveFilingScopeEntry | null;
  readonly veto: ActiveFilingScopeVeto | null;
  readonly documentIds: readonly string[];
};

export type ActiveCompanyFilingScope = ActiveScopeResultBase & {
  readonly status: 'active' | 'empty';
  readonly entries: readonly ActiveFilingScopeEntry[];
  readonly vetoes: readonly ActiveFilingScopeVeto[];
  readonly documentIds: readonly string[];
};

export interface ActiveScopeFingerprintInput {
  readonly retrievalPolicyId: string;
  readonly retrievalPolicyFingerprint: string;
  readonly corpCode: string;
  readonly symbol: string;
  readonly familyId: string | null;
  readonly entries: readonly ActiveFilingScopeEntry[];
  readonly vetoes: readonly ActiveFilingScopeVeto[];
}
