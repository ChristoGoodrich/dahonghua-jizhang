// Pure category suggestion and anomaly detection — no network, fully testable.
import type { Entry, Category, IO } from '@/domain/types';
import { allCats, catName } from '@/domain/cats';
import type { Lang } from '@/i18n';

export interface CategorySuggestion {
  cat: string;
  confidence: number; // 0..1
}

/**
 * Suggest categories based on note keywords matching history.
 * Returns up to 3 suggestions sorted by confidence descending.
 */
export function suggestCategory(
  note: string,
  history: Entry[],
  customCats: Record<IO, Category[]>,
  lang: Lang,
): CategorySuggestion[] {
  const q = note.trim().toLowerCase();
  if (!q) return [];

  // Find history entries whose note contains any shared token with the query.
  const tokens = tokenize(q);
  if (tokens.length === 0) return [];

  const matches = history.filter((e) => {
    if (!e.note) return false;
    const hTokens = tokenize(e.note.toLowerCase());
    return tokens.some((t) => hTokens.includes(t));
  });

  if (matches.length === 0) return [];

  // Tally category frequency among matches.
  const tally: Record<string, number> = {};
  for (const m of matches) {
    tally[m.cat] = (tally[m.cat] ?? 0) + 1;
  }

  const sorted = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const total = matches.length;
  return sorted.map(([cat, count]) => ({
    cat,
    confidence: Math.round((count / total) * 100) / 100,
  }));
}

/**
 * Detect if an entry amount is anomalous (>2 standard deviations from the
 * mean of entries in the same category). Returns null if fewer than 5
 * similar entries exist.
 */
export function detectAnomaly(
  entry: Entry,
  history: Entry[],
): { isAnomaly: boolean; avgAmount: number; deviation: number } | null {
  const similar = history.filter((e) => e.cat === entry.cat && e.io === entry.io);
  if (similar.length < 5) return null;

  const amounts = similar.map((e) => e.amt);
  const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
  const variance = amounts.reduce((s, a) => s + (a - avg) ** 2, 0) / amounts.length;
  const stdDev = Math.sqrt(variance);

  // Avoid division by zero when all amounts are identical.
  if (stdDev === 0) {
    return {
      isAnomaly: entry.amt !== avg,
      avgAmount: Math.round(avg * 100) / 100,
      deviation: entry.amt === avg ? 0 : Infinity,
    };
  }

  const deviation = Math.abs(entry.amt - avg) / stdDev;
  return {
    isAnomaly: deviation > 2,
    avgAmount: Math.round(avg * 100) / 100,
    deviation: Math.round(deviation * 100) / 100,
  };
}

/** Split a string into alphanumeric tokens (CJK chars are individual tokens). */
function tokenize(s: string): string[] {
  // Split on non-alphanumeric/non-CJK boundaries, filter short tokens.
  return s
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}
