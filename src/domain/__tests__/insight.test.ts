import { creditDueInsight, computeInsight } from '../insight';
import type { Account, Entry, Settings } from '../types';

const card: Account = { id: 'c1', name: '招商', nameEn: 'CMB', balance: 0, kind: 'credit', statementDay: 5, dueDay: 25 };
const accounts: Account[] = [{ id: 'default', name: '现金', balance: 0 }, card];
const spend = (day: number, amt: number, cat = 'shop'): Entry => ({ id: 's' + day, ts: new Date(2026, 0, day).getTime(), io: 'exp', cat, amt, acct: 'c1' });
const customCats = { exp: [], inc: [], xfer: [] };

describe('creditDueInsight', () => {
  const ref = new Date(2026, 0, 20).getTime(); // statement closed Jan 5, due Jan 25 → 5 days out

  it('reminds about the soonest card due with an outstanding balance', () => {
    const ins = creditDueInsight(accounts, [spend(2, 1000)], 'zh', ref)!;
    expect(ins.ic).toBe('💳');
    expect(ins.text).toContain('招商');
    expect(ins.text).toContain('5'); // 5 天后
    expect(ins.text).toContain('1,000');
  });

  it('returns null when no card has a due balance', () => {
    expect(creditDueInsight(accounts, [], 'zh', ref)).toBeNull();
    // a plain cash account never triggers it
    expect(creditDueInsight([{ id: 'd', name: '现金', balance: -500, kind: 'cash' }], [], 'zh', ref)).toBeNull();
  });

  it('uses nameEn when lang is en', () => {
    const ins = creditDueInsight(accounts, [spend(2, 500)], 'en', ref)!;
    expect(ins.text).toContain('CMB');
  });

  it('reports overdue when past due day', () => {
    const overdueRef = new Date(2026, 0, 28).getTime(); // 3 days past due
    const ins = creditDueInsight(accounts, [spend(2, 200)], 'zh', overdueRef)!;
    expect(ins.text).toContain('逾期');
  });

  it('reports due today when on the due day', () => {
    const todayRef = new Date(2026, 0, 25).getTime();
    const ins = creditDueInsight(accounts, [spend(2, 200)], 'zh', todayRef)!;
    expect(ins).not.toBeNull();
  });

  it('reports acctId for navigation', () => {
    const ins = creditDueInsight(accounts, [spend(2, 100)], 'zh', ref)!;
    expect(ins.acctId).toBe('c1');
  });
});

describe('computeInsight', () => {
  const settings: Settings = { budget: 5000, cycleStart: 1, theme: 'default', dark: false };

  it('returns null with fewer than 3 expenses', () => {
    const entries = [spend(1, 100), spend(2, 200)];
    expect(computeInsight(entries, settings, customCats, 'zh')).toBeNull();
  });

  it('warns when over budget', () => {
    const entries = Array.from({ length: 5 }, (_, i) => spend(i + 1, 1200));
    const ins = computeInsight(entries, settings, customCats, 'zh')!;
    expect(ins.ic).toBe('🥀');
    expect(ins.text).toContain('花超');
  });

  it('warns when near budget (>=80%)', () => {
    const entries = Array.from({ length: 5 }, (_, i) => spend(i + 1, 900));
    const ins = computeInsight(entries, settings, customCats, 'zh')!;
    expect(ins.ic).toBe('🌼');
    expect(ins.text).toContain('%');
  });

  it('warns in english when over budget', () => {
    const entries = Array.from({ length: 5 }, (_, i) => spend(i + 1, 1200));
    const ins = computeInsight(entries, settings, customCats, 'en')!;
    expect(ins.text).toContain('Over budget');
  });

  it('warns in english when near budget', () => {
    const entries = Array.from({ length: 5 }, (_, i) => spend(i + 1, 900));
    const ins = computeInsight(entries, settings, customCats, 'en')!;
    expect(ins.text).toContain('budget');
  });

  it('falls back to top-category insight when within budget', () => {
    const entries = [
      spend(1, 100, 'food'), spend(2, 100, 'food'), spend(3, 100, 'food'),
      spend(4, 50, 'trans'),
    ];
    const s: Settings = { budget: 0, cycleStart: 1, theme: 'default', dark: false };
    const ins = computeInsight(entries, s, customCats, 'zh')!;
    expect(ins.ic).toBe('🔍');
    expect(ins.text).toContain('餐饮');
  });

  it('reports category budget breach', () => {
    const entries = [
      spend(1, 500, 'food'), spend(2, 500, 'food'), spend(3, 500, 'food'),
      spend(4, 50, 'trans'),
    ];
    const s: Settings = { budget: 0, cycleStart: 1, theme: 'default', dark: false, catBudgets: { food: 1000 } };
    const ins = computeInsight(entries, s, customCats, 'zh')!;
    expect(ins.ic).toBe('🪻');
    expect(ins.text).toContain('餐饮');
    expect(ins.text).toContain('超出');
  });

  it('reports category budget breach in en', () => {
    const entries = [
      spend(1, 500, 'food'), spend(2, 500, 'food'), spend(3, 500, 'food'),
      spend(4, 50, 'trans'),
    ];
    const s: Settings = { budget: 0, cycleStart: 1, theme: 'default', dark: false, catBudgets: { food: 1000 } };
    const ins = computeInsight(entries, s, customCats, 'en')!;
    expect(ins.text).toContain('Food');
    expect(ins.text).toContain('over');
  });
});
