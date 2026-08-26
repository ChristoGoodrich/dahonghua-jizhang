// TypeScript half of the chart-geometry parity harness.
//
// A corpus line is `kind<TAB>json`. What is compared is where the points land,
// to the decimal the polyline string actually carries — so a divergence here
// is a divergence in what gets drawn, not in a value that rounds to the same
// pixel.

import { chartMax, polyline, xOf, yOf, type SeriesType } from '../src/features/stats/geometry';

const raw = require('fs').readFileSync(0, 'utf8') as string;

const n = (v: number) => String(v);

/** `"nan"` in the corpus is a NaN.
 *
 *  JSON has no syntax for one, and unlike the sync corpora — where that is a
 *  fact about the code, since the transport is JSON — a chart series is summed
 *  from ledger amounts and can hold one. The gap was the harness's, so the
 *  harness closes it. */
const nums = (a: unknown): number[] =>
  (a as unknown[]).map((v) => (v === 'nan' ? NaN : (v as number)));

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const a = JSON.parse(trimmed.slice(tab + 1)) as Record<string, unknown>;

  let value: string;
  switch (kind) {
    case 'max':
      value = n(chartMax(nums(a.exp), nums(a.inc), a.type as SeriesType));
      break;
    case 'x':
      value = n(xOf(a.i as number, a.n as number));
      break;
    case 'y':
      value = n(yOf(a.v === 'nan' ? NaN : (a.v as number), a.max as number));
      break;
    case 'line': {
      const exp = nums(a.exp);
      const inc = nums(a.inc);
      const type = a.type as SeriesType;
      const max = chartMax(exp, inc, type);
      const count = a.n as number;
      const draw = (arr: number[]) =>
        polyline(arr, max, count).map((p) => `${n(p.x)},${n(p.y)}`).join(' ');
      value = `max=${n(max)} exp=[${draw(exp)}] inc=[${draw(inc)}]`;
      break;
    }
    default:
      throw new Error(`unknown kind ${kind}`);
  }
  out.push(`${kind}\t${value}`);
}
console.log(out.join('\n'));
