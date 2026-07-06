import type { Entry } from './types';

export interface TrendPoint {
  date: string; // 'YYYY-MM-DD'
  exp: number;
  inc: number;
}

export interface CategoryTrendPoint {
  date: string; // 'YYYY-MM-DD'
  amt: number;
}

function toDateStr(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Daily expense and income trend for the last `days` days ending today (based on `now`). */
export function dailyTrend(entries: Entry[], days: number, now = Date.now()): TrendPoint[] {
  const today = startOfDay(now);
  const result: TrendPoint[] = [];
  const active = entries.filter((d) => !d.deletedAt);

  for (let i = days - 1; i >= 0; i--) {
    const dayStart = today - i * 864e5;
    const dayEnd = dayStart + 864e5;
    let exp = 0;
    let inc = 0;
    for (const d of active) {
      if (d.ts >= dayStart && d.ts < dayEnd) {
        if (d.io === 'exp') exp += d.amt;
        else if (d.io === 'inc') inc += d.amt;
      }
    }
    result.push({ date: toDateStr(dayStart), exp, inc });
  }
  return result;
}

function startOfWeek(ts: number): number {
  const d = new Date(ts);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // shift to Monday
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
  return monday.getTime();
}

/** Weekly expense and income trend for the last `weeks` weeks ending this week (based on `now`). */
export function weeklyTrend(entries: Entry[], weeks: number, now = Date.now()): TrendPoint[] {
  const thisMonday = startOfWeek(now);
  const result: TrendPoint[] = [];
  const active = entries.filter((d) => !d.deletedAt);
  const weekMs = 7 * 864e5;

  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = thisMonday - i * weekMs;
    const weekEnd = weekStart + weekMs;
    let exp = 0;
    let inc = 0;
    for (const d of active) {
      if (d.ts >= weekStart && d.ts < weekEnd) {
        if (d.io === 'exp') exp += d.amt;
        else if (d.io === 'inc') inc += d.amt;
      }
    }
    result.push({ date: toDateStr(weekStart), exp, inc });
  }
  return result;
}

/** Daily trend for a specific category over the last `days` days ending today (based on `now`). */
export function categoryTrend(entries: Entry[], category: string, days: number, now = Date.now()): CategoryTrendPoint[] {
  const today = startOfDay(now);
  const result: CategoryTrendPoint[] = [];
  const active = entries.filter((d) => !d.deletedAt && d.cat === category);

  for (let i = days - 1; i >= 0; i--) {
    const dayStart = today - i * 864e5;
    const dayEnd = dayStart + 864e5;
    let amt = 0;
    for (const d of active) {
      if (d.ts >= dayStart && d.ts < dayEnd) {
        amt += d.amt;
      }
    }
    result.push({ date: toDateStr(dayStart), amt });
  }
  return result;
}
