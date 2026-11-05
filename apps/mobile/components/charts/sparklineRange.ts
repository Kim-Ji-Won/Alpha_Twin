export interface SparklineRange { startIndex: number; endIndex: number }

export const SPARKLINE_PAD_X = 6;

export function selectSparklineRange(
  points: readonly { score: number }[], width: number, startX: number, endX: number,
): SparklineRange | null {
  if (points.length < 2 || ![width, startX, endX].every(Number.isFinite)
    || width <= SPARKLINE_PAD_X * 2 || Math.abs(endX - startX) < 8
    || points.some(point => !Number.isFinite(point.score))) return null;
  const indexOf = (x: number) => Math.round(
    Math.max(0, Math.min(1, (x - SPARKLINE_PAD_X) / (width - SPARKLINE_PAD_X * 2)))
    * (points.length - 1),
  );
  const a = indexOf(startX);
  const b = indexOf(endX);
  return a === b ? null : { startIndex: Math.min(a, b), endIndex: Math.max(a, b) };
}
