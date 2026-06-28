// Pure export generators — CSV for spreadsheets, kept here so the formatting is
// unit-testable. The file-writing/sharing lives in src/util/share.ts.
import type { Account, Category, Entry, IO } from './types';
import { catOf } from './cats';

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Ledger → CSV (date,type,category,account,amount,note). Tombstones excluded.
 *  Prefixed with a BOM so Excel reads UTF-8 correctly. */
export function entriesToCSV(
  entries: Entry[],
  accounts: Account[],
  customCats: Record<IO, Category[]>,
): string {
  const rows: (string | number)[][] = [['date', 'type', 'category', 'account', 'amount', 'note']];
  entries
    .filter((d) => !d.deletedAt)
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .forEach((d) => {
      const c = catOf(d.io, d.cat, customCats);
      const nameOf = (id?: string) => accounts.find((x) => x.id === id)?.name ?? '';
      const acctCell = d.io === 'xfer' ? `${nameOf(d.acct)}→${nameOf(d.acctTo)}` : nameOf(d.acct);
      rows.push([
        new Date(d.ts).toISOString().slice(0, 10),
        d.io,
        c.zh || c.en || '',
        acctCell,
        d.amt,
        d.note || '',
      ]);
    });
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
