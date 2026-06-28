import { entriesToCSV } from '../export';
import type { Account, Category, Entry, IO } from '../types';

const accounts: Account[] = [{ id: 'default', name: '现金', balance: 0 }];
const custom: Record<IO, Category[]> = { exp: [], inc: [], xfer: [] };

describe('entriesToCSV', () => {
  it('emits a BOM + header and a row per entry, oldest first', () => {
    const entries: Entry[] = [
      { id: '2', ts: Date.UTC(2026, 5, 2), io: 'inc', cat: 'salary', amt: 100, acct: 'default' },
      { id: '1', ts: Date.UTC(2026, 5, 1), io: 'exp', cat: 'food', amt: 40, note: '午饭', acct: 'default' },
    ];
    const csv = entriesToCSV(entries, accounts, custom);
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    const lines = csv.slice(1).split('\n');
    expect(lines[0]).toBe('date,type,category,account,amount,note');
    expect(lines[1]).toBe('2026-06-01,exp,餐饮,现金,40,午饭'); // sorted oldest first
    expect(lines[2]).toBe('2026-06-02,inc,工资,现金,100,');
  });

  it('quotes cells containing commas/quotes/newlines', () => {
    const entries: Entry[] = [
      { id: '1', ts: Date.UTC(2026, 0, 1), io: 'exp', cat: 'food', amt: 5, note: 'a,"b"\nc', acct: 'default' },
    ];
    // the note has a newline, so the whole cell is quoted (can't split on \n)
    const csv = entriesToCSV(entries, accounts, custom);
    expect(csv).toContain('"a,""b""\nc"');
  });

  it('excludes soft-deleted entries', () => {
    const entries: Entry[] = [
      { id: '1', ts: 1, io: 'exp', cat: 'food', amt: 5, deletedAt: 2 },
    ];
    const csv = entriesToCSV(entries, accounts, custom);
    expect(csv.slice(1).split('\n')).toHaveLength(1); // header only
  });
});
