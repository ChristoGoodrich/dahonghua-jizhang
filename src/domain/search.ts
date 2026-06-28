// Entry search — ported from v7's matchesSearch (category name, note, amount).
import type { Category, Entry, IO } from './types';
import { catOf, catName } from './cats';
import type { Lang } from '@/i18n';

export function matchesSearch(
  d: Entry,
  query: string,
  customCats: Record<IO, Category[]>,
  lang: Lang,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const c = catOf(d.io, d.cat, customCats);
  return (
    catName(c, lang).toLowerCase().includes(q) ||
    (d.note ?? '').toLowerCase().includes(q) ||
    String(d.amt).includes(q)
  );
}
