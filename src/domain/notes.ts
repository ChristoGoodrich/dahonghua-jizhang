import type { Entry } from './types';

/** Most-used note texts for a category, learned from the user's own history —
 *  frequency first, recency as the tiebreaker. Powers the tappable
 *  note-suggestion chips in the record sheet (like Cookie's per-category
 *  快捷备注, but with zero configuration). */
export function noteSuggestions(entries: Entry[], io: string, cat: string, limit = 6): string[] {
  const stat = new Map<string, { n: number; ts: number }>();
  for (const d of entries) {
    if (d.deletedAt || d.io !== io || d.cat !== cat) continue;
    const note = (d.note ?? '').trim();
    if (!note) continue;
    const cur = stat.get(note);
    if (cur) {
      cur.n += 1;
      if (d.ts > cur.ts) cur.ts = d.ts;
    } else {
      stat.set(note, { n: 1, ts: d.ts });
    }
  }
  return [...stat.entries()]
    .sort((a, b) => b[1].n - a[1].n || b[1].ts - a[1].ts)
    .slice(0, limit)
    .map(([note]) => note);
}
