// Derived indexes over the flat entry list — built once per data change so
// balance calculations, month views, and per-account stats skip linear scans.
import type { Entry } from '@/domain/types';

/** Return the YYYY-MM key for a given epoch-ms timestamp. */
export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Group non-deleted entries by their month key. */
export function buildMonthIndex(entries: Entry[]): Map<string, Entry[]> {
  const map = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.deletedAt) continue;
    const key = monthKey(e.ts);
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
    }
    arr.push(e);
  }
  return map;
}

/** Group non-deleted entries by account id. Entries without an `acct` field are
 *  grouped under the empty string. */
export function buildAccountIndex(entries: Entry[]): Map<string, Entry[]> {
  const map = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.deletedAt) continue;
    const key = e.acct ?? '';
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
    }
    arr.push(e);
  }
  return map;
}
