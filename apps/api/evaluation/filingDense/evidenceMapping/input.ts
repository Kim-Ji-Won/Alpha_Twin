import { createHash } from 'node:crypto';
import { canonicalJson } from '../canonical.js';
import { MAX_ARTIFACT_BYTES, requireEvidence, type ReceiptKey, type SourceArtifact } from './contracts.js';

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const fingerprint = (value: unknown): string => sha256(canonicalJson(value));
export const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();
export function record(value: unknown): Record<string, unknown> {
  requireEvidence(value !== null && typeof value === 'object' && !Array.isArray(value), 'SCHEMA_INVALID');
  return value as Record<string, unknown>;
}
export function parseJson(text: string): unknown {
  requireEvidence(Buffer.byteLength(text) <= MAX_ARTIFACT_BYTES, 'INPUT_TOO_LARGE');
  try { return JSON.parse(text) as unknown; } catch { throw new Error('JSON_INVALID'); }
}
export function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  requireEvidence(Object.keys(value).sort().join('|') === [...keys].sort().join('|'), 'SCHEMA_INVALID');
}
export function parseInstant(value: string | null): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, , zone] = m;
  if (+y! < 1000 || +mo! < 1 || +mo! > 12 || +d! < 1 || +h! > 23 || +mi! > 59 || +s! > 59) return null;
  if (+d! > new Date(Date.UTC(+y!, +mo!, 0)).getUTCDate()) return null;
  if (zone !== 'Z' && (+zone!.slice(1, 3) > 23 || +zone!.slice(4) > 59)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
export function validKey(key: ReceiptKey): void {
  requireEvidence(/^\d{14}$/.test(key.receipt) && /^\d{8}$/.test(key.corpCode)
    && /^\d{6}$/.test(key.symbol) && /^\d{8}$/.test(key.filingDate)
    && key.receipt.startsWith(key.filingDate) && typeof key.companyName === 'string'
    && key.companyName.length > 0 && key.companyName.length <= 200, 'IDENTITY_INVALID');
  const d = key.filingDate;
  requireEvidence(parseInstant(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T00:00:00Z`) !== null, 'IDENTITY_INVALID');
}
export function validateSource(source: SourceArtifact, bytes: Uint8Array): void {
  validKey(source.target);
  requireEvidence(/^[A-Za-z0-9_-]{1,100}$/.test(source.id), 'SOURCE_ID_INVALID');
  requireEvidence(bytes.byteLength <= MAX_ARTIFACT_BYTES, 'INPUT_TOO_LARGE');
  requireEvidence(/^[a-f0-9]{64}$/.test(source.rawBodySha256)
    && sha256(bytes) === source.rawBodySha256, 'SOURCE_HASH_MISMATCH');
  requireEvidence(['recorded', 'legacy-collection-contract'].includes(source.request.provenance), 'UNTRUSTED_SOURCE_PROVENANCE');
  const p = source.request.parameters;
  if (source.kind === 'viewer-main') {
    exactKeys(p, ['rcpNo']);
    requireEvidence(source.request.endpoint === 'https://dart.fss.or.kr/dsaf001/main.do'
      && p.rcpNo === source.target.receipt && source.request.provenance === 'recorded', 'SOURCE_CONTEXT_MISMATCH');
  } else {
    requireEvidence(source.kind === 'list-all' || source.kind === 'list-final', 'SOURCE_KIND_UNSUPPORTED');
    exactKeys(p, ['corp_code', 'bgn_de', 'end_de', 'last_reprt_at', 'page_no', 'page_count', 'sort', 'sort_mth']);
    requireEvidence(source.request.endpoint === 'https://opendart.fss.or.kr/api/list.json'
      && p.corp_code === source.target.corpCode && p.bgn_de === source.target.filingDate
      && p.end_de === source.target.filingDate && p.last_reprt_at === (source.kind === 'list-all' ? 'N' : 'Y')
      && /^[1-9]\d{0,5}$/.test(p.page_no!) && /^[1-9]\d{0,2}$/.test(p.page_count!)
      && Number(p.page_count) <= 100 && p.sort === 'date' && p.sort_mth === 'desc'
      && (source.kind === 'list-all' || source.request.provenance === 'recorded'), 'SOURCE_CONTEXT_MISMATCH');
  }
  for (const t of [source.request.startedAt, source.response.headersObservedAt, source.response.bodyReceivedAt]) {
    requireEvidence(t === null || (typeof t === 'string' && t.length <= 64), 'SCHEMA_INVALID');
  }
}
