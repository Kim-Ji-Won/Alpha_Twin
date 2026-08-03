import assert from 'node:assert/strict';
import test from 'node:test';

import { FilingLexicalError } from '../src/filingIntelligence/lexical/errors.js';
import {
  lexicalContentHash,
  lexicalGenerationFingerprint,
  WeightedLexemes,
} from '../src/filingIntelligence/lexical/lexicalFingerprints.js';
import {
  lexicalizeText,
  normalizeLexicalText,
  safeOrTsquery,
} from '../src/filingIntelligence/lexical/lexicalNormalizer.js';
import { FILING_LEXICAL_BOUNDS } from '../src/filingIntelligence/lexical/profile.js';
import {
  filingLexicalWeightAText,
  filingLexicalWeightCText,
} from '../src/filingIntelligence/lexical/semanticFields.js';

function lexicalError(code: FilingLexicalError['code']) {
  return (error: unknown) => error instanceof FilingLexicalError && error.code === code;
}

test('lexical normalization is NFC, whitespace-collapsed, and deterministic', () => {
  const decomposed = '\u1100\u1161';
  assert.equal(normalizeLexicalText(`  ${decomposed}\r\n  DRAM  `, 100), '가 dram');
  assert.deepEqual(lexicalizeText('DRAM dram GPU').lexemes, ['dram', 'gpu']);
  assert.deepEqual(lexicalizeText('DRAM dram GPU'), lexicalizeText('DRAM dram GPU'));
});

test('Korean exact, bigram, and trigram lexemes bridge bounded spacing variations', () => {
  assert.deepEqual(lexicalizeText('반도체').lexemes, ['반도체', '반도', '도체']);
  const compact = new Set(lexicalizeText('인공지능').lexemes);
  const spaced = lexicalizeText('인공 지능').lexemes;
  assert.equal(spaced.some(value => compact.has(value)), true);
  const investment = new Set(lexicalizeText('시설투자').lexemes);
  assert.equal(lexicalizeText('시설 투자').lexemes.every(value => investment.has(value)), true);
});

test('financial numeric lexemes preserve format and leading zeroes without Number conversion', () => {
  assert.deepEqual(
    lexicalizeText('001 1,000 -12.4% 0.00 2026.03.31 100억원 백만원 USD KRW').lexemes,
    ['num001', 'num1c000', 'numn12d4pct', 'num0d00', 'num2026d03d31',
      'num100', '억원', '백만원', '백만', '만원', 'usd', 'krw'],
  );
});

test('semantic weights exclude opaque table and filing identifiers', () => {
  const tableId = `tbl_${'a'.repeat(64)}`;
  assert.equal(filingLexicalWeightAText({
    sectionPath: ['사업의 내용', '반도체 사업'],
    tableId,
  }), '사업의 내용 반도체 사업');
  assert.equal(filingLexicalWeightCText({
    companyName: '테스트전자',
    symbol: '005930',
    corpCode: '00126380',
    receiptNumber: '20260803000001',
    reportName: '반기보고서',
    reportCode: '11012',
    filingDate: '2026-08-03',
    sourceTitle: `source_${'b'.repeat(64)}`,
    upstreamReportName: `upstream_${'c'.repeat(64)}`,
  }), '테스트전자 005930 반기보고서 11012 2026-08-03');
});

test('content and generation fingerprints are deterministic and order-sensitive', () => {
  const weighted: WeightedLexemes = {
    chunkRowId: '1',
    chunkId: 'chunk-a',
    chunkContentHash: 'a'.repeat(64),
    weightA: ['사업'],
    weightB: ['반도체', 'dram'],
    weightC: ['테스트전자', 'num005930'],
  };
  const contentHash = lexicalContentHash(weighted);
  assert.equal(lexicalContentHash({ ...weighted }), contentHash);
  assert.notEqual(lexicalContentHash({
    ...weighted,
    weightB: [...weighted.weightB].reverse(),
  }), contentHash);
  const generation = [{ chunkId: weighted.chunkId, hash: contentHash, lexemeCount: 6 }];
  assert.equal(lexicalGenerationFingerprint(generation), lexicalGenerationFingerprint(generation));
  assert.notEqual(lexicalGenerationFingerprint(generation), lexicalGenerationFingerprint([
    ...generation,
    { chunkId: 'chunk-b', hash: 'b'.repeat(64), lexemeCount: 1 },
  ]));
});

test('query syntax and SQL fragments never become generated lexemes or raw tsquery syntax', () => {
  const field = lexicalizeText(`'alpha':* & beta | !gamma (drop table) \\`, { query: true });
  assert.deepEqual(field.lexemes, ['alpha', 'beta', 'gamma', 'drop', 'table']);
  assert.equal(safeOrTsquery(field.lexemes), 'alpha | beta | gamma | drop | table');
  assert.throws(() => safeOrTsquery(['unsafe:*']), lexicalError('FILING_LEXICAL_QUERY_INVALID'));
});

test('empty input is empty and controls, excessive length, runs, and query lexemes fail safely', () => {
  assert.deepEqual(lexicalizeText('...   ', { query: true }).lexemes, []);
  assert.throws(() => lexicalizeText('bad\u0000text'), lexicalError('FILING_LEXICAL_INVALID_INPUT'));
  assert.throws(() => lexicalizeText(
    'a'.repeat(FILING_LEXICAL_BOUNDS.maximumSourceFieldCharacters + 1),
  ), lexicalError('FILING_LEXICAL_INVALID_INPUT'));
  assert.throws(() => lexicalizeText('x'.repeat(FILING_LEXICAL_BOUNDS.maximumQueryCharacters + 1),
    { query: true }), lexicalError('FILING_LEXICAL_QUERY_INVALID'));
  assert.throws(() => lexicalizeText('x'.repeat(FILING_LEXICAL_BOUNDS.maximumTokenLength + 1),
    { query: true }), lexicalError('FILING_LEXICAL_QUERY_INVALID'));
  assert.throws(() => lexicalizeText('가'.repeat(FILING_LEXICAL_BOUNDS.maximumKoreanRunLength + 1),
    { query: true }), lexicalError('FILING_LEXICAL_QUERY_INVALID'));
  assert.throws(() => lexicalizeText(Array.from({ length: 600 }, (_, index) => `t${index}`).join(' '),
    { query: true }), lexicalError('FILING_LEXICAL_QUERY_INVALID'));
});
