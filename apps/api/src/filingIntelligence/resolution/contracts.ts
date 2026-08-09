import {
  FilingLegalStatus,
  FilingLineageStatus,
  FilingProvider,
  VerifiedRelationSource,
} from '../lineage/contracts.js';

export const RESOLUTION_CONTROL_MODES = ['automatic', 'hold', 'select'] as const;
export type ResolutionControlMode = typeof RESOLUTION_CONTROL_MODES[number];

export const RESOLUTION_CONTROL_ACTIONS = ['hold', 'select', 'clear'] as const;
export type ResolutionControlAction = typeof RESOLUTION_CONTROL_ACTIONS[number];

export const RESOLUTION_REASON_CODES = [
  'lineage_ambiguous', 'missing_authoritative_relation', 'legal_status_review',
  'emergency_hold', 'manual_verified_selection', 'rollback_candidate',
  'data_integrity_review', 'control_cleared',
] as const;
export type ResolutionReasonCode = typeof RESOLUTION_REASON_CODES[number];

export const RESOLVER_ID = 'opendart-current-effective';
export const RESOLVER_VERSION = '1.0.0';

export interface ResolveFamilyInput {
  readonly provider: FilingProvider;
  readonly corpCode: string;
  readonly symbol: string;
  readonly lineageRootReceiptNumber: string;
}

interface ManualControlCommandBase {
  readonly familyId: string;
  readonly expectedRevision: string | null;
  readonly reasonCode: ResolutionReasonCode;
  readonly referenceHash: string;
  readonly actorReferenceHash?: string;
}

export interface SetResolutionHoldInput extends ManualControlCommandBase {
  readonly expiresAt?: string;
}

export interface SetManualReceiptSelectionInput extends ManualControlCommandBase {
  readonly selectedReceiptId: string;
  readonly expiresAt?: string;
}

export type ClearResolutionControlInput = ManualControlCommandBase;

export interface ResolutionControlPersistenceResult {
  readonly status: 'updated' | 'already_present';
  readonly familyId: string;
  readonly mode: ResolutionControlMode;
  readonly selectedReceiptId: string | null;
  readonly revision: string;
  readonly controlFingerprint: string;
}

export interface StoredResolutionControl {
  readonly familyId: string;
  readonly mode: ResolutionControlMode;
  readonly selectedReceiptId: string | null;
  readonly reasonCode: ResolutionReasonCode;
  readonly referenceHash: string;
  readonly actorReferenceHash: string | null;
  readonly expiresAt: string | null;
  readonly revision: string;
  readonly controlFingerprint: string;
}

export interface ResolutionReceiptSnapshot {
  readonly id: string;
  readonly provider: FilingProvider;
  readonly receiptNumber: string;
  readonly corpCode: string;
  readonly symbol: string;
  readonly legalStatus: FilingLegalStatus;
  readonly lineageStatus: FilingLineageStatus;
}

export interface ResolutionMemberSnapshot {
  readonly role: 'root' | 'correction';
  readonly source: VerifiedRelationSource;
  readonly membershipFingerprint: string;
  readonly receipt: ResolutionReceiptSnapshot;
}

export interface ResolutionRelationSnapshot {
  readonly id: string;
  readonly correctionReceiptId: string;
  readonly correctsReceiptId: string;
  readonly relationType: 'corrects';
  readonly relationSource: VerifiedRelationSource;
  readonly verificationReferenceHash: string;
  readonly relationFingerprint: string;
}

export interface VerifiedFamilyGraphSnapshot {
  readonly databaseNow: string;
  readonly family: {
    readonly id: string;
    readonly provider: FilingProvider;
    readonly corpCode: string;
    readonly symbol: string;
    readonly lineageRootReceiptId: string;
    readonly lineageRootReceiptNumber: string;
    readonly status: 'verified' | 'conflicted' | 'quarantined';
    readonly revision: string;
    readonly fingerprint: string;
  };
  readonly members: readonly ResolutionMemberSnapshot[];
  readonly relations: readonly ResolutionRelationSnapshot[];
  readonly manualControl: StoredResolutionControl | null;
}

export const RESOLUTION_STATUSES = [
  'resolved', 'manual_selected', 'manual_hold', 'family_not_found',
  'graph_incomplete', 'ambiguous_terminal_branch', 'legal_status_unresolved',
  'terminal_legally_ineligible', 'lineage_status_ineligible',
] as const;
export type ResolutionStatus = typeof RESOLUTION_STATUSES[number];
export type ResolutionSelectionMode = 'automatic' | 'manual' | 'none';

export interface CurrentEffectiveReceiptResolution {
  readonly familyId: string | null;
  readonly provider: FilingProvider;
  readonly corpCode: string;
  readonly symbol: string;
  readonly lineageRootReceiptId: string | null;
  readonly lineageRootReceiptNumber: string;
  readonly familyRevision: string | null;
  readonly familyFingerprint: string | null;
  readonly resolverId: typeof RESOLVER_ID;
  readonly resolverVersion: typeof RESOLVER_VERSION;
  readonly resolutionStatus: ResolutionStatus;
  readonly resolutionReasonCode: ResolutionStatus;
  readonly resolutionFingerprint: string;
  readonly selectedReceiptId: string | null;
  readonly selectedReceiptNumber: string | null;
  readonly selectionMode: ResolutionSelectionMode;
  readonly terminalReceiptIds: readonly string[];
  readonly terminalReceiptNumbers: readonly string[];
  readonly memberCount: number;
  readonly relationCount: number;
  readonly manualControlRevision: string | null;
  readonly snapshotResolvedAt: string;
}
