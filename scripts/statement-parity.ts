// TypeScript half of the statement / net-worth parity harness.
//
// Entries carry a calendar day and this side puts them at noon, which is what
// makes the two halves comparable: the core compares civil days, the shipping
// code compares epoch stamps against `23:59:59.999` on a close day, and those
// mean the same thing for any stamp on the day.
//
// `asOf` in this corpus is always the end of a day, because that is the only
// shape the app ever passes one in — `statementSummary` is the sole caller that
// passes a cutoff at all, and it always passes a statement close.

import { acctBalances, netWorthParts, totalAccountBalance } from '../src/domain/networth';
import {
  lastStatementClose,
  dueDateFor,
  statementSummary,
  dueSoon,
} from '../src/domain/statement';
import type { Account, Asset, Entry, IO, Loan } from '../src/domain/types';

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
const split = (s: string, sep: string) => (s === '' ? [] : s.split(sep));

/** id~kind~balance~statementDay~dueDay */
function parseAccount(rec: string): Account {
  const f = rec.split('~');
  return {
    id: f[0] ?? '',
    name: f[0] ?? '',
    kind: cell(f, 1),
    balance: num(f, 2) ?? 0,
    statementDay: num(f, 3),
    dueDay: num(f, 4),
  } as Account;
}

/** io~acct~acctTo~amt~fee~discount~y~m~d~del — placed at noon */
function parseEntry(rec: string, i: number): Entry {
  const f = rec.split('~');
  return {
    id: `e${i}`,
    ts: new Date(num(f, 6) ?? 2026, num(f, 7) ?? 0, num(f, 8) ?? 1, 12, 0, 0).getTime(),
    io: cell(f, 0) as IO,
    acct: cell(f, 1),
    acctTo: cell(f, 2),
    amt: num(f, 3) ?? 0,
    fee: num(f, 4),
    discount: num(f, 5),
    deletedAt: num(f, 9),
    tsRaw: num(f, 10) ?? 0,
    cat: '',
  } as Entry;
}

const n = (v: number) => String(v);
const dayStr = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const out: string[] = [];
for (const line of raw.split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) continue;
  const tab = trimmed.indexOf('\t');
  const kind = trimmed.slice(0, tab);
  const arg = trimmed.slice(tab + 1);
  const bar1 = arg.indexOf('|');
  const bar2 = arg.indexOf('|', bar1 + 1);
  const accounts = split(arg.slice(0, bar1), '^').map(parseAccount);
  const entries = split(arg.slice(bar1 + 1, bar2), '^').map(parseEntry);
  const extra = arg.slice(bar2 + 1);
  const f = extra.split(',');

  /** end of the named day, which is the only cutoff the app ever builds */
  const upto = (from: number): number | undefined => {
    const y = cell(f, from);
    if (y === undefined) return undefined;
    return new Date(Number(y), num(f, from + 1) ?? 0, num(f, from + 2) ?? 1, 23, 59, 59, 999).getTime();
  };
  const today = (from: number): number => {
    const y = cell(f, from);
    return y === undefined
      ? new Date(2026, 0, 1, 12).getTime()
      : new Date(Number(y), num(f, from + 1) ?? 0, num(f, from + 2) ?? 1, 12, 0, 0).getTime();
  };

  // `#n` is an epoch cutoff rather than a calendar one: both halves compare
  // `d.ts <= n` over opaque integers, so the `<=` is exercised without a
  // timezone being involved at all.
  const hash = extra.indexOf('#');
  const epochCut = hash < 0 ? null : Number(extra.slice(hash + 1));
  const forEpoch = (es: Entry[]) =>
    epochCut === null ? es : es.map((e) => ({ ...e, ts: (e as unknown as { tsRaw: number }).tsRaw }));

  let value: string;
  switch (kind) {
    case 'bal': {
      const bals =
        epochCut === null
          ? acctBalances(accounts, entries, upto(0))
          : acctBalances(accounts, forEpoch(entries), epochCut);
      value = [...bals].map(([k, v]) => `${k}:${n(v)}`).join(',');
      break;
    }
    case 'one': {
      const id = hash < 0 ? (cell(f, 0) ?? '') : extra.slice(0, hash).replace(/,$/, '');
      const bals = epochCut === null
        ? acctBalances(accounts, entries, upto(1))
        : acctBalances(accounts, forEpoch(entries), epochCut);
      value = n(accounts.some((a) => a.id === id) ? (bals.get(id) ?? 0) : 0);
      break;
    }
    case 'total':
      value = n(totalAccountBalance(accounts, entries));
      break;
    case 'net': {
      const [aPart = '', lPart = ''] = [extra.slice(0, extra.indexOf(';')), extra.slice(extra.indexOf(';') + 1)];
      const assets: Asset[] = split(aPart, '+').map((a, i) => {
        const p = a.split(':');
        return {
          id: `a${i}`,
          name: `a${i}`,
          type: p[0] === 'liab' ? 'liab' : 'asset',
          val: num(p, 1) ?? 0,
          noCount: cell(p, 2) === undefined ? undefined : cell(p, 2) === '1',
        } as Asset;
      });
      const loans: Loan[] = split(lPart, '+').map((l, i) => {
        const p = l.split(':');
        return {
          id: `l${i}`,
          who: `l${i}`,
          type: p[0] === 'lend' ? 'lend' : 'borrow',
          amt: num(p, 1) ?? 0,
          repaid: num(p, 2),
          ts: 0,
        } as Loan;
      });
      const r = netWorthParts(accounts, entries, assets, loans);
      value = `asset=${n(r.asset)} liab=${n(r.liab)} net=${n(r.net)}`;
      break;
    }
    case 'close':
      value = dayStr(lastStatementClose(num(f, 0) ?? 1, today(1)));
      break;
    case 'due':
      value = dayStr(dueDateFor(today(0), num(f, 3) ?? 1, num(f, 4) ?? 1));
      break;
    case 'summary': {
      const id = cell(f, 0) ?? '';
      const a = accounts.find((x) => x.id === id);
      const s = a ? statementSummary(a, accounts, entries, today(1)) : null;
      value = !s
        ? 'none'
        : `close=${dayStr(s.statementClose)} billed=${n(s.billedDue)} over=${n(s.overpay)}` +
          ` unbilled=${n(s.unbilled)} debt=${n(s.currentDebt)}` +
          ` due=${s.dueDate == null ? '-' : dayStr(s.dueDate)}` +
          ` days=${s.daysToDue == null ? '-' : n(s.daysToDue)}`;
      break;
    }
    case 'soon':
      value = dueSoon(accounts, entries, today(0), num(f, 3) ?? 7)
        .map((r) => `${r.account.id}:${n(r.billedDue)}:${n(r.daysToDue)}`)
        .join(',');
      break;
    default:
      throw new Error(`unknown kind ${kind}`);
  }
  out.push(`${kind}\t${value}`);
}
console.log(out.join('\n'));
