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

/**
 * `n` calendar days after local midnight on `ts` — negative to go back.
 *
 * Bucket edges used to be built as `today - i * 864e5`, and 864e5 is
 * twenty-four hours rather than a calendar day. That gives three different
 * wrong answers around a daylight-saving transition, all of them visible on a
 * chart:
 *
 * * Stepping back over a 23-hour day overshoots its midnight, so the day is
 *   **skipped entirely** — the axis reads the 3rd, the 5th, the 6th, and the
 *   4th is simply not drawn.
 * * Stepping back over a 25-hour day lands an hour late, so every earlier
 *   bucket runs 01:00 to 01:00 and the first hour of each day is counted
 *   under the day before it.
 * * A week is not `7 * 864e5` either, so after a transition every historical
 *   week begins at 23:00 on the Sunday while its label still says Monday.
 *
 * Going through the date constructor keeps every edge on a real local
 * midnight, whatever the day in between was worth.
 */
function addDays(ts: number, n: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

/** Daily expense and income trend for the last `days` days ending today (based on `now`). */
export function dailyTrend(entries: Entry[], days: number, now = Date.now()): TrendPoint[] {
  const today = startOfDay(now);
  const result: TrendPoint[] = [];
  const active = entries.filter((d) => !d.deletedAt);

  for (let i = days - 1; i >= 0; i--) {
    const dayStart = addDays(today, -i);
    const dayEnd = addDays(today, -i + 1);
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

  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = addDays(thisMonday, -i * 7);
    const weekEnd = addDays(weekStart, 7);
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
    const dayStart = addDays(today, -i);
    const dayEnd = addDays(today, -i + 1);
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
