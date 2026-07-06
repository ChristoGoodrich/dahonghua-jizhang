import { getWeekRange, calculateWeeklyBudget, getWeeklyStatus } from '../weekly';
import type { Entry } from '../types';

const E = (over: Partial<Entry>): Entry => ({ id: Math.random().toString(36), ts: Date.now(), io: 'exp', cat: 'food', amt: 0, ...over });

describe('getWeekRange', () => {
  it('returns Sunday to Saturday range for a mid-week date', () => {
    // Wednesday June 10, 2026
    const wed = new Date(2026, 5, 10);
    const { start, end } = getWeekRange(wed);
    expect(start.getDay()).toBe(0); // Sunday
    expect(end.getDay()).toBe(0);   // next Sunday (exclusive)
    expect(start.getDate()).toBe(7); // Sun June 7
    expect(end.getDate()).toBe(14);  // Sun June 14
  });

  it('returns same-day range when given a Sunday', () => {
    const sun = new Date(2026, 5, 7); // Sunday
    const { start, end } = getWeekRange(sun);
    expect(start.getDay()).toBe(0);
    expect(start.getDate()).toBe(7);
    expect(end.getDate()).toBe(14);
  });

  it('handles Saturday correctly', () => {
    const sat = new Date(2026, 5, 13); // Saturday
    const { start, end } = getWeekRange(sat);
    expect(start.getDay()).toBe(0);
    expect(start.getDate()).toBe(7); // still Sun June 7
    expect(end.getDate()).toBe(14);
  });

  it('spans month boundary correctly', () => {
    // Tuesday June 30, 2026 — week should start Sun June 28
    const tue = new Date(2026, 5, 30);
    const { start, end } = getWeekRange(tue);
    expect(start.getMonth()).toBe(5); // June
    expect(start.getDate()).toBe(28);
    expect(end.getMonth()).toBe(6);   // July
    expect(end.getDate()).toBe(5);
  });
});

describe('calculateWeeklyBudget', () => {
  it('divides weekly budget by 7 to get daily equivalent', () => {
    expect(calculateWeeklyBudget(700)).toBeCloseTo(100, 5);
    expect(calculateWeeklyBudget(350)).toBeCloseTo(50, 5);
  });

  it('returns 0 for zero budget', () => {
    expect(calculateWeeklyBudget(0)).toBe(0);
  });
});

describe('getWeeklyStatus', () => {
  it('calculates spent, remaining, over, daysLeft, dailyBudget', () => {
    // Wednesday June 10, 2026 at noon
    const now = new Date(2026, 5, 10, 12).getTime();
    const entries = [
      E({ amt: 100, ts: new Date(2026, 5, 8).getTime() }),  // Mon - in range
      E({ amt: 50, ts: new Date(2026, 5, 10).getTime() }),   // Wed - in range
      E({ amt: 200, ts: new Date(2026, 5, 1).getTime() }),   // before week - out of range
    ];
    const status = getWeeklyStatus(entries, 700, now);
    expect(status.spent).toBe(150);
    expect(status.remaining).toBe(550);
    expect(status.over).toBe(false);
    expect(status.dailyBudget).toBeCloseTo(100, 5);
    // daysLeft: Wed, Thu, Fri, Sat = 4 days remaining (including today)
    expect(status.daysLeft).toBe(4);
  });

  it('flags over when spent exceeds weekly budget', () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const entries = [
      E({ amt: 500, ts: new Date(2026, 5, 8).getTime() }),
      E({ amt: 300, ts: new Date(2026, 5, 9).getTime() }),
    ];
    const status = getWeeklyStatus(entries, 700, now);
    expect(status.spent).toBe(800);
    expect(status.remaining).toBe(-100);
    expect(status.over).toBe(true);
  });

  it('filters out deleted entries', () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const entries = [
      E({ amt: 100, ts: new Date(2026, 5, 8).getTime() }),
      E({ amt: 500, ts: new Date(2026, 5, 9).getTime(), deletedAt: Date.now() }),
    ];
    const status = getWeeklyStatus(entries, 700, now);
    expect(status.spent).toBe(100);
  });

  it('filters out non-expense entries', () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const entries = [
      E({ amt: 100, io: 'exp', ts: new Date(2026, 5, 8).getTime() }),
      E({ amt: 999, io: 'inc', ts: new Date(2026, 5, 8).getTime() }),
      E({ amt: 500, io: 'xfer', ts: new Date(2026, 5, 9).getTime() }),
    ];
    const status = getWeeklyStatus(entries, 700, now);
    expect(status.spent).toBe(100);
  });

  it('uses current date when now is not provided', () => {
    const status = getWeeklyStatus([], 700);
    expect(status.spent).toBe(0);
    expect(status.over).toBe(false);
    expect(status.dailyBudget).toBeCloseTo(100, 5);
    expect(status.daysLeft).toBeGreaterThanOrEqual(0);
    expect(status.daysLeft).toBeLessThanOrEqual(6);
  });
});
