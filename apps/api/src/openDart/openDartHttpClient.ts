import { DEFAULT_DISCLOSURE_ARCHIVE_POLICY } from './document/documentPolicy.js';
import { validateReceiptNumber } from './document/receiptNumber.js';
import {
  OpenDartError,
  OpenDartOperation,
  openDartDocumentErrorFromStatus,
  openDartErrorFromStatus,
} from './errors.js';

export const OPENDART_MAX_JSON_BYTES = 5 * 1024 * 1024;

export interface OpenDartHttpClientOptions {
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  maxJsonBytes?: number;
  documentTimeoutMs?: number;
  maxDocumentBytes?: number;
}

async function readLimitedBody(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) throw new Error('Response body is missing');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new Error('Response body exceeded its size limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

function contentLength(response: Response): number | undefined {
  const raw = response.headers.get('content-length');
  if (raw == null || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already closed or errored.
  }
}

async function readLimitedBinary(response: Response, maximumBytes: number): Promise<Buffer> {
  if (!response.body) {
    throw new OpenDartError('OPENDART_DOCUMENT_INVALID_ARCHIVE', 'filing-document', false);
  }
  const declaredLength = contentLength(response);
  if (declaredLength != null && declaredLength > maximumBytes) {
    await cancelBody(response);
    throw new OpenDartError('OPENDART_DOCUMENT_TOO_LARGE', 'filing-document', false);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new OpenDartError('OPENDART_DOCUMENT_TOO_LARGE', 'filing-document', false);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

function isZipSignature(body: Buffer): boolean {
  if (body.length < 4) return false;
  const signature = body.readUInt32LE(0);
  return signature === 0x04034b50 || signature === 0x06054b50 || signature === 0x08074b50;
}

function providerStatusFromSmallBody(body: Buffer): string | undefined {
  const text = body.subarray(0, 8_192).toString('utf8');
  return /<status>\s*(\d{3})\s*<\/status>/i.exec(text)?.[1]
    ?? /"status"\s*:\s*"(\d{3})"/i.exec(text)?.[1];
}

export class OpenDartHttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxJsonBytes: number;
  private readonly documentTimeoutMs: number;
  private readonly maxDocumentBytes: number;

  constructor(private readonly options: OpenDartHttpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.maxJsonBytes = options.maxJsonBytes ?? OPENDART_MAX_JSON_BYTES;
    this.documentTimeoutMs = options.documentTimeoutMs ?? options.timeoutMs;
    this.maxDocumentBytes = options.maxDocumentBytes
      ?? DEFAULT_DISCLOSURE_ARCHIVE_POLICY.maximumCompressedBytes;
  }

  get configured(): boolean {
    return Boolean(this.options.apiKey);
  }

  async getJson<T extends Record<string, unknown>>(
    operation: OpenDartOperation,
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    if (!this.options.apiKey) {
      throw new OpenDartError('OPENDART_NOT_CONFIGURED', operation, false);
    }
    const url = new URL(path, `${this.options.baseUrl}/`);
    url.search = new URLSearchParams({ crtfc_key: this.options.apiKey, ...params }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new OpenDartError('OPENDART_UNAVAILABLE', operation, true);
      }
      let body: unknown;
      try {
        body = JSON.parse(await readLimitedBody(response, this.maxJsonBytes));
      } catch (error) {
        throw new OpenDartError('OPENDART_BAD_RESPONSE', operation, false, undefined, { cause: error });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new OpenDartError('OPENDART_BAD_RESPONSE', operation, false);
      }
      const status = (body as Record<string, unknown>).status;
      if (typeof status !== 'string') {
        throw new OpenDartError('OPENDART_BAD_RESPONSE', operation, false);
      }
      if (status !== '000' && status !== '013') throw openDartErrorFromStatus(status, operation);
      return body as T;
    } catch (error) {
      if (error instanceof OpenDartError) throw error;
      if (controller.signal.aborted) {
        throw new OpenDartError('OPENDART_TIMEOUT', operation, true, undefined, { cause: error });
      }
      throw new OpenDartError('OPENDART_UNAVAILABLE', operation, true, undefined, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  async getDocumentArchive(receiptNumber: string, signal?: AbortSignal): Promise<Buffer> {
    validateReceiptNumber(receiptNumber);
    if (!this.options.apiKey) {
      throw new OpenDartError('OPENDART_NOT_CONFIGURED', 'filing-document', false);
    }
    const initialUrl = new URL('/api/document.xml', `${this.options.baseUrl}/`);
    initialUrl.search = new URLSearchParams({
      crtfc_key: this.options.apiKey,
      rcept_no: receiptNumber,
    }).toString();
    if (initialUrl.protocol !== 'https:') {
      throw new OpenDartError('OPENDART_UNAVAILABLE', 'filing-document', false);
    }

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(), this.documentTimeoutMs);

    try {
      let currentUrl = initialUrl;
      for (let redirectCount = 0; redirectCount <= 1; redirectCount += 1) {
        const response = await this.fetchImpl(currentUrl, {
          headers: { Accept: 'application/zip, application/octet-stream' },
          redirect: 'manual',
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          await cancelBody(response);
          if (!location || redirectCount === 1) {
            throw new OpenDartError('OPENDART_UNAVAILABLE', 'filing-document', true);
          }
          let nextUrl: URL;
          try {
            nextUrl = new URL(location, currentUrl);
          } catch (error) {
            throw new OpenDartError(
              'OPENDART_UNAVAILABLE',
              'filing-document',
              false,
              undefined,
              { cause: error },
            );
          }
          if (nextUrl.protocol !== 'https:' || nextUrl.host !== initialUrl.host) {
            throw new OpenDartError('OPENDART_UNAVAILABLE', 'filing-document', false);
          }
          currentUrl = nextUrl;
          continue;
        }
        if (!response.ok) {
          await cancelBody(response);
          if (response.status === 404) {
            throw new OpenDartError('OPENDART_DOCUMENT_NOT_FOUND', 'filing-document', false);
          }
          if (response.status === 401 || response.status === 403) {
            throw new OpenDartError('OPENDART_AUTH_ERROR', 'filing-document', false);
          }
          if (response.status === 429) {
            throw new OpenDartError('OPENDART_RATE_LIMITED', 'filing-document', true);
          }
          if (response.status >= 400 && response.status < 500) {
            throw new OpenDartError('OPENDART_BAD_REQUEST_MAPPING', 'filing-document', false);
          }
          throw new OpenDartError('OPENDART_UNAVAILABLE', 'filing-document', true);
        }
        const archive = await readLimitedBinary(response, this.maxDocumentBytes);
        if (!isZipSignature(archive)) {
          const status = providerStatusFromSmallBody(archive);
          if (status) throw openDartDocumentErrorFromStatus(status);
          throw new OpenDartError('OPENDART_DOCUMENT_INVALID_ARCHIVE', 'filing-document', false);
        }
        return archive;
      }
      throw new OpenDartError('OPENDART_UNAVAILABLE', 'filing-document', true);
    } catch (error) {
      if (error instanceof OpenDartError) throw error;
      if (controller.signal.aborted) {
        throw new OpenDartError('OPENDART_TIMEOUT', 'filing-document', true, undefined, { cause: error });
      }
      throw new OpenDartError('OPENDART_UNAVAILABLE', 'filing-document', true, undefined, { cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}
