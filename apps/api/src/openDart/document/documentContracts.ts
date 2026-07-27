export interface ValidatedDisclosureDocumentEntry {
  readonly entryName: string;
  readonly format: 'xml';
  readonly mediaType: 'application/xml';
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly sha256: string;
  readonly content: Buffer;
}

export interface ValidatedDisclosureDocumentArchive {
  readonly provider: 'opendart-fss';
  readonly receiptNumber: string;
  readonly archiveByteLength: number;
  readonly archiveSha256: string;
  readonly archiveEntryCount: number;
  readonly declaredTotalUncompressedBytes: number;
  readonly extractedTotalUncompressedBytes: number;
  readonly entries: readonly ValidatedDisclosureDocumentEntry[];
}

export interface DisclosureDocumentProvider {
  readonly id: 'opendart-fss';
  fetchDocumentArchive(receiptNumber: string, signal?: AbortSignal): Promise<Buffer>;
}
