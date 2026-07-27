// Alipay / WeChat CSV bill import — orchestration layer.
//
// Parsing lives in billParse.ts, dedup/category mapping in billDedup.ts.
// This module re-exports their public API so existing importers
// (`import { ... } from './billImport'`) keep working unchanged.
import type { Category, Entry, IO } from './types';

export type { BillSource, RawBill, ColumnMap, RowError, ParseResult } from './billParse';
export {
  looksLikeUtf8, decodeBillText,
  parseCSV, findHeaderRow, detectSource, autoMap,
  parseDateMs, parseAmount, parseIO,
  parseBills,
} from './billParse';

export type { Candidate } from './billDedup';
export { mapCategory, composeNote, toCandidates } from './billDedup';

import type { BillSource, RowError } from './billParse';
import { parseBills } from './billParse';
import type { Candidate } from './billDedup';
import { toCandidates } from './billDedup';

export interface ImportPreview {
  source: BillSource;
  ok: boolean; // header found + at least one usable bill
  candidates: Candidate[];
  fresh: Candidate[]; // candidates not already in the store
  dupCount: number;
  skipped: number;
  errors: RowError[];
  expCount: number;
  incCount: number;
  expSum: number;
  incSum: number;
}

/** End-to-end: text → a preview the import screen renders and then applies. */
export function prepareImport(
  text: string,
  existing: Entry[],
  custom: Record<IO, Category[]>,
): ImportPreview {
  const parsed = parseBills(text);
  const candidates = toCandidates(parsed.bills, existing, custom);
  const fresh = candidates.filter((c) => !c.dup);
  const expSum = fresh.filter((c) => c.io === 'exp').reduce((s, c) => s + c.amt, 0);
  const incSum = fresh.filter((c) => c.io === 'inc').reduce((s, c) => s + c.amt, 0);
  return {
    source: parsed.source,
    ok: parsed.headerRow >= 0 && candidates.length > 0,
    candidates,
    fresh,
    dupCount: candidates.length - fresh.length,
    skipped: parsed.skipped,
    errors: parsed.errors,
    expCount: fresh.filter((c) => c.io === 'exp').length,
    incCount: fresh.filter((c) => c.io === 'inc').length,
    expSum: Math.round(expSum * 100) / 100,
    incSum: Math.round(incSum * 100) / 100,
  };
}
