import { createHash } from 'node:crypto';

import { DenseEvaluationError } from './contracts.js';

function canonicalValue(value: unknown, inArray = false): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new DenseEvaluationError('EVALUATION_NON_FINITE_NUMBER');
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === undefined) {
    if (inArray) throw new DenseEvaluationError('EVALUATION_UNDEFINED_ARRAY_VALUE');
    return undefined;
  }
  if (Array.isArray(value)) return value.map(item => canonicalValue(item, true));
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new DenseEvaluationError('EVALUATION_NON_PLAIN_OBJECT');
    }
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, item]) => {
        const canonical = canonicalValue(item);
        return canonical === undefined ? [] : [[key, canonical]];
      }));
  }
  throw new DenseEvaluationError('EVALUATION_UNSUPPORTED_VALUE');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
