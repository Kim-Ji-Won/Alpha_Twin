import { createHash } from 'node:crypto';
import { types } from 'node:util';

import type { FilingChunk } from '../../src/openDart/document/canonicalFilingContracts.js';
import { canonicalJson } from './canonical.js';
import { DENSE_EVAL_CATEGORIES, DENSE_EVAL_DATASET_ID } from './contracts.js';

export const PENDING_REVIEW_SCHEMA = 'filing-eval-pending-review@1' as const;
export const PENDING_SCOPE = Object.freeze({
  currentEffective: 'NOT_VERIFIED', legalTerminal: 'NOT_VERIFIED',
  retrievalEligibility: 'NOT_VERIFIED', activeScope: 'NOT_VERIFIED',
  benchmarkReady: false, humanReviewed: false, goldenReady: false,
});
export const PENDING_REQUIREMENTS = Object.freeze([
  'CURRENT_EFFECTIVE_LEGAL_TERMINAL', 'FAMILY_CORRECTION', 'V2_ELIGIBILITY_ACTIVATION_ACTIVE_SCOPE',
  'HUMAN_REVIEW_SEAL', 'CORRECTION_COVERAGE', 'DENSE_COMPATIBILITY_DOCUMENT_LIMITS',
]);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ObjectValue = Record<string, unknown>;
export type PendingLocator = FilingChunk['locator'];
export interface PendingPin {
  provider: 'opendart-fss'; corpCode: string; symbol: string; receiptNumber: string;
  documentId: string; chunkId: string; contentHash: string; representationFingerprint: string;
  parserVersion: string; chunkerVersion: string; schemaVersion: string;
  sectionPath: string[]; locator: PendingLocator;
}
export interface PendingGroup {
  evidenceGroupId: string; candidateGrade: 1 | 2; humanConfirmationPending: true;
  pins: PendingPin[];
}
export interface PendingEntry {
  queryId: string; split: 'dev' | 'holdout'; originalEntry: ObjectValue;
  proposedEvidenceGroups: PendingGroup[];
  review: { status: 'pending'; reviewRoundCount: 0 };
  reviewDecision: Record<string, null>;
}
export interface PendingReviewArtifact {
  schemaVersion: typeof PENDING_REVIEW_SCHEMA;
  artifactKind: 'pending-review-candidate'; status: 'pending_human_review';
  corpusVersion: string; artifactRevision: string; sourceDatasetId: typeof DENSE_EVAL_DATASET_ID;
  sourceHashes: Record<string, string>;
  evidenceBasis: 'recorded-snapshot-only'; liveDatabaseVerified: false;
  currentScope: typeof PENDING_SCOPE;
  unmetRequirements: readonly string[];
  historicalProvenance: { sourcePacketSchema: string; corpusProof: ObjectValue };
  historicalDifferences: ObjectValue;
  entries: PendingEntry[];
}
export class PendingReviewError extends Error {
  constructor(readonly code: string) { super(code); }
}
function requireValue(ok: unknown, code = 'PENDING_SCHEMA_INVALID'): asserts ok {
  if (!ok) throw new PendingReviewError(code);
}
// Public raw inputs are copied before schema code can read properties or methods.
// The existing JSON depth limit still applies; 64 also bounds envelope traversal.
function plainData(value: unknown, ancestors = new WeakSet<object>(), depth = 0): unknown {
  requireValue(depth <= 64, 'PENDING_JSON_DEPTH');
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { requireValue(Number.isFinite(value)); return value; }
  requireValue(typeof value === 'object');
  requireValue(!types.isProxy(value));
  const isArray = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  requireValue(isArray ? prototype === Array.prototype : prototype === Object.prototype || prototype === null);
  requireValue(!ancestors.has(value));
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Reflect.ownKeys(descriptors);
    requireValue(names.every(name => typeof name === 'string'));
    if (isArray) {
      const length = descriptors.length!.value as number;
      requireValue(names.length === length + 1);
      const result: unknown[] = [];
      for (let i = 0; i < length; i += 1) {
        const d = Object.getOwnPropertyDescriptor(descriptors, String(i))?.value as PropertyDescriptor | undefined;
        requireValue(d !== undefined && Object.hasOwn(d, 'value') && d.enumerable);
        result.push(plainData(d.value, ancestors, depth + 1));
      }
      return result;
    }
    const result: ObjectValue = {};
    for (const name of names as string[]) {
      const d = Object.getOwnPropertyDescriptor(descriptors, name)!.value as PropertyDescriptor;
      requireValue(Object.hasOwn(d, 'value') && d.enumerable);
      Object.defineProperty(result, name, { value: plainData(d.value, ancestors, depth + 1),
        enumerable: true, writable: true, configurable: true });
    }
    return result;
  } finally { ancestors.delete(value); }
}
function object(value: unknown): ObjectValue {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  requireValue([Object.prototype, null].includes(Object.getPrototypeOf(value)));
  requireValue(Object.values(Object.getOwnPropertyDescriptors(value)).every(d => 'value' in d));
  requireValue(Object.getOwnPropertySymbols(value).length === 0);
  return value as ObjectValue;
}
function keys(value: ObjectValue, allowed: readonly string[]): void {
  requireValue(Object.keys(value).every(k => allowed.includes(k)), 'PENDING_UNKNOWN_FIELD');
}
function text(value: unknown): string {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 100_000);
  return value;
}
function array<T = unknown>(value: unknown, minimum = 0, exact?: number,
  lengthCode = 'PENDING_SCHEMA_INVALID'): T[] {
  requireValue(Array.isArray(value));
  requireValue(value.length >= minimum && (exact === undefined || value.length === exact), lengthCode);
  // Iteration methods skip holes and can accept inherited numeric properties.
  for (let i = 0; i < value.length; i += 1) requireValue(Object.hasOwn(value, i));
  return value as T[];
}
function integer(value: unknown): number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'PENDING_LOCATOR_INVALID');
  return value;
}
function hash(value: unknown): string {
  requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'PENDING_HASH_INVALID');
  return value;
}
function same(a: unknown, b: unknown): boolean { return canonicalJson(a) === canonicalJson(b); }
function json(value: unknown, depth = 0): Json {
  requireValue(depth <= 40, 'PENDING_JSON_DEPTH');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { requireValue(Number.isFinite(value)); return value; }
  if (Array.isArray(value)) return array(value).map(v => json(v, depth + 1));
  return Object.fromEntries(Object.entries(object(value)).map(([k, v]) => [k, json(v, depth + 1)]));
}
function range(value: unknown): readonly [number, number] {
  const pair = array(value, 2, 2, 'PENDING_LOCATOR_INVALID');
  const start = integer(pair[0]), end = integer(pair[1]);
  requireValue(start <= end, 'PENDING_LOCATOR_INVALID');
  return [start, end];
}

// Shape only: table ownership and actual row bounds require a separate DB snapshot.
export function parsePendingLocator(value: unknown): PendingLocator {
  return parseLocatorData(plainData(value));
}
function parseLocatorData(value: unknown): PendingLocator {
  const v = object(value);
  keys(v, ['entryName', 'firstBlockOrdinal', 'lastBlockOrdinal', 'tableId', 'rowRange',
    'repeatedHeaderRowRange', 'continuation', 'continuationIndex']);
  const result: { -readonly [K in keyof PendingLocator]: PendingLocator[K] } = {
    entryName: text(v.entryName), firstBlockOrdinal: integer(v.firstBlockOrdinal),
    lastBlockOrdinal: integer(v.lastBlockOrdinal),
  };
  requireValue(result.firstBlockOrdinal <= result.lastBlockOrdinal, 'PENDING_LOCATOR_INVALID');
  if (v.tableId !== undefined) result.tableId = text(v.tableId);
  for (const name of ['rowRange', 'repeatedHeaderRowRange'] as const) {
    if (v[name] !== undefined) {
      requireValue(result.tableId !== undefined, 'PENDING_LOCATOR_INVALID');
      result[name] = range(v[name]);
    }
  }
  if (v.continuation !== undefined) {
    requireValue(typeof v.continuation === 'boolean', 'PENDING_LOCATOR_INVALID');
    result.continuation = v.continuation;
  }
  if (v.continuationIndex !== undefined) result.continuationIndex = integer(v.continuationIndex);
  return result;
}

const PIN_KEYS = ['provider', 'corpCode', 'symbol', 'receiptNumber', 'documentId', 'chunkId',
  'contentHash', 'representationFingerprint', 'parserVersion', 'chunkerVersion', 'schemaVersion',
  'sectionPath', 'locator'] as const;
function pin(value: unknown): PendingPin {
  const p = object(value); keys(p, PIN_KEYS);
  requireValue(p.provider === 'opendart-fss' && /^\d{8}$/.test(text(p.corpCode))
    && /^\d{6}$/.test(text(p.symbol)) && /^\d{14}$/.test(text(p.receiptNumber))
    && /^[1-9]\d*$/.test(text(p.documentId)), 'PENDING_IDENTITY_INVALID');
  const sectionPath = array(p.sectionPath, 1).map(text);
  return { provider: 'opendart-fss', corpCode: p.corpCode as string, symbol: p.symbol as string,
    receiptNumber: p.receiptNumber as string, documentId: p.documentId as string,
    chunkId: text(p.chunkId), contentHash: hash(p.contentHash),
    representationFingerprint: hash(p.representationFingerprint), parserVersion: text(p.parserVersion),
    chunkerVersion: text(p.chunkerVersion), schemaVersion: text(p.schemaVersion),
    sectionPath, locator: parseLocatorData(p.locator) };
}
const DECISIONS = ['APPROVE_QUERY', 'REWRITE_QUERY', 'APPROVE_EVIDENCE', 'CHANGE_EVIDENCE',
  'APPROVE_GRADE', 'CHANGE_GRADE', 'REJECT_ENTRY', 'NOTES'];
function entry(value: unknown): PendingEntry {
  const e = object(value); keys(e, ['queryId', 'split', 'originalEntry', 'proposedEvidenceGroups', 'review', 'reviewDecision']);
  requireValue(e.split === 'dev' || e.split === 'holdout');
  const queryId = text(e.queryId);
  requireValue((e.split === 'dev' ? /^DEV-\d{3}$/ : /^HOLD-\d{3}$/).test(queryId));
  const original = object(json(e.originalEntry));
  requireValue(original.queryId === queryId && original.split === e.split, 'PENDING_PROVENANCE_MISMATCH');
  text(original.queryText);
  const categories = array(original.categories);
  requireValue(categories.length > 0 && new Set(categories).size === categories.length
    && categories.every(c => DENSE_EVAL_CATEGORIES.includes(c as typeof DENSE_EVAL_CATEGORIES[number])));
  requireValue(['narrative', 'table'].includes(text(original.targetModality))
    && ['annual', 'half_year', 'quarterly'].includes(text(original.reportFamily)));
  const company = object(original.company);
  requireValue(same(e.review, { status: 'pending', reviewRoundCount: 0 })
    && same(original.review, e.review), 'PENDING_REVIEW_REQUIRED');
  const decisions = object(e.reviewDecision); keys(decisions, DECISIONS);
  requireValue(DECISIONS.every(k => Object.hasOwn(decisions, k) && decisions[k] === null)
    && same(original.reviewDecision, decisions), 'PENDING_DECISION_REQUIRED');
  const oldGroups = array(original.candidateEvidenceGroups);
  const groupIds = new Set<string>(), pinIds = new Set<string>();
  const groups = array(e.proposedEvidenceGroups, 1, oldGroups.length).map((value, index): PendingGroup => {
    const g = object(value); keys(g, ['evidenceGroupId', 'candidateGrade', 'humanConfirmationPending', 'pins']);
    const old = object(oldGroups[index]);
    const id = text(g.evidenceGroupId);
    requireValue(!groupIds.has(id)); groupIds.add(id);
    requireValue(id === old.evidenceGroupId && (g.candidateGrade === 1 || g.candidateGrade === 2)
      && g.candidateGrade === old.candidateGrade && g.humanConfirmationPending === true
      && old.humanConfirmationPending === true, 'PENDING_GROUP_CHANGED');
    const previous = array(old.acceptableChunkCandidates);
    const pins = array(g.pins, 1, previous.length).map((v, i) => {
      const current = pin(v), historical = object(previous[i]);
      // Historical locators remain opaque JSON, including legacy range strings.
      text(historical.documentId); hash(historical.representationFingerprint); object(json(historical.locator));
      for (const k of PIN_KEYS.filter(k => !['documentId', 'representationFingerprint', 'locator'].includes(k))) {
        requireValue(same(current[k], historical[k]), 'PENDING_EVIDENCE_CHANGED');
      }
      requireValue(current.corpCode === company.corpCode && current.symbol === company.symbol);
      const identity = `${current.documentId}:${current.chunkId}`;
      requireValue(!pinIds.has(identity)); pinIds.add(identity);
      return current;
    });
    return { evidenceGroupId: id, candidateGrade: g.candidateGrade,
      humanConfirmationPending: true, pins };
  });
  return { queryId, split: e.split, originalEntry: original, proposedEvidenceGroups: groups,
    review: { status: 'pending', reviewRoundCount: 0 }, reviewDecision: decisions as Record<string, null> };
}

export function pendingHistoricalDifferences(entries: readonly PendingEntry[]) {
  return historicalDifferencesData(plainData(entries) as PendingEntry[]);
}
function historicalDifferencesData(entries: readonly PendingEntry[]) {
  return { cause: 'UNKNOWN', historicalSerializer: 'NOT_PROVEN', pins: array<PendingEntry>(entries).flatMap(e =>
    array<PendingGroup>(e.proposedEvidenceGroups).flatMap((g, gi) => array<PendingPin>(g.pins).map((p, pi) => {
      const old = object(array(object(array(e.originalEntry.candidateEvidenceGroups)[gi]).acceptableChunkCandidates)[pi]);
      const rawExact = same(old.locator, p.locator);
      return { queryId: e.queryId, evidenceGroupId: g.evidenceGroupId, chunkId: p.chunkId,
        representationMismatch: old.representationFingerprint !== p.representationFingerprint,
        locatorJsonRawExact: rawExact, historicalEquivalence: rawExact ? 'RAW_EXACT' : 'UNKNOWN' };
    }))) };
}
const SOURCE_KEYS = ['proposal', 'proposalManifest', 'proposalAudit', 'proposalWorksheet',
  'sourcePacket', 'recoveryManifest', 'recoveryMapping'];

export function parsePendingReviewArtifact(value: unknown): PendingReviewArtifact {
  return parseArtifactData(plainData(value));
}
function parseArtifactData(value: unknown): PendingReviewArtifact {
  const v = object(value);
  keys(v, ['schemaVersion', 'artifactKind', 'status', 'corpusVersion', 'artifactRevision',
    'sourceDatasetId', 'sourceHashes', 'evidenceBasis', 'liveDatabaseVerified', 'currentScope',
    'historicalProvenance', 'historicalDifferences', 'unmetRequirements', 'entries']);
  requireValue(v.schemaVersion === PENDING_REVIEW_SCHEMA && v.artifactKind === 'pending-review-candidate'
    && v.sourceDatasetId === DENSE_EVAL_DATASET_ID, 'PENDING_VERSION_INVALID');
  requireValue(v.status === 'pending_human_review' && v.evidenceBasis === 'recorded-snapshot-only'
    && v.liveDatabaseVerified === false && same(v.currentScope, PENDING_SCOPE)
    && same(json(v.unmetRequirements), PENDING_REQUIREMENTS), 'PENDING_SCOPE_INVALID');
  const sources = object(v.sourceHashes); keys(sources, SOURCE_KEYS);
  const sourceHashes = Object.fromEntries(SOURCE_KEYS.map(k => [k, hash(sources[k])]));
  const provenance = object(v.historicalProvenance); keys(provenance, ['sourcePacketSchema', 'corpusProof']);
  const entries = array(v.entries, 1, undefined, 'PENDING_DUPLICATE_QUERY').map(entry);
  requireValue(new Set(entries.map(e => e.queryId)).size === entries.length, 'PENDING_DUPLICATE_QUERY');
  const differences = historicalDifferencesData(entries);
  requireValue(same(json(v.historicalDifferences), differences), 'PENDING_HISTORY_CHANGED');
  return { schemaVersion: PENDING_REVIEW_SCHEMA, artifactKind: 'pending-review-candidate',
    status: 'pending_human_review', corpusVersion: text(v.corpusVersion), artifactRevision: text(v.artifactRevision),
    sourceDatasetId: DENSE_EVAL_DATASET_ID, sourceHashes, evidenceBasis: 'recorded-snapshot-only',
    liveDatabaseVerified: false, currentScope: { ...PENDING_SCOPE }, unmetRequirements: [...PENDING_REQUIREMENTS],
    historicalProvenance: { sourcePacketSchema: text(provenance.sourcePacketSchema),
      corpusProof: object(json(provenance.corpusProof)) }, historicalDifferences: differences, entries };
}
export function serializePendingReviewArtifact(value: unknown): string {
  return canonicalJson(parsePendingReviewArtifact(value)) + '\n';
}
export function pendingReviewWorksheet(value: unknown): string {
  const a = parsePendingReviewArtifact(value);
  const rows = [['query_id', 'split', 'query_text', 'categories_json', 'modality',
    'original_entry_json', 'proposed_groups_json', 'review_json', 'review_decision_json'],
  ...a.entries.map(e => [e.queryId, e.split, text(e.originalEntry.queryText), canonicalJson(e.originalEntry.categories),
    text(e.originalEntry.targetModality), canonicalJson(e.originalEntry), canonicalJson(e.proposedEvidenceGroups),
    canonicalJson(e.review), canonicalJson(e.reviewDecision)])];
  return rows.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
}

export interface RecordedProposalInput {
  proposal: Uint8Array; manifest: Uint8Array; manifestChecksum: string;
  audit: Uint8Array; worksheet: Uint8Array; sourcePacket: Uint8Array;
}
const bytesHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function read(bytes: Uint8Array): ObjectValue { return object(JSON.parse(Buffer.from(bytes).toString('utf8'))); }
function suffixHash(values: ObjectValue, suffix: string): string {
  const matches = Object.entries(values).filter(([path]) => path.endsWith('/' + suffix));
  requireValue(matches.length === 1, 'PENDING_HASH_REFERENCE_AMBIGUOUS');
  return hash(matches[0]![1]);
}

// Byte integrity imports recorded evidence; it is never a new DB authority assertion.
export function importRecordedPendingProposal(input: RecordedProposalInput): PendingReviewArtifact {
  requireValue(input.manifestChecksum === `${bytesHash(input.manifest)}  rebind-manifest.json\n`, 'PENDING_INPUT_HASH_MISMATCH');
  const m = read(input.manifest);
  const outputs = object(m.outputHashes), starts = object(m.startHashes), ends = object(m.endHashes);
  for (const [name, bytes] of [['rebind-proposal.json', input.proposal], ['rebind-audit.json', input.audit],
    ['proposal-worksheet.csv', input.worksheet]] as const) {
    requireValue(hash(outputs[name]) === bytesHash(bytes), 'PENDING_INPUT_HASH_MISMATCH');
  }
  requireValue(same(starts, ends) && suffixHash(starts, 'candidate-review-packet.json') === bytesHash(input.sourcePacket), 'PENDING_INPUT_HASH_MISMATCH');
  const p = read(input.proposal), audit = read(input.audit), original = read(input.sourcePacket);
  requireValue(m.status === 'REBIND_PROPOSAL_ONLY' && audit.finalStatus === m.status
    && p.artifactKind === 'rebind-proposal-not-dataset-packet' && p.artifactRevision === 'recovery-rebind-candidate-v1'
    && m.artifactRevision === p.artifactRevision && p.corpusVersion === m.corpusVersion
    && original.schemaVersion === 'dense-eval-review-packet@1'
    && p.status === 'pending_human_review' && same(p.currentScope, PENDING_SCOPE)
    && p.goldenDatasetMutated === false && p.canonicalFinalDatasetHashFrozen === false, 'PENDING_PROPOSAL_INVALID');
  const provenance = object(p.historicalProvenance);
  requireValue(provenance.sourcePacketSha256 === bytesHash(input.sourcePacket)
    && provenance.historicalProofAppliesToCurrentCorpus === false
    && same(provenance.historicalCorpusProof, original.corpusProof)
    && p.sourceDatasetId === original.datasetId && p.sourcePacketSchema === original.schemaVersion, 'PENDING_PROVENANCE_MISMATCH');
  const entries = array(p.entries).map(entry);
  requireValue(same(entries.map(e => e.originalEntry), original.entries), 'PENDING_PROVENANCE_MISMATCH');
  const result = parsePendingReviewArtifact({ schemaVersion: PENDING_REVIEW_SCHEMA,
    artifactKind: 'pending-review-candidate', status: 'pending_human_review', corpusVersion: m.corpusVersion,
    artifactRevision: 'pending-review-candidate-v1', sourceDatasetId: p.sourceDatasetId,
    sourceHashes: { proposal: bytesHash(input.proposal), proposalManifest: bytesHash(input.manifest),
      proposalAudit: bytesHash(input.audit), proposalWorksheet: bytesHash(input.worksheet), sourcePacket: bytesHash(input.sourcePacket),
      recoveryManifest: suffixHash(starts, 'corpus-manifest.json'), recoveryMapping: suffixHash(starts, 'identity-mapping.json') },
    evidenceBasis: 'recorded-snapshot-only', liveDatabaseVerified: false, currentScope: PENDING_SCOPE,
    unmetRequirements: PENDING_REQUIREMENTS,
    historicalProvenance: { sourcePacketSchema: original.schemaVersion, corpusProof: original.corpusProof },
    historicalDifferences: pendingHistoricalDifferences(entries), entries });
  const recordedPins = array(audit.pins);
  requireValue(recordedPins.length === result.entries.flatMap(e => e.proposedEvidenceGroups.flatMap(g => g.pins)).length, 'PENDING_AUDIT_MISMATCH');
  for (const e of result.entries) for (const [gi, g] of e.proposedEvidenceGroups.entries()) for (const [pi, pin] of g.pins.entries()) {
    const old = object(array(object(array(e.originalEntry.candidateEvidenceGroups)[gi]).acceptableChunkCandidates)[pi]);
    const matches = recordedPins.map(object).filter(r => r.queryId === e.queryId && r.evidenceGroupId === g.evidenceGroupId
      && r.oldDocumentReference === old.documentId && r.newDocumentReference === pin.documentId
      && r.oldRepresentationFingerprint === old.representationFingerprint && r.newRepresentationFingerprint === pin.representationFingerprint
      && same(r.oldLocator, old.locator) && same(r.newLocator, pin.locator));
    requireValue(matches.length === 1 && matches[0]!.representationMismatch === (old.representationFingerprint !== pin.representationFingerprint)
      && matches[0]!.jsonEvidenceLocatorRawExact === same(old.locator, pin.locator), 'PENDING_AUDIT_MISMATCH');
  }
  return result;
}
