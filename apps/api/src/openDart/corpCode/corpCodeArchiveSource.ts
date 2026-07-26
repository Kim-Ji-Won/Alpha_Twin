import { OpenDartError, openDartErrorFromStatus } from '../errors.js';

export const MAX_CORP_CODE_ARCHIVE_BYTES = 20 * 1024 * 1024;

export interface CorpCodeArchiveSource {
  fetchArchive(): Promise<Buffer>;
}

interface HttpCorpCodeArchiveSourceOptions {
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  maximumBytes?: number;
}

function providerStatusFromSmallBody(buffer: Buffer): string | undefined {
  const text = buffer.subarray(0, 8_192).toString('utf8');
  const match = /["<]status[">:\s]+(\d{3})/i.exec(text);
  return match?.[1];
}

export class HttpCorpCodeArchiveSource implements CorpCodeArchiveSource {
  private readonly fetchImpl: typeof fetch;
  private readonly maximumBytes: number;

  constructor(private readonly options: HttpCorpCodeArchiveSourceOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.maximumBytes = options.maximumBytes ?? MAX_CORP_CODE_ARCHIVE_BYTES;
  }

  async fetchArchive(): Promise<Buffer> {
    if (!this.options.apiKey) throw new OpenDartError('OPENDART_NOT_CONFIGURED', 'corp-code', false);
    const url = new URL('/api/corpCode.xml', this.options.baseUrl);
    url.search = new URLSearchParams({ crtfc_key: this.options.apiKey }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok || !response.body) {
        throw new OpenDartError('OPENDART_UNAVAILABLE', 'corp-code', true);
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > this.maximumBytes) {
            await reader.cancel();
            throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const archive = Buffer.concat(chunks);
      if (archive.length < 4 || archive.readUInt32LE(0) !== 0x04034b50) {
        const status = providerStatusFromSmallBody(archive);
        if (status) throw openDartErrorFromStatus(status, 'corp-code');
        throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false);
      }
      return archive;
    } catch (error) {
      if (error instanceof OpenDartError) throw error;
      if (controller.signal.aborted) {
        throw new OpenDartError('OPENDART_TIMEOUT', 'corp-code', true, undefined, { cause: error });
      }
      throw new OpenDartError('OPENDART_UNAVAILABLE', 'corp-code', true, undefined, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
}
