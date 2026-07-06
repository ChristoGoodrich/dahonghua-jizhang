import { dailyTrend, weeklyTrend, categoryTrend } from '../trends';
import type { Entry } from '../types';

const E = (over: Partial<Entry>): Entry => ({
  id: Math.random().toString(36),
  ts: Date.now(),
  io: 'exp',
  cat: 'food',
  amt: 0,
  ...over,
});

describe('dailyTrend', () => {
  it('aggregates expenses by day, includes income separately', () => {
    const day0 = new Date(2026, 5, 10, 0, 0, 0).getTime();
    const day1 = day0 + 864e5;
    const entries = [
      E({ ts: day0 + 3600e3, io: 'exp', amt: 20 }),
      E({ ts: day0 + 7200e3, io: 'exp', amt: 30 }),
      E({ ts: day1 + 3600e3, io: 'inc', amt: 100 }),
      E({ ts: day1 + 7200e3, io: 'exp', amt: 50 }),
    ];
    const now = day1 + 10000;
    const result = dailyTrend(entries, 2, now);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ date: expect.any(String), exp: 50, inc: 0 });
    expect(result[1]).toEqual({ date: expect.any(String), exp: 50, inc: 100 });
  });

  it('handles empty entries', () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const result = dailyTrend([], 3, now);
    expect(result).toHaveLength(3);
    for (const point of result) {
      expect(point.exp).toBe(0);
      expect(point.inc).toBe(0);
    }
  });

  it('filters out deleted entries', () => {
    const day0 = new Date(2026, 5, 10, 0, 0, 0).getTime();
    const entries = [
      E({ ts: day0 + 3600e3, io: 'exp', amt: 20 }),
      E({ ts: day0 + 7200e3, io: 'exp', amt: 30, deletedAt: day0 + 8000e3 }),
    ];
    const now = day0 + 10000;
    const result = dailyTrend(entries, 1, now);
    expect(result[0].exp).toBe(20);
  });
});

describe('weeklyTrend', () => {
  it('aggregates by week', () => {
    const week0 = new Date(2026, 5, 1, 0, 0, 0).getTime(); // Monday
    const week1 = week0 + 7 * 864e5;
    const entries = [
      E({ ts: week0 + 864e3, io: 'exp', amt: 10 }),
      E({ ts: week0 + 2 * 864e3, io: 'exp', amt: 20 }),
      E({ ts: week1 + 864e3, io: 'inc', amt: 200 }),
      E({ ts: week1 + 2 * 864e3, io: 'exp', amt: 40 }),
    ];
    const now = week1 + 3 * 864e3;
    const result = weeklyTrend(entries, 2, now);
    expect(result).toHaveLength(2);
    expect(result[0].exp).toBe(30);
    expect(result[0].inc).toBe(0);
    expect(result[1].exp).toBe(40);
    expect(result[1].inc).toBe(200);
  });

  it('handles empty entries', () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const result = weeklyTrend([], 4, now);
    expect(result).toHaveLength(4);
    for (const point of result) {
      expect(point.exp).toBe(0);
      expect(point.inc).toBe(0);
    }
  });

  it('filters out deleted entries', () => {
    const week0 = new Date(2026, 5, 1, 0, 0, 0).getTime();
    const entries = [
      E({ ts: week0 + 864e3, io: 'exp', amt: 10 }),
      E({ ts: week0 + 2 * 864e3, io: 'exp', amt: 20, deletedAt: week0 + 3 * 864e3 }),
    ];
    const now = week0 + 8 * 864e3;
    const result = weeklyTrend(entries, 1, now);
    expect(result[0].exp).toBe(10);
  });
});

describe('categoryTrend', () => {
  it('tracks a specific category over time', () => {
    const day0 = new Date(2026, 5, 10, 0, 0, 0).getTime();
    const day1 = day0 + 864e5;
    const entries = [
      E({ ts: day0 + 3600e3, cat: 'food', amt: 20 }),
      E({ ts: day0 + 7200e3, cat: 'transport', amt: 30 }),
      E({ ts: day1 + 3600e3, cat: 'food', amt: 50 }),
    ];
    const now = day1 + 10000;
    const result = categoryTrend(entries, 'food', 2, now);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ date: expect.any(String), amt: 20 });
    expect(result[1]).toEqual({ date: expect.any(String), amt: 50 });
  });

  it('returns zeros for missing days', () => {
    const day0 = new Date(2026, 5, 10, 0, 0, 0).getTime();
    const day2 = day0 + 2 * 864e5;
    const entries = [
      E({ ts: day0 + 3600e3, cat: 'food', amt: 20 }),
      E({ ts: day2 + 3600e3, cat: 'food', amt: 50 }),
    ];
    const now = day2 + 10000;
    const result = categoryTrend(entries, 'food', 3, now);
    expect(result).toHaveLength(3);
    expect(result[0].amt).toBe(20);
    expect(result[1].amt).toBe(0);
    expect(result[2].amt).toBe(50);
  });

  it('filters out deleted entries', () => {
    const day0 = new Date(2026, 5, 10, 0, 0, 0).getTime();
    const entries = [
      E({ ts: day0 + 3600e3, cat: 'food', amt: 20 }),
      E({ ts: day0 + 7200e3, cat: 'food', amt: 30, deletedAt: day0 + 8000e3 }),
    ];
    const now = day0 + 10000;
    const result = categoryTrend(entries, 'food', 1, now);
    expect(result[0].amt).toBe(20);
  });

  it('handles empty entries', () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const result = categoryTrend([], 'food', 3, now);
    expect(result).toHaveLength(3);
    for (const point of result) {
      expect(point.amt).toBe(0);
    }
  });
});
