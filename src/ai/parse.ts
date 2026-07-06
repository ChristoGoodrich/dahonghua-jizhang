// Pure parsing/normalization for AI quick-entry (natural language → entry draft).
// The network call lives in client.ts; everything here is deterministic + tested.
import type { Category, IO } from '@/domain/types';
import { allCats, catName } from '@/domain/cats';
import type { Lang } from '@/i18n';

/** Raw shape the model returns (validated by the proxy's JSON schema). */
export interface ParsedEntry {
  io: 'exp' | 'inc';
  amount: number;
  category: string; // a category name or emoji the model chose
  note?: string;
}

/** Sheet-ready draft produced from a ParsedEntry. */
export interface EntryDraft {
  io: IO;
  cat: string; // resolved category key
  amt: string; // expression string for the amount field
  note: string;
}

/** The JSON schema the proxy constrains the model to (structured outputs). */
export const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    io: { type: 'string', enum: ['exp', 'inc'] },
    amount: { type: 'number' },
    category: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['io', 'amount', 'category'],
  additionalProperties: false,
} as const;

export const AI_SYSTEM =
  'You extract a single personal-finance transaction from a short note. ' +
  'Return only the structured fields. io is "exp" for money spent and "inc" for money received. ' +
  'amount is a positive number in the main currency (no symbol). ' +
  'category MUST be chosen from the provided category list (use the exact label). ' +
  'note is a short free-text memo (the merchant or what it was for), omit if there is nothing extra.';

/** Build the user prompt, embedding the user's own category labels to pick from. */
export function buildUserPrompt(text: string, customCats: Record<IO, Category[]>, lang: Lang): string {
  const exp = allCats('exp', customCats).map((c) => catName(c, lang)).join('、');
  const inc = allCats('inc', customCats).map((c) => catName(c, lang)).join('、');
  return (
    `支出分类 / expense categories: ${exp}\n` +
    `收入分类 / income categories: ${inc}\n\n` +
    `记一笔 / entry: ${text}`
  );
}

/**
 * Resolve a model-chosen category label to a known category key for the given io.
 * Matches name (zh/en, case-insensitive), then emoji, then substring; falls back
 * to the last category (matches catOf's "other" behavior).
 */
export function resolveCategory(label: string, io: IO, customCats: Record<IO, Category[]>): string {
  const list = allCats(io, customCats);
  const q = (label ?? '').trim().toLowerCase();
  if (!q) return list[list.length - 1].k;
  const exact = list.find(
    (c) => c.zh.toLowerCase() === q || c.en.toLowerCase() === q || c.e === label.trim(),
  );
  if (exact) return exact.k;
  const partial = list.find(
    (c) => c.zh.toLowerCase().includes(q) || c.en.toLowerCase().includes(q) || q.includes(c.zh.toLowerCase()),
  );
  return (partial ?? list[list.length - 1]).k;
}

/** Convert a (possibly imperfect) ParsedEntry into a sheet-ready draft. */
export function normalizeParsed(raw: ParsedEntry, customCats: Record<IO, Category[]>): EntryDraft {
  const io: IO = raw.io === 'inc' ? 'inc' : 'exp';
  const amount = Number.isFinite(raw.amount) ? Math.max(0, Math.round(raw.amount * 100) / 100) : 0;
  return {
    io,
    cat: resolveCategory(raw.category, io, customCats),
    amt: amount ? String(amount) : '',
    note: (raw.note ?? '').trim().slice(0, 60),
  };
}
