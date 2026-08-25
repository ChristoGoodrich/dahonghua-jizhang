// Pure calendar-day helpers for the record sheet's backdating picker.
// All math is in local time — an entry "on July 3rd" means the user's July 3rd.

/** Ms timestamp on the given calendar day, carrying over the time-of-day from `ts`. */
export function onDay(ts: number, y: number, m: number, d: number): number {
  const t = new Date(ts);
  return new Date(y, m, d, t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds()).getTime();
}

/** Do two timestamps fall on the same calendar day? */
export function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** Whole calendar days between `ts` and `now` (0 = today, 1 = yesterday…). */
export function daysAgo(ts: number, now = Date.now()): number {
  const a = new Date(ts);
  const b = new Date(now);
  const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((dayB - dayA) / 86400000);
}

/**
 * Whole calendar days from `a` to `b`, negative when `b` is earlier.
 *
 * Both ends are normalised to local midnight before subtracting, and the
 * division is rounded — so a daylight-saving transition, which makes one "day"
 * 23 or 25 hours long, does not shift the count. Dividing raw timestamps by
 * 864e5 instead is the bug this exists to avoid: it is twenty-four hours, not a
 * calendar day.
 */
export function daysBetween(a: number, b: number): number {
  return daysAgo(a, b);
}

/** Monday-first month grid: leading nulls to align day 1, then 1..lastDay. */
export function monthGrid(y: number, m: number): (number | null)[] {
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Mon=0 … Sun=6
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(d);
  return cells;
}

/**
 * A timestamp as its **local** calendar date, `YYYY-MM-DD`.
 *
 * Not `new Date(ts).toISOString().slice(0, 10)`, which is the *UTC* date and
 * so is a different day for most of every day outside UTC. In Sydney every
 * entry logged before 10am exported with yesterday's date; in Shanghai before
 * 8am; in New York it goes the other way and evening entries dated tomorrow.
 * Seven call sites had it — the CSV and XLSX exports, the date handed to the
 * AI as "today", and the date the exchange-rate lookup asks about.
 *
 * A `NaN` timestamp yields `NaN-NaN-NaN` rather than throwing, which
 * `toISOString` does — a single corrupt row should not take the whole export
 * down with it.
 */
export function localDateStr(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const pad = (n: number) => (Number.isNaN(n) ? 'NaN' : String(n).padStart(2, '0'));
  return `${Number.isNaN(y) ? 'NaN' : y}-${pad(m)}-${pad(day)}`;
}
