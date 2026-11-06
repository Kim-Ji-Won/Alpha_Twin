import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSha256 } from '../evaluation/filingDense/canonical.js';
import { chunkKey, parseDatasetEnvelope } from '../evaluation/filingDense/dataset.js';
import { canonicalToEvaluationLocator, evaluationToCanonicalLocator, parseEvaluationLocator } from '../evaluation/filingDense/evaluationLocator.js';
import type { FilingChunk } from '../src/openDart/document/canonicalFilingContracts.js';

const narrative = { entryName: 'synthetic.xml', firstBlockOrdinal: 1, lastBlockOrdinal: 2,
  continuation: false, continuationIndex: 0 } as const;
const table = { ...narrative, tableId: 'synthetic-table' };
const pin = (locator: unknown) => ({ provider: 'opendart-fss', corpCode: '12345678', symbol: '123456',
  receiptNumber: '20260101000001', documentId: '1', chunkId: 'synthetic', contentHash: 'a'.repeat(64),
  representationFingerprint: 'b'.repeat(64), parserVersion: '1', chunkerVersion: '1', schemaVersion: '1',
  sectionPath: ['Synthetic'], locator });
function parsePin(locator: unknown) {
  const payload = { datasetId: 'dense-eval-v1', schemaVersion: 'dense-eval-dataset@1', split: 'dev',
    targetCount: 40, entries: [{ queryId: 'DEV-001', split: 'dev', queryText: 'Synthetic question',
      categories: ['numeric'], company: { corpCode: '12345678', symbol: '123456' }, reportFamily: 'annual',
      evidenceModality: 'table', currentEffectiveCorrection: false,
      evidenceGroups: [{ evidenceGroupId: 'g', grade: 2, acceptableChunks: [pin(locator)] }],
      review: { status: 'pending', reviewRoundCount: 0 } }] };
  return parseDatasetEnvelope({ payload, canonicalHash: canonicalSha256(payload) }, 'dev')
    .payload.entries[0]!.evidenceGroups[0]!.acceptableChunks[0]!;
}

for (const [name, ranges] of [
  ['row', { rowRange: [2, 5] }],
  ['header', { repeatedHeaderRowRange: [0, 1] }],
  ['both', { rowRange: [2, 5], repeatedHeaderRowRange: [0, 1] }],
] as const) test(`evaluation locator lossless ${name} range conversion and dataset parsing`, () => {
  const source = { ...table, ...ranges };
  const before = structuredClone(source);
  const result = canonicalToEvaluationLocator(source);
  assert.deepEqual(result, canonicalToEvaluationLocator(source));
  assert.deepEqual(source, before);
  assert.deepEqual(evaluationToCanonicalLocator(result), source);
  assert.deepEqual(parsePin(result).locator, result);
  assert.ok(Object.values(result).every(v => !Array.isArray(v)));
});

test('narrative, legacy scalar and empty-table locators remain supported', () => {
  for (const locator of [narrative, table]) {
    assert.deepEqual(evaluationToCanonicalLocator(canonicalToEvaluationLocator(locator)), locator);
    assert.deepEqual(parsePin(locator).locator, locator);
  }
  assert.deepEqual(parsePin({ ordinal: 1 }).locator, { ordinal: 1 });
  assert.throws(() => evaluationToCanonicalLocator({ ordinal: 1 }), { code: 'DATASET_LOCATOR_INVALID' });
});

for (const [start, end] of [['rowStart', 'rowEnd'], ['repeatedHeaderRowStart', 'repeatedHeaderRowEnd']] as const) {
  for (const [name, values] of [
    ['reversed', [2, 1]], ['negative', [-1, 1]], ['fraction', [0, 1.5]],
    ['unsafe', [0, Number.MAX_SAFE_INTEGER + 1]], ['numeric string', ['0', 1]],
    ['null', [null, 1]], ['missing start', [undefined, 1]], ['missing end', [0, undefined]],
  ] as const) test(`evaluation ${start} rejects ${name}`, () => {
    const locator = { ...table, ...(values[0] === undefined ? {} : { [start]: values[0] }),
      ...(values[1] === undefined ? {} : { [end]: values[1] }) };
    assert.throws(() => parsePin(locator), { code: 'DATASET_LOCATOR_INVALID' });
  });
  test(`evaluation ${start} requires table identity`, () => {
    for (const identity of [{}, { tableId: '' }, { tableId: null }, { tableId: 1 }]) {
      assert.throws(() => parsePin({ ...narrative, ...identity, [start]: 0, [end]: 1 }),
        { code: 'DATASET_LOCATOR_INVALID' });
    }
  });
}

test('raw tuples and stringified/legacy ranges are rejected rather than coerced', () => {
  for (const key of ['rowRange', 'repeatedHeaderRowRange']) {
    for (const value of [[0, 1], '[0,1]', '0-1']) {
      assert.throws(() => parsePin({ ...table, [key]: value }), { code: 'DATASET_LOCATOR_INVALID' });
    }
  }
  for (const locator of [{ ...table, rowRange: [1, 0] }, { ...table, rowRange: [0] },
    { ...narrative, rowRange: [0, 1] }, { ...table, extra: 'must not be discarded' }]) {
    assert.throws(() => canonicalToEvaluationLocator(locator as FilingChunk['locator']),
      { code: 'DATASET_LOCATOR_INVALID' });
  }
});

test('scalar locator validates block/continuation fields and never changes chunk identity', () => {
  for (const override of [{ firstBlockOrdinal: -1 }, { lastBlockOrdinal: 0 }, { continuation: 'false' },
    { continuationIndex: 0.5 }, { entryName: '' }]) {
    assert.throws(() => parseEvaluationLocator({ ...narrative, ...override }), { code: 'DATASET_LOCATOR_INVALID' });
  }
  const first = parsePin(canonicalToEvaluationLocator({ ...table, rowRange: [0, 1] }));
  const second = parsePin(canonicalToEvaluationLocator({ ...table, rowRange: [2, 3] }));
  assert.equal(chunkKey(first), chunkKey(second));
  assert.notDeepEqual(first.locator, second.locator);
});

test('conversion accepts frozen inputs, preserves header positions and does not alias tuples', () => {
  const source = Object.freeze({ ...table, rowRange: Object.freeze([2, 3] as const),
    repeatedHeaderRowRange: Object.freeze([0, 0] as const) });
  const scalar = canonicalToEvaluationLocator(source);
  assert.deepEqual(scalar, { ...table, rowStart: 2, rowEnd: 3,
    repeatedHeaderRowStart: 0, repeatedHeaderRowEnd: 0 });
  const restored = evaluationToCanonicalLocator(Object.freeze(scalar));
  assert.deepEqual(restored, source);
  assert.notEqual(restored.rowRange, source.rowRange);
  assert.notEqual(restored.repeatedHeaderRowRange, source.repeatedHeaderRowRange);
  const partial = Object.assign(Object.create({ rowEnd: 3 }), table, { rowStart: 2 });
  assert.throws(() => parseEvaluationLocator(partial), { code: 'DATASET_LOCATOR_INVALID' });
});
