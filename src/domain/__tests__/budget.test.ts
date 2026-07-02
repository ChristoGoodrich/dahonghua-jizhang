import { tierStatus, expenseTotal, todayExpense, monthlyStatus, dailyStatus, catBudgetRows } from '../budget';
import type { Entry, Settings } from '../types';

const E = (over: Partial<Entry>): Entry => ({ id: Math.random().toString(36), ts: Date.now(), io: 'exp', cat: 'food', amt: 0, ...over });
const S = (over: Partial<Settings> = {}): Settings => ({ budget: 0, cycleStart: 1, theme: 'default', ...over });

describe('tierStatus', () => {
  it('computes left/pct/over for a real limit', () => {
    const r = tierStatus(80, 100);
    expect(r).toEqual({ limit: 100, used: 80, left: 20, pct: 80, over: false });
  });
  it('flags over when used exceeds limit', () => {
    const r = tierStatus(120, 100);
    expect(r.over).toBe(true);
    expect(r.left).toBe(-20);
    expect(r.pct).toBe(120);
  });
  it('treats limit<=0 as unset (no over, pct 0)', () => {
    const r = tierStatus(50, 0);
    expect(r).toEqual({ limit: 0, used: 50, left: -50, pct: 0, over: false });
  });
});

describe('expenseTotal', () => {
  it('sums only expenses, ignoring income and transfers', () => {
    const r = expenseTotal([E({ amt: 10 }), E({ io: 'inc', amt: 999 }), E({ io: 'xfer', amt: 500 }), E({ amt: 5 })]);
    expect(r).toBe(15);
  });
});

describe('todayExpense', () => {
  it('only counts expenses booked on the same calendar day as now', () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const r = todayExpense(
      [E({ amt: 20, ts: now }), E({ amt: 7, ts: new Date(2026, 5, 10, 23).getTime() }), E({ amt: 100, ts: new Date(2026, 5, 9).getTime() })],
      now,
    );
    expect(r).toBe(27);
  });
});

describe('monthly/daily status', () => {
  it('monthlyStatus reads settings.budget', () => {
    expect(monthlyStatus([E({ amt: 60 })], S({ budget: 100 })).left).toBe(40);
  });
  it('dailyStatus flags over for today only', () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const r = dailyStatus([E({ amt: 90, ts: now }), E({ amt: 200, ts: new Date(2026, 5, 1).getTime() })], S({ dailyBudget: 50 }), now);
    expect(r.over).toBe(true);
    expect(r.used).toBe(90);
  });
});

describe('catBudgetRows', () => {
  it('only includes categories with a positive limit, sorted by pct desc', () => {
    const entries = [E({ cat: 'food', amt: 90 }), E({ cat: 'trans', amt: 20 }), E({ cat: 'fun', amt: 5 })];
    const rows = catBudgetRows(entries, S({ catBudgets: { food: 100, trans: 200, gift: 0 } }));
    expect(rows.map((r) => r.cat)).toEqual(['food', 'trans']); // gift dropped (limit 0), food first (90% > 10%)
    expect(rows[0].over).toBe(false);
    expect(rows[0].pct).toBe(90);
  });
  it('flags a category over its budget', () => {
    const rows = catBudgetRows([E({ cat: 'food', amt: 150 })], S({ catBudgets: { food: 100 } }));
    expect(rows[0].over).toBe(true);
    expect(rows[0].left).toBe(-50);
  });
});
