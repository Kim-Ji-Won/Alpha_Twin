import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { CorpCodeIndexSnapshot, CorpCodeRecord } from '../contracts.js';
import { OpenDartError } from '../errors.js';

export const CORP_CODE_SNAPSHOT_SCHEMA_VERSION = 1;
export const MAX_CORP_CODE_SNAPSHOT_BYTES = 96 * 1024 * 1024;
const SNAPSHOT_FILE_NAME = 'corp-code-index.json';

export function corpCodeRecordsChecksum(records: CorpCodeRecord[]): string {
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

export function createCorpCodeSnapshot(records: CorpCodeRecord[], refreshedAt: string): CorpCodeIndexSnapshot {
  return {
    schemaVersion: CORP_CODE_SNAPSHOT_SCHEMA_VERSION,
    refreshedAt,
    recordCount: records.length,
    checksum: corpCodeRecordsChecksum(records),
    records,
  };
}

function validRecord(value: unknown): value is CorpCodeRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as CorpCodeRecord;
  return /^\d{8}$/.test(record.corpCode)
    && /^[A-Z0-9]{6}$/.test(record.stockCode)
    && Boolean(record.corpName)
    && (record.corpEngName == null || typeof record.corpEngName === 'string')
    && /^\d{4}-\d{2}-\d{2}$/.test(record.companyInfoModifiedDate);
}

function validateSnapshot(value: unknown): CorpCodeIndexSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpenDartError('CORP_CODE_INDEX_UNAVAILABLE', 'corp-code', true);
  }
  const snapshot = value as CorpCodeIndexSnapshot;
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.records)
    || snapshot.recordCount !== snapshot.records.length || snapshot.records.length > 200_000
    || !snapshot.records.every(validRecord)
    || Number.isNaN(Date.parse(snapshot.refreshedAt))
    || snapshot.checksum !== corpCodeRecordsChecksum(snapshot.records)) {
    throw new OpenDartError('CORP_CODE_INDEX_UNAVAILABLE', 'corp-code', true);
  }
  for (let index = 1; index < snapshot.records.length; index += 1) {
    if (snapshot.records[index - 1]!.stockCode >= snapshot.records[index]!.stockCode) {
      throw new OpenDartError('CORP_CODE_INDEX_UNAVAILABLE', 'corp-code', true);
    }
  }
  return snapshot;
}

export interface CorpCodeIndexStore {
  load(): Promise<CorpCodeIndexSnapshot | undefined>;
  save(snapshot: CorpCodeIndexSnapshot): Promise<void>;
}

export class FileCorpCodeIndexStore implements CorpCodeIndexStore {
  private readonly filePath: string;

  constructor(private readonly directory: string, private readonly maximumBytes = MAX_CORP_CODE_SNAPSHOT_BYTES) {
    this.filePath = join(directory, SNAPSHOT_FILE_NAME);
  }

  async load(): Promise<CorpCodeIndexSnapshot | undefined> {
    try {
      const fileStat = await stat(this.filePath);
      if (fileStat.size > this.maximumBytes) {
        throw new OpenDartError('CORP_CODE_INDEX_UNAVAILABLE', 'corp-code', true);
      }
      return validateSnapshot(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      if (error instanceof OpenDartError) throw error;
      throw new OpenDartError('CORP_CODE_INDEX_UNAVAILABLE', 'corp-code', true, undefined, { cause: error });
    }
  }

  async save(snapshot: CorpCodeIndexSnapshot): Promise<void> {
    const valid = validateSnapshot(snapshot);
    const serialized = JSON.stringify(valid);
    if (Buffer.byteLength(serialized) > this.maximumBytes) {
      throw new OpenDartError('CORP_CODE_INDEX_UNAVAILABLE', 'corp-code', true);
    }
    await mkdir(this.directory, { recursive: true });
    const temporaryPath = join(this.directory, `.corp-code-${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new OpenDartError('CORP_CODE_INDEX_UNAVAILABLE', 'corp-code', true, undefined, { cause: error });
    }
  }
}
