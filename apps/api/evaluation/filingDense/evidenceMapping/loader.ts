import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { MAX_ARTIFACT_BYTES, requireEvidence } from './contracts.js';
import { sha256 } from './input.js';

// Catalogs are local evaluation inputs, not server-issued proof or write authority.
export interface LocalCatalog { root: string; files: Readonly<Record<string, string>> }
export async function readCatalogFile(catalog: LocalCatalog, name: string): Promise<Buffer> {
  requireEvidence(/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:json|html|md)$/.test(name)
    && !name.startsWith('.') && Object.hasOwn(catalog.files, name), 'SOURCE_PATH_REJECTED');
  const root = path.resolve(catalog.root);
  requireEvidence(await realpath(root) === root && !(await lstat(root)).isSymbolicLink(), 'SOURCE_PATH_REJECTED');
  const filename = path.join(root, name);
  const stat = await lstat(filename);
  requireEvidence(stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_ARTIFACT_BYTES, 'SOURCE_PATH_REJECTED');
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    requireEvidence(opened.isFile() && opened.ino === stat.ino && opened.dev === stat.dev, 'SOURCE_PATH_REJECTED');
    const buffer = Buffer.alloc(MAX_ARTIFACT_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const result = await handle.read(buffer, size, buffer.length - size, null);
      if (result.bytesRead === 0) break;
      size += result.bytesRead;
    }
    requireEvidence(size <= MAX_ARTIFACT_BYTES, 'INPUT_TOO_LARGE');
    const bytes = buffer.subarray(0, size);
    requireEvidence(sha256(bytes) === catalog.files[name], 'SOURCE_HASH_MISMATCH');
    requireEvidence(await realpath(root) === root, 'SOURCE_PATH_REJECTED');
    return bytes;
  } finally { await handle.close(); }
}
