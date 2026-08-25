// TypeScript half of the search / notes / archive parity harness.

import { matchesSearch } from '../src/domain/search';
import { noteSuggestions } from '../src/domain/notes';
import {
  pickerAccounts,
  archivedAccounts,
  pickerLedgers,
  archivedLedgers,
} from '../src/domain/archive';
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
const split = (s: string, sep: string) => (s === '' ? [] : s.split(sep));

/** io~cat~amt~note~tag;tag~ledger */
function parseSearchEntry(rec: string, i: number): Entry {
  const f = rec.split('~');
  const tags = cell(f, 4);
  return {
    id: `e${i}`,
    ts: 0,
    io: cell(f, 0) as IO,
    cat: f[1] ?? '',
    amt: num(f, 2) ?? 0,
    note: cell(f, 3),
    tags: tags === undefined ? undefined : tags.split(';'),
    ledger: cell(f, 5),
  } as Entry;
}

/** io~cat~note~ts~del */
function parseNoteEntry(rec: string, i: number): Entry {
  const f = rec.split('~');
  return {
    id: `e${i}`,
    io: cell(f, 0) as IO,
    cat: f[1] ?? '',
    amt: 0,
    note: cell(f, 2),
    ts: num(f, 3) ?? 0,
    deletedAt: num(f, 4),
  } as Entry;
}

/** id~archived */
function parseAccount(rec: string): Account {
  const f = rec.split('~');
  const a = cell(f, 1);
  return {
    id: f[0] ?? '',
    name: f[0] ?? '',
    archived: a === undefined ? undefined : a === '1',
  } as Account;
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

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = trimmed.slice(tab + 1);
  const bar1 = arg.indexOf('|');
  const bar2 = arg.indexOf('|', bar1 + 1);
  const a = arg.slice(0, bar1);
  const b = arg.slice(bar1 + 1, bar2 < 0 ? undefined : bar2);
  const c = bar2 < 0 ? '' : arg.slice(bar2 + 1);

  let value: string;
  switch (kind) {
    case 'search': {
      const entries = split(a, '^').map(parseSearchEntry);
      const semi = c.indexOf(';');
      const lang = (semi < 0 ? c : c.slice(0, semi)) === 'zh' ? 'zh' : 'en';
      const custom: Record<IO, Category[]> = {
        exp: parseCats(semi < 0 ? '' : c.slice(semi + 1)),
        inc: [],
        xfer: [],
      };
      value = entries.map((d) => (matchesSearch(d, b, custom, lang) ? '1' : '0')).join('');
      break;
    }
    case 'notes': {
      const entries = split(a, '^').map(parseNoteEntry);
      const f = b.split(',');
      value = noteSuggestions(entries, f[0] ?? 'exp', f[1] ?? '', num(f, 2) ?? 6).join(',');
      break;
    }
    case 'pickacct':
    case 'archacct': {
      const accounts = split(a, '^').map(parseAccount);
      const picked =
        kind === 'pickacct' ? pickerAccounts(accounts, split(b, '^')) : archivedAccounts(accounts);
      value = picked.map((x) => x.id).join(',');
      break;
    }
    case 'pickledger':
    case 'archledger': {
      const ledgers = split(a, '^');
      const archived = split(b, '^');
      const picked =
        kind === 'pickledger' ? pickerLedgers(ledgers, archived, c) : archivedLedgers(ledgers, archived);
      value = picked.join(',');
      break;
    }
    default:
      throw new Error(`unknown kind ${kind}`);
  }
  out.push(`${kind}\t${value}`);
}
console.log(out.join('\n'));
