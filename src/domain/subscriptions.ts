// Subscription auto-charge engine — ported from v7's nextDueDate /
// runSubscriptions. computeDueCharges is pure (no store access) so it can be
// unit-tested; the store action applies the charges it returns.
import type { Sub } from './types';

/** The next charge date for a subscription at-or-after `from`. */
export function nextDueDate(sub: Sub, from: Date): Date {
  const f = from;
  if (sub.freq === 'yearly') {
    const mo = (sub.month || 1) - 1;
    let d = new Date(f.getFullYear(), mo, sub.day);
    if (d < f) d = new Date(f.getFullYear() + 1, mo, sub.day);
    return d;
  }
  let d = new Date(f.getFullYear(), f.getMonth(), sub.day);
  if (d < f) d = new Date(f.getFullYear(), f.getMonth() + 1, sub.day);
  return d;
}

/** Encode a date as v7's 'YYYY-M-D' (month 0-indexed). */
function encode(d: Date): string {
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}

export interface DueResult {
  charges: number[]; // epoch ms timestamps to log
  lastCharged: string; // updated cursor for the sub
}

/** Catch up every charge from the sub's last cursor up to & including today. */
export function computeDueCharges(sub: Sub, today: Date): DueResult {
  const day0 = new Date(today);
  day0.setHours(0, 0, 0, 0);

  let cursor: Date;
  if (sub.lastCharged) {
    const [y, m, dd] = sub.lastCharged.split('-').map(Number);
    cursor = new Date(y, m, dd);
  } else {
    cursor = new Date(sub.created || Date.now());
  }
  cursor.setHours(0, 0, 0, 0);

  const charges: number[] = [];
  let lastCharged = sub.lastCharged ?? encode(cursor);
  let guard = 0;
  while (guard++ < 120) {
    // The next calendar day, not the next 24 hours. `cursor.getTime() + 864e5`
    // lands at 01:00 on a spring-forward day, and nextDueDate then reads that
    // day as already begun: a subscription due the day after the transition
    // had its candidate compared against 01:00 of its own due date, lost, and
    // was pushed a whole month. In Sydney 2026 a sub due on the 5th skipped
    // October entirely.
    const day = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    const due = nextDueDate(sub, day); // strictly after cursor
    due.setHours(0, 0, 0, 0);
    if (due > day0) break;
    charges.push(due.getTime());
    lastCharged = encode(due);
    cursor = due;
  }
  return { charges, lastCharged };
}
