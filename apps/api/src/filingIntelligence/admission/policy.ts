// Pure evidence modules only: no evaluation loader, runner, filesystem or network.
import { DECISION_RULE, EXTRACTION_RULE, ReceiptKey, ReceiptObservation, SourceArtifact } from '../../../evaluation/filingDense/evidenceMapping/contracts.js';
import { decideEvidence } from '../../../evaluation/filingDense/evidenceMapping/decision.js';
import { extractObservation } from '../../../evaluation/filingDense/evidenceMapping/extract.js';
import { fingerprint, parseInstant, validKey } from '../../../evaluation/filingDense/evidenceMapping/input.js';

export const ADMISSION_POLICY = Object.freeze({
  id: 'opendart-guarded-admission', version: '1', maxAgeMs: 86_400_000, maxSkewMs: 900_000,
  extractionRule: EXTRACTION_RULE, decisionRule: DECISION_RULE,
});
export type Operation = 'admission' | 'use';
export type Binding = Readonly<Record<string, string | null>> & {
  provider: string; corpCode: string; symbol: string; receiptNumber: string;
  familyId: string; lineageRootReceiptNumber: string;
};
export interface ClaimProof {
  claim: 'root' | 'direct-edge' | 'completeness';
  subject: readonly string[];
  basis: 'official-explicit' | 'independent-review';
  references: readonly { sha256: string; locator: string }[];
  reviewer?: { identity: string; reviewedAt: string; decision: 'accepted' };
}
export interface LineageAcceptance {
  rootReceipt: string;
  members: readonly string[];
  edges: readonly { from: string; to: string; proof: ClaimProof }[];
  rootProof: ClaimProof;
  completenessProof: ClaimProof;
}
// The internal provider must authenticate these claims independently of requests.
// This structure validates binding, not the external truth of a reference hash.
export interface AdmissionEvidence {
  target: ReceiptKey;
  binding: Binding;
  policyId: string;
  policyVersion: string;
  revision: string;
  artifacts: readonly { source: SourceArtifact; bytes: Uint8Array }[];
  finalQuery: 'requested' | 'not-requested';
  lineage: LineageAcceptance | null;
  refresh: 'ok' | 'transport-failed' | 'malformed' | 'contradiction' | 'target-absent';
}
export interface GateResult {
  allowed: boolean;
  nextAction: Operation | null;
  reasons: readonly string[];
  unverified: readonly string[];
  binding: Binding;
  target: ReceiptKey;
  policy: typeof ADMISSION_POLICY;
  evidenceRevision: string;
  evidenceDigest: string;
  evaluatedAt: string;
  validUntil: string | null;
  observationTimes: readonly { id: string; bodyCompletedAt: string | null }[];
}
const HASH = /^[a-f0-9]{64}$/;
function proofValid(p: ClaimProof | undefined, claim: ClaimProof['claim'], subject: readonly string[], now: number): boolean {
  if (!p || p.claim !== claim || fingerprint(p.subject) !== fingerprint(subject)
    || !Array.isArray(p.references) || !p.references.length
    || !p.references.every(r => HASH.test(r.sha256) && typeof r.locator === 'string' && r.locator.trim())) return false;
  if (p.basis === 'official-explicit') return true;
  const t = parseInstant(p.reviewer?.reviewedAt ?? null);
  return p.basis === 'independent-review' && !!p.reviewer?.identity.trim()
    && p.reviewer.decision === 'accepted' && t !== null && t <= now;
}
function lineageReasons(e: AdmissionEvidence, now: number): string[] {
  const l = e.lineage;
  if (!l) return ['ROOT_UNPROVEN', 'DIRECT_EDGE_UNPROVEN', 'COMPLETENESS_UNPROVEN'];
  const reasons: string[] = [];
  if ((e.binding.memberCount != null && e.binding.memberCount !== String(l.members.length))
    || (e.binding.relationCount != null && e.binding.relationCount !== String(l.edges.length))) reasons.push('GRAPH_BINDING_MISMATCH');
  if (l.rootReceipt !== e.binding.lineageRootReceiptNumber
    || !proofValid(l.rootProof, 'root', [l.rootReceipt], now)) reasons.push('ROOT_UNPROVEN');
  if (!Array.isArray(l.members) || !l.members.includes(e.target.receipt) || !l.members.includes(l.rootReceipt)
    || new Set(l.members).size !== l.members.length
    || !proofValid(l.completenessProof, 'completeness', [...l.members].sort(), now)) reasons.push('COMPLETENESS_UNPROVEN');
  const next = new Map<string, string>();
  for (const edge of l.edges) {
    if (!l.members.includes(edge.from) || !l.members.includes(edge.to) || next.has(edge.from)
      || !proofValid(edge.proof, 'direct-edge', [edge.from, edge.to], now)) reasons.push('DIRECT_EDGE_UNPROVEN');
    next.set(edge.from, edge.to);
  }
  for (const member of l.members) {
    const seen = new Set<string>(); let current = member;
    while (current !== l.rootReceipt && !seen.has(current) && next.has(current)) {
      seen.add(current); current = next.get(current)!;
    }
    if (current !== l.rootReceipt) reasons.push('COMPLETENESS_UNPROVEN');
  }
  if (next.has(l.rootReceipt)) reasons.push('DIRECT_EDGE_UNPROVEN');
  return reasons;
}

// Also used for offline negative inspection. Not an authority token or writer API.
export function assessObservations(e: AdmissionEvidence, observations: readonly ReceiptObservation[],
  expected: Binding, operation: Operation, evaluatedAt: string): GateResult {
  const reasons: string[] = [], now = parseInstant(evaluatedAt);
  if (now === null) reasons.push('EVALUATED_AT_INVALID');
  validKey(e.target);
  if (e.policyId !== ADMISSION_POLICY.id || e.policyVersion !== ADMISSION_POLICY.version) reasons.push('POLICY_BINDING_MISMATCH');
  if (!e.revision || fingerprint(e.binding) !== fingerprint(expected)) reasons.push('EVIDENCE_BINDING_MISMATCH');
  if (expected.provider !== 'opendart-fss' || e.target.receipt !== expected.receiptNumber
    || e.target.corpCode !== expected.corpCode || e.target.symbol !== expected.symbol) reasons.push('TARGET_MISMATCH');
  if (e.refresh === 'transport-failed' && operation === 'admission') reasons.push('REFRESH_TRANSPORT_FAILED');
  else if (!['ok', 'transport-failed'].includes(e.refresh)) reasons.push(`REFRESH_${e.refresh.toUpperCase().replaceAll('-', '_')}`);
  let mapped: ReturnType<typeof decideEvidence>['receipts'][number] | undefined;
  if (now !== null) {
    try {
      mapped = decideEvidence([{ target: e.target, finalQuery: e.finalQuery }], observations, [],
        { evaluatedAt, policy: { kind: 'not-approved' } }).receipts[0];
    } catch { reasons.push('OBSERVATION_BINDING_INVALID'); }
  }
  if (mapped) {
    if (mapped.identity !== 'exact') reasons.push('IDENTITY_MISMATCH');
    if (mapped.providerFinal !== 'positive') reasons.push(`FINAL_${mapped.providerFinal.toUpperCase().replaceAll('-', '_')}`);
    if (mapped.contradictions !== 'none-observed-in-scope') reasons.push('CONTRADICTION');
    reasons.push(...mapped.temporal.reasons.filter(r => r !== 'TIME_MISSING'));
  }
  for (const kind of ['list-all', 'list-final', 'viewer-main']) {
    if (!observations.some(o => o.source.kind === kind)) reasons.push(`MISSING_${kind.toUpperCase().replaceAll('-', '_')}`);
  }
  const bodies: number[] = [], finals: number[] = [];
  for (const o of observations) {
    if (o.state !== 'exact' || o.identity !== 'exact') reasons.push(`SOURCE_${o.state.toUpperCase().replaceAll('-', '_')}`);
    if (o.source.kind === 'viewer-main' && o.facts.explicitNonFinalWarning !== 'not-observed') reasons.push('VIEWER_UNACCEPTABLE');
    if (o.facts.withdrawalRemark === 'observed' || o.facts.subsequentCorrectionRemark === 'observed') reasons.push('EXPLICIT_OPPOSITE');
    if (o.source.kind !== 'viewer-main' && (o.facts.withdrawalRemark !== 'not-observed-in-field'
      || o.facts.subsequentCorrectionRemark !== 'not-observed-in-field')) reasons.push('REMARKS_UNASSESSABLE');
    if (o.source.request.provenance !== 'recorded') reasons.push('LEGACY_PHASE_REJECTED');
    const body = parseInstant(o.source.response.bodyReceivedAt);
    if (body === null) reasons.push('BODY_TIME_REQUIRED');
    else { bodies.push(body); if (o.source.kind === 'list-final') finals.push(body); }
    const start = parseInstant(o.source.request.startedAt), headers = parseInstant(o.source.response.headersObservedAt);
    for (const t of [o.source.request.startedAt, o.source.response.headersObservedAt, o.source.response.bodyReceivedAt]) {
      if (t !== null && parseInstant(t) === null) reasons.push('TIME_INVALID');
      if (now !== null && parseInstant(t) !== null && parseInstant(t)! > now) reasons.push('TIME_IN_FUTURE');
    }
    if ((start !== null && headers !== null && start > headers) || (start !== null && body !== null && start > body)
      || (headers !== null && body !== null && headers > body)) reasons.push('TIME_REVERSED');
  }
  if (bodies.length && Math.max(...bodies) - Math.min(...bodies) > ADMISSION_POLICY.maxSkewMs) reasons.push('SKEW_EXCEEDED');
  const expiry = finals.length ? Math.min(...finals) + ADMISSION_POLICY.maxAgeMs : null;
  if (expiry !== null && now !== null && now > expiry) reasons.push('EXPIRED');
  reasons.push(...lineageReasons(e, now ?? -1));
  const unique = [...new Set(reasons)].sort();
  return { allowed: unique.length === 0, nextAction: unique.length ? null : operation, reasons: unique,
    unverified: unique.filter(r => r.includes('UNPROVEN')), binding: structuredClone(expected), target: structuredClone(e.target),
    policy: ADMISSION_POLICY, evidenceRevision: e.revision,
    evidenceDigest: fingerprint({ target: e.target, revision: e.revision, observations, lineage: e.lineage,
      refresh: e.refresh, finalQuery: e.finalQuery, extraction: EXTRACTION_RULE, decision: DECISION_RULE }),
    evaluatedAt, validUntil: expiry === null ? null : new Date(expiry).toISOString(),
    observationTimes: observations.map(o => ({ id: o.id, bodyCompletedAt: o.source.response.bodyReceivedAt })) };
}

export function assessEvidence(e: AdmissionEvidence, expected: Binding, operation: Operation, evaluatedAt: string): GateResult {
  if (!Array.isArray(e.artifacts) || e.artifacts.length > 30) throw new Error('EVIDENCE_INVALID');
  // Re-extraction binds metadata and locators to actual bytes; caller observations are not accepted here.
  return assessObservations(e, e.artifacts.map(a => extractObservation(a.source, a.bytes)), expected, operation, evaluatedAt);
}
