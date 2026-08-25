// Aggregations for the stats tab — ported from v7's renderStats / renderComparison.
import type { Entry, IO } from './types';
import { cycleRange } from './cycle';
import { descByAmt } from './order';
import { daysBetween } from './dates';
import { monthKey } from '@/store/indexes';

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
    .sort((a, b) => descByAmt(a.amt, b.amt));
}

/** The N largest single entries for the given io (default expense), descending. */
export function topEntries(entries: Entry[], io: IO = 'exp', n = 5): Entry[] {
  return entries
    .filter((d) => d.io === io)
    .sort((a, b) => descByAmt(a.amt, b.amt))
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

// Named time-of-day periods (凌晨/清晨/上午/中午/下午/傍晚/晚上), matching Cookie
// 记账时段. Ranges are [from, to) in local hours; keys map to i18n labels.
export const TIME_RANGES: { key: string; from: number; to: number }[] = [
  { key: 'dawn', from: 0, to: 5 }, // 凌晨
  { key: 'earlyMorning', from: 5, to: 8 }, // 清晨
  { key: 'morning', from: 8, to: 11 }, // 上午
  { key: 'noon', from: 11, to: 13 }, // 中午
  { key: 'afternoon', from: 13, to: 17 }, // 下午
  { key: 'dusk', from: 17, to: 19 }, // 傍晚
  { key: 'night', from: 19, to: 24 }, // 晚上
];

/** The time-of-day period key for a 0..23 hour. */
export function timeBucketOf(hour: number): string {
  for (const r of TIME_RANGES) if (hour >= r.from && hour < r.to) return r.key;
  return 'night';
}

export interface TimeBucket {
  key: string;
  amt: number;
  count: number;
}

/** Totals bucketed by time-of-day period for the given io (default expense).
 *  Always returns the 7 periods in chronological order. */
export function byTimeOfDay(entries: Entry[], io: IO = 'exp'): TimeBucket[] {
  const buckets: TimeBucket[] = TIME_RANGES.map((r) => ({ key: r.key, amt: 0, count: 0 }));
  const idx = new Map(TIME_RANGES.map((r, i) => [r.key, i]));
  for (const d of entries) {
    if (d.io !== io) continue;
    const b = buckets[idx.get(timeBucketOf(new Date(d.ts).getHours()))!];
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
  const elapsed = elapsedDaysIn(start, end, now);
  return {
    todayExp,
    avg: total / elapsed,
    top: exp.length ? Math.max(...exp.map((d) => d.amt)) : 0,
    count: cycleEntries.length,
  };
}

/**
 * How many days of the cycle have elapsed, counted in calendar days.
 *
 * This used to be `ceil((min(now, end) - start) / 864e5)`, which is twenty-four
 * hours rather than a calendar day. Across a daylight-saving transition the two
 * differ and the answer was wrong in both directions: in Sydney it read 4 on
 * the 5th of October and 7 on the 6th of April. `elapsed` divides the daily
 * average, so being one out early in a cycle changes it by a third or a half.
 */
export function elapsedDaysIn(start: Date, end: Date, now: number): number {
  const cycleLen = daysBetween(start.getTime(), end.getTime());
  return Math.max(1, Math.min(daysBetween(start.getTime(), now) + 1, cycleLen));
}

/** Return entries for a time range, using the month index when available to
 *  avoid a full scan. A cycle range can span two calendar months so we check
 *  both the start-month and end-month keys. */
function entriesInRange(
  all: Entry[],
  rangeStart: number,
  rangeEnd: number,
  monthIndex?: Map<string, Entry[]>,
): Entry[] {
  if (!monthIndex) return all.filter((x) => x.ts >= rangeStart && x.ts < rangeEnd);
  const keys = new Set<string>();
  keys.add(monthKey(rangeStart));
  keys.add(monthKey(rangeEnd - 1)); // inclusive end for month lookup
  const candidates: Entry[] = [];
  for (const k of keys) {
    const arr = monthIndex.get(k);
    if (arr) candidates.push(...arr);
  }
  return candidates.filter((x) => x.ts >= rangeStart && x.ts < rangeEnd);
}

/** Expense totals for the 6 cycles ending at `anchor`'s cycle (oldest first).
 *  Pass a `monthIndex` to skip the full-entry scan on large datasets. */
export function sixMonthTrend(
  all: Entry[],
  anchor: Date,
  cycleStart: number,
  monthIndex?: Map<string, Entry[]>,
): { label: Date; total: number }[] {
  const out: { label: Date; total: number }[] = [];
  const { start } = cycleRange(anchor, cycleStart);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(start);
    d.setMonth(d.getMonth() - i);
    const r = cycleRange(d, cycleStart);
    const total = entriesInRange(all, r.start.getTime(), r.end.getTime(), monthIndex)
      .filter((x) => x.io === 'exp')
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
  const elapsedDays = elapsedDaysIn(start, end, now);

  const daily = (rangeStart: number, rangeEnd: number) => {
    const arr = new Array(elapsedDays).fill(0);
    for (const d of all) {
      if (d.io !== 'exp' || d.ts < rangeStart || d.ts >= rangeEnd) continue;
      // calendar days, not 24-hour chunks: after a spring-forward, dividing
      // raw timestamps put every entry in the first hour of a day into the
      // previous day's column for the rest of the cycle
      const day = daysBetween(rangeStart, d.ts);
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
