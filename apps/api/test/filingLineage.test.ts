import assert from 'node:assert/strict';
import test from 'node:test';

import { FilingLineageError } from '../src/filingIntelligence/lineage/errors.js';
import {
  validateFamilyInput,
  validateReceiptMetadata,
  validateRelationInput,
} from '../src/filingIntelligence/lineage/validation.js';

const HASH = 'a'.repeat(64);
const receipt = {
  provider: 'opendart-fss' as const,
  receiptNumber: '20990101000001',
  corpCode: '11111111',
  symbol: '111111',
  companyName: 'SYNTHETIC COMPANY A',
  reportName: '[기재정정] 합성 사업보고서',
  reportCode: '11011',
  filingDate: '2099-01-01',
  correctionType: 'content-correction' as const,
  hasSubsequentCorrection: true,
  isWithdrawn: false,
  metadataSource: 'synthetic-test',
  metadataObservedAt: '2099-01-02T00:00:00.000Z',
};

test('receipt metadata preserves correction observations without resolving lineage', () => {
  const value = validateReceiptMetadata(receipt);
  assert.equal(value.correctionType, 'content-correction');
  assert.equal(value.hasSubsequentCorrection, true);
  assert.equal(value.legalStatus, 'unknown');
  assert.equal('lineageStatus' in value, false);
});

test('observation time does not alter the content fingerprint', () => {
  const first = validateReceiptMetadata(receipt);
  const later = validateReceiptMetadata({
    ...receipt,
    metadataObservedAt: '2099-01-03T00:00:00.000Z',
  });
  assert.equal(first.metadataFingerprint, later.metadataFingerprint);
});

test('receipt observations require an explicit timezone', () => {
  assert.throws(
    () => validateReceiptMetadata({ ...receipt, metadataObservedAt: '2099-01-02T00:00:00' }),
    (error: unknown) => error instanceof FilingLineageError
      && error.code === 'FILING_RECEIPT_INVALID_INPUT',
  );
});

test('withdrawal observation maps conservatively to withdrawn legal status', () => {
  const value = validateReceiptMetadata({ ...receipt, isWithdrawn: true });
  assert.equal(value.legalStatus, 'withdrawn');
});

test('invalid receipt, company, symbol, and date values fail closed', () => {
  for (const invalid of [
    { ...receipt, receiptNumber: 'unsafe' },
    { ...receipt, corpCode: '1' },
    { ...receipt, symbol: '1' },
    { ...receipt, filingDate: '2099-02-30' },
  ]) {
    assert.throws(
      () => validateReceiptMetadata(invalid),
      (error: unknown) => error instanceof FilingLineageError
        && error.code === 'FILING_RECEIPT_INVALID_INPUT',
    );
  }
});

test('verified family and relation require owned source hashes and reject self edges', () => {
  const family = {
    provider: 'opendart-fss' as const,
    corpCode: '11111111',
    symbol: '111111',
    lineageRootReceiptNumber: '20990101000001',
    verificationSource: 'trusted_backfill' as const,
    verificationReferenceHash: HASH,
  };
  assert.doesNotThrow(() => validateFamilyInput(family));
  assert.throws(
    () => validateFamilyInput({ ...family, verificationReferenceHash: 'unsafe' }),
    (error: unknown) => error instanceof FilingLineageError
      && error.code === 'FILING_FAMILY_INVALID_INPUT',
  );
  assert.throws(
    () => validateRelationInput({
      ...family,
      correctionReceiptNumber: family.lineageRootReceiptNumber,
      correctsReceiptNumber: family.lineageRootReceiptNumber,
      relationType: 'corrects',
      relationSource: 'trusted_backfill',
      relationReferenceHash: HASH,
      verifiedAt: '2099-01-02T00:00:00.000Z',
    }),
    (error: unknown) => error instanceof FilingLineageError
      && error.code === 'FILING_CORRECTION_SELF_REFERENCE',
  );
});
