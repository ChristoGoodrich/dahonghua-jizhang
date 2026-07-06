// Entry search — category name, note, amount, tags, and ledger, plus amount
// comparators like ">100" / "<=50" / "=40" (ported & extended from v7).
import type { Category, Entry, IO } from './types';
import { catOf, catName } from './cats';
import type { Lang } from '@/i18n';

const AMOUNT_OP = /^(>=|<=|>|<|=)\s*(\d+(?:\.\d+)?)$/;

export function matchesSearch(
  d: Entry,
  query: string,
  customCats: Record<IO, Category[]>,
  lang: Lang,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  // Amount comparator, e.g. ">100" (over 100), "<=50", "=40". Compares the
  // base-currency amount so results match what the list displays.
  const op = q.match(AMOUNT_OP);
  if (op) {
    const n = parseFloat(op[2]);
    switch (op[1]) {
      case '>': return d.amt > n;
      case '<': return d.amt < n;
      case '>=': return d.amt >= n;
      case '<=': return d.amt <= n;
      default: return d.amt === n; // '='
    }
  }

  const c = catOf(d.io, d.cat, customCats);
  const haystack = [
    catName(c, lang),
    d.note ?? '',
    String(d.amt),
    ...(d.tags ?? []),
    d.ledger ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}
