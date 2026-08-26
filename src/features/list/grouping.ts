// Day grouping for the entry list — what the list decides, without the widgets.
//
// Extracted from EntryList.tsx so it can be read, tested and ported on its own.
// It is the first piece of *UI* logic to come out, and the pattern for the rest:
// the arithmetic, the ordering and the bucketing are decisions; the rows, the
// badges and the locale formatting are presentation and stay where they are.
//
// The one thing deliberately NOT here is the day's printed name. Turning a
// calendar day into "8月26日 周三" is `toLocaleDateString`, which is Intl and
// belongs to the platform — the same line this migration draws for money and
// for dates everywhere else. What comes out instead is which of the three
// labels applies, and the day itself for the third.

import { daysAgo } from '@/domain/dates';
import type { Entry } from '@/domain/types';

export type DayLabel = 'today' | 'yesterday' | 'date';

export interface DayGroup {
  /** `Date.prototype.toDateString()` — the local calendar day, as the map key
   *  it has always been. Locale-independent since ES2018 (`ddd MMM DD YYYY`),
   *  which is what makes it safe to parse back. */
  key: string;
  label: DayLabel;
  dayExp: number;
  dayInc: number;
  items: Entry[];
}

/**
 * Bucket entries into calendar days, newest day first.
 *
 * Sorted by `ts` descending and bucketed in that order, so the groups come out
 * newest-first without a second sort — the insertion order of the map *is* the
 * display order. Entries within a day keep that same descending order.
 *
 * Nothing is filtered here. The caller has already narrowed to a cycle and a
 * search, and a tombstone that reaches this function is a tombstone the caller
 * meant to show.
 */
export function groupByDay(entries: Entry[], now: number = Date.now()): DayGroup[] {
  const sorted = [...entries].sort((a, b) => b.ts - a.ts);
  const map = new Map<string, Entry[]>();
  for (const d of sorted) {
    const k = new Date(d.ts).toDateString();
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(d);
  }
  return [...map.entries()].map(([key, items]) => ({
    key,
    label: labelFor(key, now),
    // `xfer` counts in neither total: a transfer moves money, it does not
    // spend or earn it
    dayExp: items.filter((d) => d.io === 'exp').reduce((sum, d) => sum + d.amt, 0),
    dayInc: items.filter((d) => d.io === 'inc').reduce((sum, d) => sum + d.amt, 0),
    items,
  }));
}

/** Which of the three day labels applies.
 *
 *  `daysAgo` normalises both ends to midnight. Subtracting 24 hours instead —
 *  which this once did — makes "yesterday" the day before yesterday on the
 *  morning after the clocks go forward. */
export function labelFor(key: string, now: number = Date.now()): DayLabel {
  const ago = daysAgo(new Date(key).getTime(), now);
  if (ago === 0) return 'today';
  if (ago === 1) return 'yesterday';
  return 'date';
}

export type FlatItem =
  | { type: 'header'; key: string; label: DayLabel; dayExp: number; dayInc: number }
  | { type: 'entry'; key: string; entry: Entry; groupKey: string }
  | { type: 'entryrow'; key: string; entries: Entry[]; groupKey: string };

/**
 * Flatten day groups into the one-dimensional list a virtualised list renders.
 *
 * `columns` above 1 packs entries into rows for a tablet layout. The `> 1`
 * test is load-bearing rather than tidy: the packing loop steps by `columns`,
 * so a zero would never advance.
 */
export function flattenGroups(groups: DayGroup[], columns = 1): FlatItem[] {
  const items: FlatItem[] = [];
  for (const g of groups) {
    items.push({ type: 'header', key: g.key, label: g.label, dayExp: g.dayExp, dayInc: g.dayInc });
    if (columns > 1) {
      for (let i = 0; i < g.items.length; i += columns) {
        items.push({
          type: 'entryrow',
          key: `row-${g.key}-${i}`,
          entries: g.items.slice(i, i + columns),
          groupKey: g.key,
        });
      }
    } else {
      for (const d of g.items) {
        items.push({ type: 'entry', key: d.id, entry: d, groupKey: g.key });
      }
    }
  }
  return items;
}
