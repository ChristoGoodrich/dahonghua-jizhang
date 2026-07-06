// Aggregations for the stats tab — ported from v7's renderStats / renderComparison.
import type { Entry, IO } from './types';
import { cycleRange } from './cycle';

export interface CatTotal {
  cat: string;
  amt: number;
}

export interface DonutSlice {
  cat: string;
  frac: number; // share of the total, 0..1
  start: number; // cumulative start fraction, 0..1
}

/** Cumulative slices for a donut chart. Empty when total<=0. */
export function donutSlices(cats: CatTotal[], total: number): DonutSlice[] {
  if (total <= 0) return [];
  let acc = 0;
  return cats.map((c) => {
    const frac = c.amt / total;
    const slice: DonutSlice = { cat: c.cat, frac, start: acc };
    acc += frac;
    return slice;
  });
}

/** Total grouped by category for the given io (default expense), sorted descending. */
export function byCategory(entries: Entry[], io: IO = 'exp'): CatTotal[] {
  const map = new Map<string, number>();
  for (const d of entries) {
    if (d.io !== io) continue;
    map.set(d.cat, (map.get(d.cat) ?? 0) + d.amt);
  }
  return [...map.entries()]
    .map(([cat, amt]) => ({ cat, amt }))
    .sort((a, b) => b.amt - a.amt);
}

/** The N largest single entries for the given io (default expense), descending. */
export function topEntries(entries: Entry[], io: IO = 'exp', n = 5): Entry[] {
  return entries
    .filter((d) => d.io === io)
    .sort((a, b) => b.amt - a.amt)
    .slice(0, n);
}

export interface WeekdayTotal {
  dow: number; // 0 = Sunday … 6 = Saturday (matches Date.getDay)
  amt: number;
  count: number;
}

/** Totals bucketed by day of week for the given io (default expense). Always
 *  returns 7 buckets, Sunday-first, so the UI can label them by locale. */
export function byWeekday(entries: Entry[], io: IO = 'exp'): WeekdayTotal[] {
  const buckets: WeekdayTotal[] = Array.from({ length: 7 }, (_, dow) => ({ dow, amt: 0, count: 0 }));
  for (const d of entries) {
    if (d.io !== io) continue;
    const b = buckets[new Date(d.ts).getDay()];
    b.amt += d.amt;
    b.count += 1;
  }
  return buckets;
}

export interface Overview {
  exp: number;
  inc: number;
  balance: number; // inc - exp
  count: number; // all entries in range, including transfers
}

/** Expense / income / balance / entry-count over a set of entries. */
export function overview(entries: Entry[]): Overview {
  let exp = 0;
  let inc = 0;
  for (const d of entries) {
    if (d.io === 'exp') exp += d.amt;
    else if (d.io === 'inc') inc += d.amt;
  }
  return { exp, inc, balance: inc - exp, count: entries.length };
}

export interface StatTotals {
  todayExp: number;
  avg: number; // per elapsed day in the cycle
  top: number; // largest single expense
  count: number;
}

export function statTotals(cycleEntries: Entry[], anchor: Date, cycleStart: number, now = Date.now()): StatTotals {
  const exp = cycleEntries.filter((d) => d.io === 'exp');
  const total = exp.reduce((s, d) => s + d.amt, 0);
  const todayStr = new Date(now).toDateString();
  const todayExp = exp.filter((d) => new Date(d.ts).toDateString() === todayStr).reduce((s, d) => s + d.amt, 0);
  const { start, end } = cycleRange(anchor, cycleStart);
  const elapsed = Math.max(1, Math.ceil((Math.min(now, end.getTime()) - start.getTime()) / 864e5));
  return {
    todayExp,
    avg: total / elapsed,
    top: exp.length ? Math.max(...exp.map((d) => d.amt)) : 0,
    count: cycleEntries.length,
  };
}

/** Expense totals for the 6 cycles ending at `anchor`'s cycle (oldest first). */
export function sixMonthTrend(all: Entry[], anchor: Date, cycleStart: number): { label: Date; total: number }[] {
  const out: { label: Date; total: number }[] = [];
  const { start } = cycleRange(anchor, cycleStart);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(start);
    d.setMonth(d.getMonth() - i);
    const r = cycleRange(d, cycleStart);
    const total = all
      .filter((x) => x.io === 'exp' && x.ts >= r.start.getTime() && x.ts < r.end.getTime())
      .reduce((s, x) => s + x.amt, 0);
    out.push({ label: r.start, total });
  }
  return out;
}

export interface Comparison {
  thisCum: number[];
  lastCum: number[];
  thisTotal: number;
  lastTotal: number;
  elapsedDays: number;
}

/** Cumulative daily spend, this cycle vs the same elapsed days last cycle. */
export function comparison(all: Entry[], anchor: Date, cycleStart: number, now = Date.now()): Comparison {
  const { start, end } = cycleRange(anchor, cycleStart);
  const elapsedDays = Math.max(1, Math.ceil((Math.min(now, end.getTime()) - start.getTime()) / 864e5));

  const daily = (rangeStart: number, rangeEnd: number) => {
    const arr = new Array(elapsedDays).fill(0);
    for (const d of all) {
      if (d.io !== 'exp' || d.ts < rangeStart || d.ts >= rangeEnd) continue;
      const day = Math.floor((d.ts - rangeStart) / 864e5);
      if (day >= 0 && day < elapsedDays) arr[day] += d.amt;
    }
    return arr;
  };

  const lastStart = new Date(start);
  lastStart.setMonth(lastStart.getMonth() - 1);
  const lr = cycleRange(lastStart, cycleStart);

  const cum = (a: number[]) => {
    let s = 0;
    return a.map((x) => (s += x));
  };

  const thisCum = cum(daily(start.getTime(), end.getTime()));
  const lastCum = cum(daily(lr.start.getTime(), lr.end.getTime()));
  return {
    thisCum,
    lastCum,
    thisTotal: thisCum[elapsedDays - 1] ?? 0,
    lastTotal: lastCum[elapsedDays - 1] ?? 0,
    elapsedDays,
  };
}
