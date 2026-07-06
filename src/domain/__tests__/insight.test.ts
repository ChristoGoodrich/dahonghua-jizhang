import { creditDueInsight } from '../insight';
import type { Account, Entry } from '../types';

const card: Account = { id: 'c1', name: '招商', nameEn: 'CMB', balance: 0, kind: 'credit', statementDay: 5, dueDay: 25 };
const accounts: Account[] = [{ id: 'default', name: '现金', balance: 0 }, card];
const spend = (day: number, amt: number): Entry => ({ id: 's' + day, ts: new Date(2026, 0, day).getTime(), io: 'exp', cat: 'shop', amt, acct: 'c1' });

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
});
