import { DenseEvaluationError } from './contracts.js';

export function percentileR7(samples: readonly number[], probability: number): number {
  if (samples.length === 0) throw new DenseEvaluationError('PERCENTILE_EMPTY');
  if (samples.some(value => !Number.isFinite(value))) throw new DenseEvaluationError('PERCENTILE_NON_FINITE');
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new DenseEvaluationError('PERCENTILE_PROBABILITY_INVALID');
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  const low = sorted[lower]!;
  const high = sorted[Math.min(lower + 1, sorted.length - 1)]!;
  return low + fraction * (high - low);
}

function randomGenerator(seed: number): () => number {
  if (!Number.isInteger(seed)) throw new DenseEvaluationError('BOOTSTRAP_SEED_INVALID');
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

export const DEFAULT_BOOTSTRAP_ITERATIONS = 10_000 as const;
export const DEFAULT_BOOTSTRAP_SEED = 0x5eed1234 as const;

export function pairedBootstrapMeanCi(
  pairedDeltas: readonly number[],
  iterations = DEFAULT_BOOTSTRAP_ITERATIONS,
  seed = DEFAULT_BOOTSTRAP_SEED,
): { readonly mean: number; readonly lower95: number; readonly upper95: number;
  readonly iterations: number; readonly seed: number } {
  if (pairedDeltas.length === 0) throw new DenseEvaluationError('BOOTSTRAP_EMPTY');
  if (pairedDeltas.some(value => !Number.isFinite(value)) || !Number.isInteger(iterations) || iterations < 1) {
    throw new DenseEvaluationError('BOOTSTRAP_INPUT_INVALID');
  }
  const random = randomGenerator(seed);
  const means: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < pairedDeltas.length; index += 1) {
      sum += pairedDeltas[Math.floor(random() * pairedDeltas.length)]!;
    }
    means.push(sum / pairedDeltas.length);
  }
  return {
    mean: pairedDeltas.reduce((sum, value) => sum + value, 0) / pairedDeltas.length,
    lower95: percentileR7(means, 0.025),
    upper95: percentileR7(means, 0.975),
    iterations,
    seed,
  };
}

export function annExactRecall(
  exactIds: readonly string[],
  approximateIds: readonly string[],
  k = exactIds.length,
): number {
  if (exactIds.length === 0) throw new DenseEvaluationError('ANN_EXACT_SET_EMPTY');
  if (!Number.isInteger(k) || k < 1 || exactIds.length > k || approximateIds.length > k
    || new Set(exactIds).size !== exactIds.length || new Set(approximateIds).size !== approximateIds.length) {
    throw new DenseEvaluationError('ANN_INPUT_INVALID');
  }
  const approximate = new Set(approximateIds);
  return exactIds.filter(id => approximate.has(id)).length / exactIds.length;
}
