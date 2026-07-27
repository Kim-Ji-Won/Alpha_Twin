import {
  DisclosureDocumentProvider,
  ValidatedDisclosureDocumentArchive,
} from './documentContracts.js';
import { isOpenDartError } from '../errors.js';
import { OpenDartObservability, OpenDartSafeLogger } from '../observability.js';
import { validateReceiptNumber } from './receiptNumber.js';
import { SafeDisclosureArchiveReader } from './safeDisclosureArchiveReader.js';

export { validateReceiptNumber } from './receiptNumber.js';

export class DisclosureDocumentAcquisitionService {
  private readonly inFlight = new Map<string, Promise<ValidatedDisclosureDocumentArchive>>();

  constructor(
    private readonly provider: DisclosureDocumentProvider,
    private readonly archiveReader = new SafeDisclosureArchiveReader(),
    private readonly observability = new OpenDartObservability(),
    private readonly now: () => number = Date.now,
  ) {}

  setLogger(logger: OpenDartSafeLogger): void {
    this.observability.setLogger(logger);
  }

  acquire(
    input: string,
    signal?: AbortSignal,
  ): Promise<ValidatedDisclosureDocumentArchive> {
    const receiptNumber = validateReceiptNumber(input);
    if (signal) return this.load(receiptNumber, signal);
    const existing = this.inFlight.get(receiptNumber);
    if (existing) return existing;
    const request = this.load(receiptNumber).finally(() => {
      if (this.inFlight.get(receiptNumber) === request) {
        this.inFlight.delete(receiptNumber);
      }
    });
    this.inFlight.set(receiptNumber, request);
    return request;
  }

  private async load(
    receiptNumber: string,
    signal?: AbortSignal,
  ): Promise<ValidatedDisclosureDocumentArchive> {
    const startedAt = this.now();
    try {
      const archive = await this.provider.fetchDocumentArchive(receiptNumber, signal);
      const result = await this.archiveReader.read(receiptNumber, archive);
      this.observability.record({
        operation: 'filing-document',
        provider: 'opendart',
        receiptNumber,
        durationMs: Math.max(0, this.now() - startedAt),
        compressedBytes: result.archiveByteLength,
        entryCount: result.archiveEntryCount,
        totalUncompressedBytes: result.extractedTotalUncompressedBytes,
        outcome: 'success',
      });
      return result;
    } catch (error) {
      this.observability.record({
        operation: 'filing-document',
        provider: 'opendart',
        receiptNumber,
        durationMs: Math.max(0, this.now() - startedAt),
        retryable: isOpenDartError(error) ? error.retryable : true,
        providerStatus: isOpenDartError(error) ? error.providerStatus : undefined,
        outcome: 'failure',
      });
      throw error;
    }
  }
}
