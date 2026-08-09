import {
  familyBaseFingerprint,
  familyGraphFingerprint,
  lineageFingerprint,
} from '../lineage/fingerprints.js';
import {
  CurrentEffectiveReceiptResolution,
  RESOLVER_ID,
  RESOLVER_VERSION,
  ResolutionMemberSnapshot,
  ResolutionRelationSnapshot,
  ResolutionStatus,
  ResolveFamilyInput,
  StoredResolutionControl,
  VerifiedFamilyGraphSnapshot,
} from './contracts.js';
import { FilingResolutionError } from './errors.js';

interface GraphAnalysis {
  readonly complete: boolean;
  readonly terminals: readonly ResolutionMemberSnapshot[];
  readonly rootReachableReceiptIds: ReadonlySet<string>;
}

function integrity(): never {
  throw new FilingResolutionError('FILING_RESOLUTION_GRAPH_INTEGRITY_FAILURE', false);
}

function receiptOrder(left: ResolutionMemberSnapshot, right: ResolutionMemberSnapshot): number {
  return left.receipt.receiptNumber.localeCompare(right.receipt.receiptNumber)
    || left.receipt.id.localeCompare(right.receipt.id);
}

function orderedRelations(
  snapshot: VerifiedFamilyGraphSnapshot,
): readonly ResolutionRelationSnapshot[] {
  const numbers = new Map(snapshot.members.map(member => [
    member.receipt.id, member.receipt.receiptNumber,
  ]));
  return [...snapshot.relations].sort((left, right) => {
    const leftCorrection = numbers.get(left.correctionReceiptId) ?? integrity();
    const rightCorrection = numbers.get(right.correctionReceiptId) ?? integrity();
    const leftCorrected = numbers.get(left.correctsReceiptId) ?? integrity();
    const rightCorrected = numbers.get(right.correctsReceiptId) ?? integrity();
    return leftCorrection.localeCompare(rightCorrection)
      || leftCorrected.localeCompare(rightCorrected)
      || left.relationType.localeCompare(right.relationType)
      || left.relationFingerprint.localeCompare(right.relationFingerprint);
  });
}

function expectedFamilyFingerprint(snapshot: VerifiedFamilyGraphSnapshot): string {
  const members = [...snapshot.members].sort(receiptOrder);
  if (members.length === 1 && snapshot.relations.length === 0
    && members[0]?.receipt.id === snapshot.family.lineageRootReceiptId
    && members[0]?.role === 'root') {
    return familyBaseFingerprint({
      provider: snapshot.family.provider,
      corpCode: snapshot.family.corpCode,
      symbol: snapshot.family.symbol,
      rootReceiptNumber: snapshot.family.lineageRootReceiptNumber,
    });
  }
  const byId = new Map(members.map(member => [member.receipt.id, member]));
  return familyGraphFingerprint({
    provider: snapshot.family.provider,
    corpCode: snapshot.family.corpCode,
    symbol: snapshot.family.symbol,
    rootReceiptNumber: snapshot.family.lineageRootReceiptNumber,
    members: members.map(member => ({
      receipt_number: member.receipt.receiptNumber,
      member_role: member.role,
      membership_fingerprint: member.membershipFingerprint,
    })),
    edges: orderedRelations(snapshot).map(relation => {
      const correction = byId.get(relation.correctionReceiptId) ?? integrity();
      const corrected = byId.get(relation.correctsReceiptId) ?? integrity();
      return {
        correction_receipt_number: correction.receipt.receiptNumber,
        corrects_receipt_number: corrected.receipt.receiptNumber,
        relation_type: relation.relationType,
        relation_fingerprint: relation.relationFingerprint,
      };
    }),
  });
}

function expectedControlFingerprint(control: StoredResolutionControl): string {
  return lineageFingerprint({
    familyId: control.familyId,
    mode: control.mode,
    selectedReceiptId: control.selectedReceiptId,
    reasonCode: control.reasonCode,
    referenceHash: control.referenceHash,
    actorReferenceHash: control.actorReferenceHash,
    expiresAt: control.expiresAt,
  });
}

function validateStoredGraph(snapshot: VerifiedFamilyGraphSnapshot): void {
  const { family } = snapshot;
  if (family.status !== 'verified' || !/^\d+$/.test(family.revision)) integrity();
  const ids = new Set<string>();
  const numbers = new Set<string>();
  let roots = 0;
  for (const member of snapshot.members) {
    const receipt = member.receipt;
    if (ids.has(receipt.id) || numbers.has(receipt.receiptNumber)
      || receipt.provider !== family.provider || receipt.corpCode !== family.corpCode
      || receipt.symbol !== family.symbol) integrity();
    ids.add(receipt.id);
    numbers.add(receipt.receiptNumber);
    if (member.role === 'root') {
      roots += 1;
      if (receipt.id !== family.lineageRootReceiptId
        || receipt.receiptNumber !== family.lineageRootReceiptNumber) integrity();
    } else if (receipt.id === family.lineageRootReceiptId) integrity();
    const memberFingerprint = lineageFingerprint({
      familyRoot: family.lineageRootReceiptNumber,
      receiptNumber: receipt.receiptNumber,
      role: member.role,
      source: member.source,
    });
    if (memberFingerprint !== member.membershipFingerprint) integrity();
  }
  if (roots !== 1 || !ids.has(family.lineageRootReceiptId)) integrity();
  const predecessors = new Set<string>();
  for (const relation of snapshot.relations) {
    if (!ids.has(relation.correctionReceiptId) || !ids.has(relation.correctsReceiptId)
      || relation.correctionReceiptId === relation.correctsReceiptId
      || predecessors.has(relation.correctionReceiptId)) integrity();
    predecessors.add(relation.correctionReceiptId);
    const correction = snapshot.members.find(item => item.receipt.id === relation.correctionReceiptId)!;
    const corrected = snapshot.members.find(item => item.receipt.id === relation.correctsReceiptId)!;
    const relationFingerprint = lineageFingerprint({
      familyRoot: family.lineageRootReceiptNumber,
      correctionReceiptNumber: correction.receipt.receiptNumber,
      correctsReceiptNumber: corrected.receipt.receiptNumber,
      relationType: relation.relationType,
      relationSource: relation.relationSource,
      relationReferenceHash: relation.verificationReferenceHash,
    });
    if (relationFingerprint !== relation.relationFingerprint) integrity();
  }
  const outgoing = new Map(snapshot.relations.map(relation => [
    relation.correctionReceiptId, relation.correctsReceiptId,
  ]));
  for (const member of snapshot.members) {
    const visited = new Set<string>();
    let current: string | undefined = member.receipt.id;
    while (current != null) {
      if (visited.has(current)) integrity();
      visited.add(current);
      current = outgoing.get(current);
    }
  }
  if (expectedFamilyFingerprint(snapshot) !== family.fingerprint) integrity();
  if (snapshot.manualControl != null) {
    if (snapshot.manualControl.familyId !== family.id
      || snapshot.manualControl.controlFingerprint
        !== expectedControlFingerprint(snapshot.manualControl)) integrity();
  }
}

function analyzeGraph(snapshot: VerifiedFamilyGraphSnapshot): GraphAnalysis {
  const byId = new Map(snapshot.members.map(member => [member.receipt.id, member]));
  const outgoing = new Map(snapshot.relations.map(relation => [
    relation.correctionReceiptId, relation.correctsReceiptId,
  ]));
  if (outgoing.has(snapshot.family.lineageRootReceiptId)) {
    return { complete: false, terminals: [], rootReachableReceiptIds: new Set() };
  }
  let complete = true;
  const rootReachableReceiptIds = new Set<string>();
  for (const member of snapshot.members) {
    if (member.role === 'correction' && !outgoing.has(member.receipt.id)) complete = false;
    const visited = new Set<string>();
    let current = member.receipt.id;
    let reachesRoot = true;
    while (current !== snapshot.family.lineageRootReceiptId) {
      if (visited.has(current)) integrity();
      visited.add(current);
      const next = outgoing.get(current);
      if (!next || !byId.has(next)) {
        complete = false;
        reachesRoot = false;
        break;
      }
      current = next;
    }
    if (reachesRoot) rootReachableReceiptIds.add(member.receipt.id);
  }
  const referencedAsPredecessor = new Set(snapshot.relations.map(item => item.correctsReceiptId));
  const terminals = snapshot.members
    .filter(member => !referencedAsPredecessor.has(member.receipt.id))
    .sort(receiptOrder);
  return { complete, terminals, rootReachableReceiptIds };
}

function isControlActive(control: StoredResolutionControl, databaseNow: string): boolean {
  return control.mode !== 'automatic'
    && (control.expiresAt == null || control.expiresAt > databaseNow);
}

function resolutionFingerprint(
  snapshot: VerifiedFamilyGraphSnapshot,
  status: ResolutionStatus,
  selectedReceiptId: string | null,
  terminals: readonly ResolutionMemberSnapshot[],
  manualActive: boolean,
): string {
  return lineageFingerprint({
    resolverId: RESOLVER_ID,
    resolverVersion: RESOLVER_VERSION,
    family: snapshot.family,
    members: [...snapshot.members].sort(receiptOrder),
    relations: orderedRelations(snapshot).map(relation => ({
      correctionReceiptNumber: snapshot.members.find(
        member => member.receipt.id === relation.correctionReceiptId,
      )?.receipt.receiptNumber ?? integrity(),
      correctsReceiptNumber: snapshot.members.find(
        member => member.receipt.id === relation.correctsReceiptId,
      )?.receipt.receiptNumber ?? integrity(),
      relationType: relation.relationType,
      relationSource: relation.relationSource,
      verificationReferenceHash: relation.verificationReferenceHash,
      relationFingerprint: relation.relationFingerprint,
    })),
    manualControl: snapshot.manualControl,
    manualActive,
    resolutionStatus: status,
    selectedReceiptId,
    terminalReceiptIds: terminals.map(item => item.receipt.id),
  });
}

function result(
  snapshot: VerifiedFamilyGraphSnapshot,
  status: ResolutionStatus,
  selected: ResolutionMemberSnapshot | null,
  terminals: readonly ResolutionMemberSnapshot[],
  manualActive: boolean,
): CurrentEffectiveReceiptResolution {
  return {
    familyId: snapshot.family.id,
    provider: snapshot.family.provider,
    corpCode: snapshot.family.corpCode,
    symbol: snapshot.family.symbol,
    lineageRootReceiptId: snapshot.family.lineageRootReceiptId,
    lineageRootReceiptNumber: snapshot.family.lineageRootReceiptNumber,
    familyRevision: snapshot.family.revision,
    familyFingerprint: snapshot.family.fingerprint,
    resolverId: RESOLVER_ID,
    resolverVersion: RESOLVER_VERSION,
    resolutionStatus: status,
    resolutionReasonCode: status,
    resolutionFingerprint: resolutionFingerprint(
      snapshot, status, selected?.receipt.id ?? null, terminals, manualActive,
    ),
    selectedReceiptId: selected?.receipt.id ?? null,
    selectedReceiptNumber: selected?.receipt.receiptNumber ?? null,
    selectionMode: status === 'manual_selected' ? 'manual'
      : status === 'resolved' ? 'automatic' : 'none',
    terminalReceiptIds: terminals.map(item => item.receipt.id),
    terminalReceiptNumbers: terminals.map(item => item.receipt.receiptNumber),
    memberCount: snapshot.members.length,
    relationCount: snapshot.relations.length,
    manualControlRevision: snapshot.manualControl?.revision ?? null,
    snapshotResolvedAt: snapshot.databaseNow,
  };
}

export function resolveVerifiedFamilyGraph(
  snapshot: VerifiedFamilyGraphSnapshot,
): CurrentEffectiveReceiptResolution {
  validateStoredGraph(snapshot);
  const graph = analyzeGraph(snapshot);
  const control = snapshot.manualControl;
  const manualActive = control != null && isControlActive(control, snapshot.databaseNow);
  if (manualActive && control?.mode === 'hold') {
    return result(snapshot, 'manual_hold', null, graph.terminals, true);
  }
  if (manualActive && control?.mode === 'select') {
    const selected = snapshot.members.find(member => member.receipt.id === control.selectedReceiptId);
    if (!selected) integrity();
    if (!graph.rootReachableReceiptIds.has(selected.receipt.id)) {
      throw new FilingResolutionError('FILING_RESOLUTION_MANUAL_SELECTION_INELIGIBLE', false);
    }
    if (selected.receipt.legalStatus === 'withdrawn'
      || selected.receipt.legalStatus === 'cancelled'
      || selected.receipt.lineageStatus === 'conflicted'
      || selected.receipt.lineageStatus === 'quarantined') {
      throw new FilingResolutionError('FILING_RESOLUTION_MANUAL_SELECTION_INELIGIBLE', false);
    }
    return result(snapshot, 'manual_selected', selected, graph.terminals, true);
  }
  if (!graph.complete) return result(snapshot, 'graph_incomplete', null, graph.terminals, false);
  if (graph.terminals.length !== 1) {
    return result(snapshot, 'ambiguous_terminal_branch', null, graph.terminals, false);
  }
  const terminal = graph.terminals[0]!;
  const rootOnly = snapshot.members.length === 1 && snapshot.relations.length === 0;
  if (terminal.receipt.lineageStatus !== 'resolved'
    && !(rootOnly && terminal.role === 'root' && terminal.receipt.lineageStatus === 'unresolved')) {
    return result(snapshot, 'lineage_status_ineligible', null, graph.terminals, false);
  }
  if (terminal.receipt.legalStatus === 'unknown') {
    return result(snapshot, 'legal_status_unresolved', null, graph.terminals, false);
  }
  if (terminal.receipt.legalStatus === 'withdrawn'
    || terminal.receipt.legalStatus === 'cancelled') {
    return result(snapshot, 'terminal_legally_ineligible', null, graph.terminals, false);
  }
  return result(snapshot, 'resolved', terminal, graph.terminals, false);
}

export function resolveFamilyNotFound(
  input: ResolveFamilyInput,
  databaseNow: string,
): CurrentEffectiveReceiptResolution {
  const status = 'family_not_found';
  return {
    familyId: null,
    provider: input.provider,
    corpCode: input.corpCode,
    symbol: input.symbol,
    lineageRootReceiptId: null,
    lineageRootReceiptNumber: input.lineageRootReceiptNumber,
    familyRevision: null,
    familyFingerprint: null,
    resolverId: RESOLVER_ID,
    resolverVersion: RESOLVER_VERSION,
    resolutionStatus: status,
    resolutionReasonCode: status,
    resolutionFingerprint: lineageFingerprint({
      resolverId: RESOLVER_ID, resolverVersion: RESOLVER_VERSION, input, status,
    }),
    selectedReceiptId: null,
    selectedReceiptNumber: null,
    selectionMode: 'none',
    terminalReceiptIds: [],
    terminalReceiptNumbers: [],
    memberCount: 0,
    relationCount: 0,
    manualControlRevision: null,
    snapshotResolvedAt: databaseNow,
  };
}
