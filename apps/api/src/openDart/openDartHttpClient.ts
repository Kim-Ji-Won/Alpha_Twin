import { OpenDartError, OpenDartOperation, openDartErrorFromStatus } from './errors.js';

export const OPENDART_MAX_JSON_BYTES = 5 * 1024 * 1024;

export interface OpenDartHttpClientOptions {
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  maxJsonBytes?: number;
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

export class OpenDartHttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxJsonBytes: number;

  constructor(private readonly options: OpenDartHttpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.maxJsonBytes = options.maxJsonBytes ?? OPENDART_MAX_JSON_BYTES;
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
}
