// TypeScript half of the CSV export parity harness.
//
// Each entry carries a real epoch timestamp *and* the local calendar day it
// falls on. The generator computes both from the same wall-clock moment, so
// this side can hand `ts` straight to the shipping code — which sorts by it and
// derives the date column from it — while the core sorts by the same integer
// and renders the day it was given. Neither half has to know the other's
// timezone, and the export's own sort is the one under test.

import { entriesToCSV } from '../src/domain/export';
import type { Account, Category, Entry, IO } from '../src/domain/types';

const raw = require('fs').readFileSync(0, 'utf8') as string;

const cell = (f: string[], i: number): string | undefined => {
  const v = f[i];
  return v === undefined || v === '_' ? undefined : v;
};
function num(f: string[], i: number): number | undefined {
  const v = cell(f, i);
  if (v === undefined || v === '') return undefined;
  return v === 'nan' ? NaN : Number(v);
}

/** `_LF_`, `_CR_` and `_TAB_` are tokens in the corpus because it is one case
 *  per line — expanded here so the shipping code sees the real character. */
const expand = (s: string | undefined) =>
  s === undefined
    ? undefined
    : s.split('_LF_').join('\n').split('_CR_').join('\r').split('_TAB_').join('\t');

/** io~cat~amt~note~acct~acctTo~ts~y~m~d~del */
function parseRow(rec: string, i: number): Entry {
  const f = rec.split('~');
  return {
    id: `e${i}`,
    io: cell(f, 0) as IO,
    cat: f[1] ?? '',
    amt: num(f, 2) ?? 0,
    note: expand(cell(f, 3)),
    acct: cell(f, 4),
    acctTo: cell(f, 5),
    ts: num(f, 6) ?? 0,
    deletedAt: num(f, 10),
  } as Entry;
}

/** id:name */
function parseAccounts(s: string): Account[] {
  return s
    .split(';')
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf(':');
      return { id: i < 0 ? p : p.slice(0, i), name: i < 0 ? '' : p.slice(i + 1) } as Account;
    });
}

/** k:zh:en */
function parseCats(s: string): Category[] {
  return s
    .split(';')
    .filter(Boolean)
    .map((p) => {
      const f = p.split(':');
      return { k: f[0] ?? '', e: '', zh: f[1] ?? '', en: f[2] ?? '', c: '', custom: true } as Category;
    });
}

/** Both halves spell an awkward character the same way, so a formatting
 *  difference in the harness cannot be reported as one in the code. */
function show(s: string): string {
  let out = '';
  for (const c of s) {
    const n = c.codePointAt(0)!;
    const odd =
      n < 0x20 || (n >= 0x7f && n <= 0xa0) || n === 0xfeff || n === 0x2028 || n === 0x2029;
    out += odd ? `<U+${n.toString(16).toUpperCase().padStart(4, '0')}>` : c;
  }
  return out;
}

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  if (kind !== 'csv') throw new Error(`unknown kind ${kind}`);
  const arg = trimmed.slice(tab + 1);
  const bar1 = arg.indexOf('|');
  const bar2 = arg.indexOf('|', bar1 + 1);
  const body = arg.slice(0, bar1);
  const entries = body ? body.split('^').map(parseRow) : [];
  const accounts = parseAccounts(arg.slice(bar1 + 1, bar2));
  const custom: Record<IO, Category[]> = {
    exp: parseCats(arg.slice(bar2 + 1)),
    inc: [],
    xfer: [],
  };
  out.push(`${kind}\t${show(entriesToCSV(entries, accounts, custom))}`);
}
console.log(out.join('\n'));
