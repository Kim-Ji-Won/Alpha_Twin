import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { canonicalJson, canonicalSha256 } from '../evaluation/filingDense/canonical.js';
import { assertBenchmarkEligible, parseDatasetEnvelope } from '../evaluation/filingDense/dataset.js';
import type { DenseEvalEntry } from '../evaluation/filingDense/contracts.js';
import {
  importRecordedPendingProposal, parsePendingLocator, parsePendingReviewArtifact,
  pendingHistoricalDifferences, pendingReviewWorksheet, PENDING_REVIEW_SCHEMA,
  PENDING_SCOPE, serializePendingReviewArtifact,
} from '../evaluation/filingDense/pendingReview.js';

const narrative = { entryName: 'synthetic.xml', firstBlockOrdinal: 0, lastBlockOrdinal: 0 };
const table = { ...narrative, tableId: 'table-synthetic', rowRange: [0, 3], repeatedHeaderRowRange: [0, 0] };
const decisions = Object.fromEntries(['APPROVE_QUERY', 'REWRITE_QUERY', 'APPROVE_EVIDENCE',
  'CHANGE_EVIDENCE', 'APPROVE_GRADE', 'CHANGE_GRADE', 'REJECT_ENTRY', 'NOTES'].map(k => [k, null]));
const review = { status: 'pending' as const, reviewRoundCount: 0 as const };
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const bytes = (v: unknown) => Buffer.from(JSON.stringify(v));
function fixture() {
  const old = { provider: 'opendart-fss', corpCode: '12345678', symbol: '123456',
    receiptNumber: '20260101000001', documentId: '4', chunkId: 'synthetic-chunk',
    contentHash: 'a'.repeat(64), representationFingerprint: 'b'.repeat(64),
    parserVersion: '1.0.1', chunkerVersion: '1.0.1', schemaVersion: '1', sectionPath: ['Synthetic'],
    locator: { ...table, rowRange: '0-3', repeatedHeaderRowRange: '0-0' } };
  const pin = { ...old, documentId: '3', representationFingerprint: 'c'.repeat(64), locator: table };
  const group = { evidenceGroupId: 'synthetic-group', candidateGrade: 2, humanConfirmationPending: true };
  const originalEntry = { queryId: 'DEV-001', split: 'dev', queryText: 'Synthetic question, "quoted"\nnext line',
    categories: ['numeric'], targetModality: 'table', reportFamily: 'annual',
    company: { corpCode: old.corpCode, symbol: old.symbol }, currentEffectiveCorrection: false,
    candidateEvidenceGroups: [{ ...group, acceptableChunkCandidates: [old] }], review, reviewDecision: decisions };
  const entries = [{ queryId: 'DEV-001', split: 'dev', originalEntry,
    proposedEvidenceGroups: [{ ...group, pins: [pin] }], review, reviewDecision: decisions }];
  const original = { schemaVersion: 'dense-eval-review-packet@1', datasetId: 'dense-eval-v1',
    corpusProof: { currentEffectiveValidation: 'historical-only' }, entries: [originalEntry] };
  const sourcePacket = bytes(original);
  const proposal = bytes({ artifactRevision: 'recovery-rebind-candidate-v1', artifactKind: 'rebind-proposal-not-dataset-packet',
    corpusVersion: 'synthetic-provisional-v1', sourceDatasetId: original.datasetId, sourcePacketSchema: original.schemaVersion,
    status: 'pending_human_review', currentScope: PENDING_SCOPE, goldenDatasetMutated: false, canonicalFinalDatasetHashFrozen: false,
    historicalProvenance: { sourcePacketSha256: sha(sourcePacket), historicalCorpusProof: original.corpusProof,
      historicalProofAppliesToCurrentCorpus: false }, entries });
  const audit = bytes({ finalStatus: 'REBIND_PROPOSAL_ONLY', pins: [{ queryId: 'DEV-001', evidenceGroupId: group.evidenceGroupId,
    oldDocumentReference: old.documentId, newDocumentReference: pin.documentId,
    oldRepresentationFingerprint: old.representationFingerprint, newRepresentationFingerprint: pin.representationFingerprint,
    oldLocator: old.locator, newLocator: pin.locator, representationMismatch: true, jsonEvidenceLocatorRawExact: false }] });
  const worksheet = Buffer.from('synthetic worksheet');
  const inputHashes = { '/synthetic/candidate-review-packet.json': sha(sourcePacket),
    '/synthetic/corpus-manifest.json': 'd'.repeat(64), '/synthetic/identity-mapping.json': 'e'.repeat(64) };
  const manifest = bytes({ status: 'REBIND_PROPOSAL_ONLY', artifactRevision: 'recovery-rebind-candidate-v1',
    corpusVersion: 'synthetic-provisional-v1', startHashes: inputHashes, endHashes: inputHashes,
    outputHashes: { 'rebind-proposal.json': sha(proposal), 'rebind-audit.json': sha(audit), 'proposal-worksheet.csv': sha(worksheet) } });
  return { proposal, audit, worksheet, sourcePacket, manifest,
    manifestChecksum: `${sha(manifest)}  rebind-manifest.json\n` };
}

test('pending canonical narrative, table and optional header locators remain lossless', () => {
  assert.deepEqual(parsePendingLocator(narrative), narrative);
  assert.deepEqual(parsePendingLocator(table), table);
  assert.deepEqual(parsePendingLocator({ ...narrative, continuation: false, continuationIndex: 0 }),
    { ...narrative, continuation: false, continuationIndex: 0 });
  const { repeatedHeaderRowRange: _, ...withoutHeader } = table;
  assert.deepEqual(parsePendingLocator(withoutHeader), withoutHeader);
  assert.deepEqual(parsePendingLocator({ ...narrative, rowRange: undefined, tableId: undefined }), narrative);
  assert.deepEqual(parsePendingLocator(JSON.parse(canonicalJson(table))), table);
});

const badLocators: readonly [string, unknown][] = [
  ['short tuple', { ...table, rowRange: [0] }], ['long tuple', { ...table, rowRange: [0, 1, 2] }],
  ['empty tuple', { ...table, rowRange: [] }], ['negative', { ...table, rowRange: [-1, 2] }],
  ['fraction', { ...table, rowRange: [0, 1.5] }], ['reverse', { ...table, rowRange: [3, 1] }],
  ['unsafe integer', { ...table, rowRange: [0, Number.MAX_SAFE_INTEGER + 1] }],
  ['numeric string', { ...table, rowRange: ['0', 3] }], ['legacy string', { ...table, rowRange: '0-3' }],
  ['range object', { ...table, rowRange: { start: 0, end: 3 } }], ['null range', { ...table, rowRange: null }],
  ['null optional', { ...narrative, continuation: null }], ['empty table ID', { ...table, tableId: '' }],
  ['missing required', { firstBlockOrdinal: 0, lastBlockOrdinal: 0 }],
  ['null required', { ...narrative, entryName: null }], ['reversed blocks', { ...narrative, firstBlockOrdinal: 2 }],
  ['range without table', { ...narrative, rowRange: [0, 1] }], ['bad header', { ...table, repeatedHeaderRowRange: [1, 0] }],
  ['undefined tuple item', { ...table, rowRange: [0, undefined] }], ['unknown field', { ...narrative, trusted: true }],
];
for (const [name, locator] of badLocators) test(`pending locator rejects ${name} without coercion`, () => {
  assert.throws(() => parsePendingLocator(locator));
});

test('recorded import is deterministic, pending-only and preserves provenance', () => {
  const input = fixture(), artifact = importRecordedPendingProposal(input);
  assert.equal(artifact.schemaVersion, PENDING_REVIEW_SCHEMA);
  assert.equal(artifact.currentScope.benchmarkReady, false);
  assert.equal(artifact.liveDatabaseVerified, false);
  assert.deepEqual(artifact.entries[0]!.originalEntry, JSON.parse(input.sourcePacket.toString()).entries[0]);
  const serialized = serializePendingReviewArtifact(artifact);
  assert.equal(serialized, serializePendingReviewArtifact(importRecordedPendingProposal(input)));
  assert.equal(serialized, serializePendingReviewArtifact(parsePendingReviewArtifact(JSON.parse(serialized))));
  assert.deepEqual(artifact.entries[0]!.proposedEvidenceGroups[0]!.pins[0]!.locator, table);
  assert.equal(pendingReviewWorksheet(artifact), pendingReviewWorksheet(JSON.parse(serialized)));
  assert.ok(pendingReviewWorksheet(artifact).includes('""quoted""'));
  const changes = artifact.historicalDifferences.pins as { locatorJsonRawExact: boolean; historicalEquivalence: string }[];
  assert.equal(changes[0]!.locatorJsonRawExact, false);
  assert.equal(changes[0]!.historicalEquivalence, 'UNKNOWN');
});

for (const field of ['proposal', 'audit', 'worksheet', 'sourcePacket', 'manifest'] as const) {
  test(`recorded import rejects ${field} byte/hash mismatch`, () => {
    const input = fixture(); input[field] = Buffer.concat([input[field], Buffer.from(' ')]);
    assert.throws(() => importRecordedPendingProposal(input));
  });
}

test('candidate rejects missing identity/hash, duplicate IDs, wrong version and altered history', () => {
  const source = importRecordedPendingProposal(fixture());
  for (const key of ['documentId', 'contentHash', 'representationFingerprint']) {
    const a = JSON.parse(JSON.stringify(source)); delete a.entries[0].proposedEvidenceGroups[0].pins[0][key];
    assert.throws(() => parsePendingReviewArtifact(a));
  }
  assert.throws(() => parsePendingReviewArtifact({ ...source, entries: [...source.entries, ...source.entries] }));
  assert.throws(() => parsePendingReviewArtifact({ ...source, schemaVersion: 'dense-eval-dataset@1' }));
  assert.throws(() => parsePendingReviewArtifact({ ...source, historicalDifferences: {} }));
  assert.throws(() => parsePendingReviewArtifact({ ...source, liveDatabaseVerified: true }));
  assert.throws(() => parsePendingReviewArtifact({ ...source, currentScope: { ...PENDING_SCOPE, benchmarkReady: true } }));
});

for (const state of ['reviewed', 'sealed']) test(`candidate rejects ${state} disguise`, () => {
  const a = JSON.parse(serializePendingReviewArtifact(importRecordedPendingProposal(fixture())));
  a.entries[0].review = { status: state, reviewRoundCount: 2 };
  a.entries[0].originalEntry.review = a.entries[0].review;
  assert.throws(() => parsePendingReviewArtifact(a));
});

test('Golden v1 still rejects array locators and candidate envelope; pending gate stays closed', () => {
  const candidate = importRecordedPendingProposal(fixture());
  assert.throws(() => parseDatasetEnvelope(candidate, 'dev'));
  const p = candidate.entries[0]!.proposedEvidenceGroups[0]!.pins[0]!;
  const e = { queryId: 'DEV-001', split: 'dev', queryText: 'Synthetic only', categories: ['numeric'],
    company: { corpCode: p.corpCode, symbol: p.symbol }, reportFamily: 'annual', evidenceModality: 'table',
    currentEffectiveCorrection: false, evidenceGroups: [{ evidenceGroupId: 'g', grade: 2, acceptableChunks: [p] }], review };
  const payload = { datasetId: 'dense-eval-v1', schemaVersion: 'dense-eval-dataset@1', split: 'dev', targetCount: 40, entries: [e] };
  assert.throws(() => parseDatasetEnvelope({ payload, canonicalHash: canonicalSha256(payload) }, 'dev'),
    (error: unknown) => (error as { code: string }).code === 'DATASET_LOCATOR_INVALID');
  const golden = JSON.parse(JSON.stringify(payload)); golden.entries[0].evidenceGroups[0].acceptableChunks[0].locator = { ordinal: 0 };
  const parsed = parseDatasetEnvelope({ payload: golden, canonicalHash: canonicalSha256(golden) }, 'dev');
  assert.throws(() => assertBenchmarkEligible(parsed.payload.entries[0] as DenseEvalEntry),
    (error: unknown) => (error as { code: string }).code === 'PENDING_ANNOTATION');
  assert.throws(() => parsePendingReviewArtifact({ payload: golden, canonicalHash: canonicalSha256(golden) }));
});

test('candidate cannot silently change grade, question provenance or null decisions', () => {
  const input = fixture();
  const p = JSON.parse(input.proposal.toString()); p.entries[0].originalEntry.queryText = 'Changed';
  input.proposal = bytes(p);
  const m = JSON.parse(input.manifest.toString()); m.outputHashes['rebind-proposal.json'] = sha(input.proposal);
  input.manifest = bytes(m); input.manifestChecksum = `${sha(input.manifest)}  rebind-manifest.json\n`;
  assert.throws(() => importRecordedPendingProposal(input));
  const a = JSON.parse(serializePendingReviewArtifact(importRecordedPendingProposal(fixture())));
  a.entries[0].proposedEvidenceGroups[0].candidateGrade = 1;
  assert.throws(() => parsePendingReviewArtifact(a));
  const b = JSON.parse(serializePendingReviewArtifact(importRecordedPendingProposal(fixture())));
  b.entries[0].reviewDecision.APPROVE_QUERY = true;
  assert.throws(() => parsePendingReviewArtifact(b));
  assert.deepEqual(pendingHistoricalDifferences(importRecordedPendingProposal(fixture()).entries),
    importRecordedPendingProposal(fixture()).historicalDifferences);
});

test('narrative artifact saves and loads without requiring table-only fields', () => {
  const a = JSON.parse(serializePendingReviewArtifact(importRecordedPendingProposal(fixture())));
  a.entries[0].originalEntry.targetModality = 'narrative';
  a.entries[0].originalEntry.candidateEvidenceGroups[0].acceptableChunkCandidates[0].locator = narrative;
  a.entries[0].proposedEvidenceGroups[0].pins[0].locator = { ...narrative, tableId: undefined };
  a.historicalDifferences = pendingHistoricalDifferences(a.entries);
  const saved = serializePendingReviewArtifact(a);
  assert.deepEqual(parsePendingReviewArtifact(JSON.parse(saved)).entries[0]!.proposedEvidenceGroups[0]!.pins[0]!.locator, narrative);
});

test('recorded importer rejects unsupported proposal revision despite matching byte hashes', () => {
  const input = fixture(), p = JSON.parse(input.proposal.toString());
  p.artifactRevision = 'unsupported-v2'; input.proposal = bytes(p);
  const m = JSON.parse(input.manifest.toString()); m.artifactRevision = p.artifactRevision;
  m.outputHashes['rebind-proposal.json'] = sha(input.proposal);
  input.manifest = bytes(m); input.manifestChecksum = `${sha(input.manifest)}  rebind-manifest.json\n`;
  assert.throws(() => importRecordedPendingProposal(input));
});

const sparseVariants: readonly (readonly [string, (values: unknown[]) => unknown[]])[] = [
  ['all holes', v => new Array(v.length)],
  ...[0, 1, 2].map(index => [`delete slot ${index}`, (v: unknown[]) => {
    delete v[index]; return v;
  }] as const),
  ['extended length', v => { v.length += 1; return v; }],
  ['inherited slot', v => {
    const prototype = Object.create(Array.prototype);
    prototype[0] = v[0]; delete v[0]; Object.setPrototypeOf(v, prototype); return v;
  }],
  ['shadowed hasOwnProperty', v => {
    delete v[0]; Object.defineProperty(v, 'hasOwnProperty', { value: () => true }); return v;
  }],
];
for (const [name, mutate] of sparseVariants) {
  for (const field of ['sectionPath', 'pins', 'provenance'] as const) {
    test(`sparse ${field} rejects ${name} at parser and serializer`, () => {
      const a = structuredClone(importRecordedPendingProposal(fixture()));
      const g = a.entries[0]!.proposedEvidenceGroups[0]!;
      const oldGroup = (a.entries[0]!.originalEntry.candidateEvidenceGroups as { acceptableChunkCandidates: Record<string, unknown>[] }[])[0]!;
      const old = oldGroup.acceptableChunkCandidates[0]!;
      g.pins = [0, 1, 2].map(i => ({ ...structuredClone(g.pins[0]!), chunkId: `chunk-${i}`, sectionPath: ['A', 'B', 'C'] }));
      oldGroup.acceptableChunkCandidates = g.pins.map(p => ({ ...structuredClone(old), chunkId: p.chunkId, sectionPath: [...p.sectionPath] }));
      a.historicalDifferences = pendingHistoricalDifferences(a.entries);
      assert.doesNotThrow(() => parsePendingReviewArtifact(a));
      const p = g.pins[0]!;
      if (field === 'sectionPath') p.sectionPath = mutate([...p.sectionPath]) as string[];
      if (field === 'pins') g.pins = mutate([...g.pins]) as typeof g.pins;
      if (field === 'provenance') a.historicalProvenance.corpusProof.extra = mutate([1, 2, 3]);
      for (const validate of [parsePendingReviewArtifact, serializePendingReviewArtifact]) {
        assert.throws(() => validate(a), { code: 'PENDING_SCHEMA_INVALID' });
      }
    });
  }
}

for (const field of ['rowRange', 'repeatedHeaderRowRange'] as const) {
  for (const index of [0, 1]) test(`sparse ${field} rejects hole ${index}`, () => {
    const pair = [0, 0]; delete pair[index];
    assert.throws(() => parsePendingLocator({ ...table, [field]: pair }), { code: 'PENDING_SCHEMA_INVALID' });
  });
}

test('sparse one-pin array and historical helper reject absent own slots', () => {
  const a = structuredClone(importRecordedPendingProposal(fixture()));
  a.entries[0]!.proposedEvidenceGroups[0]!.pins = new Array(1);
  for (const validate of [parsePendingReviewArtifact, serializePendingReviewArtifact]) {
    assert.throws(() => validate(a), { code: 'PENDING_SCHEMA_INVALID' });
  }
  assert.throws(() => pendingHistoricalDifferences(a.entries), { code: 'PENDING_SCHEMA_INVALID' });
});

test('sparse entries, groups, historical JSON and requirements reject inherited or missing slots', () => {
  for (const field of ['entries', 'groups', 'original', 'requirements', 'differences']) {
    const a = structuredClone(importRecordedPendingProposal(fixture()));
    if (field === 'entries') delete a.entries[0];
    if (field === 'groups') delete a.entries[0]!.proposedEvidenceGroups[0];
    if (field === 'original') a.entries[0]!.originalEntry.extra = [new Array(1)];
    if (field === 'differences') a.historicalDifferences.extra = new Array(1);
    if (field === 'requirements') {
      const values = [...a.unmetRequirements], prototype = Object.create(Array.prototype);
      prototype[0] = values[0]; delete values[0]; Object.setPrototypeOf(values, prototype);
      a.unmetRequirements = values;
    }
    assert.throws(() => parsePendingReviewArtifact(a), { code: 'PENDING_SCHEMA_INVALID' });
    assert.throws(() => serializePendingReviewArtifact(a), { code: 'PENDING_SCHEMA_INVALID' });
  }
});

for (const value of [undefined, null]) test(`required array elements reject explicit ${value}`, () => {
  for (const field of ['pins', 'sectionPath']) {
    const a = structuredClone(importRecordedPendingProposal(fixture()));
    const g = a.entries[0]!.proposedEvidenceGroups[0]!;
    if (field === 'pins') g.pins = [value] as unknown as typeof g.pins;
    else g.pins[0]!.sectionPath = [value] as unknown as string[];
    assert.throws(() => parsePendingReviewArtifact(a), { code: 'PENDING_SCHEMA_INVALID' });
    assert.throws(() => serializePendingReviewArtifact(a), { code: 'PENDING_SCHEMA_INVALID' });
  }
  for (const field of ['rowRange', 'repeatedHeaderRowRange']) {
    assert.throws(() => parsePendingLocator({ ...table, [field]: [0, value] }), { code: 'PENDING_LOCATOR_INVALID' });
  }
});

test('dense arrays preserve optional omission, empty JSON arrays and deterministic round-trip', () => {
  const a = structuredClone(importRecordedPendingProposal(fixture()));
  a.historicalProvenance.corpusProof.extra = [];
  const p = a.entries[0]!.proposedEvidenceGroups[0]!.pins[0]!;
  p.locator = { ...table, rowRange: [0, 0], repeatedHeaderRowRange: [0, 0], continuation: undefined };
  a.historicalDifferences = pendingHistoricalDifferences(a.entries);
  const parsed = parsePendingReviewArtifact(a), saved = serializePendingReviewArtifact(a);
  assert.deepEqual(parsePendingReviewArtifact(JSON.parse(saved)), parsed);
  assert.equal(serializePendingReviewArtifact(JSON.parse(saved)), saved);
  assert.deepEqual(parsed.historicalProvenance.corpusProof.extra, []);
  assert.deepEqual(parsed.entries[0]!.proposedEvidenceGroups[0]!.pins[0]!.sectionPath, ['Synthetic']);
});

test('sparse ranges reject inherited numeric slots and historical helper rejects sparse outer arrays', () => {
  for (const field of ['rowRange', 'repeatedHeaderRowRange']) {
    const pair = [0, 0], prototype = Object.create(Array.prototype);
    prototype[0] = 0; delete pair[0]; Object.setPrototypeOf(pair, prototype);
    assert.throws(() => parsePendingLocator({ ...table, [field]: pair }), { code: 'PENDING_SCHEMA_INVALID' });
  }
  const a = structuredClone(importRecordedPendingProposal(fixture()));
  assert.throws(() => pendingHistoricalDifferences(new Array(1)), { code: 'PENDING_SCHEMA_INVALID' });
  delete a.entries[0]!.proposedEvidenceGroups[0];
  assert.throws(() => pendingHistoricalDifferences(a.entries), { code: 'PENDING_SCHEMA_INVALID' });
});

test('bytes importer rejects JSON null pin even with valid manifest hashes', () => {
  const input = fixture(), p = JSON.parse(input.proposal.toString());
  p.entries[0].proposedEvidenceGroups[0].pins = [null];
  input.proposal = bytes(p);
  const m = JSON.parse(input.manifest.toString());
  m.outputHashes['rebind-proposal.json'] = sha(input.proposal);
  input.manifest = bytes(m); input.manifestChecksum = `${sha(input.manifest)}  rebind-manifest.json\n`;
  assert.throws(() => importRecordedPendingProposal(input), { code: 'PENDING_SCHEMA_INVALID' });
});

test('plain-data boundary rejects own map without executing it', () => {
  for (const validate of [parsePendingReviewArtifact, serializePendingReviewArtifact]) {
    const a = importRecordedPendingProposal(fixture());
    let calls = 0;
    const path = [null];
    Object.defineProperty(path, 'map', { value: () => { calls += 1; return ['Synthetic']; } });
    a.entries[0]!.proposedEvidenceGroups[0]!.pins[0]!.sectionPath = path as unknown as string[];
    assert.throws(() => validate(a), { code: 'PENDING_SCHEMA_INVALID' });
    assert.equal(calls, 0); assert.equal(path[0], null);
  }
});

test('plain-data boundary rejects deleting numeric getter without executing it', () => {
  for (const validate of [parsePendingReviewArtifact, serializePendingReviewArtifact]) {
    const a = importRecordedPendingProposal(fixture());
    let calls = 0;
    const values = ['first', 'second'];
    Object.defineProperty(values, '0', { enumerable: true, configurable: true,
      get() { calls += 1; delete values[1]; return 'first'; } });
    a.historicalProvenance.corpusProof.extra = values;
    assert.throws(() => validate(a), { code: 'PENDING_SCHEMA_INVALID' });
    assert.equal(calls, 0); assert.equal(values.length, 2);
    assert.equal(Object.hasOwn(values, 1), true); assert.equal(values[1], 'second');
  }
});

const executableCases = ['map getter', 'slot setter', 'length-changing getter', 'root entries getter',
  'nested pins getter', 'locator getter', 'iterator hook', 'toJSON hook', 'record toJSON',
  'root proxy', 'nested proxy', 'revoked proxy', 'custom prototype', 'class instance',
  'symbol property', 'non-enumerable record', 'array extra property', 'cycle'] as const;
for (const kind of executableCases) test(`plain-data rejects ${kind} without callbacks or mutation`, () => {
  for (const validate of [parsePendingReviewArtifact, serializePendingReviewArtifact]) {
    const a = importRecordedPendingProposal(fixture());
    const values = ['first', 'second'];
    let calls = 0;
    const callback = () => { calls += 1; return values; };
    let input: unknown = a;
    const group = a.entries[0]!.proposedEvidenceGroups[0]!;
    const pin = group.pins[0]!;
    const proof = a.historicalProvenance.corpusProof;
    if (kind === 'map getter') Object.defineProperty(values, 'map', { get: callback });
    if (kind === 'slot setter') Object.defineProperty(values, '0', { set: callback, configurable: true });
    if (kind === 'length-changing getter') Object.defineProperty(values, '0', {
      get() { calls += 1; values.length = 0; return 'first'; }, configurable: true });
    if (kind === 'root entries getter') Object.defineProperty(a, 'entries', { get: callback });
    if (kind === 'nested pins getter') Object.defineProperty(group, 'pins', { get: callback });
    if (kind === 'locator getter') Object.defineProperty(pin, 'locator', { get: callback });
    if (kind === 'iterator hook') Object.defineProperty(values, Symbol.iterator, { value: callback });
    if (kind === 'toJSON hook') Object.defineProperty(values, 'toJSON', { value: callback });
    if (kind === 'record toJSON') proof.toJSON = callback;
    const traps: ProxyHandler<object> = {
      get() { calls += 1; throw new Error('must not execute'); },
      ownKeys() { calls += 1; throw new Error('must not execute'); },
      getPrototypeOf() { calls += 1; throw new Error('must not execute'); },
      getOwnPropertyDescriptor() { calls += 1; throw new Error('must not execute'); },
    };
    if (kind === 'root proxy') input = new Proxy(a, traps);
    if (kind === 'nested proxy') proof.proxy = new Proxy(values, traps);
    if (kind === 'revoked proxy') {
      const revocable = Proxy.revocable({}, traps); revocable.revoke(); proof.proxy = revocable.proxy;
    }
    if (kind === 'custom prototype') Object.setPrototypeOf(values, Object.create(Array.prototype));
    if (kind === 'class instance') proof.extra = new (class Data { value = 1; })();
    if (kind === 'symbol property') Object.defineProperty(proof, Symbol('extra'), { value: 'hidden' });
    if (kind === 'non-enumerable record') Object.defineProperty(proof, 'hidden', { value: 'hidden' });
    if (kind === 'array extra property') Object.defineProperty(values, 'extra', { value: 'ignored-before' });
    if (kind === 'cycle') proof.cycle = proof;
    proof.values = values;
    const descriptorsBefore = Object.getOwnPropertyDescriptors(values);
    const proofBefore = Object.getOwnPropertyDescriptors(proof);
    assert.throws(() => validate(input), { code: 'PENDING_SCHEMA_INVALID' });
    assert.equal(calls, 0);
    assert.deepEqual(Object.getOwnPropertyDescriptors(values), descriptorsBefore);
    assert.deepEqual(Object.getOwnPropertyDescriptors(proof), proofBefore);
  }
});

test('plain-data public locator and historical helper reject accessors before reading them', () => {
  let calls = 0;
  const locator = { ...narrative };
  Object.defineProperty(locator, 'entryName', { get() { calls += 1; return 'synthetic.xml'; } });
  assert.throws(() => parsePendingLocator(locator), { code: 'PENDING_SCHEMA_INVALID' });
  const a = importRecordedPendingProposal(fixture());
  Object.defineProperty(a.entries, 'flatMap', { value() { calls += 1; return []; } });
  assert.throws(() => pendingHistoricalDifferences(a.entries), { code: 'PENDING_SCHEMA_INVALID' });
  assert.equal(calls, 0);
});

test('plain-data accepts frozen/null-prototype/shared records and detaches all returned data', () => {
  const a = importRecordedPendingProposal(fixture());
  const shared = Object.create(null) as Record<string, unknown>;
  shared.values = [1, 2];
  a.historicalProvenance.corpusProof.left = shared;
  a.historicalProvenance.corpusProof.right = shared;
  const frozen = structuredClone(a);
  function freezeData(v: unknown): void {
    if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v); for (const child of Object.values(v)) freezeData(child);
    }
  }
  freezeData(frozen);
  const saved = serializePendingReviewArtifact(a);
  assert.equal(serializePendingReviewArtifact(frozen), saved);
  const parsed = parsePendingReviewArtifact(a);
  assert.deepEqual(parsePendingReviewArtifact(JSON.parse(saved)), parsed);
  (shared.values as number[])[0] = 99;
  a.entries[0]!.reviewDecision.NOTES = 'changed' as never;
  a.entries[0]!.proposedEvidenceGroups[0]!.pins[0]!.sectionPath[0] = 'Changed';
  assert.equal(serializePendingReviewArtifact(parsed), saved);
  assert.notEqual(parsed.historicalProvenance.corpusProof.left, shared);
});

test('plain-data preserves an own __proto__ data key without changing prototypes', () => {
  const a = importRecordedPendingProposal(fixture());
  a.historicalProvenance.corpusProof = JSON.parse('{"__proto__":{"marker":true},"values":[]}');
  const parsed = parsePendingReviewArtifact(a);
  const proof = parsed.historicalProvenance.corpusProof;
  assert.equal(Object.getPrototypeOf(proof), Object.prototype);
  assert.equal(Object.hasOwn(proof, '__proto__'), true);
  assert.equal(Object.hasOwn(Object.prototype, 'marker'), false);
  assert.deepEqual(parsePendingReviewArtifact(JSON.parse(serializePendingReviewArtifact(a))), parsed);
});
