import { FilingLexicalError } from './errors.js';
import { FILING_LEXICAL_BOUNDS, FILING_LEXICAL_PROFILE } from './profile.js';
import { LexicalField } from './contracts.js';

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const KOREAN = /^\p{Script=Hangul}+$/u;
const SAFE_LEXEME = /^(?:\p{Script=Hangul}|[a-z0-9])+$/u;
const TOKEN = /[+-]?\d[\d,]*(?:\.\d+)*(?:%)?|\p{Script=Hangul}+|[A-Za-z][A-Za-z0-9]*/gu;

function invalid(code: 'FILING_LEXICAL_INVALID_INPUT' | 'FILING_LEXICAL_QUERY_INVALID'): never {
  throw new FilingLexicalError(code, false);
}

export function normalizeLexicalText(value: string, maximumCharacters: number): string {
  if (typeof value !== 'string' || value.length > maximumCharacters || CONTROL.test(value)) {
    invalid('FILING_LEXICAL_INVALID_INPUT');
  }
  return value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function numericLexeme(value: string): string {
  const encoded = value.toLowerCase()
    .replace(/^-/u, 'n')
    .replace(/^\+/u, 'p')
    .replace(/,/gu, 'c')
    .replace(/\./gu, 'd')
    .replace(/%$/u, 'pct');
  return `num${encoded}`;
}

function addLexeme(
  target: string[],
  seen: Set<string>,
  value: string,
  query: boolean,
): void {
  if (!value || value.length > FILING_LEXICAL_BOUNDS.maximumTokenLength || !SAFE_LEXEME.test(value)) {
    invalid(query ? 'FILING_LEXICAL_QUERY_INVALID' : 'FILING_LEXICAL_INVALID_INPUT');
  }
  if (!seen.has(value)) {
    seen.add(value);
    target.push(value);
  }
}

export function lexicalizeText(
  value: string,
  options: { readonly query?: boolean } = {},
): LexicalField {
  const maximumCharacters = options.query
    ? FILING_LEXICAL_BOUNDS.maximumQueryCharacters
    : FILING_LEXICAL_BOUNDS.maximumSourceFieldCharacters;
  let normalized: string;
  try {
    normalized = normalizeLexicalText(value, maximumCharacters);
  } catch (error) {
    if (options.query && error instanceof FilingLexicalError) {
      invalid('FILING_LEXICAL_QUERY_INVALID');
    }
    throw error;
  }
  const lexemes: string[] = [];
  const seen = new Set<string>();
  const isQuery = options.query === true;
  for (const match of normalized.matchAll(TOKEN)) {
    const token = match[0]!;
    if (KOREAN.test(token)) {
      if (token.length > FILING_LEXICAL_BOUNDS.maximumKoreanRunLength) {
        invalid(options.query ? 'FILING_LEXICAL_QUERY_INVALID' : 'FILING_LEXICAL_INVALID_INPUT');
      }
      if (token.length <= FILING_LEXICAL_BOUNDS.maximumTokenLength) {
        addLexeme(lexemes, seen, token, isQuery);
      }
      for (const size of FILING_LEXICAL_PROFILE.ngramSizes) {
        for (let index = 0; index + size <= token.length; index += 1) {
          addLexeme(lexemes, seen, token.slice(index, index + size), isQuery);
        }
      }
    } else if (/^[+-]?\d/u.test(token)) {
      addLexeme(lexemes, seen, numericLexeme(token), isQuery);
    } else {
      addLexeme(lexemes, seen, token.toLowerCase(), isQuery);
    }
    const maximumLexemes = options.query
      ? FILING_LEXICAL_BOUNDS.maximumQueryLexemes
      : FILING_LEXICAL_BOUNDS.maximumLexemesPerField;
    if (lexemes.length > maximumLexemes) {
      invalid(options.query ? 'FILING_LEXICAL_QUERY_INVALID' : 'FILING_LEXICAL_INVALID_INPUT');
    }
  }
  return { lexemes, payload: lexemes.join(' ') };
}

export function safeOrTsquery(lexemes: readonly string[]): string {
  if (lexemes.length > FILING_LEXICAL_BOUNDS.maximumQueryLexemes
    || lexemes.some(value => !SAFE_LEXEME.test(value))) {
    invalid('FILING_LEXICAL_QUERY_INVALID');
  }
  return lexemes.join(' | ');
}
