import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ActiveCompanyFilingScope,
  ActiveFilingScopeEntry,
} from '../src/filingIntelligence/activeScope/contracts.js';
import { ActiveFilingScopeError } from '../src/filingIntelligence/activeScope/errors.js';
import { FILING_RETRIEVAL_POLICY } from '../src/filingIntelligence/eligibility/policies.js';
import { FilingLexicalCandidate } from '../src/filingIntelligence/lexical/contracts.js';
import { FilingLexicalError } from '../src/filingIntelligence/lexical/errors.js';
import { FILING_LEXICAL_PROFILE } from '../src/filingIntelligence/lexical/profile.js';
import {
  SearchActiveCompanyFilingsLexicallyInput,
} from '../src/filingIntelligence/retrieval/contracts.js';
import { ActiveCompanyLexicalSearchError } from '../src/filingIntelligence/retrieval/errors.js';
import {
  ActiveCompanyLexicalSearchService,
} from '../src/filingIntelligence/retrieval/activeCompanyLexicalSearchService.js';

const COMPANY = { corpCode: '00126380', symbol: '005930' };

function entry(documentId: string, familyId = documentId): ActiveFilingScopeEntry {
  return {
    familyId, lineageRootReceiptNumber: `202608${familyId.padStart(8, '0')}`,
    receiptId: familyId, receiptNumber: `202608${familyId.padStart(8, '0')}`,
    documentId, activationRevision: '1', activationFingerprint: 'a'.repeat(64),
    eligibilityRevision: '1', eligibilityFingerprint: 'b'.repeat(64),
    representationFingerprint: 'c'.repeat(64), lexicalGenerationId: familyId,
    lexicalGenerationFingerprint: 'd'.repeat(64), activatedAt: '2026-08-30T00:00:00.000Z',
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
    resolvedAt: '2026-08-30T00:00:00.000Z',
    scopeFingerprint: `scope-${documentIds.join('-') || 'empty'}`,
  };
}

function candidate(documentId: string, chunkId: string, lexicalRank: number):
FilingLexicalCandidate {
  return {
    documentId, chunkRowId: chunkId, chunkId, provider: 'opendart-fss',
    receiptNumber: '20260830000001', ...COMPANY, sectionPath: ['사업의 내용'], ordinal: 0,
    sourceText: chunkId, retrievalText: chunkId, locator: {}, contentHash: 'e'.repeat(64),
    parserVersion: '1', chunkerVersion: '1',
    lexicalProfileId: FILING_LEXICAL_PROFILE.profileId, lexicalRank,
  };
}

test('active company search fixes lexical-v1 and preserves exact scope, ranking, and provenance',
  async () => {
    const active = scope(['11', '12']);
    const ranked = [candidate('12', 'high', 0.8), candidate('11', 'low', 0.2)];
    const scopeCalls: unknown[] = [];
    const lexicalCalls: unknown[] = [];
    const service = new ActiveCompanyLexicalSearchService({
      async resolveCompany(input) { scopeCalls.push(input); return active; },
    }, {
      async retrieveLexicalFilingChunks(input) { lexicalCalls.push(input); return ranked; },
    });
    const result = await service.search({ ...COMPANY, query: '반도체 투자', topK: 7 });
    assert.equal(result.status, 'matched');
    assert.equal(result.scope, active);
    assert.equal(result.scope.scopeFingerprint, 'scope-11-12');
    assert.equal(result.lexicalProfileId, FILING_LEXICAL_PROFILE.profileId);
    assert.deepEqual(result.candidates, ranked);
    assert.deepEqual(result.candidates.map(value => value.chunkId), ['high', 'low']);
    assert.deepEqual(scopeCalls, [{ ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId }]);
    assert.deepEqual(lexicalCalls, [{ ...COMPANY, documentIds: active.documentIds,
      query: '반도체 투자', topK: 7 }]);
  });

test('empty and veto-only scopes short-circuit without lexical retrieval', async t => {
  for (const [name, active] of [
    ['empty', scope([])],
    ['veto-only', scope([], [{
      familyId: '1', lineageRootReceiptNumber: '20260830000001', reason: 'manual_hold',
      evidenceRevision: '1', evidenceFingerprint: 'f'.repeat(64),
    }])],
  ] as const) {
    await t.test(name, async () => {
      let lexicalCalls = 0;
      const service = new ActiveCompanyLexicalSearchService({
        async resolveCompany() { return active; },
      }, {
        async retrieveLexicalFilingChunks() { lexicalCalls += 1; return []; },
      });
      const result = await service.search({ ...COMPANY, query: '위험' });
      assert.deepEqual([result.status, result.candidates.length, lexicalCalls],
        ['scope_empty', 0, 0]);
      assert.equal(result.scope.vetoes.length, name === 'veto-only' ? 1 : 0);
    });
  }
});

test('active scope with zero lexical candidates is distinct from an empty scope', async () => {
  let calls = 0;
  const service = new ActiveCompanyLexicalSearchService({
    async resolveCompany() { return scope(['21']); },
  }, {
    async retrieveLexicalFilingChunks() { calls += 1; return []; },
  });
  const result = await service.search({ ...COMPANY, query: '일치없음' });
  assert.deepEqual([result.status, result.candidates.length, calls], ['no_matches', 0, 1]);
});

test('input validation runs before scope and prevents caller-controlled document scope', async () => {
  type CallerCanProvideDocumentIds = 'documentIds' extends
  keyof SearchActiveCompanyFilingsLexicallyInput ? true : false;
  const callerCanProvideDocumentIds: CallerCanProvideDocumentIds = false;
  assert.equal(callerCanProvideDocumentIds, false);
  let scopeCalls = 0;
  const service = new ActiveCompanyLexicalSearchService({
    async resolveCompany() { scopeCalls += 1; return scope([]); },
  }, {
    async retrieveLexicalFilingChunks() { throw new Error('unreachable'); },
  });
  await assert.rejects(service.search({ ...COMPANY, query: 'x'.repeat(2_001) }),
    (error: unknown) => error instanceof FilingLexicalError
      && error.code === 'FILING_LEXICAL_QUERY_INVALID');
  await assert.rejects(service.search({ ...COMPANY, query: 'valid', topK: 21 }),
    (error: unknown) => error instanceof ActiveCompanyLexicalSearchError
      && error.code === 'FILING_ACTIVE_LEXICAL_SEARCH_INVALID_INPUT');
  const malicious = { ...COMPANY, query: 'valid', documentIds: ['999'] };
  await assert.rejects(service.search(malicious),
    (error: unknown) => error instanceof ActiveCompanyLexicalSearchError
      && error.code === 'FILING_ACTIVE_LEXICAL_SEARCH_INVALID_INPUT');
  assert.equal(scopeCalls, 0);
});

test('scope and lexical typed failures propagate fail-closed without fallback', async t => {
  await t.test('scope failure', async () => {
    const failure = new ActiveFilingScopeError('FILING_ACTIVE_SCOPE_POLICY_DRIFT', false);
    let lexicalCalls = 0;
    const service = new ActiveCompanyLexicalSearchService({
      async resolveCompany() { throw failure; },
    }, {
      async retrieveLexicalFilingChunks() { lexicalCalls += 1; return []; },
    });
    await assert.rejects(service.search({ ...COMPANY, query: '위험' }), value => value === failure);
    assert.equal(lexicalCalls, 0);
  });
  await t.test('lexical failure', async () => {
    const failure = new FilingLexicalError('FILING_LEXICAL_SCOPE_INVALID', false);
    let lexicalCalls = 0;
    const service = new ActiveCompanyLexicalSearchService({
      async resolveCompany() { return scope(['31']); },
    }, {
      async retrieveLexicalFilingChunks() { lexicalCalls += 1; throw failure; },
    });
    await assert.rejects(service.search({ ...COMPANY, query: '위험' }), value => value === failure);
    assert.equal(lexicalCalls, 1);
  });
});

test('scope contract corruption is rejected before lexical retrieval', async () => {
  let lexicalCalls = 0;
  const corrupt = { ...scope(['41']), documentIds: ['42'] };
  const service = new ActiveCompanyLexicalSearchService({
    async resolveCompany() { return corrupt; },
  }, {
    async retrieveLexicalFilingChunks() { lexicalCalls += 1; return []; },
  });
  await assert.rejects(service.search({ ...COMPANY, query: '위험' }),
    (error: unknown) => error instanceof ActiveCompanyLexicalSearchError
      && error.code === 'FILING_ACTIVE_LEXICAL_SEARCH_SCOPE_INTEGRITY_FAILURE');
  assert.equal(lexicalCalls, 0);
});

test('each request remains bound to its resolved scope across switch and hold races', async () => {
  let current = scope(['51']);
  let afterResolution: (() => void) | undefined;
  const service = new ActiveCompanyLexicalSearchService({
    async resolveCompany() {
      const resolved = current;
      afterResolution?.();
      return resolved;
    },
  }, {
    async retrieveLexicalFilingChunks(input) {
      return [candidate(input.documentIds[0]!, `chunk-${input.documentIds[0]}`, 1)];
    },
  });
  afterResolution = () => { current = scope(['52']); afterResolution = undefined; };
  const inFlightSwitch = await service.search({ ...COMPANY, query: '전환' });
  assert.deepEqual([inFlightSwitch.scope.documentIds, inFlightSwitch.candidates[0]?.documentId],
    [['51'], '51']);
  assert.deepEqual((await service.search({ ...COMPANY, query: '전환' })).scope.documentIds, ['52']);

  afterResolution = () => { current = scope([], [{
    familyId: '52', lineageRootReceiptNumber: '20260830000052', reason: 'manual_hold',
    evidenceRevision: '2', evidenceFingerprint: 'a'.repeat(64),
  }]); afterResolution = undefined; };
  const inFlightHold = await service.search({ ...COMPANY, query: '보류' });
  assert.deepEqual([inFlightHold.status, inFlightHold.candidates[0]?.documentId], ['matched', '52']);
  const afterHold = await service.search({ ...COMPANY, query: '보류' });
  assert.deepEqual([afterHold.status, afterHold.candidates.length], ['scope_empty', 0]);
});
