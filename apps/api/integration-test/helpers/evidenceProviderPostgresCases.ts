import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client, Pool, PoolClient, PoolConfig, QueryResult } from 'pg';
import { AdmissionDenied, AdmissionGuard } from '../../src/filingIntelligence/admission/guard.js';
import { Binding, Operation } from '../../src/filingIntelligence/admission/policy.js';
import { ArtifactManifest, PreservedEvidenceReader, PinnedClaimReader, claimTarget } from '../../src/filingIntelligence/admission/artifactReader.js';
import { CurrentBindingReader } from '../../src/filingIntelligence/admission/bindingReader.js';
import { PreservedAdmissionEvidenceProvider } from '../../src/filingIntelligence/admission/evidenceProvider.js';
import { ReceiptKey, EXTRACTION_RULE, DECISION_RULE } from '../../evaluation/filingDense/evidenceMapping/contracts.js';
import { sha256 } from '../../evaluation/filingDense/evidenceMapping/input.js';
import { FilingRetrievalActivationRepository } from '../../src/filingIntelligence/activation/filingRetrievalActivationRepository.js';
import { FilingRetrievalActivationService } from '../../src/filingIntelligence/activation/filingRetrievalActivationService.js';
import { FilingEligibilityRepository } from '../../src/filingIntelligence/eligibility/filingEligibilityRepository.js';
import { FILING_RETRIEVAL_POLICY } from '../../src/filingIntelligence/eligibility/policies.js';
import { FilingLexicalRepository } from '../../src/filingIntelligence/lexical/filingLexicalRepository.js';
import { FilingLineageRepository } from '../../src/filingIntelligence/lineage/filingLineageRepository.js';
import { FilingDocumentRepository } from '../../src/filingIntelligence/persistence/filingDocumentRepository.js';
import { VerifiedFilingGraphRepository } from '../../src/filingIntelligence/resolution/graphRepository.js';
import { FilingResolutionService } from '../../src/filingIntelligence/resolution/service.js';
import { ActiveFilingScopeRepository } from '../../src/filingIntelligence/activeScope/activeFilingScopeRepository.js';
import { ActiveFilingScopeService } from '../../src/filingIntelligence/activeScope/activeFilingScopeService.js';
import { ActiveCompanyLexicalSearchService } from '../../src/filingIntelligence/retrieval/activeCompanyLexicalSearchService.js';
import { evidence, SYNTHETIC_NOW } from '../../test/fixtures/admission.js';
import { syntheticPersistenceInputFor } from './filingFixture.js';

type RecordEvent = (event: Record<string, unknown>) => void;
const policy = FILING_RETRIEVAL_POLICY.policyId;
const denied = (e: unknown) => e instanceof AdmissionDenied && e.reasons.includes('DB_BINDING_MISMATCH');

// No connection or fixture side effects at import. The owner verifies fresh-cluster provenance first.
export async function runEvidenceProviderPostgresCases(config: PoolConfig, root: string, record: RecordEvent): Promise<void> {
  assert.equal(config.host, '127.0.0.1');
  assert.ok([55456, 55457, 55458, 55459].includes(config.port!));
  assert.equal(config.database, 'alpha_twin_benchmark_test');
  assert.match(config.user!, /^evidence_test_[a-f0-9]+$/);
  const pool = new Pool({ ...config, max: 4, connectionTimeoutMillis: 5000,
    statement_timeout: 10000, query_timeout: 12000, idle_in_transaction_session_timeout: 15000 });
  const live = new Set<Client | PoolClient>();
  pool.on('acquire', client => live.add(client));
  pool.on('release', (_error, client) => live.delete(client));
  try {
    const role = await pool.query('SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user');
    assert.deepEqual(role.rows, [{ rolsuper: false, rolcreatedb: false, rolcreaterole: false }]);
    for (const [ordinal, caseId] of ['P1', 'P2-before', 'P2-after', 'P3'].entries()) {
      let timedOut = false;
      const deadline = setTimeout(() => {
        timedOut = true;
        for (const client of live) if (client instanceof Client) void client.end().catch(() => {});
      }, 60000);
      try {
        record({ caseId, phase: 'fixture-start' });
        const receiptNumber = `2099010100010${ordinal}`;
        const company = { corpCode: `7777777${ordinal}`, symbol: `77777${ordinal}` };
        const fixture = syntheticPersistenceInputFor({ receiptNumber, ...company, companyName: 'Synthetic Company',
          paragraphTexts: ['quasarnebula synthetic evidence provider integration searchable paragraph.'] });
        const document = await new FilingDocumentRepository(pool).persistCanonicalFiling({ ...fixture,
          metadata: { ...fixture.metadata, legalStatus: 'reported_active', metadataSource: 'synthetic-evidence-provider-test',
            metadataObservedAt: SYNTHETIC_NOW } });
        const lexical = new FilingLexicalRepository(pool);
        await lexical.indexFilingDocumentLexically(document.documentId);
        const input = { provider: 'opendart-fss' as const, ...company, lineageRootReceiptNumber: receiptNumber };
        const family = await new FilingLineageRepository(pool).persistVerifiedReportFamily({ ...input,
          verificationSource: 'trusted_backfill', verificationReferenceHash: 'e'.repeat(64) });
        const graphs = new VerifiedFilingGraphRepository(pool);
        const resolution = await new FilingResolutionService(graphs).resolveCurrentEffectiveReceiptCandidate(input);
        assert.equal(resolution.selectedReceiptNumber, receiptNumber);
        const base: Binding = { ...input, receiptNumber, familyId: family.familyId,
          familyRevision: resolution.familyRevision, familyFingerprint: resolution.familyFingerprint,
          retrievalPolicyId: policy };
        const synthetic = evidence(base);
        const dir = path.join(root, caseId);
        await mkdir(dir, { recursive: false });
        const manifest: ArtifactManifest = { schema: 'admission-artifact-catalog@1', revision: 'synthetic-v1',
          extractionRule: EXTRACTION_RULE, decisionRule: DECISION_RULE, target: synthetic.target,
          finalQuery: 'requested', sources: [] };
        for (const [i, item] of synthetic.artifacts.entries()) {
          const name = `source-${i}.${item.source.kind === 'viewer-main' ? 'html' : 'json'}`;
          await writeFile(path.join(dir, name), item.bytes, { flag: 'wx' });
          manifest.sources.push({ name, revision: manifest.revision, source: item.source });
        }
        const manifestBytes = JSON.stringify(manifest);
        await writeFile(path.join(dir, 'manifest.json'), manifestBytes, { flag: 'wx' });
        const artifacts = new PreservedEvidenceReader({ root: dir, name: 'manifest.json', sha256: sha256(manifestBytes) });
        const bundle = await artifacts.read();
        const claimsBytes = JSON.stringify({ schema: 'admission-claim-catalog@1', issuer: 'synthetic-test-only',
          decision: 'accepted', revision: 'synthetic-v1', artifactRevision: bundle.revision,
          target: claimTarget(base), lineage: synthetic.lineage });
        await writeFile(path.join(dir, 'claims.json'), claimsBytes, { flag: 'wx' });
        const claims = new PinnedClaimReader({ root: dir, name: 'claims.json', sha256: sha256(claimsBytes) }, 'synthetic-test-only');
        const clients = new Map<PoolClient, number>();
        const txClients = new Set<PoolClient>();
        let boundary = 'session-check';
        const boundaries: string[] = [];
        const reads: { client: number; operation: Operation; document: boolean; ok: boolean }[] = [];
        class ObservedBindingReader extends CurrentBindingReader {
          override async read(client: PoolClient, expected: Binding, target: ReceiptKey, operation: Operation = 'admission') {
            if (!clients.has(client)) clients.set(client, clients.size + 1);
            const identity = (await client.query(`SELECT pg_backend_pid() AS pid,
              current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only`)).rows[0];
            const state = await client.query(`SELECT revision::text FROM filing_intelligence.filing_report_family WHERE id=$1`, [family.familyId]);
            record({ caseId, phase: 'binding-read', client: clients.get(client), identity, revision: state.rows[0]?.revision,
              operation, document: expected.documentId ?? null });
            const observation = { client: clients.get(client)!, operation, document: !!expected.documentId, ok: false };
            reads.push(observation);
            const original = client.query;
            const query = original.bind(client) as (...args: unknown[]) => Promise<QueryResult>;
            // Observe actual returned SQL rows without changing results or choosing another client.
            client.query = (async (...args: unknown[]) => {
              const result = await query(...args);
              if (typeof args[0] === 'string' && args[0].includes('g.status AS generation_status')) {
                record({ caseId, phase: 'adapter-generation-row', client: clients.get(client), rows: result.rows.map(row => ({
                  generationId: row.lexicalGenerationId, fingerprint: row.lexicalGenerationFingerprint, status: row.generation_status,
                })) });
              }
              return result;
            }) as typeof client.query;
            try { const result = await super.read(client, expected, target, operation);
              observation.ok = true; record({ caseId, phase: 'binding-return', binding: result }); return result;
            } catch (error) { record({ caseId, phase: 'binding-denial', code: (error as { code?: string }).code ?? 'UNKNOWN' }); throw error; }
            finally { client.query = original; }
          }
        }
        const provider = new PreservedAdmissionEvidenceProvider(artifacts, new ObservedBindingReader(), {
          async withClient(phase, read) {
            const client = await pool.connect();
            try {
              await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
              record({ caseId, phase: `lease-${phase}` });
              const result = await read(client); await client.query('COMMIT'); return result;
            } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
          },
        }, claims);
        class ObservedGuard extends AdmissionGuard {
          override session() {
            const session = super.session();
            const before = session.beforeWrite.bind(session), finalize = session.finalizeWrites.bind(session);
            session.beforeWrite = async (binding, client) => {
              const prior = boundary; boundary = 'beforeWrite';
              try { await before(binding, client); } finally { boundary = prior; }
            };
            session.finalizeWrites = async client => {
              const prior = boundary; boundary = 'finalizeWrites';
              try { await finalize(client); } finally { boundary = prior; }
            };
            return session;
          }
        }
        const guard = new ObservedGuard({ async load(binding, client, operation) {
          if (client) txClients.add(client);
          const phase = client ? (boundary === 'session-check' && !binding.documentId ? 'post-lock' : boundary) : 'read-lease';
          boundaries.push(phase);
          record({ caseId, phase: 'provider-boundary', boundary: phase, suppliedTransaction: !!client });
          return provider.load(binding, client, operation);
        } }, { now: () => SYNTHETIC_NOW });
        const snapshot = async () => {
          const client = new Client({ ...config, connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 12000 });
          live.add(client);
          try {
            await client.connect();
            await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
            const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
            const e = await client.query(`SELECT status, document_id::text, receipt_id::text, lexical_generation_id::text
              FROM filing_intelligence.filing_retrieval_eligibility WHERE document_id=$1 AND retrieval_policy_id=$2`, [document.documentId, policy]);
            const a = await client.query(`SELECT status, document_id::text, receipt_id::text, lexical_generation_id::text
              FROM filing_intelligence.filing_retrieval_activation WHERE family_id=$1 AND retrieval_policy_id=$2`, [family.familyId, policy]);
            const h = await client.query(`SELECT count(*)::int AS n FROM filing_intelligence.filing_retrieval_activation_history WHERE family_id=$1`, [family.familyId]);
            await client.query('COMMIT'); return { pid, eligibility: e.rows, activation: a.rows, history: h.rows[0].n };
          } finally { await client.end(); live.delete(client); }
        };
        const before = await snapshot();
        assert.equal(before.activation.length + before.eligibility.length + before.history, 0);
        if (caseId === 'P3') {
          const writer = await pool.connect();
          try {
            await writer.query('BEGIN ISOLATION LEVEL READ COMMITTED');
            const a = resolution.familyRevision!;
            const b = String(BigInt(a) + 1n);
            const updated = await writer.query(`UPDATE filing_intelligence.filing_report_family SET revision=$1
              WHERE id=$2 AND revision=$3 AND family_fingerprint=$4 RETURNING revision::text`, [b, family.familyId, a, resolution.familyFingerprint]);
            assert.equal(updated.rowCount, 1);
            const observer = await pool.query(`SELECT revision::text, pg_backend_pid() AS pid FROM filing_intelligence.filing_report_family WHERE id=$1`, [family.familyId]);
            assert.equal(observer.rows[0].revision, a);
            // Read B through the production adapter before testing stale A through the production guard.
            const observed = await new CurrentBindingReader().read(writer, { ...base, familyRevision: b }, synthetic.target);
            assert.equal(observed.familyRevision, b);
            await assert.rejects(guard.inspect(base, 'admission', writer), denied);
            const writerPid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
            assert.notEqual(writerPid, observer.rows[0].pid);
            record({ caseId, phase: 'uncommitted-visibility', writerPid, observer: observer.rows[0], adapterRevision: observed.familyRevision,
              affectedRows: updated.rowCount, reason: 'DB_BINDING_MISMATCH', rollbackPath: 'dedicated-reader-probe' });
            await writer.query('ROLLBACK');
            const restored = await pool.query(`SELECT revision::text FROM filing_intelligence.filing_report_family WHERE id=$1`, [family.familyId]);
            assert.equal(restored.rows[0].revision, a);
            assert.equal(timedOut, false);
            record({ caseId, phase: 'PASS', restoredRevision: a });
          } finally { await writer.query('ROLLBACK'); writer.release(); }
          continue;
        }
        const service = FilingRetrievalActivationService.guarded(new FilingRetrievalActivationRepository(pool), graphs,
          new FilingEligibilityRepository(pool), guard);
        const activation = await service.apply({ resolution, retrievalPolicyId: policy });
        assert.equal(activation.status, 'activated');
        assert.equal(txClients.size, 1);
        assert.ok(boundaries.includes('post-lock'));
        assert.equal(boundaries.filter(b => b === 'beforeWrite').length, 2);
        assert.equal(boundaries.filter(b => b === 'finalizeWrites').length, 2);
        const after = await snapshot();
        assert.equal(after.history, 1);
        assert.equal(after.eligibility[0]?.status, 'eligible'); assert.equal(after.activation[0]?.status, 'active');
        for (const key of ['document_id', 'receipt_id', 'lexical_generation_id']) assert.equal(after.eligibility[0][key], after.activation[0][key]);
        assert.equal(after.activation[0].document_id, document.documentId);
        record({ caseId, phase: 'activation-verified', after, transactionClients: txClients.size, reads });
        const scopes = ActiveFilingScopeService.guarded(new ActiveFilingScopeRepository(pool), guard);
        const active = await scopes.resolveCompany({ ...company, retrievalPolicyId: policy });
        assert.equal(active.status, 'active');
        const generation = await pool.query(`SELECT id::text, lexical_fingerprint, status FROM filing_intelligence.filing_lexical_generation
          WHERE document_id=$1 AND profile_id=$2`, [document.documentId, FILING_RETRIEVAL_POLICY.lexicalProfileId]);
        assert.equal(generation.rowCount, 1); assert.equal(generation.rows[0].status, 'ready');
        const g = generation.rows[0];
        const failGeneration = async () => {
          const changed = await pool.query(`UPDATE filing_intelligence.filing_lexical_generation SET status='failed'
            WHERE id=$1 AND document_id=$2 AND lexical_fingerprint=$3 AND status='ready' RETURNING id::text, lexical_fingerprint, status`,
          [g.id, document.documentId, g.lexical_fingerprint]);
          assert.equal(changed.rowCount, 1);
          const observed = await pool.query(`SELECT id::text, lexical_fingerprint, status FROM filing_intelligence.filing_lexical_generation WHERE id=$1`, [g.id]);
          assert.deepEqual(observed.rows, [{ ...g, status: 'failed' }]);
          record({ caseId, phase: 'fault-injection', affectedRows: changed.rowCount, before: g, after: observed.rows[0] });
        };
        let queries = 0, failAfterQuery = false;
        const retriever = { async retrieveLexicalFilingChunks(...args: Parameters<FilingLexicalRepository['retrieveLexicalFilingChunks']>) {
          queries++;
          const result = await lexical.retrieveLexicalFilingChunks(...args);
          assert.ok(result.length > 0);
          if (failAfterQuery) await failGeneration();
          return result;
        } };
        const positive = await ActiveCompanyLexicalSearchService.guarded(scopes, retriever, guard).search({ ...company, query: 'quasarnebula' });
        assert.equal(positive.status, 'matched'); assert.equal(queries, 1);
        for (const c of positive.candidates) {
          assert.equal(c.documentId, document.documentId); assert.equal(c.receiptNumber, receiptNumber);
          const linked = await pool.query(`SELECT chunk_id FROM filing_intelligence.filing_chunk_lexical
            WHERE generation_id=$1 AND document_id=$2 AND chunk_id=$3`, [g.id, document.documentId, c.chunkId]);
          assert.equal(linked.rowCount, 1);
        }
        record({ caseId, phase: 'positive-search', generation: g, candidates: positive.candidates.map(c => ({ documentId: c.documentId, receiptNumber: c.receiptNumber, chunkId: c.chunkId })), scope: active });
        if (caseId !== 'P1') {
          queries = 0;
          if (caseId === 'P2-before') await failGeneration(); else failAfterQuery = true;
          // Retain an honestly resolved ready scope to isolate the new provider's status recheck.
          const controlled = ActiveCompanyLexicalSearchService.guarded({ async resolveCompany() { return active; } }, retriever, guard);
          await assert.rejects(controlled.search({ ...company, query: 'quasarnebula' }), denied);
          assert.equal(queries, caseId === 'P2-before' ? 0 : 1);
          assert.equal(reads.at(-1)?.ok, false);
        }
        assert.equal(timedOut, false);
        record({ caseId, phase: 'PASS', lexicalQueries: queries, familyId: family.familyId, documentId: document.documentId });
      } finally { clearTimeout(deadline); }
    }
  } finally { await pool.end(); }
}
