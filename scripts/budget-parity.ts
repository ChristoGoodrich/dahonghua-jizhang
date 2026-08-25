// TypeScript half of the budget parity harness.
//
// The `rows` cases are the interesting ones. `catBudgetRows` sorts by
// percentage and `Array.prototype.sort` is stable, so every tie is broken by
// `Object.keys` order — and ties are the normal state of a fresh cycle, where
// every capped category sits at exactly zero percent. This side builds a real
// object from the corpus's ordered pairs, so whatever JavaScript does to that
// order is what gets compared: including moving integer-like keys to the front
// in ascending numeric order, which the corpus deliberately provokes.

import {
  tierStatus,
  expenseTotal,
  todayExpense,
  monthlyStatus,
  dailyStatus,
  catBudgetRows,
  type TierStatus,
} from '../src/domain/budget';
import type { Entry, IO, Settings } from '../src/domain/types';

const raw = require('fs').readFileSync(0, 'utf8') as string;

function num(s: string | undefined, fallback = 0): number {
  if (s === undefined || s === '' || s === '_') return fallback;
  if (s === 'nan') return NaN;
  return Number(s);
}

/** io~cat~amt~y~m~d — noon, so the local day is never in doubt. */
function parseEntry(rec: string, i: number): Entry {
  const f = rec.split('~');
  return {
    id: `e${i}`,
    ts: new Date(num(f[3], 2026), num(f[4], 0), num(f[5], 1), 12, 0, 0).getTime(),
    io: (f[0] === '_' ? undefined : f[0]) as IO,
    cat: f[1] ?? '',
    amt: num(f[2]),
  } as Entry;
}

const n = (v: number) => String(v);
const show = (s: TierStatus) =>
  `lim=${n(s.limit)} used=${n(s.used)} left=${n(s.left)} pct=${n(s.pct)} over=${s.over}`;

/** `a:1;b:2` in the order given — assigned in that order so Object.keys sees it. */
function parseCaps(s: string): Record<string, number> {
  const cb: Record<string, number> = {};
  for (const p of s.split(';')) {
    if (!p) continue;
    const i = p.indexOf(':');
    cb[i < 0 ? p : p.slice(0, i)] = num(i < 0 ? '0' : p.slice(i + 1));
  }
  return cb;
}

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = trimmed.slice(tab + 1);
  const [body, extra = ''] = arg.split('|');
  const entries = body ? body.split('^').map(parseEntry) : [];

  const f = extra.split(',');
  const today = (from: number) =>
    new Date(num(f[from], 2026), num(f[from + 1], 0), num(f[from + 2], 1), 12, 0, 0).getTime();

  let value: string;
  switch (kind) {
    case 'tier':
      value = show(tierStatus(num(f[0]), num(f[1])));
      break;
    case 'total':
      value = n(expenseTotal(entries));
      break;
    case 'today':
      value = n(todayExpense(entries, today(0)));
      break;
    case 'monthly':
      value = show(monthlyStatus(entries, { budget: num(f[0]) } as Settings));
      break;
    case 'daily':
      value = show(dailyStatus(entries, { dailyBudget: num(f[0]) } as Settings, today(1)));
      break;
    case 'rows':
      value = catBudgetRows(entries, { catBudgets: parseCaps(extra) } as Settings)
        .map((r) => `${r.cat}:${n(r.pct)}`)
        .join(',');
      break;
    default:
      throw new Error(`unknown kind ${kind}`);
  }
  out.push(`${kind}\t${value}`);
}
console.log(out.join('\n'));
