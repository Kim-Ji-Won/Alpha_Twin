import { PoolClient } from 'pg';

import { FilingPersistenceError } from './errors.js';

export const REPRESENTATION_MANIFEST_VERSION = 'filing-representation-manifest@1';

const HASH = /^[0-9a-f]{64}$/;

export interface RepresentationManifest {
  readonly sectionManifestFingerprint: string;
  readonly blockManifestFingerprint: string;
  readonly chunkManifestFingerprint: string;
  readonly representationFingerprint: string;
}

interface ManifestRow {
  section_manifest_fingerprint: string;
  block_manifest_fingerprint: string;
  chunk_manifest_fingerprint: string;
  representation_fingerprint: string;
}

function checked(row: ManifestRow | undefined): RepresentationManifest {
  if (!row || ![
    row.section_manifest_fingerprint,
    row.block_manifest_fingerprint,
    row.chunk_manifest_fingerprint,
    row.representation_fingerprint,
  ].every(value => HASH.test(value))) {
    throw new FilingPersistenceError('FILING_PERSISTENCE_INTEGRITY_FAILURE', false);
  }
  return {
    sectionManifestFingerprint: row.section_manifest_fingerprint,
    blockManifestFingerprint: row.block_manifest_fingerprint,
    chunkManifestFingerprint: row.chunk_manifest_fingerprint,
    representationFingerprint: row.representation_fingerprint,
  };
}

export async function computeRepresentationManifestWithClient(
  client: PoolClient,
  documentId: string,
): Promise<RepresentationManifest> {
  const result = await client.query<ManifestRow>(
    `SELECT section_manifest_fingerprint, block_manifest_fingerprint,
            chunk_manifest_fingerprint, representation_fingerprint
     FROM filing_intelligence.compute_filing_representation_manifest($1)`,
    [documentId],
  );
  return checked(result.rows[0]);
}

export async function persistRepresentationManifestWithClient(
  client: PoolClient,
  documentId: string,
): Promise<RepresentationManifest> {
  const manifest = await computeRepresentationManifestWithClient(client, documentId);
  const result = await client.query<ManifestRow>(
    `INSERT INTO filing_intelligence.filing_document_representation_manifest (
       document_id, representation_manifest_version, section_manifest_fingerprint,
       block_manifest_fingerprint, chunk_manifest_fingerprint,
       representation_fingerprint
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING section_manifest_fingerprint, block_manifest_fingerprint,
               chunk_manifest_fingerprint, representation_fingerprint`,
    [documentId, REPRESENTATION_MANIFEST_VERSION,
      manifest.sectionManifestFingerprint, manifest.blockManifestFingerprint,
      manifest.chunkManifestFingerprint, manifest.representationFingerprint],
  );
  return checked(result.rows[0]);
}

export async function verifyStoredRepresentationManifestWithClient(
  client: PoolClient,
  documentId: string,
): Promise<RepresentationManifest> {
  const storedResult = await client.query<ManifestRow>(
    `SELECT section_manifest_fingerprint, block_manifest_fingerprint,
            chunk_manifest_fingerprint, representation_fingerprint
     FROM filing_intelligence.filing_document_representation_manifest
     WHERE document_id = $1
     FOR SHARE`,
    [documentId],
  );
  const stored = checked(storedResult.rows[0]);
  const computed = await computeRepresentationManifestWithClient(client, documentId);
  if (stored.sectionManifestFingerprint !== computed.sectionManifestFingerprint
    || stored.blockManifestFingerprint !== computed.blockManifestFingerprint
    || stored.chunkManifestFingerprint !== computed.chunkManifestFingerprint
    || stored.representationFingerprint !== computed.representationFingerprint) {
    throw new FilingPersistenceError('FILING_PERSISTENCE_INTEGRITY_FAILURE', false);
  }
  return stored;
}
