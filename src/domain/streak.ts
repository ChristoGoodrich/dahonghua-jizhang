// Consecutive-day logging streak — ported from v7's streakDays().
// Counts back from today (or yesterday if nothing logged today yet).

export function streakDays(timestamps: number[], now: Date = new Date()): number {
  const days = new Set(timestamps.map((ts) => new Date(ts).toDateString()));
  let n = 0;
  const d = new Date(now);
  if (!days.has(d.toDateString())) {
    d.setDate(d.getDate() - 1);
    if (!days.has(d.toDateString())) return 0;
  }
  while (days.has(d.toDateString())) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
