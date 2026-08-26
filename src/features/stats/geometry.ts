// Where a chart's points go — the arithmetic under the drawing.
//
// Extracted from TrendChart.tsx, which says of itself that it is a
// "hand-rolled dual polyline in the app's own chart voice… and no chart
// library". That was a deliberate choice and it stays one; what it means for
// this migration is that the mapping from values to coordinates is the app's
// own code rather than a dependency's, so it is code that has to answer to the
// parity corpus like everything else.
//
// Three things in here are easy to get wrong and hard to notice:
//
//   * `Math.max()` of an empty list is `-Infinity`, not zero. Filtering a
//     series out and then asking for its maximum would put every point at
//     `-Infinity` and draw nothing.
//   * a single point has no span to divide by, so `n - 1` is zero.
//   * an all-zero series would divide by a zero maximum.
//
// All three are guarded, and all three guards are the kind a rewrite drops.

/** The drawing box, in the units the viewBox uses. */
export const CHART_W = 300;
export const CHART_H = 96;
export const CHART_PAD = 7;

export interface Point {
  x: number;
  y: number;
}

/** Which series are drawn. */
export type SeriesType = 'exp' | 'inc' | 'both';

/**
 * The tallest value any drawn series reaches, and never less than 1.
 *
 * The `1` is not cosmetic. It is the divisor for every y, so an all-zero day
 * would otherwise be a division by zero — and it also means a chart of small
 * numbers is not stretched to fill the box, which is the honest way to draw
 * "almost nothing happened".
 *
 * A series that is not being drawn contributes nothing, which is why this takes
 * the type rather than both arrays and a flag.
 */
export function chartMax(exp: number[], inc: number[], type: SeriesType = 'both'): number {
  const drawn: number[] = [];
  if (type === 'exp' || type === 'both') drawn.push(...exp);
  if (type === 'inc' || type === 'both') drawn.push(...inc);
  // `Math.max(...[])` is -Infinity, so the 1 is load-bearing twice over
  return Math.max(...drawn, 1);
}

/** The x for the `i`th of `n` points, spread evenly across the padded box. */
export function xOf(i: number, n: number): number {
  return CHART_PAD + (i / Math.max(1, n - 1)) * (CHART_W - 2 * CHART_PAD);
}

/** The y for a value, measured down from the top as SVG does. */
export function yOf(v: number, max: number): number {
  return CHART_H - CHART_PAD - (v / max) * (CHART_H - 2 * CHART_PAD);
}

/**
 * A series as drawable points.
 *
 * Coordinates are rounded to one decimal, which is what the polyline string
 * carries — so what is compared is what is drawn, not a value that happens to
 * round to it.
 */
export function polyline(values: number[], max: number, n: number): Point[] {
  return values.map((v, i) => ({
    x: Number(xOf(i, n).toFixed(1)),
    y: Number(yOf(v, max).toFixed(1)),
  }));
}
