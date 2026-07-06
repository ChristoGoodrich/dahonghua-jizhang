// Weekly budget math — get week range (Sun–Sat), calculate daily equivalent,
// and compute weekly spending status.
import type { Entry } from './types';

export interface WeekRange {
  start: Date;
  end: Date; // exclusive (next Sunday 00:00)
}

export interface WeeklyStatus {
  spent: number;
  remaining: number;
  over: boolean;
  daysLeft: number;
  dailyBudget: number;
}

/** Sunday-to-Saturday range containing `date`. `end` is exclusive. */
export function getWeekRange(date: Date): WeekRange {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay(); // 0=Sun
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start, end };
}

/** Daily budget equivalent from a weekly budget (weeklyBudget / 7). */
export function calculateWeeklyBudget(weeklyBudget: number): number {
  return weeklyBudget / 7;
}

/** Weekly spending status for the week containing `now`. */
export function getWeeklyStatus(entries: Entry[], weeklyBudget: number, now = Date.now()): WeeklyStatus {
  const anchor = new Date(now);
  const { start, end } = getWeekRange(anchor);
  const startMs = start.getTime();
  const endMs = end.getTime();

  const spent = entries
    .filter((d) => d.io === 'exp' && !d.deletedAt && d.ts >= startMs && d.ts < endMs)
    .reduce((s, d) => s + d.amt, 0);

  const remaining = weeklyBudget - spent;
  const over = weeklyBudget > 0 && spent > weeklyBudget;
  const dailyBudget = calculateWeeklyBudget(weeklyBudget);

  // daysLeft: days remaining in the week from today (including today)
  const today = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const daysLeft = Math.max(0, Math.round((endMs - today.getTime()) / 864e5));

  return { spent, remaining, over, daysLeft, dailyBudget };
}
