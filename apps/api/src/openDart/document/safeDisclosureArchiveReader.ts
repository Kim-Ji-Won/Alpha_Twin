import { createHash } from 'node:crypto';

import yauzl, { Entry, ZipFile } from 'yauzl';

import { OpenDartError } from '../errors.js';
import {
  ValidatedDisclosureDocumentArchive,
  ValidatedDisclosureDocumentEntry,
} from './documentContracts.js';
import {
  DEFAULT_DISCLOSURE_ARCHIVE_POLICY,
  DisclosureArchivePolicy,
  validateDisclosureArchivePolicy,
} from './documentPolicy.js';

const NESTED_ARCHIVE_EXTENSIONS = new Set([
  '.7z',
  '.bz2',
  '.gz',
  '.rar',
  '.tar',
  '.tgz',
  '.xz',
  '.zip',
]);
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_REGULAR_FILE = 0o100000;
const UNIX_DIRECTORY = 0o040000;

function documentError(
  code: 'OPENDART_DOCUMENT_INVALID_ARCHIVE'
    | 'OPENDART_DOCUMENT_UNSAFE_ARCHIVE'
    | 'OPENDART_DOCUMENT_TOO_LARGE'
    | 'OPENDART_DOCUMENT_NO_ELIGIBLE_ENTRY',
  cause?: unknown,
): OpenDartError {
  return new OpenDartError(
    code,
    'filing-document',
    false,
    undefined,
    cause instanceof Error ? { cause } : undefined,
  );
}

function openZip(archive: Buffer): Promise<ZipFile> {
  return yauzl.fromBufferPromise(archive, {
    autoClose: false,
    lazyEntries: true,
    decodeStrings: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
}

function normalizedPathCandidate(fileName: string): string {
  return fileName.normalize('NFKC');
}

function hasUnsafePathSemantics(fileName: string): boolean {
  if (
    !fileName
    || fileName.includes('\0')
    || fileName.includes('\\')
    || fileName.startsWith('/')
    || /^[a-z]:/i.test(fileName)
  ) {
    return true;
  }
  const segments = fileName.split('/');
  return segments.some(segment => segment === '.' || segment === '..' || segment === '');
}

export function validateDocumentEntryName(fileName: string, byteLength: number): string {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
    throw documentError('OPENDART_DOCUMENT_UNSAFE_ARCHIVE');
  }
  const normalized = normalizedPathCandidate(fileName);
  if (hasUnsafePathSemantics(fileName) || hasUnsafePathSemantics(normalized)) {
    throw documentError('OPENDART_DOCUMENT_UNSAFE_ARCHIVE');
  }
  try {
    const decoded = normalizedPathCandidate(decodeURIComponent(normalized));
    if (decoded !== normalized && hasUnsafePathSemantics(decoded)) {
      throw documentError('OPENDART_DOCUMENT_UNSAFE_ARCHIVE');
    }
  } catch (error) {
    if (error instanceof OpenDartError) throw error;
    // A literal malformed percent sequence has no path decoding semantics.
  }
  return normalized;
}

function extension(fileName: string): string {
  const baseName = fileName.slice(fileName.lastIndexOf('/') + 1).toLowerCase();
  const dot = baseName.lastIndexOf('.');
  return dot < 0 ? '' : baseName.slice(dot);
}

function unixFileType(entry: Entry): number {
  const creatorSystem = entry.versionMadeBy >>> 8;
  return creatorSystem === 3
    ? (entry.externalFileAttributes >>> 16) & UNIX_FILE_TYPE_MASK
    : 0;
}

function isDirectory(entry: Entry): boolean {
  return entry.fileName.endsWith('/')
    || unixFileType(entry) === UNIX_DIRECTORY
    || (entry.externalFileAttributes & 0x10) !== 0;
}

function validateEntryType(entry: Entry, directory: boolean): void {
  if (entry.isEncrypted() || !entry.canDecodeFileData()) {
    throw documentError('OPENDART_DOCUMENT_UNSAFE_ARCHIVE');
  }
  const fileType = unixFileType(entry);
  if (directory) {
    if (fileType !== 0 && fileType !== UNIX_DIRECTORY) {
      throw documentError('OPENDART_DOCUMENT_UNSAFE_ARCHIVE');
    }
    return;
  }
  if (fileType !== 0 && fileType !== UNIX_REGULAR_FILE) {
    throw documentError('OPENDART_DOCUMENT_UNSAFE_ARCHIVE');
  }
}

function hasNestedArchiveMagic(content: Buffer): boolean {
  if (content.length < 4) return false;
  const firstFour = content.readUInt32LE(0);
  return firstFour === 0x04034b50
    || firstFour === 0x06054b50
    || firstFour === 0x08074b50
    || firstFour === 0x184d2204
    || content.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
    || content.subarray(0, 6).equals(Buffer.from('Rar!\x1a\x07', 'binary'))
    || content.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]));
}

function isXmlCandidate(content: Buffer): boolean {
  if (content.length === 0 || content.includes(0) || hasNestedArchiveMagic(content)) return false;
  let offset = content.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0;
  while (offset < content.length && [0x09, 0x0a, 0x0d, 0x20].includes(content[offset]!)) offset += 1;
  return content[offset] === 0x3c;
}

async function readEntry(
  zip: ZipFile,
  entry: Entry,
  maximumBytes: number,
): Promise<Buffer> {
  const stream = await zip.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let actualBytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      actualBytes += buffer.length;
      if (actualBytes > maximumBytes) {
        stream.destroy();
        throw documentError('OPENDART_DOCUMENT_TOO_LARGE');
      }
      chunks.push(buffer);
    }
  } catch (error) {
    stream.destroy();
    throw error;
  }
  if (actualBytes !== entry.uncompressedSize) {
    throw documentError('OPENDART_DOCUMENT_INVALID_ARCHIVE');
  }
  return Buffer.concat(chunks, actualBytes);
}

function isUnsafeYauzlError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /absolute path|invalid relative path|invalid characters in fileName/i.test(error.message);
}

export class SafeDisclosureArchiveReader {
  private readonly policy: DisclosureArchivePolicy;

  constructor(policy: DisclosureArchivePolicy = DEFAULT_DISCLOSURE_ARCHIVE_POLICY) {
    this.policy = validateDisclosureArchivePolicy(policy);
  }

  async read(
    receiptNumber: string,
    archive: Buffer,
  ): Promise<ValidatedDisclosureDocumentArchive> {
    if (archive.length > this.policy.maximumCompressedBytes) {
      throw documentError('OPENDART_DOCUMENT_TOO_LARGE');
    }
    let zip: ZipFile | undefined;
    try {
      zip = await openZip(archive);
      if (zip.entryCount > this.policy.maximumEntries) {
        throw documentError('OPENDART_DOCUMENT_TOO_LARGE');
      }

      const names = new Set<string>();
      const entries: ValidatedDisclosureDocumentEntry[] = [];
      let archiveEntryCount = 0;
      let declaredTotalUncompressedBytes = 0;
      let extractedTotalUncompressedBytes = 0;

      for await (const entry of zip.eachEntry()) {
        archiveEntryCount += 1;
        if (archiveEntryCount > this.policy.maximumEntries) {
          throw documentError('OPENDART_DOCUMENT_TOO_LARGE');
        }
        if (entry.fileNameRaw.length > this.policy.maximumFileNameBytes) {
          throw documentError('OPENDART_DOCUMENT_UNSAFE_ARCHIVE');
        }

        const directory = isDirectory(entry);
        const validationName = directory && entry.fileName.endsWith('/')
          ? entry.fileName.slice(0, -1)
          : entry.fileName;
        const entryName = validateDocumentEntryName(validationName, entry.fileNameRaw.length);
        const normalizedKey = entryName.toLocaleLowerCase('en-US');
        if (names.has(normalizedKey)) {
          throw documentError('OPENDART_DOCUMENT_UNSAFE_ARCHIVE');
        }
        names.add(normalizedKey);
        validateEntryType(entry, directory);
        if (directory) continue;

        if (
          !Number.isSafeInteger(entry.compressedSize)
          || !Number.isSafeInteger(entry.uncompressedSize)
          || entry.compressedSize < 0
          || entry.uncompressedSize < 0
        ) {
          throw documentError('OPENDART_DOCUMENT_INVALID_ARCHIVE');
        }
        declaredTotalUncompressedBytes += entry.uncompressedSize;
        if (
          entry.uncompressedSize > this.policy.maximumEntryUncompressedBytes
          || declaredTotalUncompressedBytes > this.policy.maximumTotalUncompressedBytes
        ) {
          throw documentError('OPENDART_DOCUMENT_TOO_LARGE');
        }

        const entryExtension = extension(entryName);
        if (NESTED_ARCHIVE_EXTENSIONS.has(entryExtension)) {
          throw documentError('OPENDART_DOCUMENT_UNSAFE_ARCHIVE');
        }
        if (entryExtension !== '.xml') continue;

        const content = await readEntry(
          zip,
          entry,
          this.policy.maximumEntryUncompressedBytes,
        );
        extractedTotalUncompressedBytes += content.length;
        if (extractedTotalUncompressedBytes > this.policy.maximumTotalUncompressedBytes) {
          throw documentError('OPENDART_DOCUMENT_TOO_LARGE');
        }
        if (hasNestedArchiveMagic(content)) {
          throw documentError('OPENDART_DOCUMENT_UNSAFE_ARCHIVE');
        }
        if (!isXmlCandidate(content)) {
          throw documentError('OPENDART_DOCUMENT_INVALID_ARCHIVE');
        }
        entries.push({
          entryName,
          format: 'xml',
          mediaType: 'application/xml',
          compressedSize: entry.compressedSize,
          uncompressedSize: content.length,
          sha256: createHash('sha256').update(content).digest('hex'),
          content,
        });
      }

      if (entries.length === 0) {
        throw documentError('OPENDART_DOCUMENT_NO_ELIGIBLE_ENTRY');
      }
      return {
        provider: 'opendart-fss',
        receiptNumber,
        archiveByteLength: archive.length,
        archiveSha256: createHash('sha256').update(archive).digest('hex'),
        archiveEntryCount,
        declaredTotalUncompressedBytes,
        extractedTotalUncompressedBytes,
        entries,
      };
    } catch (error) {
      if (error instanceof OpenDartError) throw error;
      throw documentError(
        isUnsafeYauzlError(error)
          ? 'OPENDART_DOCUMENT_UNSAFE_ARCHIVE'
          : 'OPENDART_DOCUMENT_INVALID_ARCHIVE',
        error,
      );
    } finally {
      zip?.close();
    }
  }
}
