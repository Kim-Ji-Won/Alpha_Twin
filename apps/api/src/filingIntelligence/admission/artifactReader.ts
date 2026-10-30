import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { DECISION_RULE, EXTRACTION_RULE, MAX_ARTIFACT_BYTES, SourceArtifact, ReceiptKey } from '../../../evaluation/filingDense/evidenceMapping/contracts.js';
import { fingerprint, parseJson, sha256, validKey } from '../../../evaluation/filingDense/evidenceMapping/input.js';
import { extractObservation } from '../../../evaluation/filingDense/evidenceMapping/extract.js';
import { ADMISSION_POLICY, AdmissionEvidence, Binding, LineageAcceptance } from './policy.js';
import { EvidenceProviderError as Failure } from './providerErrors.js';

export interface PinnedFile { root: string; name: string; sha256: string }
// Internal configuration, never populated from an HTTP request. No symlinks, subpaths or unbounded reads.
export async function readPinnedFile(reference: PinnedFile): Promise<Buffer> {
  const ref = structuredClone(reference);
  if (!/^[a-f0-9]{64}$/.test(ref.sha256) || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(json|html|md)$/.test(ref.name)) {
    throw new Failure('ARTIFACT_PATH_REJECTED');
  }
  const root = path.resolve(ref.root), filename = path.join(root, ref.name);
  try {
    if (await realpath(root) !== root) throw new Failure('ARTIFACT_PATH_REJECTED');
    const before = await lstat(filename);
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_ARTIFACT_BYTES) throw new Failure('ARTIFACT_PATH_REJECTED');
    const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) throw new Failure('ARTIFACT_PATH_REJECTED');
      const buffer = Buffer.alloc(MAX_ARTIFACT_BYTES + 1);
      let size = 0;
      while (size < buffer.length) {
        const result = await handle.read(buffer, size, buffer.length - size, null);
        if (!result.bytesRead) break;
        size += result.bytesRead;
      }
      if (size > MAX_ARTIFACT_BYTES) throw new Failure('ARTIFACT_SCHEMA_INVALID');
      const bytes = buffer.subarray(0, size);
      if (sha256(bytes) !== ref.sha256) throw new Failure('ARTIFACT_HASH_MISMATCH');
      if (await realpath(root) !== root || await realpath(filename) !== filename) throw new Failure('ARTIFACT_PATH_REJECTED');
      return bytes;
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure((error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'ARTIFACT_MISSING' : 'ARTIFACT_READ_FAILED');
  }
}

export interface ArtifactManifest {
  schema: 'admission-artifact-catalog@1'; revision: string;
  extractionRule: typeof EXTRACTION_RULE; decisionRule: typeof DECISION_RULE;
  target: ReceiptKey; finalQuery: 'requested' | 'not-requested';
  sources: { revision: string; name: string; source: SourceArtifact }[];
}
export class PreservedEvidenceReader {
  private readonly reference: PinnedFile;
  constructor(reference: PinnedFile) { this.reference = structuredClone(reference); }
  async read(): Promise<Pick<AdmissionEvidence, 'target' | 'artifacts' | 'revision' | 'finalQuery'>> {
    const bytes = await readPinnedFile(this.reference);
    let manifest: ArtifactManifest;
    try {
      manifest = parseJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as ArtifactManifest;
      if (manifest.schema !== 'admission-artifact-catalog@1' || typeof manifest.revision !== 'string'
        || !manifest.revision || manifest.revision.length > 200 || manifest.extractionRule !== EXTRACTION_RULE
        || manifest.decisionRule !== DECISION_RULE || !['requested', 'not-requested'].includes(manifest.finalQuery)
        || !Array.isArray(manifest.sources) || !manifest.sources.length || manifest.sources.length > 30) throw new Error();
      validKey(manifest.target);
    } catch { throw new Failure('ARTIFACT_SCHEMA_INVALID'); }
    const artifacts: AdmissionEvidence['artifacts'][number][] = [];
    const ids = new Set<string>();
    for (const entry of manifest.sources) {
      if (!entry || entry.revision !== manifest.revision || fingerprint(entry.source?.target) !== fingerprint(manifest.target)) {
        throw new Failure('ARTIFACT_CONTEXT_MISMATCH');
      }
      const body = await readPinnedFile({ root: this.reference.root, name: entry.name, sha256: entry.source.rawBodySha256 });
      let observation;
      try { observation = extractObservation(entry.source, body); }
      catch { throw new Failure('ARTIFACT_CONTEXT_MISMATCH'); }
      if (ids.has(observation.id)) throw new Failure('ARTIFACT_DUPLICATE');
      ids.add(observation.id);
      if (observation.reasons.some(reason => reason === 'IDENTITY_MISMATCH' || reason === 'SOURCE_CONTEXT_MISMATCH')) {
        throw new Failure('ARTIFACT_CONTEXT_MISMATCH');
      }
      if (observation.state === 'malformed') throw new Failure(observation.reasons.includes('SOURCE_STRUCTURE_UNSUPPORTED')
        ? 'ARTIFACT_UNSUPPORTED' : 'ARTIFACT_MALFORMED');
      // This exact buffer was hashed and extracted; guard will receive it, never a reread.
      artifacts.push({ source: structuredClone(entry.source), bytes: body });
    }
    return { target: structuredClone(manifest.target), artifacts, finalQuery: manifest.finalQuery,
      revision: fingerprint({ manifest: this.reference.sha256, revision: manifest.revision,
        policy: ADMISSION_POLICY, observations: [...ids] }) };
  }
}

export interface ClaimAcceptanceReader {
  read(binding: Binding, artifactRevision: string): Promise<{ lineage: LineageAcceptance; revision: string } | null>;
}
export class UnavailableClaimReader implements ClaimAcceptanceReader {
  async read(): Promise<null> { return null; }
}
export const CLAIM_BINDING_FIELDS = ['provider', 'corpCode', 'symbol', 'familyId', 'lineageRootReceiptNumber',
  'familyRevision', 'familyFingerprint'] as const;
export function claimTarget(binding: Binding): Record<string, string> {
  return Object.fromEntries(CLAIM_BINDING_FIELDS.map(key => {
    const value = binding[key];
    if (typeof value !== 'string' || !value) throw new Failure('CLAIM_BINDING_MISMATCH');
    return [key, value];
  }));
}
// A pinned internal issuer catalog is a trust boundary, not a review workflow or proof of external truth.
export class PinnedClaimReader implements ClaimAcceptanceReader {
  private readonly ref: PinnedFile;
  constructor(ref: PinnedFile, private readonly issuer: string) { this.ref = structuredClone(ref); }
  async read(binding: Binding, artifactRevision: string) {
    const bytes = await readPinnedFile(this.ref);
    try {
      const record = parseJson(bytes.toString('utf8')) as {
        schema: string; issuer: string; decision: string; revision: string; artifactRevision: string;
        target: Record<string, string>; lineage: LineageAcceptance;
      };
      if (record.schema !== 'admission-claim-catalog@1' || !this.issuer || record.issuer !== this.issuer
        || record.decision !== 'accepted' || typeof record.revision !== 'string' || !record.revision
        || record.artifactRevision !== artifactRevision || fingerprint(record.target) !== fingerprint(claimTarget(binding))
        || !record.lineage) throw new Error();
      return { lineage: structuredClone(record.lineage), revision: fingerprint({ file: this.ref.sha256, issuer: this.issuer, revision: record.revision }) };
    } catch { throw new Failure('CLAIM_BINDING_MISMATCH'); }
  }
}
