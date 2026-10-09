import { ADMISSION_POLICY, AdmissionEvidence, Binding, ClaimProof } from '../../src/filingIntelligence/admission/policy.js';
import { AdmissionGuard } from '../../src/filingIntelligence/admission/guard.js';
import { source, page, html, row, target } from './evidenceMapping.js';
import { ActiveCompanyFilingScope } from '../../src/filingIntelligence/activeScope/contracts.js';
import { FILING_RETRIEVAL_POLICY } from '../../src/filingIntelligence/eligibility/policies.js';

export const SYNTHETIC_NOW = '2026-10-08T00:00:00.000Z';
export const H = 'a'.repeat(64);
export const binding: Binding = { provider: 'opendart-fss', receiptNumber: target.receipt,
  corpCode: target.corpCode, symbol: target.symbol, familyId: '1', lineageRootReceiptNumber: target.receipt };
export function syntheticProof(claim: ClaimProof['claim'], subject: string[]): ClaimProof {
  return { claim, subject, basis: 'independent-review', references: [{ sha256: H, locator: 'synthetic:test-only' }],
    reviewer: { identity: 'synthetic-reviewer-not-a-real-approval', reviewedAt: SYNTHETIC_NOW, decision: 'accepted' } };
}
export function evidence(b: Binding = binding): AdmissionEvidence {
  const t = { ...target, receipt: b.receiptNumber, corpCode: b.corpCode, symbol: b.symbol, filingDate: b.receiptNumber.slice(0, 8) };
  const members = [...new Set([b.lineageRootReceiptNumber, t.receipt])].sort();
  return { target: t, binding: { ...b }, policyId: ADMISSION_POLICY.id,
    policyVersion: ADMISSION_POLICY.version, revision: 'synthetic-revision-1', finalQuery: 'requested', refresh: 'ok',
    artifacts: (['list-all', 'list-final', 'viewer-main'] as const).map(kind => {
      const text = kind === 'viewer-main' ? html(t) : page([row(t)]);
      return { source: source(kind, text, t, SYNTHETIC_NOW), bytes: Buffer.from(text) };
    }), lineage: { rootReceipt: b.lineageRootReceiptNumber, members,
      edges: members.length === 1 ? [] : [{ from: t.receipt, to: b.lineageRootReceiptNumber,
        proof: syntheticProof('direct-edge', [t.receipt, b.lineageRootReceiptNumber]) }],
      rootProof: syntheticProof('root', [b.lineageRootReceiptNumber]), completenessProof: syntheticProof('completeness', members) } };
}
export function fakeGuard(mutate: (e: AdmissionEvidence, call: number) => void = () => {},
  clock: () => string = () => SYNTHETIC_NOW) {
  let calls = 0;
  const guard = new AdmissionGuard({ async load(b) { const e = evidence(b); mutate(e, ++calls); return e; } }, { now: clock });
  return { guard, calls: () => calls };
}
export function scope(): ActiveCompanyFilingScope {
  return { scopeId: 'opendart-active-filing-scope', scopeVersion: '1.0.0',
    corpCode: target.corpCode, symbol: target.symbol,
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId, retrievalPolicyFingerprint: FILING_RETRIEVAL_POLICY.fingerprint,
    status: 'active', resolvedAt: SYNTHETIC_NOW, scopeFingerprint: H, documentIds: ['3'], vetoes: [],
    entries: [{ familyId: '1', lineageRootReceiptNumber: target.receipt, receiptId: '2', receiptNumber: target.receipt,
      documentId: '3', activationRevision: '1', activationFingerprint: H, eligibilityRevision: '1',
      eligibilityFingerprint: H, representationFingerprint: H, lexicalGenerationId: '4', lexicalGenerationFingerprint: H,
      activatedAt: SYNTHETIC_NOW, selectionMode: 'automatic' }] };
}
