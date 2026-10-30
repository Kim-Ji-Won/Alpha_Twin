import assert from 'node:assert/strict';
import { Client, Pool, PoolConfig } from 'pg';
import { AdmissionDenied, AdmissionGuard } from '../../src/filingIntelligence/admission/guard.js';
import { FilingRetrievalActivationRepository } from '../../src/filingIntelligence/activation/filingRetrievalActivationRepository.js';
import { FilingRetrievalActivationService } from '../../src/filingIntelligence/activation/filingRetrievalActivationService.js';
import { FilingEligibilityRepository } from '../../src/filingIntelligence/eligibility/filingEligibilityRepository.js';
import { FILING_RETRIEVAL_POLICY } from '../../src/filingIntelligence/eligibility/policies.js';
import { FilingLexicalRepository } from '../../src/filingIntelligence/lexical/filingLexicalRepository.js';
import { FilingLineageRepository } from '../../src/filingIntelligence/lineage/filingLineageRepository.js';
import { FilingDocumentRepository } from '../../src/filingIntelligence/persistence/filingDocumentRepository.js';
import { VerifiedFilingGraphRepository } from '../../src/filingIntelligence/resolution/graphRepository.js';
import { FilingResolutionService } from '../../src/filingIntelligence/resolution/service.js';
import { evidence, SYNTHETIC_NOW } from '../../test/fixtures/admission.js';
import { syntheticPersistenceInputFor } from './filingFixture.js';

// Called only by the fresh-cluster orchestrator after provenance verification.
// No environment URL, DB reset, migrations, or default connection is used here.
export async function runGuardedPostgresCases(config: PoolConfig,
  record: (event: Record<string, unknown>) => void): Promise<void> {
  assert.equal(config.host, '127.0.0.1');
  assert.ok([55455, 55456, 55457, 55458, 55459].includes(config.port!));
  assert.equal(config.database, 'alpha_twin_benchmark_test');
  assert.ok(config.user?.startsWith('guarded_test_'));
  const policy = FILING_RETRIEVAL_POLICY.policyId;
  const pool = new Pool({ ...config, max: 3 });
  try {
    for (let id = 1; id <= 4; id++) {
      const caseId = `T${id}`;
      record({ caseId, stage: 'fixture' });
      const receiptNumber = `2099010100000${id}`;
      const company = { corpCode: `8888888${id}`, symbol: `88888${id}` };
      const lineage = new FilingLineageRepository(pool);
      const fixture = syntheticPersistenceInputFor({ receiptNumber, ...company, companyName: 'SYNTHETIC GUARDED TEST' });
      const document = await new FilingDocumentRepository(pool).persistCanonicalFiling({ ...fixture,
        metadata: { ...fixture.metadata, legalStatus: 'reported_active',
          metadataSource: 'synthetic-guarded-postgres-test', metadataObservedAt: SYNTHETIC_NOW } });
      if (id === 1 || id === 4) {
        await new FilingLexicalRepository(pool).indexFilingDocumentLexically(document.documentId);
      }
      const input = { provider: 'opendart-fss' as const, ...company, lineageRootReceiptNumber: receiptNumber };
      const family = await lineage.persistVerifiedReportFamily({ ...input,
        verificationSource: 'trusted_backfill', verificationReferenceHash: 'd'.repeat(64) });
      const graphs = new VerifiedFilingGraphRepository(pool);
      const resolution = await new FilingResolutionService(graphs).resolveCurrentEffectiveReceiptCandidate(input);
      assert.equal(resolution.selectedReceiptNumber, receiptNumber);
      let now = SYNTHETIC_NOW;
      let writeObserved = false;
      let writePid: number | undefined;
      const guard = new AdmissionGuard({ async load(binding, client) {
        if (id === 2 && client && binding.documentId && !writeObserved) {
          // A sequential read on the exact service transaction, after its real evaluator.
          const written = await client.query(
            `SELECT status, revision::text, pg_backend_pid() AS pid
             FROM filing_intelligence.filing_retrieval_eligibility
             WHERE document_id=$1 AND retrieval_policy_id=$2`, [document.documentId, policy]);
          if (written.rows.length) {
            assert.equal(written.rows.length, 1);
            assert.equal(written.rows[0].status, 'ineligible');
            assert.equal(written.rows[0].revision, '1');
            writeObserved = true;
            writePid = written.rows[0].pid;
            record({ caseId, stage: 'uncommitted-write-observed', row: written.rows[0] });
            now = new Date(Date.parse(SYNTHETIC_NOW) + 86400001).toISOString();
          }
        }
        return evidence(binding);
      } }, { now: () => now });
      const appName = `guarded_isolated_${caseId}`;
      const servicePool = new Pool({ ...config, application_name: appName, max: 1 });
      const service = FilingRetrievalActivationService.guarded(
        new FilingRetrievalActivationRepository(servicePool), new VerifiedFilingGraphRepository(servicePool),
        new FilingEligibilityRepository(servicePool), guard);
      const snapshot = async () => {
        const observer = new Client(config);
        try {
          await observer.connect();
          await observer.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          const readonly = await observer.query('SHOW transaction_read_only');
          assert.equal(readonly.rows[0].transaction_read_only, 'on');
          const pid = (await observer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          const eligibility = await observer.query(
            `SELECT document_id::text, receipt_id::text, status, reason_code, revision::text,
                    eligibility_fingerprint, representation_fingerprint, lexical_generation_id::text
             FROM filing_intelligence.filing_retrieval_eligibility
             WHERE document_id=$1 AND retrieval_policy_id=$2`, [document.documentId, policy]);
          const activation = await observer.query(
            `SELECT document_id::text, receipt_id::text, status, activation_revision::text,
                    eligibility_fingerprint, representation_fingerprint, lexical_generation_id::text
             FROM filing_intelligence.filing_retrieval_activation
             WHERE family_id=$1 AND retrieval_policy_id=$2`, [family.familyId, policy]);
          const history = await observer.query(
            `SELECT count(*)::integer AS count FROM filing_intelligence.filing_retrieval_activation_history
             WHERE family_id=$1 AND retrieval_policy_id=$2`, [family.familyId, policy]);
          await observer.query('COMMIT');
          return { pid, eligibility: eligibility.rows, activation: activation.rows, history: history.rows[0].count };
        } finally { await observer.end(); }
      };
      try {
        const before = await snapshot();
        assert.equal(before.eligibility.length + before.activation.length + before.history, 0);
        const apply = () => service.apply({ resolution, retrievalPolicyId: policy });
        if (id === 4) {
          const locker = new Client(config);
          const observer = new Client(config);
          let pending: ReturnType<typeof apply> | undefined;
          try {
            await locker.connect(); await observer.connect();
            await locker.query('BEGIN');
            const lockerPid = (await locker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
            await locker.query('SELECT id FROM filing_intelligence.filing_report_family WHERE id=$1 FOR UPDATE', [family.familyId]);
            pending = apply();
            // Attach rejection handling immediately; assert the actual error after releasing the lock.
            void pending.catch(() => {});
            const deadline = Date.now() + 8000;
            let blocked = false;
            while (Date.now() < deadline) {
              const waiting = await observer.query(
                `SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
                 WHERE application_name=$1 AND datname=current_database()`, [appName]);
              const row = waiting.rows.find(row => row.blockers.includes(lockerPid));
              if (row) {
                blocked = true;
                record({ caseId, stage: 'actual-lock-wait-observed', servicePid: row.pid, lockerPid, blockers: row.blockers });
                break;
              }
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            assert.ok(blocked, 'actual lock wait was not observed');
            now = new Date(Date.parse(SYNTHETIC_NOW) + 86400001).toISOString();
            await locker.query('ROLLBACK');
            await assert.rejects(pending, value => value instanceof AdmissionDenied && value.reasons.includes('EXPIRED'));
          } finally {
            await locker.end(); await observer.end();
            if (pending) await pending.catch(() => {});
          }
        } else if (id === 2) {
          await assert.rejects(apply(), value => value instanceof AdmissionDenied && value.reasons.includes('EXPIRED'));
          assert.ok(writeObserved, 'real evaluator write must precede rollback');
        } else {
          const result = await apply();
          assert.equal(result.status, id === 1 ? 'activated' : 'candidate_not_ready');
          record({ caseId, stage: 'service-return', status: result.status });
        }
        const after = await snapshot();
        if (id === 1) {
          assert.equal(after.eligibility.length, 1); assert.equal(after.activation.length, 1);
          assert.equal(after.history, 1);
          assert.equal(after.eligibility[0].status, 'eligible');
          assert.equal(after.activation[0].status, 'active');
          assert.equal(after.activation[0].activation_revision, '1');
          for (const field of ['document_id', 'receipt_id', 'eligibility_fingerprint', 'representation_fingerprint', 'lexical_generation_id']) {
            assert.equal(after.eligibility[0][field], after.activation[0][field]);
            assert.ok(after.activation[0][field]);
          }
          assert.equal(after.activation[0].document_id, document.documentId);
          assert.equal(after.activation[0].receipt_id, resolution.selectedReceiptId);
        } else if (id === 3) {
          assert.equal(after.eligibility.length, 1);
          assert.equal(after.eligibility[0].status, 'ineligible');
          assert.equal(after.eligibility[0].reason_code, 'lexical_generation_missing');
          assert.equal(after.eligibility[0].revision, '1');
          assert.equal(after.activation.length + after.history, 0);
        } else {
          assert.deepEqual({ ...after, pid: 0 }, { ...before, pid: 0 });
          if (id === 2) assert.notEqual(after.pid, writePid);
        }
        record({ caseId, stage: 'PASS', familyId: family.familyId, documentId: document.documentId, after });
      } finally { await servicePool.end(); }
    }
  } finally { await pool.end(); }
}
