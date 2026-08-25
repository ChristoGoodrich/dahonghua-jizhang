// TypeScript half of the trends parity harness.
//
// The corpus names a calendar *day* for each entry, plus the local *hour* it
// happened at. The core compares civil days and so ignores the hour; this side
// builds a real timestamp from both and lets the shipping code resolve the day
// back out of it.
//
// That asymmetry is the point. It is exactly the shape that was broken: bucket
// edges built as `today - i * 864e5` put an entry at 00:30 in the previous
// day's bucket for the whole window after a transition, while a civil-day
// comparison cannot. An hour of 0 on a day near a transition is therefore the
// case worth generating, and the corpus generates a lot of them.

import { dailyTrend, weeklyTrend, categoryTrend } from '../src/domain/trends';
import type { Entry, IO } from '../src/domain/types';

const raw = require('fs').readFileSync(0, 'utf8') as string;

/** `_` is absent, `nan` is a literal NaN, anything else is itself. */
function num(s: string | undefined): number | undefined {
  if (s === undefined || s === '_') return undefined;
  if (s === 'nan') return NaN;
  return Number(s);
}

/** io~cat~amt~y~m~d~deletedAt~hour */
function parseRow(rec: string, i: number): Entry {
  const f = rec.split('~');
  const hour = f[7] === undefined ? 12 : Number(f[7]);
  return {
    id: `e${i}`,
    ts: new Date(Number(f[3] ?? 2026), Number(f[4] ?? 0), Number(f[5] ?? 1), hour, 30, 0).getTime(),
    io: (f[0] === '_' ? undefined : f[0]) as IO,
    cat: f[1] ?? '',
    amt: num(f[2]) ?? 0,
    deletedAt: num(f[6]),
  } as Entry;
}

const n = (v: number) => String(v);

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = trimmed.slice(tab + 1);
  const [body, extra = ''] = arg.split('|');
  const rows = body ? body.split('^').map(parseRow) : [];

  // n,todayY,todayM,todayD[,category]
  const f = extra.split(',');
  const count = f[0] === undefined || f[0] === '' ? 7 : Number(f[0]);
  // noon, so `now` itself never sits in a skipped or repeated hour
  const now = new Date(Number(f[1] ?? 2026), Number(f[2] ?? 0), Number(f[3] ?? 1), 12, 0, 0).getTime();

  let value: string;
  switch (kind) {
    case 'daily':
      value = dailyTrend(rows, count, now)
        .map((p) => `${p.date}:${n(p.exp)}:${n(p.inc)}`)
        .join(',');
      break;
    case 'weekly':
      value = weeklyTrend(rows, count, now)
        .map((p) => `${p.date}:${n(p.exp)}:${n(p.inc)}`)
        .join(',');
      break;
    case 'cat':
      value = categoryTrend(rows, f[4] ?? '', count, now)
        .map((p) => `${p.date}:${n(p.amt)}`)
        .join(',');
      break;
    default:
      throw new Error(`unknown kind ${kind}`);
  }
  out.push(`${kind}\t${value}`);
}
console.log(out.join('\n'));
