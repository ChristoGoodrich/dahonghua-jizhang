// Advanced entry filtering — date range, IO type, category, account.
// Works alongside the existing text search in search.ts.
import type { Entry, IO } from './types';

export interface FilterState {
  io?: IO;              // filter by expense/income/transfer
  cat?: string;         // filter by category key
  acct?: string;        // filter by account id
  dateFrom?: number;    // timestamp start (inclusive)
  dateTo?: number;      // timestamp end (inclusive)
}

/** Check if an entry matches all active filters. */
export function matchesFilter(d: Entry, filter: FilterState): boolean {
  // IO type filter
  if (filter.io && d.io !== filter.io) return false;

  // Category filter
  if (filter.cat && d.cat !== filter.cat) return false;

  // Account filter
  if (filter.acct && d.acct !== filter.acct) return false;

  // Date range filter
  if (filter.dateFrom && d.ts < filter.dateFrom) return false;
  if (filter.dateTo && d.ts > filter.dateTo) return false;

  return true;
}

/** Parse a date range string into timestamps. Supports:
 *  - "2024-01" → entire month
 *  - "2024-01-15" → entire day
 *  - "2024-01-01~2024-01-31" → explicit range
 *  - "1月" / "jan" → current year's January
 *  - "上周" / "last week" → previous week
 *  - "本月" / "this month" → current month
 */
export function parseDateRange(query: string): { from?: number; to?: number } | null {
  const q = query.trim();

  // Explicit range: YYYY-MM-DD~YYYY-MM-DD
  const rangeMatch = q.match(/^(\d{4}-\d{2}-\d{2})\s*[~\-]\s*(\d{4}-\d{2}-\d{2})$/);
  if (rangeMatch) {
    const from = new Date(rangeMatch[1] + 'T00:00:00').getTime();
    const to = new Date(rangeMatch[2] + 'T23:59:59').getTime();
    if (!isNaN(from) && !isNaN(to)) return { from, to };
  }

  // YYYY-MM (entire month)
  const monthMatch = q.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const y = parseInt(monthMatch[1]);
    const m = parseInt(monthMatch[2]) - 1;
    const from = new Date(y, m, 1).getTime();
    const to = new Date(y, m + 1, 0, 23, 59, 59).getTime();
    return { from, to };
  }

  // YYYY-MM-DD (entire day)
  const dayMatch = q.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dayMatch) {
    const from = new Date(dayMatch[1] + 'T00:00:00').getTime();
    const to = new Date(dayMatch[1] + '-' + dayMatch[2] + '-' + dayMatch[3] + 'T23:59:59').getTime();
    if (!isNaN(from) && !isNaN(to)) return { from, to };
  }

  // Chinese month: "1月" .. "12月"
  const zhMonth = q.match(/^(\d{1,2})月$/);
  if (zhMonth) {
    const m = parseInt(zhMonth[1]) - 1;
    if (m >= 0 && m < 12) {
      const y = new Date().getFullYear();
      const from = new Date(y, m, 1).getTime();
      const to = new Date(y, m + 1, 0, 23, 59, 59).getTime();
      return { from, to };
    }
  }

  // Relative: "本月" / "this month"
  if (q === '本月' || q === 'this month') {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).getTime();
    return { from, to };
  }

  // Relative: "上月" / "last month"
  if (q === '上月' || q === 'last month') {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).getTime();
    return { from, to };
  }

  // Relative: "上周" / "last week"
  if (q === '上周' || q === 'last week') {
    const now = new Date();
    const day = now.getDay() || 7; // Sunday = 7
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day - 6).getTime();
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, 23, 59, 59).getTime();
    return { from, to };
  }

  // Relative: "本周" / "this week"
  if (q === '本周' || q === 'this week') {
    const now = new Date();
    const day = now.getDay() || 7;
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1).getTime();
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - day), 23, 59, 59).getTime();
    return { from, to };
  }

  // Relative: "今天" / "today"
  if (q === '今天' || q === 'today') {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime();
    return { from, to };
  }

  // Relative: "昨天" / "yesterday"
  if (q === '昨天' || q === 'yesterday') {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59).getTime();
    return { from, to };
  }

  return null;
}

/**
 * Keywords that set the direction filter, and where a word boundary belongs.
 *
 * `\b` is defined against `\w`, which is `[A-Za-z0-9_]` and contains no CJK
 * character at all — so `\b支出\b` can never match, and the Chinese keywords
 * here were dead from the day they were written, in a Chinese-language app.
 * Searching 支出 set no filter and left the word in the text query.
 *
 * Boundaries are kept around the ASCII words, where they stop `expense`
 * matching inside `inexpensive`, and dropped around the Chinese ones, where
 * they only ever prevented a match. The first list that strips anything wins.
 */
const IO_WORDS: [IO, RegExp][] = [
  ['exp', /\b(?:expense|spent)\b|支出|花掉/gi],
  ['inc', /\b(?:income|earned)\b|收入|进账/gi],
  ['xfer', /\b(?:transfer)\b|转账/gi],
];

/** Build a filter state from a search query string.
 *  Extracts date ranges, IO type keywords, etc. from the query. */
export function parseSearchQuery(query: string): { text: string; filter: FilterState } {
  let text = query.trim();
  const filter: FilterState = {};

  // Extract date range patterns
  const dateRange = parseDateRange(text);
  if (dateRange) {
    filter.dateFrom = dateRange.from;
    filter.dateTo = dateRange.to;
    // Remove the date part from text search
    text = '';
  }

  // Extract IO type keywords. Tested by stripping rather than by `.test()`,
  // which on a /g/ regex carries lastIndex between calls.
  for (const [io, re] of IO_WORDS) {
    const stripped = text.replace(re, '').trim();
    if (stripped !== text) {
      filter.io = io;
      text = stripped;
      break;
    }
  }

  return { text, filter };
}
