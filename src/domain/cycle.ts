// Custom accounting-cycle math — ported verbatim in behavior from v7's
// cycleRange / cycleRangeFrom / inCycle. A "cycle" is a month-long window that
// can start on any day 1..28 (e.g. payday on the 25th).

import { daysBetween } from './dates';

export interface CycleRange {
  start: Date;
  end: Date;
}

/** The cycle window that contains `anchor`, given the cycle start day. */
export function cycleRange(anchor: Date, cycleStart = 1): CycleRange {
  const cs = cycleStart || 1;
  let start = new Date(anchor.getFullYear(), anchor.getMonth(), cs);
  if (anchor.getDate() < cs) {
    start = new Date(anchor.getFullYear(), anchor.getMonth() - 1, cs);
  }
  const end = new Date(start.getFullYear(), start.getMonth() + 1, cs);
  return { start, end };
}

/** True if timestamp `ts` falls inside the cycle that contains `anchor`. */
export function inCycle(ts: number, anchor: Date, cycleStart = 1): boolean {
  const { start, end } = cycleRange(anchor, cycleStart);
  return ts >= start.getTime() && ts < end.getTime();
}

/** Move `anchor` by `dir` whole cycles (e.g. prev/next month). */
export function shiftCycle(anchor: Date, dir: number, cycleStart = 1): Date {
  const { start } = cycleRange(anchor, cycleStart);
  return new Date(start.getFullYear(), start.getMonth() + dir, cycleStart || 1);
}

/** Number of whole days in the cycle (28..31). */
export function cycleDays(anchor: Date, cycleStart = 1): number {
  const { start, end } = cycleRange(anchor, cycleStart);
  return daysBetween(start.getTime(), end.getTime());
}
