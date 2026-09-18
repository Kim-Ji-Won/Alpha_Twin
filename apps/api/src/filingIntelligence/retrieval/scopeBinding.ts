import { FILING_RETRIEVAL_POLICY, FILING_RETRIEVAL_POLICY_V2 } from '../eligibility/policies.js';

const bindingBrand = Symbol('verified-retrieval-scope-binding');
function define(policy: typeof FILING_RETRIEVAL_POLICY | typeof FILING_RETRIEVAL_POLICY_V2) {
  return Object.freeze({ [bindingBrand]: true as const, policy,
    policyId: policy.policyId, policyFingerprint: policy.fingerprint,
    authorityVersion: 'registry-owned-active-scope@1' as const });
}
export const UTF8_RETRIEVAL_SCOPE_BINDING = define(FILING_RETRIEVAL_POLICY);
export const MIXED_RETRIEVAL_SCOPE_BINDING = define(FILING_RETRIEVAL_POLICY_V2);
export type VerifiedRetrievalScopeBinding = typeof UTF8_RETRIEVAL_SCOPE_BINDING;

export function assertTrustedScopeBinding(binding: VerifiedRetrievalScopeBinding): void {
  if (binding !== UTF8_RETRIEVAL_SCOPE_BINDING && binding !== MIXED_RETRIEVAL_SCOPE_BINDING) {
    throw new TypeError('UNTRUSTED_RETRIEVAL_SCOPE_BINDING');
  }
}

const AUTHORITY_FIELDS = [
  'policy', 'retrievalPolicyId', 'retrievalPolicy', 'scopePolicy', 'scopePolicyId',
  'representationPolicy', 'representationPolicyId', 'documentIds', 'generationId',
  'generationIds', 'generations', 'vector', 'queryVector', 'scope', 'verifiedGenerations',
  'binding', 'scopeBinding', 'retrievalScopeBinding',
] as const;

export function hasInjectedAuthority(input: object): boolean {
  return AUTHORITY_FIELDS.some(field => Object.hasOwn(input, field));
}
