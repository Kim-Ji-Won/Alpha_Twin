import { PoolClient } from 'pg';

import { FilingEligibilityError } from '../eligibility/errors.js';
import { FilingEligibilityRepository } from '../eligibility/filingEligibilityRepository.js';
import {
  FILING_REPRESENTATION_POLICY,
  getRetrievalPolicy,
} from '../eligibility/policies.js';
import { serializeJson } from '../persistence/fingerprints.js';
import {
  CurrentEffectiveReceiptResolution,
  ResolveFamilyInput,
} from '../resolution/contracts.js';
import { FilingResolutionError } from '../resolution/errors.js';
import { VerifiedFilingGraphRepository } from '../resolution/graphRepository.js';
import { resolveVerifiedFamilyGraph } from '../resolution/resolver.js';
import {
  ActivationFingerprintInput,
  ApplyFilingRetrievalActivationInput,
  ApplyFilingRetrievalActivationResult,
  FilingRetrievalActivationEvent,
  FilingRetrievalActivationReason,
  FilingRetrievalActivationState,
} from './contracts.js';
import { FilingRetrievalActivationError } from './errors.js';
import {
  activationEventFingerprint,
  activationFingerprint,
} from './fingerprints.js';
import {
  FilingRetrievalActivationRepository,
  LockedFamilyIdentity,
} from './filingRetrievalActivationRepository.js';
import { activationActionFor } from './transitionPolicy.js';

const BIGINT = /^[1-9]\d{0,18}$/;

function error(code: FilingRetrievalActivationError['code'], cause?: unknown) {
  return new FilingRetrievalActivationError(code, false, cause == null ? undefined : { cause });
}

function postgresCode(value: unknown): string | undefined {
  return typeof value === 'object' && value !== null && 'code' in value
    && typeof value.code === 'string' ? value.code : undefined;
}

function mapError(value: unknown): FilingRetrievalActivationError {
  if (value instanceof FilingRetrievalActivationError) return value;
  if (value instanceof FilingResolutionError) {
    return error('FILING_ACTIVATION_INTEGRITY_FAILURE', value);
  }
  if (value instanceof FilingEligibilityError) {
    if (value.code === 'FILING_ELIGIBILITY_POLICY_UNKNOWN'
      || value.code === 'FILING_ELIGIBILITY_INVALID_INPUT') {
      return error('FILING_ACTIVATION_INVALID_INPUT', value);
    }
    return error('FILING_ACTIVATION_INTEGRITY_FAILURE', value);
  }
  const code = postgresCode(value);
  if (code === '23503' || code === '23505' || code === '23514' || code === '22P02') {
    return error('FILING_ACTIVATION_INTEGRITY_FAILURE', value);
  }
  return new FilingRetrievalActivationError(
    'FILING_ACTIVATION_TRANSACTION_FAILED',
    code == null || code.startsWith('08') || code === '40001'
      || code === '40P01' || code === '57014',
    { cause: value },
  );
}

function fingerprintInput(state: FilingRetrievalActivationState): ActivationFingerprintInput {
  return {
    familyId: state.familyId,
    retrievalPolicyId: state.retrievalPolicyId,
    retrievalPolicyFingerprint: state.retrievalPolicyFingerprint,
    status: state.status,
    receiptId: state.receiptId,
    documentId: state.documentId,
    familyRevision: state.familyRevision,
    familyFingerprint: state.familyFingerprint,
    resolutionFingerprint: state.resolutionFingerprint,
    resolverId: state.resolverId,
    resolverVersion: state.resolverVersion,
    manualControlRevision: state.manualControlRevision,
    selectionMode: state.selectionMode,
    eligibilityRevision: state.eligibilityRevision,
    eligibilityFingerprint: state.eligibilityFingerprint,
    representationPolicyId: state.representationPolicyId,
    representationPolicyFingerprint: state.representationPolicyFingerprint,
    representationFingerprint: state.representationFingerprint,
    lexicalGenerationId: state.lexicalGenerationId,
    lexicalGenerationFingerprint: state.lexicalGenerationFingerprint,
  };
}

function assertCurrentIntegrity(state: FilingRetrievalActivationState | null): void {
  if (state != null && activationFingerprint(fingerprintInput(state))
    !== state.activationFingerprint) {
    throw error('FILING_ACTIVATION_INTEGRITY_FAILURE');
  }
}

function resolutionEvidence(resolution: CurrentEffectiveReceiptResolution): string {
  return serializeJson({
    familyId: resolution.familyId,
    provider: resolution.provider,
    corpCode: resolution.corpCode,
    symbol: resolution.symbol,
    lineageRootReceiptId: resolution.lineageRootReceiptId,
    lineageRootReceiptNumber: resolution.lineageRootReceiptNumber,
    familyRevision: resolution.familyRevision,
    familyFingerprint: resolution.familyFingerprint,
    resolverId: resolution.resolverId,
    resolverVersion: resolution.resolverVersion,
    resolutionStatus: resolution.resolutionStatus,
    resolutionReasonCode: resolution.resolutionReasonCode,
    resolutionFingerprint: resolution.resolutionFingerprint,
    selectedReceiptId: resolution.selectedReceiptId,
    selectedReceiptNumber: resolution.selectedReceiptNumber,
    selectionMode: resolution.selectionMode,
    terminalReceiptIds: resolution.terminalReceiptIds,
    terminalReceiptNumbers: resolution.terminalReceiptNumbers,
    memberCount: resolution.memberCount,
    relationCount: resolution.relationCount,
    manualControlRevision: resolution.manualControlRevision,
  });
}

function assertFresh(
  supplied: CurrentEffectiveReceiptResolution,
  current: CurrentEffectiveReceiptResolution,
): void {
  if (resolutionEvidence(supplied) !== resolutionEvidence(current)) {
    throw error('FILING_ACTIVATION_STALE_RESOLUTION');
  }
}

function resolveInput(family: LockedFamilyIdentity): ResolveFamilyInput {
  if (family.provider !== 'opendart-fss') throw error('FILING_ACTIVATION_INTEGRITY_FAILURE');
  return {
    provider: family.provider,
    corpCode: family.corpCode,
    symbol: family.symbol,
    lineageRootReceiptNumber: family.lineageRootReceiptNumber,
  };
}

function baseState(
  current: FilingRetrievalActivationState | null,
  resolution: CurrentEffectiveReceiptResolution,
  policy: ReturnType<typeof getRetrievalPolicy>,
  databaseNow: Date,
): Omit<FilingRetrievalActivationState,
  'status' | 'receiptId' | 'documentId' | 'selectionMode' | 'eligibilityRevision'
  | 'eligibilityFingerprint' | 'representationPolicyId'
  | 'representationPolicyFingerprint' | 'representationFingerprint'
  | 'lexicalGenerationId' | 'lexicalGenerationFingerprint' | 'activationFingerprint'
  | 'activatedAt'> {
  if (resolution.familyId == null || resolution.familyRevision == null
    || resolution.familyFingerprint == null) throw error('FILING_ACTIVATION_INTEGRITY_FAILURE');
  return {
    familyId: resolution.familyId,
    retrievalPolicyId: policy.policyId,
    retrievalPolicyFingerprint: policy.fingerprint,
    familyRevision: resolution.familyRevision,
    familyFingerprint: resolution.familyFingerprint,
    resolutionFingerprint: resolution.resolutionFingerprint,
    resolverId: resolution.resolverId,
    resolverVersion: resolution.resolverVersion,
    manualControlRevision: resolution.manualControlRevision,
    activationRevision: current == null ? '1' : (BigInt(current.activationRevision) + 1n).toString(),
    stateChangedAt: databaseNow,
    createdAt: current?.createdAt ?? databaseNow,
    updatedAt: databaseNow,
  };
}

function withFingerprint(
  state: Omit<FilingRetrievalActivationState, 'activationFingerprint'>,
): FilingRetrievalActivationState {
  const candidate = { ...state, activationFingerprint: '' };
  return { ...candidate, activationFingerprint: activationFingerprint(fingerprintInput(candidate)) };
}

function transitionReason(
  eventType: FilingRetrievalActivationEvent,
  resolution: CurrentEffectiveReceiptResolution,
  current: FilingRetrievalActivationState | null,
  next: FilingRetrievalActivationState,
): FilingRetrievalActivationReason {
  if (eventType === 'activate') return 'initial_activation';
  if (eventType === 'deactivate') {
    return resolution.resolutionStatus === 'manual_hold'
      ? 'manual_hold' : 'terminal_legally_ineligible';
  }
  if (eventType === 'refresh') {
    return current?.eligibilityFingerprint !== next.eligibilityFingerprint
      || current.eligibilityRevision !== next.eligibilityRevision
      ? 'eligibility_refresh' : 'representation_refresh';
  }
  return resolution.selectionMode === 'manual' ? 'manual_selection' : 'automatic_resolution';
}

export class FilingRetrievalActivationService {
  constructor(
    private readonly repository: FilingRetrievalActivationRepository,
    private readonly graphs: VerifiedFilingGraphRepository,
    private readonly eligibility: FilingEligibilityRepository,
  ) {}

  async apply(
    input: ApplyFilingRetrievalActivationInput,
  ): Promise<ApplyFilingRetrievalActivationResult> {
    if (input.resolution.familyId == null || !BIGINT.test(input.resolution.familyId)) {
      throw error('FILING_ACTIVATION_INVALID_INPUT');
    }
    let policy: ReturnType<typeof getRetrievalPolicy>;
    try {
      policy = getRetrievalPolicy(input.retrievalPolicyId);
    } catch (cause) {
      throw mapError(cause);
    }
    try {
      return await this.repository.transaction(client => this.applyWithClient(
        client, input.resolution, policy,
      ));
    } catch (cause) {
      throw mapError(cause);
    }
  }

  private async applyWithClient(
    client: PoolClient,
    supplied: CurrentEffectiveReceiptResolution,
    policy: ReturnType<typeof getRetrievalPolicy>,
  ): Promise<ApplyFilingRetrievalActivationResult> {
    const time = await client.query<{ database_now: Date }>(
      'SELECT clock_timestamp() AS database_now',
    );
    const databaseNow = time.rows[0]?.database_now;
    if (!(databaseNow instanceof Date)) throw error('FILING_ACTIVATION_TRANSACTION_FAILED');
    const family = await this.repository.lockFamily(client, supplied.familyId!);
    if (family == null) throw error('FILING_ACTIVATION_FAMILY_NOT_FOUND');
    if (family.provider !== supplied.provider || family.corpCode !== supplied.corpCode
      || family.symbol !== supplied.symbol
      || family.lineageRootReceiptNumber !== supplied.lineageRootReceiptNumber) {
      throw error('FILING_ACTIVATION_STALE_RESOLUTION');
    }
    await this.repository.lockManualControl(client, family.id);
    const current = await this.repository.lockCurrent(client, family.id, policy.policyId);
    assertCurrentIntegrity(current);
    const graph = await this.graphs.loadWithClient(
      client, resolveInput(family), family.id, databaseNow,
    );
    if (graph.snapshot == null) throw error('FILING_ACTIVATION_INTEGRITY_FAILURE');
    const resolution = resolveVerifiedFamilyGraph(graph.snapshot);
    assertFresh(supplied, resolution);
    const action = activationActionFor(resolution.resolutionStatus);
    if (action === 'invalid') throw error('FILING_ACTIVATION_INVALID_INPUT');
    if (action === 'retain') return { status: 'retained_existing', activation: current };
    if (action === 'deactivate') {
      if (current == null) return { status: 'inactive_noop', activation: null };
      return this.deactivate(client, current, resolution, policy, databaseNow);
    }
    if (resolution.selectedReceiptId == null) {
      throw error('FILING_ACTIVATION_INTEGRITY_FAILURE');
    }
    const discoveredDocumentIds = await this.repository.findCompatibleDocumentIds(
      client, resolution.selectedReceiptId, FILING_REPRESENTATION_POLICY,
    );
    await this.repository.lockCandidateDocuments(client, discoveredDocumentIds);
    await this.repository.stabilizeSelectedReceipt(
      client, family.id, resolution.selectedReceiptId,
    );
    const documentIds = await this.repository.findCompatibleDocumentIds(
      client, resolution.selectedReceiptId, FILING_REPRESENTATION_POLICY,
    );
    const evaluations = [];
    for (const documentId of documentIds) {
      evaluations.push(await this.eligibility.evaluateDocumentEligibilityWithClient(
        client, documentId, policy.policyId, databaseNow,
      ));
    }
    const eligible = evaluations.filter(item => item.status === 'eligible');
    if (eligible.length === 0) {
      return { status: 'candidate_not_ready', activation: current };
    }
    if (eligible.length > 1) {
      throw error('FILING_ACTIVATION_REPRESENTATION_AMBIGUOUS');
    }
    const selected = eligible[0]!;
    if (selected.receiptId !== resolution.selectedReceiptId
      || selected.lexicalGenerationId == null
      || selected.lexicalGenerationFingerprint == null) {
      throw error('FILING_ACTIVATION_INTEGRITY_FAILURE');
    }
    const base = baseState(current, resolution, policy, databaseNow);
    const next = withFingerprint({
      ...base,
      status: 'active',
      receiptId: selected.receiptId,
      documentId: selected.documentId,
      selectionMode: resolution.selectionMode === 'manual' ? 'manual' : 'automatic',
      eligibilityRevision: selected.revision,
      eligibilityFingerprint: selected.eligibilityFingerprint,
      representationPolicyId: selected.representationPolicyId,
      representationPolicyFingerprint: selected.representationPolicyFingerprint,
      representationFingerprint: selected.representationFingerprint,
      lexicalGenerationId: selected.lexicalGenerationId,
      lexicalGenerationFingerprint: selected.lexicalGenerationFingerprint,
      activatedAt: current?.status === 'active'
        && current.documentId === selected.documentId ? current.activatedAt : databaseNow,
    });
    if (current?.activationFingerprint === next.activationFingerprint) {
      return { status: 'already_current', activation: current };
    }
    const eventType: FilingRetrievalActivationEvent = current == null
      || current.status === 'inactive' ? 'activate'
      : current.documentId === next.documentId ? 'refresh' : 'switch';
    return this.persist(client, current, next, eventType,
      transitionReason(eventType, resolution, current, next));
  }

  private async deactivate(
    client: PoolClient,
    current: FilingRetrievalActivationState,
    resolution: CurrentEffectiveReceiptResolution,
    policy: ReturnType<typeof getRetrievalPolicy>,
    databaseNow: Date,
  ): Promise<ApplyFilingRetrievalActivationResult> {
    const next = withFingerprint({
      ...baseState(current, resolution, policy, databaseNow),
      status: 'inactive', receiptId: null, documentId: null, selectionMode: 'none',
      eligibilityRevision: null, eligibilityFingerprint: null,
      representationPolicyId: null, representationPolicyFingerprint: null,
      representationFingerprint: null, lexicalGenerationId: null,
      lexicalGenerationFingerprint: null, activatedAt: null,
    });
    if (current.activationFingerprint === next.activationFingerprint) {
      return { status: 'inactive_noop', activation: current };
    }
    const eventType: FilingRetrievalActivationEvent = current.status === 'active'
      ? 'deactivate' : 'refresh';
    return this.persist(client, current, next, eventType,
      transitionReason(eventType, resolution, current, next));
  }

  private async persist(
    client: PoolClient,
    current: FilingRetrievalActivationState | null,
    next: FilingRetrievalActivationState,
    eventType: FilingRetrievalActivationEvent,
    reasonCode: FilingRetrievalActivationReason,
  ): Promise<ApplyFilingRetrievalActivationResult> {
    const eventFingerprint = activationEventFingerprint({
      activation: fingerprintInput(next),
      activationFingerprint: next.activationFingerprint,
      eventType,
      reasonCode,
      previousReceiptId: current?.receiptId ?? null,
      previousDocumentId: current?.documentId ?? null,
    });
    const written = await this.repository.writeTransition(client, {
      state: next, eventType, reasonCode, eventFingerprint,
      previousReceiptId: current?.receiptId ?? null,
      previousDocumentId: current?.documentId ?? null,
    });
    const status = eventType === 'activate' ? 'activated'
      : eventType === 'switch' ? 'switched'
      : eventType === 'deactivate' ? 'deactivated' : 'refreshed';
    return { status, activation: written };
  }
}
