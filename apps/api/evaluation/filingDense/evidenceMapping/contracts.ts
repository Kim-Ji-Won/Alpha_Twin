export const EVIDENCE_SCHEMA = 'filing-evidence-mapping@1' as const;
export const EXTRACTION_RULE = 'opendart-preserved-profile@1' as const;
export const DECISION_RULE = 'evidence-mapping-decision@1' as const;
export const MAX_ARTIFACT_BYTES = 2_000_000;

export class EvidenceMappingError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function requireEvidence(ok: unknown, code: string): asserts ok {
  if (!ok) throw new EvidenceMappingError(code);
}
export type Field<T> = { state: 'present'; value: T } | { state: 'missing' }
  | { state: 'invalid' };
export interface ReceiptKey {
  receipt: string; corpCode: string; symbol: string; filingDate: string;
  companyName: string;
}
export interface SourceArtifact {
  id: string;
  kind: 'list-all' | 'list-final' | 'viewer-main';
  target: ReceiptKey;
  rawBodySha256: string;
  request: { endpoint: string; parameters: Record<string, string>;
    provenance: 'recorded' | 'legacy-collection-contract'; startedAt: string | null };
  response: { headersObservedAt: string | null; bodyReceivedAt: string | null;
    httpStatus: number | null; providerStatus: string | null };
}
export interface SourceLocation {
  artifactId: string; rawBodySha256: string; extractionRuleVersion: typeof EXTRACTION_RULE;
  locator: { kind: 'json'; pointer: string } | { kind: 'html'; selector: string; startLine: number; endLine: number };
}
export type ObservationState = 'exact' | 'absent-in-this-response' | 'incomplete'
  | 'ambiguous' | 'malformed' | 'unavailable';
export type Marker = 'observed' | 'not-observed-in-field' | 'field-missing' | 'field-invalid';
export interface ReceiptObservation {
  id: string; source: SourceArtifact; state: ObservationState;
  evidence: SourceLocation[]; reasons: string[];
  exactReceiptMatchCount: number | null;
  identity: 'exact' | 'unproven' | 'conflicting';
  // Source-local name: list report_nm, or validated decoded viewer title's report segment.
  rawReportName: Field<string | null>; rawRemarks: Field<string | null>;
  facts: { contentCorrectionTitle: Marker; subsequentCorrectionRemark: Marker;
    withdrawalRemark: Marker; consolidatedPartRemark: Marker;
    providerFinal: 'positive' | 'not-applicable' | ObservationState;
    explicitNonFinalWarning: 'observed' | 'not-observed' | 'not-assessable';
    selectedReceipt: string | null; familyMembers: string[] };
  pagination: 'complete-for-requested-day' | 'incomplete' | 'malformed' | 'not-applicable';
}
export type PolicyMode = { kind: 'not-approved' }
  | { kind: 'simulation'; maxSkewMs: number; maxFinalAgeMs: number };
export interface DecisionContext { evaluatedAt: string; policy: PolicyMode }
export interface ReceiptPlan { target: ReceiptKey; finalQuery: 'requested' | 'not-requested' }
export interface DirectionalRelationKey { relation: 'corrects'; fromReceipt: string; toReceipt: string }
export interface TemporalAssessment {
  completeness: 'complete' | 'missing-required-observation' | 'invalid-time';
  observations: { id: string; at: string | null; phase: 'body-complete' | 'response-headers-observed' | 'missing' }[];
  ageMsByObservation: Record<string, number | null>;
  providerFinalAgeMs: number | null; skewMs: number | null;
  policyStatus: 'POLICY_NOT_APPROVED' | 'POLICY_SIMULATION';
  outcome: 'NOT_EVALUATED' | 'NOT_EVALUABLE' | 'WITHIN_LIMITS' | 'EXPIRED' | 'SKEW_EXCEEDED';
  reasons: string[]; enforcement: 'NOT_CONNECTED';
}
export interface ReceiptDecision {
  target: ReceiptKey; evaluatedAt: string; ruleVersion: typeof DECISION_RULE;
  evidenceIds: string[]; observationIds: string[];
  identity: 'exact' | 'unproven' | 'conflicting';
  providerFinal: 'positive' | 'not-requested' | ObservationState;
  explicitNonFinal: 'observed' | 'not-observed' | 'not-assessable';
  withdrawal: Marker[]; subsequentCorrection: Marker[];
  sourceStates: { id: string; state: ObservationState }[];
  contradictions: 'none-observed-in-scope' | 'review-required';
  temporal: TemporalAssessment;
  root: 'UNPROVEN'; lineageCompleteness: 'UNPROVEN';
  policyAcceptance: 'POLICY_NOT_APPROVED';
  disposition: 'HELD_UNPROVEN' | 'REVIEW_REQUIRED';
  reasons: string[]; unknowns: string[]; nextActions: string[];
}
export interface RelationDecision {
  key: DirectionalRelationKey; evaluatedAt: string; ruleVersion: typeof DECISION_RULE;
  evidenceIds: string[]; endpointIdentity: 'exact-both' | 'unproven' | 'conflicting';
  sameFamily: 'observed' | 'unproven' | 'conflicting';
  explicitDirectedReference: 'UNPROVEN'; root: 'UNPROVEN'; completeness: 'UNPROVEN';
  policyAcceptance: 'POLICY_NOT_APPROVED'; disposition: 'HELD_UNPROVEN' | 'REVIEW_REQUIRED';
  reasons: string[]; unknowns: string[]; nextActions: string[];
}
