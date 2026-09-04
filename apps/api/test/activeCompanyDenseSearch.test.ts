import assert from 'node:assert/strict';
import test from 'node:test';

import { ActiveCompanyFilingScope, ActiveFilingScopeEntry } from '../src/filingIntelligence/activeScope/contracts.js';
import { ActiveFilingScopeError } from '../src/filingIntelligence/activeScope/errors.js';
import { DenseGenerationError, EmbeddingProvider } from '../src/filingIntelligence/dense/embeddingProvider.js';
import { FilingDenseError } from '../src/filingIntelligence/dense/errors.js';
import { FILING_DENSE_PROFILES } from '../src/filingIntelligence/dense/profile.js';
import { DenseReadyGenerationReference, FilingDenseCandidate } from '../src/filingIntelligence/dense/retrievalContracts.js';
import { FILING_RETRIEVAL_POLICY } from '../src/filingIntelligence/eligibility/policies.js';
import { ActiveCompanyDenseSearchService } from '../src/filingIntelligence/retrieval/activeCompanyDenseSearchService.js';
import { SearchActiveCompanyFilingsDenselyInput } from '../src/filingIntelligence/retrieval/contracts.js';
import { DENSE_QUERY_FORMATTER_ID, prepareDenseQuery } from '../src/filingIntelligence/retrieval/denseQueryFormatter.js';
import { ActiveCompanyDenseSearchError } from '../src/filingIntelligence/retrieval/errors.js';

const COMPANY = { corpCode: '00126380', symbol: '005930' };
const PROFILE = FILING_DENSE_PROFILES.openAiSmall1536;
const HASHES = ['a', 'b', 'c', 'd', 'e', 'f'].map(value => value.repeat(64));

function entry(documentId: string, familyId = documentId): ActiveFilingScopeEntry {
  return {
    familyId, lineageRootReceiptNumber: `202608${familyId.padStart(8, '0')}`,
    receiptId: familyId, receiptNumber: `202608${familyId.padStart(8, '0')}`,
    documentId, activationRevision: '1', activationFingerprint: HASHES[0]!,
    eligibilityRevision: '1', eligibilityFingerprint: HASHES[1]!,
    representationFingerprint: HASHES[2]!, lexicalGenerationId: familyId,
    lexicalGenerationFingerprint: HASHES[3]!, activatedAt: '2026-08-30T00:00:00.000Z',
    selectionMode: 'automatic',
  };
}

function scope(documentIds: readonly string[], vetoes: ActiveCompanyFilingScope['vetoes'] = []):
ActiveCompanyFilingScope {
  return {
    scopeId: 'opendart-active-filing-scope', scopeVersion: '1.0.0',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    retrievalPolicyFingerprint: FILING_RETRIEVAL_POLICY.fingerprint,
    ...COMPANY, status: documentIds.length === 0 ? 'empty' : 'active',
    entries: documentIds.map(value => entry(value)), vetoes, documentIds,
    resolvedAt: '2026-08-30T00:00:00.000Z', scopeFingerprint: HASHES[4]!,
  };
}

function generation(documentId: string, generationId = documentId): DenseReadyGenerationReference {
  return {
    documentId, generationId, generationFingerprint: HASHES[0]!,
    representationFingerprint: HASHES[1]!, inputManifestFingerprint: HASHES[2]!,
    expectedVectorCount: 1,
  };
}

function candidate(documentId: string, chunkId: string, denseRank: number): FilingDenseCandidate {
  return {
    documentId, chunkRowId: chunkId, chunkId, generationId: documentId,
    generationFingerprint: HASHES[0]!, provider: 'opendart-fss',
    receiptNumber: '20260830000001', ...COMPANY, sectionPath: ['사업의 내용'], ordinal: 0,
    sourceText: chunkId, retrievalText: chunkId, locator: {
      entryName: 'document.xml', firstBlockOrdinal: 0, lastBlockOrdinal: 0,
    }, contentHash: HASHES[3]!, parserVersion: '1', chunkerVersion: '1',
    denseProfileId: PROFILE.profileId, denseRank, denseSimilarity: 1 - denseRank / 10,
  };
}

const vector = (first = 1): number[] => {
  const values = Array<number>(1536).fill(0);
  values[0] = first;
  values[1] = -0;
  return values;
};

const ready = (documentIds: readonly string[]) => ({
  status: 'ready' as const, denseProfileId: PROFILE.profileId,
  denseProfileFingerprint: PROFILE.profileFingerprint,
  generations: documentIds.map(value => generation(value)),
});

function provider(overrides: Partial<Awaited<ReturnType<EmbeddingProvider['embedBatch']>>> = {}):
EmbeddingProvider {
  return {
    async embedBatch(profile, inputs) {
      return {
        provider: 'openai', model: profile.modelId, tokenCount: 3,
        vectors: inputs.map(input => ({ inputId: input.inputId, vector: vector(0.123456789) })),
        ...overrides,
      };
    },
  };
}

const isOrchestrationError = (code: ActiveCompanyDenseSearchError['code']) => (value: unknown) =>
  value instanceof ActiveCompanyDenseSearchError && value.code === code;

test('active dense search preserves execution order, exact refs, ranking, and bounded provenance',
  async () => {
    const calls: string[] = [];
    const active = scope(['11', '12']);
    const generations = ready(active.documentIds);
    const ranked = [candidate('12', 'high', 1), candidate('11', 'low', 2)];
    let searchVector: readonly number[] | undefined;
    const service = new ActiveCompanyDenseSearchService({
      async resolveCompany(input) {
        calls.push('scope');
        assert.deepEqual(input, { ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId });
        return active;
      },
    }, {
      async resolveDenseReadiness(input) {
        calls.push('readiness');
        assert.deepEqual(input.documentIds, active.documentIds);
        return generations;
      },
      async retrieveDenseFilingChunks(input) {
        calls.push('search');
        assert.equal(input.generations, generations.generations);
        assert.equal(input.queryVector[0], Math.fround(0.123456789));
        assert.equal(Object.is(input.queryVector[1], -0), false);
        searchVector = input.queryVector;
        return ranked;
      },
    }, {
      async embedBatch(profile, inputs) {
        calls.push('provider');
        assert.equal(profile, PROFILE);
        assert.deepEqual(inputs, [{ inputId: 'active-company-dense-query', text: '한글 Query\n내부  공백' }]);
        return provider().embedBatch(profile, inputs);
      },
    }, { count(text) { calls.push('tokenizer'); assert.equal(text, '한글 Query\n내부  공백'); return 7; } },
    (() => { const values = [10, 15]; return () => values.shift()!; })());
    const result = await service.search({ ...COMPANY,
      query: '  한글 Query\n내부  공백  ', denseProfileId: PROFILE.profileId, topK: 7 });
    assert.deepEqual(calls, ['scope', 'readiness', 'tokenizer', 'provider', 'search']);
    assert.equal(searchVector != null, true);
    assert.equal(result.status, 'matched');
    assert.equal(result.scope, active);
    assert.deepEqual(result.candidates, ranked);
    assert.deepEqual(result.generations.map(value => value.documentId), ['11', '12']);
    assert.deepEqual(result.queryEmbedding, {
      provider: 'openai', requestedModel: PROFILE.modelId, responseModel: PROFILE.modelId,
      queryFormatterId: DENSE_QUERY_FORMATTER_ID, preflightTokenCount: 7,
      providerTokenCount: 3, latencyMs: 5, dimension: 1536,
    });
  });

test('query formatter fixes NFC, trim, control, code-point, and token boundaries', () => {
  const tokenizer = { count: (_text: string) => 8_192 };
  const prepared = prepareDenseQuery(' \t한글\n내부\t공백\r ', tokenizer);
  assert.equal(prepared.formatted, '한글\n내부\t공백');
  assert.equal(prepareDenseQuery('😀'.repeat(2_000), tokenizer).codePointCount, 2_000);
  assert.throws(() => prepareDenseQuery('😀'.repeat(2_001), tokenizer),
    isOrchestrationError('FILING_ACTIVE_DENSE_SEARCH_INVALID_INPUT'));
  for (const value of ['', ' \n\t ', 'safe\u0000unsafe', 'safe\u000bunsafe', 'safe\u007funsafe',
    'safe\u0085unsafe']) {
    assert.throws(() => prepareDenseQuery(value, tokenizer),
      isOrchestrationError('FILING_ACTIVE_DENSE_SEARCH_INVALID_INPUT'));
  }
  assert.throws(() => prepareDenseQuery('token overflow', { count: () => 8_193 }),
    isOrchestrationError('FILING_ACTIVE_DENSE_SEARCH_INVALID_INPUT'));
});

test('structural validation and authority injection fail before scope resolution', async () => {
  type CallerDocumentIds = 'documentIds' extends keyof SearchActiveCompanyFilingsDenselyInput
    ? true : false;
  type CallerQueryVector = 'queryVector' extends keyof SearchActiveCompanyFilingsDenselyInput
    ? true : false;
  const compileTimeBoundary: readonly [CallerDocumentIds, CallerQueryVector] = [false, false];
  assert.deepEqual(compileTimeBoundary, [false, false]);
  let scopeCalls = 0;
  const service = new ActiveCompanyDenseSearchService({
    async resolveCompany() { scopeCalls += 1; return scope([]); },
  }, {
    async resolveDenseReadiness() { throw new Error('unreachable'); },
    async retrieveDenseFilingChunks() { throw new Error('unreachable'); },
  }, provider(), { count: () => 1 });
  for (const invalid of [
    { ...COMPANY, query: 'valid', denseProfileId: '' },
    { ...COMPANY, query: 'valid', denseProfileId: 'unknown' },
    { ...COMPANY, query: 'valid', denseProfileId: PROFILE.profileId, topK: 21 },
    { ...COMPANY, query: 'valid', denseProfileId: PROFILE.profileId, documentIds: ['999'] },
    { ...COMPANY, query: 'valid', denseProfileId: PROFILE.profileId, generationIds: ['999'] },
    { ...COMPANY, query: 'valid', denseProfileId: PROFILE.profileId, generations: [] },
    { ...COMPANY, query: 'valid', denseProfileId: PROFILE.profileId, queryVector: vector() },
    { ...COMPANY, query: 'valid', denseProfileId: PROFILE.profileId, scope: scope([]) },
    { ...COMPANY, query: 'valid', denseProfileId: PROFILE.profileId,
      scopePolicyId: 'caller-policy' },
    { ...COMPANY, query: 'valid', denseProfileId: PROFILE.profileId,
      retrievalPolicyId: 'caller-policy' },
    { ...COMPANY, query: 'valid', denseProfileId: PROFILE.profileId,
      verifiedGenerations: [] },
  ]) {
    await assert.rejects(service.search(invalid),
      isOrchestrationError('FILING_ACTIVE_DENSE_SEARCH_INVALID_INPUT'));
  }
  assert.equal(scopeCalls, 0);
});

test('empty and veto-only scopes skip readiness, formatting, provider, and search', async t => {
  for (const active of [scope([]), scope([], [{ familyId: '1',
    lineageRootReceiptNumber: '20260830000001', reason: 'manual_hold', evidenceRevision: '1',
    evidenceFingerprint: HASHES[5]! }])]) {
    await t.test(active.vetoes.length === 0 ? 'empty' : 'vetoed', async () => {
      let downstreamCalls = 0;
      const service = new ActiveCompanyDenseSearchService({ async resolveCompany() { return active; } }, {
        async resolveDenseReadiness() { downstreamCalls += 1; return ready([]); },
        async retrieveDenseFilingChunks() { downstreamCalls += 1; return []; },
      }, { async embedBatch() { downstreamCalls += 1; throw new Error('unreachable'); } },
      { count() { downstreamCalls += 1; return 1; } });
      const result = await service.search({ ...COMPANY, query: '\u0000', denseProfileId: PROFILE.profileId });
      assert.deepEqual([result.status, result.scope, downstreamCalls], ['scope_empty', active, 0]);
    });
  }
});

test('all operational not-ready reasons skip query work and never expose a subset', async t => {
  for (const reason of ['generation_missing', 'generation_building', 'generation_failed'] as const) {
    await t.test(reason, async () => {
      let providerCalls = 0;
      let searchCalls = 0;
      const active = scope(['21', '22']);
      const service = new ActiveCompanyDenseSearchService({ async resolveCompany() { return active; } }, {
        async resolveDenseReadiness() {
          return { status: 'not_ready', denseProfileId: PROFILE.profileId,
            denseProfileFingerprint: PROFILE.profileFingerprint, generations: [],
            reasons: [{ documentId: '22', reason }] };
        },
        async retrieveDenseFilingChunks() { searchCalls += 1; return []; },
      }, { async embedBatch() { providerCalls += 1; return provider().embedBatch(PROFILE, []); } },
      { count: () => 1 });
      const result = await service.search({ ...COMPANY, query: '위험', denseProfileId: PROFILE.profileId });
      assert.equal(result.status, 'dense_not_ready');
      assert.deepEqual(result.generations, []);
      assert.deepEqual([providerCalls, searchCalls], [0, 0]);
    });
  }
});

test('semantic query validation runs after full readiness but before provider work', async () => {
  const calls: string[] = [];
  const active = scope(['25']);
  const service = new ActiveCompanyDenseSearchService({
    async resolveCompany() { calls.push('scope'); return active; },
  }, {
    async resolveDenseReadiness() { calls.push('readiness'); return ready(active.documentIds); },
    async retrieveDenseFilingChunks() { calls.push('search'); return []; },
  }, { async embedBatch() { calls.push('provider'); return provider().embedBatch(PROFILE, []); } },
  { count() { calls.push('tokenizer'); return 8_193; } });
  await assert.rejects(service.search({ ...COMPANY, query: 'token overflow',
    denseProfileId: PROFILE.profileId }),
  isOrchestrationError('FILING_ACTIVE_DENSE_SEARCH_INVALID_INPUT'));
  assert.deepEqual(calls, ['scope', 'readiness', 'tokenizer']);
});

test('candidate profiles coexist without a default or cross-profile fallback', async () => {
  const active = scope(['26']);
  const providerProfiles: string[] = [];
  const readinessProfiles: string[] = [];
  const service = new ActiveCompanyDenseSearchService({ async resolveCompany() { return active; } }, {
    async resolveDenseReadiness(input) {
      readinessProfiles.push(input.denseProfileId);
      const selected = FILING_DENSE_PROFILES.openAiLargeReduced1536;
      if (input.denseProfileId === selected.profileId) {
        return { status: 'not_ready' as const, denseProfileId: selected.profileId,
          denseProfileFingerprint: selected.profileFingerprint, generations: [] as const,
          reasons: [{ documentId: '26', reason: 'generation_missing' as const }] as const };
      }
      return ready(active.documentIds);
    },
    async retrieveDenseFilingChunks() { return []; },
  }, { async embedBatch(profile, inputs) {
    providerProfiles.push(profile.profileId);
    return provider().embedBatch(profile, inputs);
  } }, { count: () => 1 });
  const small = await service.search({ ...COMPANY, query: '비교', denseProfileId: PROFILE.profileId });
  const large = await service.search({ ...COMPANY, query: '비교',
    denseProfileId: FILING_DENSE_PROFILES.openAiLargeReduced1536.profileId });
  assert.equal(small.status, 'no_matches');
  assert.equal(large.status, 'dense_not_ready');
  assert.deepEqual(readinessProfiles, [PROFILE.profileId,
    FILING_DENSE_PROFILES.openAiLargeReduced1536.profileId]);
  assert.deepEqual(providerProfiles, [PROFILE.profileId]);
});

test('provider failure is mapped once and malformed responses never reach exact search', async t => {
  const active = scope(['31']);
  for (const [name, failingProvider, expectedProviderCode] of [
    ['provider error', { async embedBatch() {
      throw new DenseGenerationError('DENSE_PROVIDER_TIMEOUT', true);
    } }, 'DENSE_PROVIDER_TIMEOUT'],
    ['response error', provider({ vectors: [] }), 'DENSE_PROVIDER_RESPONSE_INVALID'],
  ] as const) {
    await t.test(name, async () => {
      let providerCalls = 0;
      let searchCalls = 0;
      const service = new ActiveCompanyDenseSearchService({ async resolveCompany() { return active; } }, {
        async resolveDenseReadiness() { return ready(active.documentIds); },
        async retrieveDenseFilingChunks() { searchCalls += 1; return []; },
      }, { async embedBatch(profile, inputs) {
        providerCalls += 1;
        return failingProvider.embedBatch(profile, inputs);
      } }, { count: () => 1 });
      await assert.rejects(service.search({ ...COMPANY, query: '위험',
        denseProfileId: PROFILE.profileId }), (value: unknown) =>
        value instanceof ActiveCompanyDenseSearchError
          && value.code === 'FILING_DENSE_QUERY_EMBEDDING_FAILED'
          && value.providerFailureCode === expectedProviderCode);
      assert.deepEqual([providerCalls, searchCalls], [1, 0]);
    });
  }
});

test('query text remains request-local across results and provider failures', async () => {
  const marker = 'PRIVATE_QUERY_SENTINEL_XYZ';
  const active = scope(['35']);
  let providerInput: string | undefined;
  const dense = {
    async resolveDenseReadiness() { return ready(active.documentIds); },
    async retrieveDenseFilingChunks() { return []; },
  };
  const success = new ActiveCompanyDenseSearchService({
    async resolveCompany() { return active; },
  }, dense, { async embedBatch(profile, inputs) {
    providerInput = inputs[0]?.text;
    return provider().embedBatch(profile, inputs);
  } }, { count: () => 1 });
  const result = await success.search({ ...COMPANY, query: `  ${marker}  `,
    denseProfileId: PROFILE.profileId });
  assert.equal(providerInput, marker);
  assert.equal(JSON.stringify(result).includes(marker), false);

  const failure = new ActiveCompanyDenseSearchService({
    async resolveCompany() { return active; },
  }, dense, { async embedBatch() { throw new Error(marker); } }, { count: () => 1 });
  await assert.rejects(failure.search({ ...COMPANY, query: marker,
    denseProfileId: PROFILE.profileId }), (value: unknown) => {
    assert.ok(value instanceof ActiveCompanyDenseSearchError);
    assert.equal(value.message.includes(marker), false);
    assert.equal(value.cause, undefined);
    assert.equal(JSON.stringify(value).includes(marker), false);
    return true;
  });
});

test('ready empty candidates become no_matches and lower typed failures stay intact', async t => {
  const active = scope(['41']);
  const base = { ...COMPANY, query: '위험', denseProfileId: PROFILE.profileId };
  const noMatches = new ActiveCompanyDenseSearchService({ async resolveCompany() { return active; } }, {
    async resolveDenseReadiness() { return ready(active.documentIds); },
    async retrieveDenseFilingChunks() { return []; },
  }, provider(), { count: () => 1 });
  assert.equal((await noMatches.search(base)).status, 'no_matches');

  for (const failure of [
    new ActiveFilingScopeError('FILING_ACTIVE_SCOPE_TOO_LARGE', false),
    new FilingDenseError('FILING_DENSE_GENERATION_INTEGRITY_FAILURE', false),
    new FilingDenseError('FILING_DENSE_RETRIEVAL_SCOPE_FAILURE', false),
  ]) {
    await t.test(failure.code, async () => {
      const service = new ActiveCompanyDenseSearchService({
        async resolveCompany() {
          if (failure instanceof ActiveFilingScopeError) throw failure;
          return active;
        },
      }, {
        async resolveDenseReadiness() {
          if (failure.code === 'FILING_DENSE_GENERATION_INTEGRITY_FAILURE') throw failure;
          return ready(active.documentIds);
        },
        async retrieveDenseFilingChunks() { throw failure; },
      }, provider(), { count: () => 1 });
      await assert.rejects(service.search(base), value => value === failure);
    });
  }
});
