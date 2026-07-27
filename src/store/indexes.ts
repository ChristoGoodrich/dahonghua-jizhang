// Date-key helpers for the persisted-entry loaders.
//
// This module once also built per-month/per-account Map indexes on every data
// change, but nothing ever consumed them (screens filter cycle-based windows,
// not calendar months) — they were pure rebuild cost and were removed.

/** Return the YYYY-MM key for a given epoch-ms timestamp. */
export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
