import type { PoolClient } from 'pg';
import type { ReceiptKey } from '../../../evaluation/filingDense/evidenceMapping/contracts.js';
import { getRetrievalPolicy } from '../eligibility/policies.js';
import { GraphRowCardinalityError, readBindingGraph } from '../resolution/graphRepository.js';
import { FilingResolutionError } from '../resolution/errors.js';
import { resolveVerifiedFamilyGraph } from '../resolution/resolver.js';
import { Binding, Operation } from './policy.js';
import { EvidenceProviderError as Failure } from './providerErrors.js';

function one(rows: Record<string, unknown>[]): Record<string, unknown> {
  if (!rows.length) throw new Failure('DB_ROW_MISSING');
  if (rows.length !== 1) throw new Failure('DB_CARDINALITY_INVALID');
  return rows[0]!;
}
export class CurrentBindingReader {
  async read(client: PoolClient, expected: Binding, target: ReceiptKey, operation: Operation = 'admission'): Promise<Binding> {
    if (!client || typeof client.query !== 'function') throw new Failure('DB_CONTEXT_REQUIRED');
    try {
      if (!/^[1-9]\d{0,18}$/.test(expected.familyId) || !expected.retrievalPolicyId
        || (expected.documentId != null && !/^[1-9]\d{0,18}$/.test(expected.documentId))) throw new Failure('DB_BINDING_MISMATCH');
      const loaded = await readBindingGraph(client, { provider: 'opendart-fss', corpCode: expected.corpCode,
        symbol: expected.symbol, lineageRootReceiptNumber: expected.lineageRootReceiptNumber }, expected.familyId);
      if (!loaded.snapshot) throw new Failure('DB_ROW_MISSING');
      const r = resolveVerifiedFamilyGraph(loaded.snapshot);
      if (!r.selectedReceiptNumber || !r.familyId) throw new Failure('DB_BINDING_MISMATCH');
      const policy = getRetrievalPolicy(expected.retrievalPolicyId);
      const current: Record<string, string | null> = {
        provider: r.provider, corpCode: r.corpCode, symbol: r.symbol,
        receiptNumber: r.selectedReceiptNumber, receiptId: r.selectedReceiptId,
        familyId: r.familyId, lineageRootReceiptNumber: r.lineageRootReceiptNumber,
        familyRevision: r.familyRevision, familyFingerprint: r.familyFingerprint,
        currentFamilyRevision: r.familyRevision, currentFamilyFingerprint: r.familyFingerprint,
        resolutionFingerprint: r.resolutionFingerprint, manualControlRevision: r.manualControlRevision,
        memberCount: String(r.memberCount), relationCount: String(r.relationCount),
        retrievalPolicyId: policy.policyId, retrievalPolicyFingerprint: policy.fingerprint,
      };
      const receipt = one((await client.query(
        `SELECT company_name, to_char(filing_date, 'YYYYMMDD') AS filing_date
         FROM filing_intelligence.filing_receipt WHERE id=$1 AND provider=$2
           AND receipt_number=$3 AND corp_code=$4 AND symbol=$5`,
        [r.selectedReceiptId, r.provider, r.selectedReceiptNumber, r.corpCode, r.symbol])).rows);
      if (receipt.company_name !== target.companyName || receipt.filing_date !== target.filingDate
        || r.selectedReceiptNumber !== target.receipt || r.corpCode !== target.corpCode || r.symbol !== target.symbol) {
        throw new Failure('DB_BINDING_MISMATCH');
      }
      if (expected.documentId != null) {
        const row = one((await client.query(
          `SELECT d.id::text AS "documentId", m.representation_fingerprint AS "representationFingerprint",
             m.representation_manifest_version AS manifest_version,
             d.canonical_schema_version, d.parser_version, d.chunker_version,
             e.revision::text AS "eligibilityRevision", e.eligibility_fingerprint AS "eligibilityFingerprint",
             e.representation_policy_id AS "representationPolicyId",
             e.representation_policy_fingerprint AS "representationPolicyFingerprint",
             g.id::text AS "lexicalGenerationId", g.lexical_fingerprint AS "lexicalGenerationFingerprint",
             g.status AS generation_status,
             a.activation_revision::text AS "activationRevision", a.activation_fingerprint AS "activationFingerprint",
             a.activated_at AS activated_at, a.selection_mode AS "selectionMode"
           FROM filing_intelligence.filing_document d
           JOIN filing_intelligence.filing_document_representation_manifest m ON m.document_id=d.id
           LEFT JOIN filing_intelligence.filing_retrieval_eligibility e ON e.document_id=d.id AND e.retrieval_policy_id=$6
           LEFT JOIN filing_intelligence.filing_lexical_generation g ON g.document_id=d.id AND g.profile_id=$7
           LEFT JOIN filing_intelligence.filing_retrieval_activation a ON a.family_id=$8 AND a.document_id=d.id
             AND a.retrieval_policy_id=$6 AND a.status='active'
           WHERE d.id=$1 AND d.receipt_id=$2 AND d.provider=$3 AND d.corp_code=$4 AND d.symbol=$5`,
          [expected.documentId, r.selectedReceiptId, r.provider, r.corpCode, r.symbol, policy.policyId, policy.lexicalProfileId, r.familyId])).rows);
        // Admission must still evaluate missing/not-ready candidates; use must recheck readiness.
        if (operation === 'use' && row.generation_status !== 'ready') throw new Failure('DB_BINDING_MISMATCH');
        if (row.manifest_version !== 'filing-representation-manifest@1'
          || !['canonical_schema_version', 'parser_version', 'chunker_version'].every(k => typeof row[k] === 'string' && row[k])) {
          throw new Failure('DB_BINDING_MISMATCH');
        }
        for (const key of ['documentId', 'representationFingerprint', 'eligibilityRevision', 'eligibilityFingerprint',
          'representationPolicyId', 'representationPolicyFingerprint', 'lexicalGenerationId', 'lexicalGenerationFingerprint',
          'activationRevision', 'activationFingerprint', 'selectionMode']) {
          if (row[key] !== null && typeof row[key] !== 'string') throw new Failure('DB_BINDING_MISMATCH');
          current[key] = row[key] as string | null;
        }
        if (!/^[a-f0-9]{64}$/.test(current.representationFingerprint ?? '')) throw new Failure('DB_BINDING_MISMATCH');
        if (row.activated_at !== null && !(row.activated_at instanceof Date)) throw new Failure('DB_BINDING_MISMATCH');
        current.activatedAt = row.activated_at instanceof Date ? row.activated_at.toISOString() : null;
      }
      for (const [key, value] of Object.entries(expected)) {
        if (!Object.hasOwn(current, key) || current[key] !== value) throw new Failure('DB_BINDING_MISMATCH');
      }
      return current as Binding;
    } catch (error) {
      if (error instanceof Failure) throw error;
      if (error instanceof GraphRowCardinalityError) throw new Failure('DB_CARDINALITY_INVALID');
      if (error instanceof FilingResolutionError) throw new Failure('DB_BINDING_MISMATCH');
      throw new Failure('DB_QUERY_FAILED');
    }
  }
}
