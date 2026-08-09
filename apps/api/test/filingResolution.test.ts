import assert from 'node:assert/strict';
import test from 'node:test';

import {
  familyBaseFingerprint,
  familyGraphFingerprint,
  lineageFingerprint,
} from '../src/filingIntelligence/lineage/fingerprints.js';
import {
  ResolutionMemberSnapshot,
  ResolutionRelationSnapshot,
  StoredResolutionControl,
  VerifiedFamilyGraphSnapshot,
} from '../src/filingIntelligence/resolution/contracts.js';
import { FilingResolutionError } from '../src/filingIntelligence/resolution/errors.js';
import { resolveVerifiedFamilyGraph } from '../src/filingIntelligence/resolution/resolver.js';

const ROOT = '20990101000000';
const A1 = '20990101000001';
const A2 = '20990101000002';
const HASH = 'a'.repeat(64);
const NOW = '2099-01-10T00:00:00.000Z';

function member(
  id: string,
  receiptNumber: string,
  role: 'root' | 'correction',
  overrides: Partial<ResolutionMemberSnapshot['receipt']> = {},
): ResolutionMemberSnapshot {
  const source = 'trusted_backfill' as const;
  return {
    role,
    source,
    membershipFingerprint: lineageFingerprint({
      familyRoot: ROOT, receiptNumber, role, source,
    }),
    receipt: {
      id,
      provider: 'opendart-fss',
      receiptNumber,
      corpCode: '11111111',
      symbol: '111111',
      legalStatus: 'reported_active',
      lineageStatus: 'resolved',
      ...overrides,
    },
  };
}

function relation(
  id: string,
  correction: ResolutionMemberSnapshot,
  corrected: ResolutionMemberSnapshot,
): ResolutionRelationSnapshot {
  const relationSource = 'trusted_backfill' as const;
  const relationType = 'corrects' as const;
  return {
    id,
    correctionReceiptId: correction.receipt.id,
    correctsReceiptId: corrected.receipt.id,
    relationType,
    relationSource,
    verificationReferenceHash: HASH,
    relationFingerprint: lineageFingerprint({
      familyRoot: ROOT,
      correctionReceiptNumber: correction.receipt.receiptNumber,
      correctsReceiptNumber: corrected.receipt.receiptNumber,
      relationType,
      relationSource,
      relationReferenceHash: HASH,
    }),
  };
}

function control(
  mode: 'hold' | 'select',
  selectedReceiptId: string | null,
  expiresAt: string | null = null,
): StoredResolutionControl {
  const state = {
    familyId: '10',
    mode,
    selectedReceiptId,
    reasonCode: mode === 'hold' ? 'emergency_hold' as const : 'manual_verified_selection' as const,
    referenceHash: HASH,
    actorReferenceHash: null,
    expiresAt,
  };
  return {
    ...state,
    revision: '1',
    controlFingerprint: lineageFingerprint(state),
  };
}

function snapshot(
  members: readonly ResolutionMemberSnapshot[],
  relations: readonly ResolutionRelationSnapshot[],
  manualControl: StoredResolutionControl | null = null,
  databaseNow = NOW,
): VerifiedFamilyGraphSnapshot {
  const orderedMembers = [...members].sort((left, right) =>
    left.receipt.receiptNumber.localeCompare(right.receipt.receiptNumber));
  const byId = new Map(members.map(item => [item.receipt.id, item]));
  const orderedRelations = [...relations].sort((left, right) => {
    const leftCorrection = byId.get(left.correctionReceiptId)!.receipt.receiptNumber;
    const rightCorrection = byId.get(right.correctionReceiptId)!.receipt.receiptNumber;
    return leftCorrection.localeCompare(rightCorrection);
  });
  const fingerprint = members.length === 1 && relations.length === 0
    ? familyBaseFingerprint({
      provider: 'opendart-fss', corpCode: '11111111', symbol: '111111',
      rootReceiptNumber: ROOT,
    })
    : familyGraphFingerprint({
      provider: 'opendart-fss', corpCode: '11111111', symbol: '111111',
      rootReceiptNumber: ROOT,
      members: orderedMembers.map(item => ({
        receipt_number: item.receipt.receiptNumber,
        member_role: item.role,
        membership_fingerprint: item.membershipFingerprint,
      })),
      edges: orderedRelations.map(item => ({
        correction_receipt_number: byId.get(item.correctionReceiptId)!.receipt.receiptNumber,
        corrects_receipt_number: byId.get(item.correctsReceiptId)!.receipt.receiptNumber,
        relation_type: item.relationType,
        relation_fingerprint: item.relationFingerprint,
      })),
    });
  return {
    databaseNow,
    family: {
      id: '10', provider: 'opendart-fss', corpCode: '11111111', symbol: '111111',
      lineageRootReceiptId: '1', lineageRootReceiptNumber: ROOT,
      status: 'verified', revision: String(relations.length + 1), fingerprint,
    },
    members,
    relations,
    manualControl,
  };
}

function resolutionError(code: FilingResolutionError['code']) {
  return (error: unknown) => error instanceof FilingResolutionError && error.code === code;
}

test('root-only family resolves only an active legal root', () => {
  const root = member('1', ROOT, 'root', { lineageStatus: 'unresolved' });
  const resolved = resolveVerifiedFamilyGraph(snapshot([root], []));
  assert.equal(resolved.resolutionStatus, 'resolved');
  assert.equal(resolved.selectedReceiptNumber, ROOT);
  assert.equal(resolveVerifiedFamilyGraph(snapshot([
    member('1', ROOT, 'root', { legalStatus: 'unknown', lineageStatus: 'unresolved' }),
  ], [])).resolutionStatus, 'legal_status_unresolved');
  for (const legalStatus of ['withdrawn', 'cancelled'] as const) {
    assert.equal(resolveVerifiedFamilyGraph(snapshot([
      member('1', ROOT, 'root', { legalStatus, lineageStatus: 'unresolved' }),
    ], [])).resolutionStatus, 'terminal_legally_ineligible');
  }
  assert.equal(resolveVerifiedFamilyGraph(snapshot([
    root, member('2', A1, 'correction'),
  ], [])).resolutionStatus, 'graph_incomplete');
});

test('linear chains select the only terminal in correction-to-predecessor direction', () => {
  const root = member('1', ROOT, 'root');
  const first = member('2', A1, 'correction');
  const second = member('3', A2, 'correction');
  const one = resolveVerifiedFamilyGraph(snapshot([root, first], [relation('1', first, root)]));
  assert.equal(one.selectedReceiptNumber, A1);
  const two = resolveVerifiedFamilyGraph(snapshot(
    [root, first, second], [relation('1', first, root), relation('2', second, first)],
  ));
  assert.equal(two.selectedReceiptNumber, A2);
  assert.deepEqual(two.terminalReceiptNumbers, [A2]);
});

test('branch, missing predecessor, and disconnected members never guess a candidate', () => {
  const root = member('1', ROOT, 'root');
  const first = member('2', A1, 'correction');
  const second = member('3', A2, 'correction');
  assert.equal(resolveVerifiedFamilyGraph(snapshot(
    [root, first, second], [relation('1', first, root), relation('2', second, root)],
  )).resolutionStatus, 'ambiguous_terminal_branch');
  assert.equal(resolveVerifiedFamilyGraph(snapshot([root, first], [])).resolutionStatus,
    'graph_incomplete');
  assert.equal(resolveVerifiedFamilyGraph(snapshot(
    [root, first, second], [relation('1', first, root)],
  )).resolutionStatus, 'graph_incomplete');
});

test('automatic selection enforces terminal lineage and legal status without fallback', () => {
  const root = member('1', ROOT, 'root');
  for (const lineageStatus of ['unresolved', 'conflicted', 'quarantined'] as const) {
    const terminal = member('2', A1, 'correction', { lineageStatus });
    assert.equal(resolveVerifiedFamilyGraph(snapshot(
      [root, terminal], [relation('1', terminal, root)],
    )).resolutionStatus, 'lineage_status_ineligible');
  }
  const unknown = member('2', A1, 'correction', { legalStatus: 'unknown' });
  assert.equal(resolveVerifiedFamilyGraph(snapshot(
    [root, unknown], [relation('1', unknown, root)],
  )).resolutionStatus, 'legal_status_unresolved');
  const withdrawn = member('2', A1, 'correction', { legalStatus: 'withdrawn' });
  const result = resolveVerifiedFamilyGraph(snapshot(
    [root, withdrawn], [relation('1', withdrawn, root)],
  ));
  assert.equal(result.resolutionStatus, 'terminal_legally_ineligible');
  assert.equal(result.selectedReceiptId, null);
});

test('active hold wins while expired hold is ignored using snapshot database time', () => {
  const root = member('1', ROOT, 'root', { lineageStatus: 'unresolved' });
  const active = resolveVerifiedFamilyGraph(snapshot(
    [root], [], control('hold', null, '2099-01-11T00:00:00.000Z'),
  ));
  const expired = resolveVerifiedFamilyGraph(snapshot(
    [root], [], control('hold', null, '2099-01-09T00:00:00.000Z'),
  ));
  assert.equal(active.resolutionStatus, 'manual_hold');
  assert.equal(expired.resolutionStatus, 'resolved');
  assert.notEqual(active.resolutionFingerprint, expired.resolutionFingerprint);
});

test('manual selection can choose an unknown historical member but not ineligible members', () => {
  const root = member('1', ROOT, 'root', { legalStatus: 'unknown' });
  const first = member('2', A1, 'correction');
  const second = member('3', A2, 'correction');
  const graph = snapshot(
    [root, first, second],
    [relation('1', first, root), relation('2', second, first)],
    control('select', root.receipt.id),
  );
  const selected = resolveVerifiedFamilyGraph(graph);
  assert.equal(selected.resolutionStatus, 'manual_selected');
  assert.equal(selected.selectedReceiptNumber, ROOT);
  assert.equal(selected.selectionMode, 'manual');
  for (const overrides of [
    { legalStatus: 'withdrawn' as const },
    { legalStatus: 'cancelled' as const },
    { lineageStatus: 'conflicted' as const },
    { lineageStatus: 'quarantined' as const },
  ]) {
    const ineligibleRoot = member('1', ROOT, 'root', overrides);
    const current = member('2', A1, 'correction');
    assert.throws(() => resolveVerifiedFamilyGraph(snapshot(
      [ineligibleRoot, current], [relation('1', current, ineligibleRoot)],
      control('select', ineligibleRoot.receipt.id),
    )), resolutionError('FILING_RESOLUTION_MANUAL_SELECTION_INELIGIBLE'));
  }
});

test('manual selection requires its own verified path but may override other incompleteness', () => {
  const root = member('1', ROOT, 'root');
  const first = member('2', A1, 'correction', { legalStatus: 'unknown' });
  const disconnected = member('3', A2, 'correction');
  const selected = resolveVerifiedFamilyGraph(snapshot(
    [root, first, disconnected], [relation('1', first, root)],
    control('select', first.receipt.id),
  ));
  assert.equal(selected.resolutionStatus, 'manual_selected');
  assert.throws(() => resolveVerifiedFamilyGraph(snapshot(
    [root, first, disconnected], [relation('1', first, root)],
    control('select', disconnected.receipt.id),
  )), resolutionError('FILING_RESOLUTION_MANUAL_SELECTION_INELIGIBLE'));
  const corrupted = snapshot([root], [], control('select', '999'));
  assert.throws(() => resolveVerifiedFamilyGraph(corrupted),
    resolutionError('FILING_RESOLUTION_GRAPH_INTEGRITY_FAILURE'));
});

test('fingerprint, role, company, and cycle corruption fail closed', () => {
  const root = member('1', ROOT, 'root');
  const first = member('2', A1, 'correction');
  const valid = snapshot([root, first], [relation('1', first, root)]);
  assert.throws(() => resolveVerifiedFamilyGraph({
    ...valid, family: { ...valid.family, fingerprint: 'f'.repeat(64) },
  }), resolutionError('FILING_RESOLUTION_GRAPH_INTEGRITY_FAILURE'));
  assert.throws(() => resolveVerifiedFamilyGraph(snapshot([
    root, member('2', A1, 'correction', { corpCode: '22222222' }),
  ], [])), resolutionError('FILING_RESOLUTION_GRAPH_INTEGRITY_FAILURE'));
  const invalidRoot = member('1', ROOT, 'correction');
  assert.throws(() => resolveVerifiedFamilyGraph(snapshot([invalidRoot], [])),
    resolutionError('FILING_RESOLUTION_GRAPH_INTEGRITY_FAILURE'));
  const back = relation('2', root, first);
  assert.throws(() => resolveVerifiedFamilyGraph(snapshot(
    [root, first], [relation('1', first, root), back],
  )), resolutionError('FILING_RESOLUTION_GRAPH_INTEGRITY_FAILURE'));
});

test('resolution and fingerprint are stable across snapshot time and insertion order', () => {
  const root = member('1', ROOT, 'root');
  const first = member('2', A1, 'correction');
  const second = member('3', A2, 'correction');
  const edges = [relation('1', first, root), relation('2', second, first)];
  const left = resolveVerifiedFamilyGraph(snapshot([root, first, second], edges));
  const right = resolveVerifiedFamilyGraph(snapshot(
    [second, root, first], [...edges].reverse(), null, '2099-01-10T01:00:00.000Z',
  ));
  assert.equal(left.resolutionFingerprint, right.resolutionFingerprint);
  assert.equal(left.selectedReceiptNumber, right.selectedReceiptNumber);
  assert.notEqual(left.snapshotResolvedAt, right.snapshotResolvedAt);
});

test('manual control changes participate in the resolution fingerprint', () => {
  const root = member('1', ROOT, 'root', { lineageStatus: 'unresolved' });
  const automatic = resolveVerifiedFamilyGraph(snapshot([root], []));
  const held = resolveVerifiedFamilyGraph(snapshot([root], [], control('hold', null)));
  const selected = resolveVerifiedFamilyGraph(snapshot([root], [], control('select', '1')));
  assert.notEqual(automatic.resolutionFingerprint, held.resolutionFingerprint);
  assert.notEqual(held.resolutionFingerprint, selected.resolutionFingerprint);
});
