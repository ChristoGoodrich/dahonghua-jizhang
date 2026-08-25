// Pure parsing/normalization for AI quick-entry (natural language → entry draft).
// The network call lives in client.ts; everything here is deterministic + tested.
import type { Category, IO } from '@/domain/types';
import { allCats, catName } from '@/domain/cats';
import type { Lang } from '@/i18n';
import { localDateStr } from '@/domain/dates';

/** Raw shape the model returns (validated by the proxy's JSON schema). */
export interface ParsedEntry {
  io: 'exp' | 'inc';
  amount: number;
  category: string; // a category name or emoji the model chose
  note?: string;
  date?: string; // ISO date string (YYYY-MM-DD) when user mentions a relative date
}

/** Sheet-ready draft produced from a ParsedEntry. */
export interface EntryDraft {
  io: IO;
  cat: string; // resolved category key
  amt: string; // expression string for the amount field
  note: string;
  date?: string; // ISO date string when parsed from natural language
}

/** The JSON schema the proxy constrains the model to (structured outputs). */
export const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    io: { type: 'string', enum: ['exp', 'inc'] },
    amount: { type: 'number' },
    category: { type: 'string' },
    note: { type: 'string' },
    date: { type: 'string', description: 'ISO date (YYYY-MM-DD) when user mentions a relative date' },
  },
  required: ['io', 'amount', 'category'],
  additionalProperties: false,
} as const;

export const AI_SYSTEM =
  'You extract a single personal-finance transaction from a short note. ' +
  'Return only the structured fields. io is "exp" for money spent and "inc" for money received. ' +
  'amount is a positive number in the main currency (no symbol). ' +
  'category MUST be chosen from the provided category list (use the exact label). ' +
  'note is a short free-text memo (the merchant or what it was for), omit if there is nothing extra. ' +
  'If the user mentions a relative date (e.g. "昨天", "前天", "上周三", "last Friday", "3天前"), ' +
  'return date as an ISO date string (YYYY-MM-DD) based on today being {{today}}. ' +
  'Omit date if no date is mentioned (the entry will use the current time).';

/** Build the user prompt, embedding the user's own category labels and today's date. */
export function buildUserPrompt(text: string, customCats: Record<IO, Category[]>, lang: Lang): string {
  const exp = allCats('exp', customCats).map((c) => catName(c, lang)).join('、');
  const inc = allCats('inc', customCats).map((c) => catName(c, lang)).join('、');
  const today = localDateStr(Date.now()); // the user's day, not UTC's
  return (
    `Today: ${today}\n` +
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

// Above this an "amount" is a hallucination, not a transaction. The bound also
// keeps the result below 1e21, where String() switches to exponential notation —
// "1e+21" fed into the amount field would be read by evalExpr as 1 + 21 = 22.
const MAX_AMOUNT = 1e12;

/** Coerce whatever the model put in `amount` into a number, or NaN.
 *  Models very often return the amount as a STRING ("35", "¥35", "35.00"),
 *  which a bare Number.isFinite check rejects outright. */
function toAmount(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v.replace(/[^\d.-]/g, ''));
  return NaN;
}

/** Convert a (possibly imperfect) ParsedEntry into a sheet-ready draft. */
export function normalizeParsed(raw: ParsedEntry, customCats: Record<IO, Category[]>): EntryDraft {
  const io: IO = raw.io === 'inc' ? 'inc' : 'exp';
  const n = toAmount(raw.amount);
  // out-of-range resolves to 0, which the caller surfaces as a parse failure —
  // better than silently clamping the user's amount to something they never said
  const amount = Number.isFinite(n) && n <= MAX_AMOUNT ? Math.max(0, Math.round(n * 100) / 100) : 0;

  // Parse date if provided (YYYY-MM-DD → timestamp at noon local time)
  let date: string | undefined;
  if (raw.date && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
    date = raw.date;
  }

  return {
    io,
    cat: resolveCategory(raw.category, io, customCats),
    amt: amount ? String(amount) : '',
    note: (raw.note ?? '').trim().slice(0, 60),
    date,
  };
}
