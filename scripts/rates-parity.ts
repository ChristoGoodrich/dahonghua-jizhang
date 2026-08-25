// TypeScript half of the exchange-rate parity harness.
//
// No HTTP on either side: the corpus hands over what each source said and both
// halves answer with what they would believe. That is only possible because
// rates.ts now keeps its decisions in three pure functions — before the split
// they were interleaved with `fetch` and could not be checked without mocking
// a network.

import { invertRate, isRecent, resolveRate } from '../src/domain/rates';

const raw = require('fs').readFileSync(0, 'utf8') as string;

const cell = (f: string[], i: number): string | undefined => {
  const v = f[i];
  return v === undefined || v === '_' || v === '' ? undefined : v;
};

/** `_` is "the API said nothing usable" — a missing key, a string, a timeout. */
function apiValue(f: string[], i: number): unknown {
  const v = cell(f, i);
  if (v === undefined) return undefined;
  if (v === 'nan') return NaN;
  if (v === 'inf') return Infinity;
  if (v === '-inf') return -Infinity;
  return Number(v);
}

const n = (v: number) => String(v);

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const f = trimmed.slice(tab + 1).split('~');

  let value: string;
  switch (kind) {
    case 'invert': {
      const r = invertRate(apiValue(f, 0));
      value = r === null ? 'null' : n(r);
      break;
    }
    case 'parse': {
      // `new Date('YYYY-MM-DDT00:00:00')`, rendered in the same civil terms the
      // core answers in — a zero-based month, so it lines up with Civil
      const d = new Date((f[0] ?? '') + 'T00:00:00');
      value = Number.isNaN(d.getTime())
        ? 'null'
        : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      break;
    }
    case 'recent': {
      const now = new Date(
        Number(cell(f, 1) ?? 2026),
        Number(cell(f, 2) ?? 5),
        Number(cell(f, 3) ?? 10),
        0,
        Number(cell(f, 4) ?? 0),
      ).getTime();
      value = String(isRecent(f[0] ?? '', now));
      break;
    }
    case 'resolve': {
      const cached = apiValue(f, 4);
      const r = resolveRate(
        cell(f, 0) === '1',
        apiValue(f, 1),
        cell(f, 2) === '1',
        apiValue(f, 3),
        typeof cached === 'number' ? cached : undefined,
      );
      value = `${r.rate === null ? 'null' : n(r.rate)} ${r.source}`;
      break;
    }
    default:
      throw new Error(`unknown kind ${kind}`);
  }
  out.push(`${kind}\t${value}`);
}
console.log(out.join('\n'));
