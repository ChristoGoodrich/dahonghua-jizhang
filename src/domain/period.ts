// Time-dimension stats — day / week / month / half-year / year (Cookie 记账 parity).
// `month` respects the custom accounting cycle; the others use calendar boundaries.
import type { Entry, IO } from './types';
import { cycleRange, shiftCycle, type CycleRange } from './cycle';

export type Period = 'day' | 'week' | 'month' | 'halfyear' | 'year';

export const PERIODS: Period[] = ['day', 'week', 'month', 'halfyear', 'year'];

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** The window of `period` that contains `anchor`. */
export function periodRange(anchor: Date, period: Period, cycleStart = 1): CycleRange {
  switch (period) {
    case 'day': {
      const start = midnight(anchor);
      return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1) };
    }
    case 'week': {
      const d = midnight(anchor);
      const dow = (d.getDay() + 6) % 7; // Monday = 0
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
      return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) };
    }
    case 'month':
      return cycleRange(anchor, cycleStart);
    case 'halfyear': {
      const h = anchor.getMonth() < 6 ? 0 : 6;
      const start = new Date(anchor.getFullYear(), h, 1);
      return { start, end: new Date(anchor.getFullYear(), h + 6, 1) };
    }
    case 'year': {
      const start = new Date(anchor.getFullYear(), 0, 1);
      return { start, end: new Date(anchor.getFullYear() + 1, 0, 1) };
    }
  }
}

/** Move `anchor` by `dir` whole periods (negative = earlier). */
export function shiftPeriod(anchor: Date, period: Period, dir: number, cycleStart = 1): Date {
  const { start } = periodRange(anchor, period, cycleStart);
  switch (period) {
    case 'day':
      return new Date(start.getFullYear(), start.getMonth(), start.getDate() + dir);
    case 'week':
      return new Date(start.getFullYear(), start.getMonth(), start.getDate() + dir * 7);
    case 'month':
      return shiftCycle(anchor, dir, cycleStart);
    case 'halfyear':
      return new Date(start.getFullYear(), start.getMonth() + dir * 6, 1);
    case 'year':
      return new Date(start.getFullYear() + dir, 0, 1);
  }
}

/** Entries whose timestamp falls inside the period containing `anchor`. */
export function entriesInPeriod(all: Entry[], anchor: Date, period: Period, cycleStart = 1): Entry[] {
  const { start, end } = periodRange(anchor, period, cycleStart);
  const a = start.getTime();
  const b = end.getTime();
  return all.filter((d) => d.ts >= a && d.ts < b);
}

/** Human label for the period window, e.g. "2026年6月" / "2026 上半年" / "Jun 10". */
export function periodLabel(anchor: Date, period: Period, lang: 'zh' | 'en', cycleStart = 1): string {
  const { start } = periodRange(anchor, period, cycleStart);
  const zh = lang === 'zh';
  const loc = zh ? 'zh-CN' : 'en-US';
  switch (period) {
    case 'day':
      return start.toLocaleDateString(loc, { month: 'short', day: 'numeric' });
    case 'week': {
      const last = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      const a = start.toLocaleDateString(loc, { month: 'short', day: 'numeric' });
      const b = last.toLocaleDateString(loc, { month: 'short', day: 'numeric' });
      return `${a} – ${b}`;
    }
    case 'month':
      return start.toLocaleDateString(loc, { year: 'numeric', month: 'long' });
    case 'halfyear': {
      const half = start.getMonth() < 6 ? (zh ? '上半年' : 'H1') : (zh ? '下半年' : 'H2');
      return zh ? `${start.getFullYear()}年 ${half}` : `${start.getFullYear()} ${half}`;
    }
    case 'year':
      return zh ? `${start.getFullYear()}年` : String(start.getFullYear());
  }
}

export interface TrendBucket {
  start: Date;
  total: number;
}

/** Totals for the 6 periods ending at `anchor`'s period (oldest first). */
export function periodTrend(
  all: Entry[],
  anchor: Date,
  period: Period,
  cycleStart = 1,
  io: IO = 'exp',
): TrendBucket[] {
  const out: TrendBucket[] = [];
  for (let i = 5; i >= 0; i--) {
    const a = shiftPeriod(anchor, period, -i, cycleStart);
    const r = periodRange(a, period, cycleStart);
    const total = all
      .filter((x) => x.io === io && x.ts >= r.start.getTime() && x.ts < r.end.getTime())
      .reduce((s, x) => s + x.amt, 0);
    out.push({ start: r.start, total });
  }
  return out;
}

/** Short axis label for a trend bucket, varying by period. */
export function bucketLabel(start: Date, period: Period, lang: 'zh' | 'en'): string {
  const loc = lang === 'zh' ? 'zh-CN' : 'en-US';
  switch (period) {
    case 'day':
      return start.toLocaleDateString(loc, { month: 'numeric', day: 'numeric' });
    case 'week':
      return start.toLocaleDateString(loc, { month: 'numeric', day: 'numeric' });
    case 'month':
      return start.toLocaleDateString(loc, { month: 'short' });
    case 'halfyear':
      return (lang === 'zh' ? (start.getMonth() < 6 ? '上' : '下') : start.getMonth() < 6 ? 'H1' : 'H2') +
        (lang === 'zh' ? '' : ' ') + (start.getFullYear() % 100);
    case 'year':
      return String(start.getFullYear());
  }
}
