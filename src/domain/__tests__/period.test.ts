import { periodRange, shiftPeriod, entriesInPeriod, periodTrend, periodLabel } from '../period';
import type { Entry } from '../types';

const E = (over: Partial<Entry>): Entry => ({ id: Math.random().toString(36), ts: Date.now(), io: 'exp', cat: 'food', amt: 0, ...over });

describe('periodRange', () => {
  it('day spans one calendar day', () => {
    const { start, end } = periodRange(new Date(2026, 5, 10, 14), 'day');
    expect(start).toEqual(new Date(2026, 5, 10));
    expect(end).toEqual(new Date(2026, 5, 11));
  });
  it('week starts on Monday', () => {
    // 2026-06-10 is a Wednesday → week starts Mon 2026-06-08
    const { start, end } = periodRange(new Date(2026, 5, 10), 'week');
    expect(start.getDay()).toBe(1);
    expect(start).toEqual(new Date(2026, 5, 8));
    expect(end).toEqual(new Date(2026, 5, 15));
  });
  it('month respects the cycle start day', () => {
    const { start } = periodRange(new Date(2026, 5, 10), 'month', 25);
    expect(start).toEqual(new Date(2026, 4, 25)); // before the 25th → prev cycle
  });
  it('halfyear splits the year in two', () => {
    expect(periodRange(new Date(2026, 2, 1), 'halfyear').start).toEqual(new Date(2026, 0, 1));
    expect(periodRange(new Date(2026, 8, 1), 'halfyear').start).toEqual(new Date(2026, 6, 1));
  });
  it('year spans Jan 1 to next Jan 1', () => {
    const { start, end } = periodRange(new Date(2026, 5, 10), 'year');
    expect(start).toEqual(new Date(2026, 0, 1));
    expect(end).toEqual(new Date(2027, 0, 1));
  });
});

describe('shiftPeriod', () => {
  it('moves by whole periods in each dimension', () => {
    expect(shiftPeriod(new Date(2026, 5, 10), 'day', -1)).toEqual(new Date(2026, 5, 9));
    expect(shiftPeriod(new Date(2026, 5, 10), 'week', 1)).toEqual(new Date(2026, 5, 15));
    expect(shiftPeriod(new Date(2026, 5, 10), 'halfyear', 1)).toEqual(new Date(2026, 6, 1));
    expect(shiftPeriod(new Date(2026, 5, 10), 'year', -2)).toEqual(new Date(2024, 0, 1));
  });
});

describe('entriesInPeriod', () => {
  it('keeps only entries inside the window', () => {
    const all = [
      E({ ts: new Date(2026, 5, 10, 9).getTime(), amt: 1 }),
      E({ ts: new Date(2026, 5, 11).getTime(), amt: 2 }),
      E({ ts: new Date(2026, 5, 10, 23).getTime(), amt: 3 }),
    ];
    const r = entriesInPeriod(all, new Date(2026, 5, 10, 12), 'day');
    expect(r.map((e) => e.amt).sort()).toEqual([1, 3]);
  });
});

describe('periodTrend', () => {
  it('returns 6 buckets oldest-first, current period last', () => {
    const all = [
      E({ ts: new Date(2026, 5, 10).getTime(), amt: 50 }), // this month
      E({ ts: new Date(2026, 4, 10).getTime(), amt: 20 }), // last month
      E({ io: 'inc', ts: new Date(2026, 5, 10).getTime(), amt: 999 }),
    ];
    const r = periodTrend(all, new Date(2026, 5, 10), 'month', 1, 'exp');
    expect(r).toHaveLength(6);
    expect(r[5].total).toBe(50);
    expect(r[4].total).toBe(20);
    expect(r[0].total).toBe(0);
  });
  it('can trend income instead of expense', () => {
    const all = [E({ io: 'inc', ts: new Date(2026, 5, 10).getTime(), amt: 999 })];
    const r = periodTrend(all, new Date(2026, 5, 10), 'month', 1, 'inc');
    expect(r[5].total).toBe(999);
  });
});

describe('periodLabel', () => {
  it('labels half-years', () => {
    expect(periodLabel(new Date(2026, 2, 1), 'halfyear', 'zh')).toContain('上半年');
    expect(periodLabel(new Date(2026, 8, 1), 'halfyear', 'en')).toContain('H2');
  });
  it('labels years', () => {
    expect(periodLabel(new Date(2026, 5, 1), 'year', 'en')).toBe('2026');
  });
});
