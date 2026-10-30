import type { PoolClient } from 'pg';
import { fingerprint } from '../../../evaluation/filingDense/evidenceMapping/input.js';
import { AdmissionClock, AdmissionGuard, EvidenceProvider, systemAdmissionClock } from './guard.js';
import { ADMISSION_POLICY, AdmissionEvidence, Binding, Operation } from './policy.js';
import { ClaimAcceptanceReader, PreservedEvidenceReader, UnavailableClaimReader } from './artifactReader.js';
import { CurrentBindingReader } from './bindingReader.js';
import { EvidenceProviderError as Failure } from './providerErrors.js';

export interface ReadContexts {
  // Internal owner supplies a bounded RR/serializable read-only lease; no global pool fallback.
  withClient<T>(phase: 'preflight' | 'use', read: (client: PoolClient) => Promise<T>): Promise<T>;
}
export class PreservedAdmissionEvidenceProvider implements EvidenceProvider {
  constructor(private readonly artifacts: PreservedEvidenceReader,
    private readonly bindings: CurrentBindingReader,
    private readonly contexts: ReadContexts | undefined,
    private readonly claims: ClaimAcceptanceReader = new UnavailableClaimReader()) {}

  async load(binding: Binding, client?: PoolClient, operation: Operation = 'admission'): Promise<AdmissionEvidence> {
    const expected = structuredClone(binding);
    const bundle = await this.artifacts.read();
    const read = async (context: PoolClient) => {
      const current = await this.bindings.read(context, expected, bundle.target, operation);
      const accepted = await this.claims.read(current, bundle.revision);
      if (!accepted) throw new Failure('CLAIM_UNAVAILABLE');
      return { ...bundle, binding: expected, lineage: accepted.lineage,
        revision: fingerprint({ artifacts: bundle.revision, claims: accepted.revision, policy: ADMISSION_POLICY }),
        policyId: ADMISSION_POLICY.id, policyVersion: ADMISSION_POLICY.version, refresh: 'ok' as const };
    };
    // A supplied writer client always wins; never acquire an unrelated read connection inside its transaction.
    if (client) return read(client);
    if (!this.contexts) throw new Failure('DB_CONTEXT_REQUIRED');
    return this.contexts.withClient(operation === 'use' ? 'use' : 'preflight', async context => {
      if (!context || typeof context.query !== 'function') throw new Failure('DB_CONTEXT_REQUIRED');
      try {
        const settings = await context.query(`SELECT current_setting('transaction_read_only') AS read_only,
          current_setting('transaction_isolation') AS isolation`);
        if (settings.rows.length !== 1 || settings.rows[0].read_only !== 'on'
          || !['repeatable read', 'serializable'].includes(settings.rows[0].isolation)) throw new Failure('DB_CONTEXT_INVALID');
      } catch (error) { if (error instanceof Failure) throw error; throw new Failure('DB_QUERY_FAILED'); }
      return read(context);
    });
  }
}

// Opt-in internal composition. Pass the resulting guard to existing .guarded factories.
export function preservedAdmissionGuard(artifacts: PreservedEvidenceReader, contexts: ReadContexts,
  claims: ClaimAcceptanceReader = new UnavailableClaimReader(), clock: AdmissionClock = systemAdmissionClock): AdmissionGuard {
  return new AdmissionGuard(new PreservedAdmissionEvidenceProvider(artifacts, new CurrentBindingReader(), contexts, claims), clock);
}
