import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DisclosureDocumentAcquisitionService,
  validateReceiptNumber,
} from '../src/openDart/document/disclosureDocumentAcquisitionService.js';
import { DisclosureDocumentProvider } from '../src/openDart/document/documentContracts.js';
import { SafeDisclosureArchiveReader } from '../src/openDart/document/safeDisclosureArchiveReader.js';
import { OpenDartError } from '../src/openDart/errors.js';
import { syntheticZip } from './helpers/syntheticZip.js';

const receipt = '20260720000001';
const archive = syntheticZip([{
  name: 'document.xml',
  content: '<DOCUMENT>ALPHA TWIN TEST COMPANY</DOCUMENT>',
}]);

test('receipt validation accepts only an exact fourteen-digit identity', () => {
  assert.equal(validateReceiptNumber(receipt), receipt);
  for (const value of [
    '2026072000000',
    '202607200000011',
    '2026072000000A',
    '20260720-00001',
    ` ${receipt}`,
    `${receipt} `,
    '',
    '../20260720000001',
    "' OR 1=1 --",
  ]) {
    assert.throws(
      () => validateReceiptNumber(value),
      (error: OpenDartError) => error.code === 'INVALID_RECEIPT',
    );
  }
});

test('invalid receipts never reach the provider', () => {
  let calls = 0;
  const provider: DisclosureDocumentProvider = {
    id: 'opendart-fss',
    async fetchDocumentArchive() {
      calls += 1;
      return archive;
    },
  };
  const service = new DisclosureDocumentAcquisitionService(provider);
  assert.throws(() => service.acquire('bad'), OpenDartError);
  assert.equal(calls, 0);
});

test('acquisition coalesces concurrent receipts and clears failed single-flight state', async () => {
  let calls = 0;
  let fail = false;
  const provider: DisclosureDocumentProvider = {
    id: 'opendart-fss',
    async fetchDocumentArchive() {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      if (fail) throw new OpenDartError('OPENDART_UNAVAILABLE', 'filing-document', true);
      return archive;
    },
  };
  const service = new DisclosureDocumentAcquisitionService(
    provider,
    new SafeDisclosureArchiveReader(),
  );
  const results = await Promise.all([
    service.acquire(receipt),
    service.acquire(receipt),
    service.acquire(receipt),
  ]);
  assert.equal(calls, 1);
  assert.equal(results[0]?.entries.length, 1);

  const firstSignal = new AbortController();
  const secondSignal = new AbortController();
  await Promise.all([
    service.acquire(receipt, firstSignal.signal),
    service.acquire(receipt, secondSignal.signal),
  ]);
  assert.equal(calls, 3);

  fail = true;
  await assert.rejects(service.acquire('20260720000002'));
  fail = false;
  await service.acquire('20260720000002');
  assert.equal(calls, 5);
});

test('acquisition logs only bounded metadata and error categories', async () => {
  const events: object[] = [];
  const provider: DisclosureDocumentProvider = {
    id: 'opendart-fss',
    async fetchDocumentArchive() {
      return archive;
    },
  };
  let now = 100;
  const service = new DisclosureDocumentAcquisitionService(
    provider,
    new SafeDisclosureArchiveReader(),
    undefined,
    () => now += 5,
  );
  service.setLogger({
    info(data) { events.push(data); },
    warn(data) { events.push(data); },
    error(data) { events.push(data); },
  });
  await service.acquire(receipt);
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('ALPHA TWIN TEST COMPANY'), false);
  assert.equal(serialized.includes('crtfc_key'), false);
  assert.equal(serialized.includes('content'), false);
  assert.equal(serialized.includes(receipt), true);
  assert.equal(serialized.includes('compressedBytes'), true);
});
