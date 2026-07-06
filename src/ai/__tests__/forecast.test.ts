import { forecastMonthlyExpense } from '../forecast';
import type { Entry } from '@/domain/types';

const E = (over: Partial<Entry>): Entry => ({
  id: Math.random().toString(36),
  ts: Date.now(),
  io: 'exp',
  cat: 'food',
  amt: 0,
  ...over,
});

// Helper: create a Date at a specific year/month/day
const D = (y: number, m: number, d: number) => new Date(y, m, d).getTime();

describe('forecastMonthlyExpense', () => {
  // Anchor is 2026-07-06; cycles are month-aligned (cycleStart=1).
  // Past 3 cycles: Jun, May, Apr 2026.
  const anchor = new Date(2026, 6, 6); // July 6

  it('returns zero predicted amount when history is empty', () => {
    const r = forecastMonthlyExpense([], 1, anchor);
    expect(r.predicted).toBe(0);
    expect(r.trend).toBe('stable');
    expect(r.confidence).toBe(0);
    expect(r.breakdown).toEqual([]);
  });

  it('predicts based on historical data', () => {
    const entries = [
      // April expenses
      E({ ts: D(2026, 3, 5), amt: 100, cat: 'food' }),
      E({ ts: D(2026, 3, 15), amt: 200, cat: 'trans' }),
      // May expenses
      E({ ts: D(2026, 4, 3), amt: 120, cat: 'food' }),
      E({ ts: D(2026, 4, 20), amt: 180, cat: 'trans' }),
      // June expenses
      E({ ts: D(2026, 5, 10), amt: 130, cat: 'food' }),
      E({ ts: D(2026, 5, 22), amt: 170, cat: 'trans' }),
    ];
    const r = forecastMonthlyExpense(entries, 1, anchor);
    expect(r.predicted).toBeGreaterThan(0);
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.breakdown.length).toBeGreaterThan(0);
  });

  it('detects increasing trend', () => {
    const entries = [
      // April: 200
      E({ ts: D(2026, 3, 5), amt: 100, cat: 'food' }),
      E({ ts: D(2026, 3, 15), amt: 100, cat: 'food' }),
      // May: 400
      E({ ts: D(2026, 4, 5), amt: 200, cat: 'food' }),
      E({ ts: D(2026, 4, 15), amt: 200, cat: 'food' }),
      // June: 600
      E({ ts: D(2026, 5, 5), amt: 300, cat: 'food' }),
      E({ ts: D(2026, 5, 15), amt: 300, cat: 'food' }),
    ];
    const r = forecastMonthlyExpense(entries, 1, anchor);
    expect(r.trend).toBe('increasing');
    expect(r.predicted).toBeGreaterThan(600);
  });

  it('detects decreasing trend', () => {
    const entries = [
      // April: 600
      E({ ts: D(2026, 3, 5), amt: 300, cat: 'food' }),
      E({ ts: D(2026, 3, 15), amt: 300, cat: 'food' }),
      // May: 400
      E({ ts: D(2026, 4, 5), amt: 200, cat: 'food' }),
      E({ ts: D(2026, 4, 15), amt: 200, cat: 'food' }),
      // June: 200
      E({ ts: D(2026, 5, 5), amt: 100, cat: 'food' }),
      E({ ts: D(2026, 5, 15), amt: 100, cat: 'food' }),
    ];
    const r = forecastMonthlyExpense(entries, 1, anchor);
    expect(r.trend).toBe('decreasing');
    expect(r.predicted).toBeLessThan(200);
  });

  it('detects stable trend when amounts are flat', () => {
    const entries = [
      E({ ts: D(2026, 3, 5), amt: 200, cat: 'food' }),
      E({ ts: D(2026, 4, 5), amt: 200, cat: 'food' }),
      E({ ts: D(2026, 5, 5), amt: 200, cat: 'food' }),
    ];
    const r = forecastMonthlyExpense(entries, 1, anchor);
    expect(r.trend).toBe('stable');
  });

  it('returns reasonable confidence values between 0 and 1', () => {
    const entries = [
      E({ ts: D(2026, 3, 5), amt: 100, cat: 'food' }),
      E({ ts: D(2026, 4, 5), amt: 150, cat: 'food' }),
      E({ ts: D(2026, 5, 5), amt: 120, cat: 'food' }),
    ];
    const r = forecastMonthlyExpense(entries, 1, anchor);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it('returns category breakdown that sums close to predicted', () => {
    const entries = [
      E({ ts: D(2026, 3, 5), amt: 100, cat: 'food' }),
      E({ ts: D(2026, 3, 15), amt: 50, cat: 'trans' }),
      E({ ts: D(2026, 4, 5), amt: 110, cat: 'food' }),
      E({ ts: D(2026, 4, 15), amt: 60, cat: 'trans' }),
      E({ ts: D(2026, 5, 5), amt: 120, cat: 'food' }),
      E({ ts: D(2026, 5, 15), amt: 70, cat: 'trans' }),
    ];
    const r = forecastMonthlyExpense(entries, 1, anchor);
    const breakdownSum = r.breakdown.reduce((s, b) => s + b.predicted, 0);
    expect(Math.abs(breakdownSum - r.predicted)).toBeLessThan(1);
  });

  it('ignores income and transfer entries', () => {
    const entries = [
      E({ ts: D(2026, 3, 5), amt: 100, cat: 'food' }),
      E({ ts: D(2026, 3, 10), amt: 5000, io: 'inc', cat: 'salary' }),
      E({ ts: D(2026, 3, 12), amt: 1000, io: 'xfer', cat: 'transfer' }),
      E({ ts: D(2026, 4, 5), amt: 100, cat: 'food' }),
      E({ ts: D(2026, 5, 5), amt: 100, cat: 'food' }),
    ];
    const r = forecastMonthlyExpense(entries, 1, anchor);
    expect(r.predicted).toBeGreaterThan(0);
    expect(r.predicted).toBeLessThan(200);
  });

  it('uses custom cycleStart correctly', () => {
    // cycleStart=25 means cycle runs 25th..24th
    // For anchor July 6, past 3 cycles are:
    //   Jun 25-Jul 24 → but anchor is July 6 so this is the current cycle
    //   May 25-Jun 24, Apr 25-May 24, Mar 25-Apr 24
    const entries = [
      E({ ts: D(2026, 2, 28), amt: 100, cat: 'food' }), // March 28 → in Mar 25 - Apr 24 cycle
      E({ ts: D(2026, 3, 30), amt: 200, cat: 'food' }), // April 30 → in Apr 25 - May 24 cycle
      E({ ts: D(2026, 4, 30), amt: 300, cat: 'food' }), // May 30 → in May 25 - Jun 24 cycle
    ];
    const r = forecastMonthlyExpense(entries, 25, anchor);
    expect(r.predicted).toBeGreaterThan(0);
  });
});
