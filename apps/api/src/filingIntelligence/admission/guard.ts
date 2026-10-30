import type { PoolClient } from 'pg';
import { fingerprint } from '../../../evaluation/filingDense/evidenceMapping/input.js';
import { parseInstant } from '../../../evaluation/filingDense/evidenceMapping/input.js';
import { AdmissionEvidence, assessEvidence, Binding, GateResult, Operation } from './policy.js';
import type { ActiveCompanyFilingScope, ActiveFamilyFilingScope } from '../activeScope/contracts.js';
import { EvidenceProviderError } from './providerErrors.js';

export class AdmissionDenied extends Error {
  readonly code = 'FILING_ADMISSION_DENIED';
  constructor(readonly reasons: readonly string[]) { super('FILING_ADMISSION_DENIED'); }
}
export interface EvidenceProvider {
  // Internal DI only. Must independently bind the loaded evidence to current DB/reviewer authority.
  // Transaction-aware implementations use this client, not another snapshot/connection.
  load(binding: Binding, client?: PoolClient, operation?: Operation): Promise<AdmissionEvidence | null>;
}
export interface AdmissionClock { now(): string }
export const systemAdmissionClock: AdmissionClock = Object.freeze({ now: () => new Date().toISOString() });
export class AdmissionGuard {
  constructor(private readonly provider: EvidenceProvider, private readonly clock: AdmissionClock = systemAdmissionClock) {
    if (!provider || typeof provider.load !== 'function' || !clock || typeof clock.now !== 'function') {
      throw new AdmissionDenied(['EVIDENCE_PROVIDER_REQUIRED']);
    }
  }
  session(): AdmissionSession { return new AdmissionSession(this); }
  now(): string { return this.clock.now(); }
  async inspect(binding: Binding, operation: Operation, client?: PoolClient): Promise<GateResult> {
    let evidence: AdmissionEvidence | null;
    try { evidence = await this.provider.load(structuredClone(binding), client, operation); }
    catch (error) {
      throw new AdmissionDenied([error instanceof EvidenceProviderError ? error.code : 'EVIDENCE_PROVIDER_FAILED']);
    }
    if (!evidence) throw new AdmissionDenied(['EVIDENCE_UNAVAILABLE']);
    let result: GateResult;
    try { result = assessEvidence(evidence, binding, operation, this.clock.now()); }
    catch { throw new AdmissionDenied(['EVIDENCE_INVALID']); }
    if (!result.allowed) throw new AdmissionDenied(result.reasons);
    return result;
  }
}
export function requireAdmissionGuard(guard: AdmissionGuard): AdmissionGuard {
  if (!(guard instanceof AdmissionGuard)) throw new AdmissionDenied(['GUARD_REQUIRED']);
  return guard;
}
// Only these flat-entry scope DTOs are supported. Never freeze caller-owned values.
function snapshotScope<T extends ActiveCompanyFilingScope | ActiveFamilyFilingScope>(input: T): T {
  const copy = structuredClone(input);
  Object.freeze(copy.documentIds);
  if ('entries' in copy) {
    copy.entries.forEach(Object.freeze); copy.vetoes.forEach(Object.freeze);
    Object.freeze(copy.entries); Object.freeze(copy.vetoes);
  } else {
    if (copy.entry) Object.freeze(copy.entry);
    if (copy.veto) Object.freeze(copy.veto);
  }
  return Object.freeze(copy);
}
export class AdmissionSession {
  private readonly pins = new Map<string, string>();
  private readonly bindings = new Map<string, Record<string, string | null>>();
  private scopeDigest: string | undefined;
  private lastTime = -Infinity;
  private validUntil = Infinity;
  private readonly writes = new Map<string, Binding>();
  constructor(private readonly guard: AdmissionGuard) {}
  async check(binding: Binding, operation: Operation, client?: PoolClient): Promise<GateResult> {
    const result = await this.guard.inspect(binding, operation, client);
    const time = parseInstant(result.evaluatedAt)!;
    if (time < this.lastTime) throw new AdmissionDenied(['CLOCK_REVERSED']);
    this.lastTime = time;
    this.validUntil = Math.min(this.validUntil, parseInstant(result.validUntil)!);
    const key = fingerprint([binding.provider, binding.corpCode, binding.receiptNumber, binding.familyId]);
    const pin = this.pins.get(key);
    if (pin !== undefined && pin !== result.evidenceDigest) throw new AdmissionDenied(['EVIDENCE_REVISION_CHANGED']);
    const bound = this.bindings.get(key) ?? {};
    for (const field of ['familyRevision', 'familyFingerprint', 'currentFamilyRevision', 'currentFamilyFingerprint',
      'receiptId', 'lineageRootReceiptNumber', 'retrievalPolicyId', 'retrievalPolicyFingerprint']) {
      if (Object.hasOwn(binding, field)) {
        if (Object.hasOwn(bound, field) && bound[field] !== binding[field]) throw new AdmissionDenied(['TARGET_REVISION_CHANGED']);
        bound[field] = binding[field]!;
      }
    }
    this.bindings.set(key, bound);
    this.pins.set(key, result.evidenceDigest);
    return result;
  }
  async beforeWrite(binding: Binding, client: PoolClient): Promise<void> {
    const copy = structuredClone(binding);
    await this.check(copy, 'admission', client);
    this.writes.set(fingerprint(copy), copy);
  }
  async finalizeWrites(client: PoolClient): Promise<void> {
    for (const binding of this.writes.values()) await this.check(binding, 'admission', client);
    this.assertCurrent();
  }
  private assertCurrent(): void {
    const now = parseInstant(this.guard.now());
    if (now === null || now < this.lastTime) throw new AdmissionDenied(['CLOCK_INVALID']);
    this.lastTime = now;
    if (now > this.validUntil) throw new AdmissionDenied(['EXPIRED']);
  }
  async scope<T extends ActiveCompanyFilingScope | ActiveFamilyFilingScope>(input: T): Promise<T> {
    const scope = snapshotScope(input);
    const entries = 'entries' in scope ? scope.entries : scope.entry ? [scope.entry] : [];
    const digest = fingerprint({ corpCode: scope.corpCode, symbol: scope.symbol, status: scope.status,
      policy: scope.retrievalPolicyId, policyFingerprint: scope.retrievalPolicyFingerprint, entries,
      vetoes: 'vetoes' in scope ? scope.vetoes : scope.veto });
    if (this.scopeDigest !== undefined && this.scopeDigest !== digest) throw new AdmissionDenied(['SCOPE_REVISION_CHANGED']);
    this.scopeDigest = digest;
    if (scope.status === 'active' && !entries.length) throw new AdmissionDenied(['SCOPE_BINDING_INVALID']);
    for (const entry of entries) await this.check({ provider: 'opendart-fss', corpCode: scope.corpCode,
      symbol: scope.symbol, ...entry, retrievalPolicyId: scope.retrievalPolicyId,
      retrievalPolicyFingerprint: scope.retrievalPolicyFingerprint }, 'use');
    this.assertCurrent();
    return scope;
  }
}
