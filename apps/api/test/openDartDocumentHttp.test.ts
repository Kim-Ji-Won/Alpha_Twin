import assert from 'node:assert/strict';
import test from 'node:test';

import { OpenDartError } from '../src/openDart/errors.js';
import { OpenDartHttpClient } from '../src/openDart/openDartHttpClient.js';
import { syntheticZip } from './helpers/syntheticZip.js';

const receipt = '20260720000001';
const archive = syntheticZip([{ name: 'document.xml', content: '<DOCUMENT>test</DOCUMENT>' }]);
const archiveBody = Uint8Array.from(archive);

function client(
  fetchImpl: typeof fetch,
  options: { apiKey?: string; timeoutMs?: number; maximumBytes?: number } = {},
) {
  return new OpenDartHttpClient({
    apiKey: options.apiKey ?? 'synthetic-secret',
    baseUrl: 'https://opendart.example.test',
    timeoutMs: 50,
    documentTimeoutMs: options.timeoutMs ?? 50,
    maxDocumentBytes: options.maximumBytes ?? 1024,
    fetchImpl,
  });
}

test('document transport sends the server key only to the expected endpoint', async () => {
  let requested: URL | undefined;
  let redirectMode: RequestRedirect | undefined;
  const body = await client(async (input, init) => {
    requested = new URL(String(input));
    redirectMode = init?.redirect;
    return new Response(archiveBody);
  }).getDocumentArchive(receipt);
  assert.deepEqual(body, archive);
  assert.equal(requested?.pathname, '/api/document.xml');
  assert.equal(requested?.searchParams.get('rcept_no'), receipt);
  assert.equal(requested?.searchParams.get('crtfc_key'), 'synthetic-secret');
  assert.equal(redirectMode, 'manual');
});

test('document transport does not call the network when OpenDART is unconfigured', async () => {
  let calls = 0;
  const unconfigured = client(async () => {
    calls += 1;
    return new Response(archiveBody);
  }, { apiKey: '' });
  await assert.rejects(
    unconfigured.getDocumentArchive(receipt),
    (error: OpenDartError) => error.code === 'OPENDART_NOT_CONFIGURED',
  );
  assert.equal(calls, 0);
});

test('document transport rejects invalid receipts before any network request', async () => {
  let calls = 0;
  const transport = client(async () => {
    calls += 1;
    return new Response(archiveBody);
  });
  await assert.rejects(
    transport.getDocumentArchive('../20260720000001'),
    (error: OpenDartError) => error.code === 'INVALID_RECEIPT',
  );
  assert.equal(calls, 0);
});

test('document transport enforces declared and streamed compressed byte limits', async () => {
  const declared = client(
    async () => new Response(archiveBody, { headers: { 'content-length': '1000' } }),
    { maximumBytes: 100 },
  );
  await assert.rejects(
    declared.getDocumentArchive(receipt),
    (error: OpenDartError) => error.code === 'OPENDART_DOCUMENT_TOO_LARGE',
  );

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(archive.subarray(0, 80));
      controller.enqueue(archive.subarray(80));
      controller.close();
    },
  });
  const streamed = client(async () => new Response(stream), { maximumBytes: 100 });
  await assert.rejects(
    streamed.getDocumentArchive(receipt),
    (error: OpenDartError) => error.code === 'OPENDART_DOCUMENT_TOO_LARGE',
  );

  const malformedLength = client(
    async () => new Response(archiveBody, { headers: { 'content-length': '-1' } }),
  );
  assert.deepEqual(await malformedLength.getDocumentArchive(receipt), archive);
});

test('document transport follows at most one same-host HTTPS redirect', async () => {
  const requested: URL[] = [];
  const redirected = client(async input => {
    const url = new URL(String(input));
    requested.push(url);
    return requested.length === 1
      ? new Response(null, { status: 302, headers: { location: '/download/document.xml' } })
      : new Response(archiveBody);
  });
  assert.deepEqual(await redirected.getDocumentArchive(receipt), archive);
  assert.equal(requested.length, 2);
  assert.equal(requested[1]?.hostname, 'opendart.example.test');

  for (const location of [
    'http://opendart.example.test/document.xml',
    'https://other.example.test/document.xml',
    'https://opendart.example.test:8443/document.xml',
  ]) {
    let calls = 0;
    await assert.rejects(client(async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location } });
    }).getDocumentArchive(receipt), OpenDartError);
    assert.equal(calls, 1);
  }

  let loopCalls = 0;
  await assert.rejects(client(async () => {
    loopCalls += 1;
    return new Response(null, { status: 302, headers: { location: '/again' } });
  }).getDocumentArchive(receipt), OpenDartError);
  assert.equal(loopCalls, 2);
});

test('document transport maps HTTP and OpenDART application failures safely', async () => {
  const cases: Array<[number, string]> = [
    [404, 'OPENDART_DOCUMENT_NOT_FOUND'],
    [401, 'OPENDART_AUTH_ERROR'],
    [429, 'OPENDART_RATE_LIMITED'],
    [500, 'OPENDART_UNAVAILABLE'],
  ];
  for (const [status, code] of cases) {
    await assert.rejects(
      client(async () => new Response(null, { status })).getDocumentArchive(receipt),
      (error: OpenDartError) => error.code === code,
    );
  }
  for (const [status, code] of [
    ['013', 'OPENDART_DOCUMENT_NOT_FOUND'],
    ['014', 'OPENDART_DOCUMENT_NOT_FOUND'],
    ['020', 'OPENDART_RATE_LIMITED'],
    ['010', 'OPENDART_AUTH_ERROR'],
    ['011', 'OPENDART_AUTH_ERROR'],
    ['012', 'OPENDART_AUTH_ERROR'],
    ['901', 'OPENDART_AUTH_ERROR'],
    ['800', 'OPENDART_UNAVAILABLE'],
    ['900', 'OPENDART_UNAVAILABLE'],
    ['100', 'OPENDART_BAD_REQUEST_MAPPING'],
  ]) {
    const payload = `<result><status>${status}</status><message>private upstream text</message></result>`;
    await assert.rejects(
      client(async () => new Response(payload)).getDocumentArchive(receipt),
      (error: OpenDartError) => error.code === code && !error.message.includes('private upstream text'),
    );
  }
  await assert.rejects(
    client(async () => new Response('not a zip')).getDocumentArchive(receipt),
    (error: OpenDartError) => error.code === 'OPENDART_DOCUMENT_INVALID_ARCHIVE',
  );
});

test('document transport classifies timeouts and network failures without retrying', async () => {
  let timeoutCalls = 0;
  const timeout = client(
    async (_input, init) => {
      timeoutCalls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    },
    { timeoutMs: 1 },
  );
  await assert.rejects(
    timeout.getDocumentArchive(receipt),
    (error: OpenDartError) => error.code === 'OPENDART_TIMEOUT' && error.retryable,
  );
  assert.equal(timeoutCalls, 1);

  let networkCalls = 0;
  await assert.rejects(client(async () => {
    networkCalls += 1;
    throw new Error('offline');
  }).getDocumentArchive(receipt), (error: OpenDartError) => error.code === 'OPENDART_UNAVAILABLE');
  assert.equal(networkCalls, 1);
});
