// Pure export generators — CSV and XLSX for spreadsheets, kept here so the
// formatting is unit-testable. The file-writing/sharing lives in src/util/share.ts.
import type { Account, Category, Entry, IO } from './types';
import { catOf } from './cats';
import { writeXlsx, type Cell } from './xlsxWrite';

/** The one row shape both exports share: header + one line per live entry,
 *  oldest first. Tombstones are dropped — an export is a statement of what the
 *  ledger holds, not of what it has ever held. */
function toRows(
  entries: Entry[],
  accounts: Account[],
  customCats: Record<IO, Category[]>,
): Cell[][] {
  const nameOf = (id?: string) => accounts.find((x) => x.id === id)?.name ?? '';
  const rows: Cell[][] = [['date', 'type', 'category', 'account', 'amount', 'note']];
  entries
    .filter((d) => !d.deletedAt)
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .forEach((d) => {
      const c = catOf(d.io, d.cat, customCats);
      rows.push([
        new Date(d.ts).toISOString().slice(0, 10),
        d.io,
        c.zh || c.en || '',
        d.io === 'xfer' ? `${nameOf(d.acct)}→${nameOf(d.acctTo)}` : nameOf(d.acct),
        d.amt,
        d.note || '',
      ]);
    });
  return rows;
}

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
  const rows = toRows(entries, accounts, customCats);
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

/** Ledger → XLSX ArrayBuffer. Same columns as CSV. Tombstones excluded. */
export function entriesToXLSX(
  entries: Entry[],
  accounts: Account[],
  customCats: Record<IO, Category[]>,
): ArrayBuffer {
  const rows = toRows(entries, accounts, customCats);
  return writeXlsx(rows);
}
