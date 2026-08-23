import { CurrentEffectiveReceiptResolution } from '../resolution/contracts.js';

export const ACTIVATION_STATUSES = ['active', 'inactive'] as const;
export type FilingRetrievalActivationStatus = typeof ACTIVATION_STATUSES[number];

export const ACTIVATION_EVENTS = ['activate', 'switch', 'deactivate', 'refresh'] as const;
export type FilingRetrievalActivationEvent = typeof ACTIVATION_EVENTS[number];

export const ACTIVATION_REASONS = [
  'initial_activation', 'automatic_resolution', 'manual_selection',
  'manual_hold', 'terminal_legally_ineligible', 'representation_refresh',
  'eligibility_refresh',
] as const;
export type FilingRetrievalActivationReason = typeof ACTIVATION_REASONS[number];

export interface ApplyFilingRetrievalActivationInput {
  readonly resolution: CurrentEffectiveReceiptResolution;
  readonly retrievalPolicyId: string;
}

export interface FilingRetrievalActivationState {
  readonly familyId: string;
  readonly retrievalPolicyId: string;
  readonly retrievalPolicyFingerprint: string;
  readonly status: FilingRetrievalActivationStatus;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly familyRevision: string;
  readonly familyFingerprint: string;
  readonly resolutionFingerprint: string;
  readonly resolverId: string;
  readonly resolverVersion: string;
  readonly manualControlRevision: string | null;
  readonly selectionMode: 'automatic' | 'manual' | 'none';
  readonly eligibilityRevision: string | null;
  readonly eligibilityFingerprint: string | null;
  readonly representationPolicyId: string | null;
  readonly representationPolicyFingerprint: string | null;
  readonly representationFingerprint: string | null;
  readonly lexicalGenerationId: string | null;
  readonly lexicalGenerationFingerprint: string | null;
  readonly activationRevision: string;
  readonly activationFingerprint: string;
  readonly activatedAt: Date | null;
  readonly stateChangedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type ApplyFilingRetrievalActivationResult =
  | { readonly status: 'activated' | 'switched' | 'deactivated' | 'refreshed';
      readonly activation: FilingRetrievalActivationState }
  | { readonly status: 'already_current';
      readonly activation: FilingRetrievalActivationState }
  | { readonly status: 'retained_existing' | 'candidate_not_ready' | 'inactive_noop';
      readonly activation: FilingRetrievalActivationState | null };

export interface ActivationFingerprintInput {
  readonly familyId: string;
  readonly retrievalPolicyId: string;
  readonly retrievalPolicyFingerprint: string;
  readonly status: FilingRetrievalActivationStatus;
  readonly receiptId: string | null;
  readonly documentId: string | null;
  readonly familyRevision: string;
  readonly familyFingerprint: string;
  readonly resolutionFingerprint: string;
  readonly resolverId: string;
  readonly resolverVersion: string;
  readonly manualControlRevision: string | null;
  readonly selectionMode: 'automatic' | 'manual' | 'none';
  readonly eligibilityRevision: string | null;
  readonly eligibilityFingerprint: string | null;
  readonly representationPolicyId: string | null;
  readonly representationPolicyFingerprint: string | null;
  readonly representationFingerprint: string | null;
  readonly lexicalGenerationId: string | null;
  readonly lexicalGenerationFingerprint: string | null;
}
