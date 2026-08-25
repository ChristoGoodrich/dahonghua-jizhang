// TypeScript half of the insight parity harness.
//
// This side calls the shipping `computeInsight` / `creditDueInsight`, which
// build their text from the phrase table and from literals inside insight.ts.
// The Rust side is handed the same sentences through the corpus. If the
// transcription in the corpus is wrong the two answers differ, so the
// duplication checks itself rather than sitting there rotting.

import { computeInsight, creditDueInsight, type Insight } from '../src/domain/insight';
import type { Account, Category, Entry, IO, Settings } from '../src/domain/types';

const raw = require('fs').readFileSync(0, 'utf8') as string;

const cell = (f: string[], i: number): string | undefined => {
  const v = f[i];
  return v === undefined || v === '_' || v === '' ? undefined : v;
};
function num(f: string[], i: number): number | undefined {
  const v = cell(f, i);
  if (v === undefined) return undefined;
  return v === 'nan' ? NaN : Number(v);
}

/** io~cat~amt~y~m~d~acct — placed at noon */
function parseEntry(rec: string, i: number): Entry {
  const f = rec.split('~');
  return {
    id: `e${i}`,
    ts: new Date(num(f, 3) ?? 2026, num(f, 4) ?? 5, num(f, 5) ?? 10, 12, 0, 0).getTime(),
    io: cell(f, 0) as IO,
    cat: f[1] ?? '',
    amt: num(f, 2) ?? 0,
    acct: cell(f, 6),
  } as Entry;
}

/** id~name~nameEn~kind~balance~statementDay~dueDay */
function parseAccount(rec: string): Account {
  const f = rec.split('~');
  return {
    id: f[0] ?? '',
    name: f[1] ?? '',
    // `_` is absent; an empty field is a real empty string, so that
    // `nameEn || name` fallback is reachable
    nameEn: f[2] === '_' ? undefined : f[2],
    kind: cell(f, 3),
    balance: num(f, 4) ?? 0,
    statementDay: num(f, 5),
    dueDay: num(f, 6),
  } as Account;
}

function parseCaps(s: string): Record<string, number> {
  const cb: Record<string, number> = {};
  for (const p of s.split(';')) {
    if (!p) continue;
    const i = p.indexOf(':');
    cb[i < 0 ? p : p.slice(0, i)] = i < 0 ? 0 : num([p.slice(i + 1)], 0) ?? 0;
  }
  return cb;
}

/** k:emoji:zh:en */
function parseCats(s: string): Category[] {
  return s
    .split(';')
    .filter(Boolean)
    .map((p) => {
      const f = p.split(':');
      return { k: f[0] ?? '', e: f[1] ?? '', zh: f[2] ?? '', en: f[3] ?? '', c: '', custom: true } as Category;
    });
}

const show = (r: Insight | null) => (r === null ? 'null' : `${r.ic}|${r.text}|${r.acctId ?? ''}`);

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = trimmed.slice(tab + 1);

  // the copy lines are the Rust side's business; acknowledge and move on
  if (kind === 'copyzh' || kind === 'copyen') {
    out.push(`${kind}\tok`);
    continue;
  }

  const parts = arg.split('|');
  const entries = parts[0] ? parts[0].split('^').map(parseEntry) : [];
  const accounts = parts[1] ? parts[1].split('^').map(parseAccount) : [];
  const extra = parts[2] ?? '';
  const cats = parts[3] ?? '';

  const f = extra.split(',');
  const settings = {
    budget: num(f, 0) ?? 0,
    dailyBudget: num(f, 1) ?? 0,
    catBudgets: parseCaps(f[2] ?? ''),
  } as Settings;
  const lang = cell(f, 3) === 'zh' ? 'zh' : 'en';
  const today = new Date(num(f, 4) ?? 2026, num(f, 5) ?? 5, num(f, 6) ?? 10, 12, 0, 0).getTime();
  const customCats: Record<IO, Category[]> = { exp: parseCats(cats), inc: [], xfer: [] };

  let value: string;
  switch (kind) {
    case 'insight': {
      // `computeInsight` reads the clock for its daily-budget tier, so the
      // corpus's "today" has to be the clock for the length of the call
      const realNow = Date.now;
      Date.now = () => today;
      try {
        value = show(computeInsight(entries, settings, customCats, lang));
      } finally {
        Date.now = realNow;
      }
      break;
    }
    case 'credit':
      value = show(creditDueInsight(accounts, entries, lang, today));
      break;
    default:
      throw new Error(`unknown kind ${kind}`);
  }
  out.push(`${kind}\t${value}`);
}
console.log(out.join('\n'));
