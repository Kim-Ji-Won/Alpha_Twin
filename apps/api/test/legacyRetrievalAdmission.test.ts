import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { syntheticLegacyPersistenceInput, syntheticPersistenceInputFor } from '../integration-test/helpers/filingFixture.js';
import { calculatePersistenceFingerprints, serializeJson } from '../src/filingIntelligence/persistence/fingerprints.js';
import { canonicalRepresentationSet, FILING_REPRESENTATION_POLICY, FILING_RETRIEVAL_POLICY,
  FILING_RETRIEVAL_POLICY_V2, LEGACY_FILING_REPRESENTATION_POLICY, getRetrievalPolicy,
  LEXICAL_DEFINITION_DIGEST } from '../src/filingIntelligence/eligibility/policies.js';
import { AdmissionDocument, matchRepresentation, verifyAdmissionChunks } from '../src/filingIntelligence/eligibility/representationAdmission.js';
import { calculateEligibilityFingerprintV2 } from '../src/filingIntelligence/eligibility/fingerprints.js';
import { FilingEligibilityError } from '../src/filingIntelligence/eligibility/errors.js';
import { FILING_LEXICAL_PROFILE } from '../src/filingIntelligence/lexical/profile.js';
import { ActiveCompanyLexicalSearchService } from '../src/filingIntelligence/retrieval/activeCompanyLexicalSearchService.js';
import { ActiveCompanyDenseSearchService } from '../src/filingIntelligence/retrieval/activeCompanyDenseSearchService.js';
import { MIXED_RETRIEVAL_SCOPE_BINDING, UTF8_RETRIEVAL_SCOPE_BINDING,
  assertTrustedScopeBinding } from '../src/filingIntelligence/retrieval/scopeBinding.js';
import { FILING_DENSE_PROFILES } from '../src/filingIntelligence/dense/profile.js';

function evidence(legacy = false) {
  const input = legacy ? syntheticLegacyPersistenceInput() : syntheticPersistenceInputFor({ paragraphCount: 2 });
  const d = input.document;
  const p = d.source.decoding;
  const f = calculatePersistenceFingerprints(input);
  const document: AdmissionDocument = {
    id: '1', receipt_id: '2', provider: d.provider, receipt_number: d.receiptNumber,
    source_entry_hash: d.source.entrySha256, canonical_schema_name: d.schemaName,
    canonical_schema_version: String(d.schemaVersion), parser_version: d.parserVersion,
    chunk_schema_version: String(input.chunks[0]!.schemaVersion), chunker_version: input.chunks[0]!.chunkerVersion,
    decoding_profile_id: p?.decodingProfileId ?? null,
    decoding_profile_fingerprint: p?.decodingProfileFingerprint ?? null,
    source_declared_encoding: p?.sourceDeclaredEncoding ?? null,
    source_bom_kind: p?.sourceBomKind ?? null, source_utf8_validity: p?.sourceUtf8Validity ?? null,
    canonical_utf8_hash: p?.canonicalUtf8Sha256 ?? null,
    decoder_runtime_label: p?.decoderRuntimeLabel ?? null,
    decoding_compatibility_reason: p?.compatibilityReason ?? null,
    canonical_fingerprint: f.canonicalFingerprint, chunk_fingerprint: f.chunkFingerprint,
    representation_fingerprint: 'a'.repeat(64), section_count: d.statistics.sectionCount,
    block_count: d.blocks.length, chunk_count: input.chunks.length,
  };
  const chunks = input.chunks.map(c => ({ content_hash: c.contentHash, retrieval_text: c.retrievalText }));
  return { document, chunks };
}
const integrity = (error: unknown) => error instanceof FilingEligibilityError
  && error.code === 'FILING_ELIGIBILITY_REPRESENTATION_INTEGRITY_FAILURE';

test('v2 freezes canonical exact pairs without changing old fingerprints or lexical definition', () => {
  assert.equal(FILING_REPRESENTATION_POLICY.fingerprint, '478517a1a011f62f788de68e174362830ff6f820b250f94dbaa6d9b71efb5d8e');
  assert.equal(LEGACY_FILING_REPRESENTATION_POLICY.fingerprint, '535f6e5687ea1d3385c5050df630e0ae41e47e1d16404c652e9cd362083893e7');
  assert.equal(FILING_RETRIEVAL_POLICY.fingerprint, '6bd7c02888299b9fc6d474c0c29f287d501598f95e4ce433097f0b87bdae862e');
  assert.equal(getRetrievalPolicy(FILING_RETRIEVAL_POLICY_V2.policyId), FILING_RETRIEVAL_POLICY_V2);
  assert.equal(FILING_RETRIEVAL_POLICY_V2.semanticsVersion, '2');
  assert.equal(FILING_RETRIEVAL_POLICY_V2.fingerprint, 'd57b6b0663536384badcf242a1cecd40ff24b6820d689df732d6c2474096db9b');
  assert.equal(LEXICAL_DEFINITION_DIGEST, 'a5fcdad3eb4217304ef833d38b36789b5e28f48579fb3b37819161cd001fff41');
  assert.equal(LEXICAL_DEFINITION_DIGEST, createHash('sha256').update(serializeJson(FILING_LEXICAL_PROFILE)).digest('hex'));
  const pairs = FILING_RETRIEVAL_POLICY_V2.allowedRepresentations;
  assert.deepEqual(canonicalRepresentationSet([...pairs].reverse()), pairs);
  const { fingerprint, ...definition } = FILING_RETRIEVAL_POLICY_V2;
  assert.equal(createHash('sha256').update(serializeJson({ ...definition,
    allowedRepresentations: canonicalRepresentationSet([...pairs].reverse()) })).digest('hex'), fingerprint);
  assert.ok(Object.isFrozen(FILING_RETRIEVAL_POLICY_V2));
  assert.ok(Object.isFrozen(pairs));
  assert.ok(pairs.every(Object.isFrozen));
  assert.throws(() => Object.assign(pairs[0]!, { fingerprint: 'changed' }), TypeError);
  assert.throws(() => canonicalRepresentationSet([]));
  assert.throws(() => canonicalRepresentationSet([{ policyId: 'unregistered', fingerprint: 'f'.repeat(64) }]));
  assert.throws(() => canonicalRepresentationSet([pairs[0]!, pairs[0]!]));
  assert.throws(() => canonicalRepresentationSet([pairs[0]!, { ...pairs[0]!, fingerprint: 'f'.repeat(64) }]));
  assert.throws(() => canonicalRepresentationSet([{ ...pairs[0]!, fingerprint: 'f'.repeat(64) }]));
});

test('exact matcher admits both registered representations, rejects legacy under v1, and validates stored chunk identity', () => {
  for (const legacy of [false, true]) {
    const { document, chunks } = evidence(legacy);
    assert.equal(matchRepresentation(document, FILING_RETRIEVAL_POLICY_V2),
      legacy ? LEGACY_FILING_REPRESENTATION_POLICY : FILING_REPRESENTATION_POLICY);
    assert.equal(matchRepresentation(document, FILING_RETRIEVAL_POLICY), legacy ? null : FILING_REPRESENTATION_POLICY);
    verifyAdmissionChunks(document, chunks);
    assert.throws(() => verifyAdmissionChunks(document, chunks.slice(1)), integrity);
    assert.throws(() => verifyAdmissionChunks(document, chunks.map(c => ({ ...c, retrieval_text: 'tampered' }))), integrity);
  }
});

test('valid unsupported representation is deterministic unmatched with null pair', () => {
  const { document } = evidence();
  const unsupported = { ...document, parser_version: 'future-parser' };
  assert.equal(matchRepresentation(unsupported, FILING_RETRIEVAL_POLICY_V2), null);
  const state = { status: 'ineligible', reasonCode: 'representation_policy_mismatch', generation: null } as const;
  const fp = calculateEligibilityFingerprintV2(unsupported, null, state);
  assert.equal(calculateEligibilityFingerprintV2({ ...unsupported }, null, state), fp);
  assert.notEqual(calculateEligibilityFingerprintV2({ ...unsupported, source_entry_hash: 'b'.repeat(64) }, null, state), fp);
});

test('unknown, partial, and tampered provenance never fall through to another policy', async t => {
  const { document, chunks } = evidence(true);
  const cases: Partial<AdmissionDocument>[] = [
    { decoding_profile_id: 'unknown' }, { decoding_profile_id: null },
    { decoding_profile_fingerprint: null }, { decoding_profile_fingerprint: 'f'.repeat(64) },
    { source_declared_encoding: 'latin1' }, { source_bom_kind: 'utf8' },
    { source_utf8_validity: 'valid' }, { canonical_utf8_hash: null },
    { decoder_runtime_label: 'other' }, { decoding_compatibility_reason: null },
    { representation_fingerprint: 'invalid' },
  ];
  for (const override of cases) await t.test(Object.keys(override)[0]!, () => {
    assert.throws(() => matchRepresentation({ ...document, ...override }, FILING_RETRIEVAL_POLICY_V2), integrity);
  });
  for (const field of ['canonical_utf8_hash', 'source_entry_hash'] as const) {
    await t.test(`${field} identity drift`, () => {
      assert.throws(() => verifyAdmissionChunks({ ...document, [field]: 'f'.repeat(64) }, chunks), integrity);
    });
  }
  assert.throws(() => matchRepresentation({ ...evidence().document,
    canonical_utf8_hash: 'f'.repeat(64) }, FILING_RETRIEVAL_POLICY_V2), integrity);
});

test('bindings cannot be forged and authority injection is rejected before any service work', async () => {
  assertTrustedScopeBinding(MIXED_RETRIEVAL_SCOPE_BINDING);
  assertTrustedScopeBinding(UTF8_RETRIEVAL_SCOPE_BINDING);
  assert.throws(() => assertTrustedScopeBinding({ ...MIXED_RETRIEVAL_SCOPE_BINDING }));
  const never = async (): Promise<never> => { throw new Error('unexpected dependency call'); };
  const lexical = new ActiveCompanyLexicalSearchService({ resolveCompany: never },
    { retrieveLexicalFilingChunks: never }, MIXED_RETRIEVAL_SCOPE_BINDING);
  const dense = new ActiveCompanyDenseSearchService({ resolveCompany: never },
    { resolveDenseReadiness: never, retrieveDenseFilingChunks: never }, { embedBatch: never },
    undefined, undefined, MIXED_RETRIEVAL_SCOPE_BINDING);
  for (const key of ['policy', 'retrievalPolicyId', 'retrievalPolicy', 'scopePolicy', 'representationPolicy', 'documentIds',
    'generationId', 'vector', 'scope', 'binding', 'scopeBinding']) {
    const input = { corpCode: '00164779', symbol: '000660', query: 'synthetic', [key]: 'injected' };
    await assert.rejects(lexical.search(input), { code: 'FILING_ACTIVE_LEXICAL_SEARCH_INVALID_INPUT' });
    await assert.rejects(dense.search({ ...input, denseProfileId: FILING_DENSE_PROFILES.openAiSmall1536.profileId }),
      { code: 'FILING_ACTIVE_DENSE_SEARCH_INVALID_INPUT' });
  }
});

test('unapproved v2 dense scope fails before scope/readiness/provider, without changing dense profiles', async () => {
  let calls = 0;
  const never = async (): Promise<never> => { calls++; throw new Error('unexpected dependency call'); };
  const dense = new ActiveCompanyDenseSearchService({ resolveCompany: never },
    { resolveDenseReadiness: never, retrieveDenseFilingChunks: never }, { embedBatch: never },
    undefined, undefined, MIXED_RETRIEVAL_SCOPE_BINDING);
  for (const profile of Object.values(FILING_DENSE_PROFILES)) {
    await assert.rejects(dense.search({ corpCode: '00164779', symbol: '000660', query: 'synthetic',
      denseProfileId: profile.profileId }), { code: 'FILING_DENSE_SCOPE_COMPATIBILITY_NOT_APPROVED' });
  }
  assert.equal(calls, 0);
  assert.equal(FILING_DENSE_PROFILES.openAiSmall1536.profileFingerprint, '60c39bf8b4889972741080f36cc9b8a88d940ff6d71cb2f57c9149b65c01705c');
  assert.equal(FILING_DENSE_PROFILES.openAiLargeReduced1536.profileFingerprint, '0e2c13b55fbd30f3eab873a1b23e229c535130218bb52a9e634645fb0e436e9c');
});
