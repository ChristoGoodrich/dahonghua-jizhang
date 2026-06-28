// Month recap — summary numbers for the review/share card (ported from v7's openReview).
import type { Entry } from './types';

export interface Recap {
  exp: number;
  inc: number;
  net: number;
  count: number;
  activeDays: number;
  topCatKey: string | null;
  topCatAmt: number;
}

/** Summarize a cycle's entries for the review card. */
export function monthRecap(entries: Entry[]): Recap {
  const exp = entries.filter((d) => d.io === 'exp').reduce((s, d) => s + d.amt, 0);
  const inc = entries.filter((d) => d.io === 'inc').reduce((s, d) => s + d.amt, 0);
  const byCat: Record<string, number> = {};
  entries.filter((d) => d.io === 'exp').forEach((d) => (byCat[d.cat] = (byCat[d.cat] || 0) + d.amt));
  const topCatKey = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a])[0] ?? null;
  const activeDays = new Set(entries.map((d) => new Date(d.ts).toDateString())).size;
  return {
    exp,
    inc,
    net: inc - exp,
    count: entries.length,
    activeDays,
    topCatKey,
    topCatAmt: topCatKey ? byCat[topCatKey] : 0,
  };
}
