// Category actions — user-defined custom categories and per-category subcategories.
import type { Category, IO } from '@/domain/types';
import { CAT_PALETTE } from '@/domain/cats';
import { store$, newId } from './state';

export function addCustomCat(io: IO, name: string, emoji: string): Category {
  const list = store$.customCats[io].peek();
  const c: Category = {
    k: 'c' + Date.now(),
    e: emoji,
    zh: name,
    en: name,
    c: CAT_PALETTE[list.length % CAT_PALETTE.length],
    custom: true,
  };
  store$.customCats[io].set([...list, c]);
  return c;
}

export function addSubcat(catKey: string, name: string): void {
  const map = store$.subcats.peek();
  const list = map[catKey] ?? [];
  store$.subcats.set({ ...map, [catKey]: [...list, { k: newId('sc'), name }] });
}

export function removeSubcat(catKey: string, k: string): void {
  const map = store$.subcats.peek();
  store$.subcats.set({ ...map, [catKey]: (map[catKey] ?? []).filter((sc) => sc.k !== k) });
}
