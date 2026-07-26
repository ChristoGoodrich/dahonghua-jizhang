import { monthKey, buildMonthIndex, buildAccountIndex } from '../indexes';
import type { Entry } from '@/domain/types';

const E = (over: Partial<Entry>): Entry => ({
  id: 'x',
  ts: 0,
  io: 'exp',
  cat: 'food',
  amt: 10,
  ...over,
});

describe('monthKey', () => {
  it('returns YYYY-MM for a known timestamp', () => {
    // 2026-03-15 10:00 UTC
    expect(monthKey(Date.UTC(2026, 2, 15, 10))).toBe('2026-03');
  });

  it('pads single-digit months with a leading zero', () => {
    expect(monthKey(Date.UTC(2026, 0, 1))).toBe('2026-01');
  });
});

describe('buildMonthIndex', () => {
  it('groups entries by month', () => {
    const entries = [
      E({ id: 'a', ts: Date.UTC(2026, 0, 10) }),
      E({ id: 'b', ts: Date.UTC(2026, 0, 20) }),
      E({ id: 'c', ts: Date.UTC(2026, 1, 5) }),
    ];
    const idx = buildMonthIndex(entries);
    expect(idx.get('2026-01')!.map((e) => e.id)).toEqual(['a', 'b']);
    expect(idx.get('2026-02')!.map((e) => e.id)).toEqual(['c']);
  });

  it('excludes tombstoned (deletedAt) entries', () => {
    const entries = [
      E({ id: 'live', ts: Date.UTC(2026, 3, 1) }),
      E({ id: 'dead', ts: Date.UTC(2026, 3, 2), deletedAt: 999 }),
    ];
    const idx = buildMonthIndex(entries);
    expect(idx.get('2026-04')!.map((e) => e.id)).toEqual(['live']);
  });

  it('returns an empty map for empty input', () => {
    expect(buildMonthIndex([]).size).toBe(0);
  });
});

describe('buildAccountIndex', () => {
  it('groups entries by account', () => {
    const entries = [
      E({ id: 'a', acct: 'cash' }),
      E({ id: 'b', acct: 'credit' }),
      E({ id: 'c', acct: 'cash' }),
    ];
    const idx = buildAccountIndex(entries);
    expect(idx.get('cash')!.map((e) => e.id)).toEqual(['a', 'c']);
    expect(idx.get('credit')!.map((e) => e.id)).toEqual(['b']);
  });

  it('groups entries without acct under empty string', () => {
    const entries = [E({ id: 'a' })]; // no acct
    const idx = buildAccountIndex(entries);
    expect(idx.get('')!.map((e) => e.id)).toEqual(['a']);
  });

  it('excludes tombstoned (deletedAt) entries', () => {
    const entries = [
      E({ id: 'live', acct: 'cash' }),
      E({ id: 'dead', acct: 'cash', deletedAt: 123 }),
    ];
    const idx = buildAccountIndex(entries);
    expect(idx.get('cash')!.map((e) => e.id)).toEqual(['live']);
  });

  it('returns an empty map for empty input', () => {
    expect(buildAccountIndex([]).size).toBe(0);
  });
});
