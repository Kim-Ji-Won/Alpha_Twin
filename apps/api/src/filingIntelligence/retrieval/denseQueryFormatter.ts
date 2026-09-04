import { DENSE_COST_LIMITS, DenseTokenizer } from '../dense/batchPlanner.js';
import { ActiveCompanyDenseSearchError } from './errors.js';

export const DENSE_QUERY_FORMATTER_ID = 'query-text-only@1' as const;
export const DENSE_QUERY_MAXIMUM_CODE_POINTS = 2_000;

const UNSAFE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

function invalidQuery(): never {
  throw new ActiveCompanyDenseSearchError('FILING_ACTIVE_DENSE_SEARCH_INVALID_INPUT', false);
}

export interface PreparedDenseQuery {
  readonly formatted: string;
  readonly codePointCount: number;
  readonly tokenCount: number;
}

export function prepareDenseQuery(query: string, tokenizer: DenseTokenizer): PreparedDenseQuery {
  const formatted = query.normalize('NFC').trim();
  const codePointCount = [...formatted].length;
  if (formatted.length === 0 || codePointCount > DENSE_QUERY_MAXIMUM_CODE_POINTS
    || UNSAFE_CONTROL.test(formatted)) {
    invalidQuery();
  }
  const tokenCount = tokenizer.count(formatted);
  if (!Number.isInteger(tokenCount) || tokenCount < 1
    || tokenCount > DENSE_COST_LIMITS.maximumTokensPerInput) {
    invalidQuery();
  }
  return { formatted, codePointCount, tokenCount };
}
