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

/** Monday-first month grid: leading nulls to align day 1, then 1..lastDay. */
export function monthGrid(y: number, m: number): (number | null)[] {
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Mon=0 … Sun=6
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(d);
  return cells;
}
