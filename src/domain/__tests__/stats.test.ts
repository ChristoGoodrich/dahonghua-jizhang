import { byCategory, statTotals, sixMonthTrend, comparison } from '../stats';
import { computeInsight } from '../insight';
import type { Entry } from '../types';

const E = (over: Partial<Entry>): Entry => ({ id: Math.random().toString(36), ts: Date.now(), io: 'exp', cat: 'food', amt: 0, ...over });
const noCustom = { exp: [], inc: [] };

describe('byCategory', () => {
  it('groups expenses by category, sorted descending', () => {
    const r = byCategory([E({ cat: 'food', amt: 10 }), E({ cat: 'trans', amt: 30 }), E({ cat: 'food', amt: 5 }), E({ io: 'inc', cat: 'salary', amt: 999 })]);
    expect(r).toEqual([{ cat: 'trans', amt: 30 }, { cat: 'food', amt: 15 }]);
  });
});

describe('statTotals', () => {
  it('computes today/avg/top/count', () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const entries = [
      E({ cat: 'food', amt: 20, ts: now }),
      E({ cat: 'trans', amt: 100, ts: new Date(2026, 5, 3).getTime() }),
      E({ io: 'inc', cat: 'salary', amt: 500, ts: now }),
    ];
    const r = statTotals(entries, new Date(2026, 5, 10), 1, now);
    expect(r.todayExp).toBe(20);
    expect(r.top).toBe(100);
    expect(r.count).toBe(3);
    expect(r.avg).toBeGreaterThan(0);
  });
});

describe('sixMonthTrend', () => {
  it('returns 6 buckets oldest-first', () => {
    const r = sixMonthTrend([E({ amt: 50, ts: new Date(2026, 5, 5).getTime() })], new Date(2026, 5, 10), 1);
    expect(r).toHaveLength(6);
    expect(r[5].total).toBe(50); // current cycle is last
    expect(r[0].total).toBe(0);
  });
});

describe('comparison', () => {
  it('builds cumulative arrays for this vs last cycle', () => {
    const thisStart = new Date(2026, 5, 1).getTime();
    const lastStart = new Date(2026, 4, 1).getTime();
    const r = comparison(
      [E({ amt: 10, ts: thisStart + 864e5 }), E({ amt: 20, ts: lastStart + 864e5 })],
      new Date(2026, 5, 3, 12),
      1,
      new Date(2026, 5, 3, 12).getTime(),
    );
    expect(r.thisCum).toHaveLength(r.elapsedDays);
    expect(r.thisTotal).toBe(10);
    expect(r.lastTotal).toBe(20);
  });
});

describe('computeInsight', () => {
  const base = { budget: 0, cycleStart: 1, theme: 'default' as const };

  it('returns null with fewer than 3 expenses', () => {
    expect(computeInsight([E({ amt: 1 }), E({ amt: 1 })], base, noCustom, 'zh')).toBeNull();
  });

  it('flags over-budget', () => {
    const entries = [E({ amt: 60 }), E({ amt: 30 }), E({ amt: 20 })];
    const r = computeInsight(entries, { ...base, budget: 100 }, noCustom, 'en');
    expect(r?.ic).toBe('🥀');
  });

  it('falls back to biggest category', () => {
    const entries = [E({ cat: 'food', amt: 60 }), E({ cat: 'trans', amt: 30 }), E({ cat: 'food', amt: 10 })];
    const r = computeInsight(entries, base, noCustom, 'en');
    expect(r?.ic).toBe('🔍');
    expect(r?.text).toContain('Food');
  });
});
