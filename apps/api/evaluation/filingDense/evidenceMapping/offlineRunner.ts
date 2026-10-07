import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decideEvidence } from './decision.js';
import { extractObservation } from './extract.js';
import { EvidenceMappingError, requireEvidence, type DirectionalRelationKey, type ReceiptKey, type ReceiptPlan, type SourceArtifact } from './contracts.js';
import { parseJson, record, sha256 } from './input.js';
import { readCatalogFile, type LocalCatalog } from './loader.js';

const BASE = '/Users/jiwon/.alpha-twin/evaluation-recovery';
const DESIGN = `${BASE}/evidence-mapping-contract-2026-09-30T09-35-32-448Z-B31f7x`;
const ROOTS = [
  `${BASE}/official-disclosure-metadata-2026-09-30T08-53-15-435Z-D1F8Ah`,
  `${BASE}/relation-status-calibration-2026-09-30T09-02-21-064Z-EWGlWN`,
] as const;
const DESIGN_FILES = {
  'contract-design.md': '78848908c4be19439f8304f96fb002cc0e313e5d62fbf7174d7f5687878c64c6',
  'proposed-policy-decisions.md': '5f37b3cd6655c013067d13520ab0298590d187c925ef8f61a5392c781543dd2c',
  'synthetic-test-plan.md': 'd8db5149121cd7dea1849d5d752e71256d1e599f9b12c618746741097955465e',
  'decision-table.json': 'f67e9d8c691235822a24c27d4385178c6f7e7c51ef0e0119ce7ef767e3cffc72',
  'input-hashes.json': 'cd23b89f737cb3c27c06c5a36dc8ca7528c581176e4b71a7f62157e84e0888a7',
  'evidence-index.json': '7f9d21dd41099f60412f951d337b001b7d488e6575aab19053f7201184c5b42a',
  'offline-probe.json': '4da0d10b743f04fbbec97817a32ddf7368b9f6cdf1775f47fe8cbe6417a89d0a',
};
export const FIXTURE_EVALUATED_AT = '2026-09-30T09:10:00.000Z';

export async function runPreservedEvidenceReport(): Promise<string> {
  const startedAt = new Date().toISOString();
  const catalogs: LocalCatalog[] = [{ root: DESIGN, files: DESIGN_FILES }];
  const loaded = new Map<string, Buffer>();
  const load = async (catalog: LocalCatalog): Promise<void> => {
    for (const name of Object.keys(catalog.files).sort()) loaded.set(`${catalog.root}/${name}`, await readCatalogFile(catalog, name));
  };
  await load(catalogs[0]!);
  const decode = (filename: string): Record<string, unknown> => {
    const bytes = loaded.get(filename); requireEvidence(bytes, 'INPUT_NOT_IN_CATALOG');
    return record(parseJson(bytes.toString('utf8')));
  };
  const hashes = decode(`${DESIGN}/input-hashes.json`);
  requireEvidence(Array.isArray(hashes.files), 'HASH_MANIFEST_INVALID');
  for (const root of ROOTS) {
    const files: Record<string, string> = {};
    for (const item of hashes.files) {
      const f = record(item);
      requireEvidence(typeof f.path === 'string' && ROOTS.some(r => path.dirname(f.path as string) === r)
        && f.startSha256 === f.endSha256 && typeof f.startSha256 === 'string' && /^[a-f0-9]{64}$/.test(f.startSha256), 'HASH_MANIFEST_INVALID');
      if (path.dirname(f.path) === root) {
        const name = path.basename(f.path); requireEvidence(!Object.hasOwn(files, name), 'DUPLICATE_SOURCE_FILE');
        files[name] = f.startSha256;
      }
    }
    const catalog = { root, files }; catalogs.push(catalog); await load(catalog);
  }
  const old = decode(`${ROOTS[0]}/run-manifest.json`), manifest = decode(`${ROOTS[1]}/request-manifest.json`);
  const index = decode(`${DESIGN}/evidence-index.json`);
  requireEvidence(Array.isArray(old.results) && Array.isArray(manifest.requests) && Array.isArray(index.evidence), 'MANIFEST_INVALID');
  const targets = new Map<string, ReceiptKey>();
  const artifacts: { source: SourceArtifact; filename: string }[] = [];
  for (const item of old.results) {
    const r = record(item), metadata = record(r.metadata);
    const target: ReceiptKey = { receipt: String(r.receipt), corpCode: String(r.corpCode), symbol: String(r.symbol),
      filingDate: String(r.date), companyName: String(metadata.corp_name) };
    requireEvidence(!targets.has(target.receipt), 'DUPLICATE_TARGET'); targets.set(target.receipt, target);
    const indexed = index.evidence.map(record).find(e => e.id === `N-${target.receipt}`);
    requireEvidence(indexed && indexed.rawBodySha256 === r.bodySha256
      && indexed.path === `${ROOTS[0]}/${r.responseFile}`, 'EVIDENCE_INDEX_MISMATCH');
    // The old collector did not serialize a complete query. Bind the documented legacy profile,
    // retain its phase, and never claim this is a newly recorded request/body timestamp.
    artifacts.push({ filename: String(indexed.path), source: {
      id: `N-${target.receipt}`, kind: 'list-all', target, rawBodySha256: String(r.bodySha256),
      request: { endpoint: 'https://opendart.fss.or.kr/api/list.json', provenance: 'legacy-collection-contract',
        startedAt: String(r.startedAt), parameters: { corp_code: target.corpCode, bgn_de: target.filingDate,
          end_de: target.filingDate, last_reprt_at: 'N', page_no: '1', page_count: '100', sort: 'date', sort_mth: 'desc' } },
      response: { headersObservedAt: String(r.responseObservedAt), bodyReceivedAt: null,
        httpStatus: Number(r.httpStatus), providerStatus: String(r.providerStatus) },
    } });
  }
  for (const item of manifest.requests) {
    const r = record(item);
    if (typeof r.id !== 'string' || !/^[AB]-\d{14}$/.test(r.id)) continue;
    const target = targets.get(r.id.slice(2)); requireEvidence(target, 'MANIFEST_TARGET_MISMATCH');
    const indexed = index.evidence.map(record).find(e => e.id === r.id);
    requireEvidence(indexed && indexed.rawBodySha256 === r.rawSha256
      && indexed.path === `${ROOTS[1]}/${r.file}`, 'EVIDENCE_INDEX_MISMATCH');
    const u = new URL(String(r.url));
    requireEvidence(!u.username && !u.password && !u.hash && u.protocol === 'https:', 'SOURCE_CONTEXT_MISMATCH');
    const kind = r.id.startsWith('A-') ? 'list-final' : 'viewer-main';
    const parameters = kind === 'list-final' ? record(r.parameters) : Object.fromEntries(u.searchParams);
    requireEvidence(Object.values(parameters).every(v => typeof v === 'string')
      && (kind !== 'list-final' || !u.search), 'SOURCE_CONTEXT_MISMATCH');
    artifacts.push({ filename: String(indexed.path), source: {
      id: r.id, kind, target, rawBodySha256: String(r.rawSha256),
      request: { endpoint: `${u.origin}${u.pathname}`, parameters: parameters as Record<string, string>,
        provenance: 'recorded', startedAt: String(r.requestStartedAt) },
      response: { headersObservedAt: String(r.responseHeadersAt), bodyReceivedAt: String(r.responseReceivedAt),
        httpStatus: Number(r.httpStatus), providerStatus: kind === 'list-final' ? String(r.providerStatus) : null },
    } });
  }
  const observations = artifacts.map(({ source, filename }) => {
    const bytes = loaded.get(filename); requireEvidence(bytes, 'INPUT_NOT_IN_CATALOG');
    return extractObservation(source, bytes);
  });
  const plans: ReceiptPlan[] = [...targets.values()].map(target => ({ target,
    finalQuery: artifacts.some(a => a.source.kind === 'list-final' && a.source.target.receipt === target.receipt) ? 'requested' : 'not-requested' }));
  // Candidate directions are examination subjects from the approved design, not accepted relations.
  const expected = decode(`${DESIGN}/decision-table.json`);
  requireEvidence(Array.isArray(expected.relations), 'DESIGN_TABLE_INVALID');
  const relations: DirectionalRelationKey[] = expected.relations.map(item => {
    const key = record(record(item).key);
    return { relation: 'corrects', fromReceipt: String(key.from), toReceipt: String(key.to) };
  });
  const unapproved = decideEvidence(plans, observations, relations, { evaluatedAt: FIXTURE_EVALUATED_AT, policy: { kind: 'not-approved' } });
  const simulation = decideEvidence(plans, observations, relations, { evaluatedAt: FIXTURE_EVALUATED_AT,
    policy: { kind: 'simulation', maxSkewMs: 900000, maxFinalAgeMs: 86400000 } });
  const counts = { identities: unapproved.receipts.filter(r => r.identity === 'exact').length,
    finalPositive: unapproved.receipts.filter(r => r.providerFinal === 'positive').length,
    finalNotRequested: unapproved.receipts.filter(r => r.providerFinal === 'not-requested').length,
    nonFinal: unapproved.receipts.filter(r => r.explicitNonFinal === 'observed').length,
    sameFamily: unapproved.relations.filter(r => r.sameFamily === 'observed').length,
    heldReceipts: unapproved.receipts.filter(r => r.disposition === 'HELD_UNPROVEN').length };
  const differences: string[] = [];
  requireEvidence(Array.isArray(expected.receipts), 'DESIGN_TABLE_INVALID');
  for (const item of expected.receipts) {
    const e = record(item), actual = unapproved.receipts.find(r => r.target.receipt === e.receipt);
    if (!actual || actual.identity !== String(e.identity).toLowerCase()
      || actual.providerFinal !== (e.providerFinal === 'EXACT_POSITIVE' ? 'positive' : 'not-requested')
      || actual.explicitNonFinal !== (e.explicitNonFinal === 'OBSERVED' ? 'observed' : 'not-observed')
      || actual.disposition !== e.decision) differences.push(`receipt:${String(e.receipt)}`);
  }
  for (const relation of unapproved.relations) if (relation.sameFamily !== 'observed' || relation.disposition !== 'HELD_UNPROVEN') {
    differences.push(`relation:${relation.key.fromReceipt}:${relation.key.toReceipt}`);
  }
  const inputHashes = [];
  for (const catalog of catalogs) for (const name of Object.keys(catalog.files).sort()) {
    const filename = `${catalog.root}/${name}`, end = await readCatalogFile(catalog, name), start = loaded.get(filename)!;
    requireEvidence(sha256(start) === sha256(end), 'INPUT_CHANGED');
    inputHashes.push({ path: filename, startSha256: sha256(start), endSha256: sha256(end), unchanged: true });
  }
  const output = await mkdtemp(`${BASE}/evidence-mapping-implementation-${new Date().toISOString().replace(/[:.]/g, '-')}-`);
  const reports: Record<string, unknown> = {
    'decision-report.json': { generatedAt: new Date().toISOString(), counts, differences,
      designDifferences: ['simulation age uses Y final observation, not oldest N age', 'missing final set is NOT_EVALUABLE',
        'legacy N headers phase retained, not relabelled as body received', 'root and direct-edge source profiles remain unsupported'], unapproved, simulation },
    'extraction-index.json': { observations, rawArtifactCount: artifacts.length, observationsAreNotServerSignatures: true },
    'input-hashes.json': { startedAt, endedAt: new Date().toISOString(), files: inputHashes, allUnchanged: true },
  };
  for (const [name, report] of Object.entries(reports)) await writeFile(`${output}/${name}`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, counts, differences, inputCount: inputHashes.length }));
  return output;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runPreservedEvidenceReport().catch(error => {
    console.error(error instanceof EvidenceMappingError ? error.code : 'OFFLINE_REPORT_FAILED'); process.exitCode = 1;
  });
}
