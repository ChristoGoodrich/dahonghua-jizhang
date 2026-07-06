import { byCategory, statTotals, sixMonthTrend, comparison, donutSlices, topEntries, byWeekday, byTimeOfDay, timeBucketOf } from '../stats';
import { computeInsight } from '../insight';
import type { Entry } from '../types';

const E = (over: Partial<Entry>): Entry => ({ id: Math.random().toString(36), ts: Date.now(), io: 'exp', cat: 'food', amt: 0, ...over });
const noCustom = { exp: [], inc: [] };

describe('donutSlices', () => {
  it('returns cumulative fractions that sum to 1', () => {
    const slices = donutSlices([{ cat: 'food', amt: 60 }, { cat: 'trans', amt: 40 }], 100);
    expect(slices).toEqual([
      { cat: 'food', frac: 0.6, start: 0 },
      { cat: 'trans', frac: 0.4, start: 0.6 },
    ]);
    expect(slices.reduce((s, x) => s + x.frac, 0)).toBeCloseTo(1);
  });
  it('is empty when total is zero', () => {
    expect(donutSlices([{ cat: 'food', amt: 0 }], 0)).toEqual([]);
  });
});

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

describe('topEntries', () => {
  it('returns the N largest expenses, descending, ignoring other io', () => {
    const r = topEntries(
      [E({ amt: 10 }), E({ amt: 50 }), E({ amt: 30 }), E({ io: 'inc', amt: 999 })],
      'exp',
      2,
    );
    expect(r.map((d) => d.amt)).toEqual([50, 30]);
  });
});

describe('byWeekday', () => {
  it('buckets expenses Sunday-first by day of week', () => {
    const sun = new Date(2026, 5, 7).getTime(); // 2026-06-07 is a Sunday
    const mon = new Date(2026, 5, 8).getTime();
    const r = byWeekday([E({ amt: 10, ts: sun }), E({ amt: 5, ts: mon }), E({ amt: 3, ts: mon }), E({ io: 'inc', amt: 99, ts: sun })]);
    expect(r).toHaveLength(7);
    expect(r[0]).toEqual({ dow: 0, amt: 10, count: 1 }); // Sunday
    expect(r[1]).toEqual({ dow: 1, amt: 8, count: 2 }); // Monday
    expect(r[2]).toEqual({ dow: 2, amt: 0, count: 0 });
  });
});

describe('timeBucketOf', () => {
  it('maps hours to the 7 named periods', () => {
    expect(timeBucketOf(2)).toBe('dawn'); // 凌晨
    expect(timeBucketOf(6)).toBe('earlyMorning'); // 清晨
    expect(timeBucketOf(9)).toBe('morning'); // 上午
    expect(timeBucketOf(12)).toBe('noon'); // 中午
    expect(timeBucketOf(15)).toBe('afternoon'); // 下午
    expect(timeBucketOf(18)).toBe('dusk'); // 傍晚
    expect(timeBucketOf(22)).toBe('night'); // 晚上
    expect(timeBucketOf(0)).toBe('dawn'); // boundary
    expect(timeBucketOf(23)).toBe('night');
  });
});

describe('byTimeOfDay', () => {
  it('buckets expenses into chronological periods and ignores other io', () => {
    const at = (h: number) => new Date(2026, 5, 8, h, 30).getTime();
    const r = byTimeOfDay([
      E({ amt: 20, ts: at(12) }), // noon
      E({ amt: 8, ts: at(12) }), // noon
      E({ amt: 50, ts: at(21) }), // night
      E({ io: 'inc', amt: 999, ts: at(21) }), // ignored (income)
    ]);
    expect(r).toHaveLength(7);
    expect(r.map((x) => x.key)).toEqual(['dawn', 'earlyMorning', 'morning', 'noon', 'afternoon', 'dusk', 'night']);
    expect(r.find((x) => x.key === 'noon')).toEqual({ key: 'noon', amt: 28, count: 2 });
    expect(r.find((x) => x.key === 'night')).toEqual({ key: 'night', amt: 50, count: 1 });
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
