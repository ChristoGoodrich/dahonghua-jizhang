// 3-tier budget status — monthly / daily / per-category (Cookie 记账 parity).
// Pure functions over the current cycle's entries; UI + insight consume these.
import type { Entry, Settings } from './types';
import { descByAmt } from './order';

export interface TierStatus {
  limit: number;
  used: number;
  left: number; // limit - used (can be negative)
  pct: number; // 0..100+, used/limit * 100 (0 when no limit)
  over: boolean;
}

/** Status of a spend total against a budget limit. limit<=0 means "unset". */
export function tierStatus(used: number, limit: number): TierStatus {
  const lim = limit > 0 ? limit : 0;
  const left = lim - used;
  const pct = lim > 0 ? (used / lim) * 100 : 0;
  return { limit: lim, used, left, pct, over: lim > 0 && used > lim };
}

/** Total expense (excludes income & transfers) over the given entries. */
export function expenseTotal(entries: Entry[]): number {
  return entries.filter((d) => d.io === 'exp').reduce((s, d) => s + d.amt, 0);
}

/** Expense booked on the same calendar day as `now`. */
export function todayExpense(entries: Entry[], now = Date.now()): number {
  const day = new Date(now).toDateString();
  return entries
    .filter((d) => d.io === 'exp' && new Date(d.ts).toDateString() === day)
    .reduce((s, d) => s + d.amt, 0);
}

/** Monthly (cycle) budget status from settings.budget. */
export function monthlyStatus(cycleEntries: Entry[], settings: Settings): TierStatus {
  return tierStatus(expenseTotal(cycleEntries), settings.budget ?? 0);
}

/** Today's spend vs settings.dailyBudget. */
export function dailyStatus(cycleEntries: Entry[], settings: Settings, now = Date.now()): TierStatus {
  return tierStatus(todayExpense(cycleEntries, now), settings.dailyBudget ?? 0);
}

export interface CatBudgetRow extends TierStatus {
  cat: string;
}

/**
 * Per-category budget rows for every category that has a limit set,
 * sorted by how close to (or over) the limit it is.
 */
export function catBudgetRows(cycleEntries: Entry[], settings: Settings): CatBudgetRow[] {
  const cb = settings.catBudgets ?? {};
  const spent = new Map<string, number>();
  for (const d of cycleEntries) {
    if (d.io !== 'exp') continue;
    spent.set(d.cat, (spent.get(d.cat) ?? 0) + d.amt);
  }
  return Object.keys(cb)
    .filter((k) => cb[k] > 0)
    .map((k) => ({ cat: k, ...tierStatus(spent.get(k) ?? 0, cb[k]) }))
    .sort((a, b) => descByAmt(a.pct, b.pct));
}
