import { FilingDenseError } from './errors.js';
import { canonicalizeDenseVector, denseVectorFingerprint } from './fingerprints.js';
import { FILING_DENSE_DIMENSION } from './profile.js';

export interface PreparedDenseVector {
  readonly values: readonly number[];
  readonly pgVector: string;
  readonly fingerprint: string;
}

function invalidVector(): never {
  throw new FilingDenseError('FILING_DENSE_VECTOR_INVALID', false);
}

export function prepareDenseVector(values: readonly number[]): PreparedDenseVector {
  if (values.length !== FILING_DENSE_DIMENSION
    || values.some(value => !Number.isFinite(value))) {
    invalidVector();
  }
  let canonical: readonly number[];
  try {
    canonical = canonicalizeDenseVector(values);
  } catch {
    invalidVector();
  }
  if (!canonical.some(value => value !== 0)) invalidVector();
  return {
    values: canonical,
    pgVector: `[${canonical.join(',')}]`,
    fingerprint: denseVectorFingerprint(canonical),
  };
}
