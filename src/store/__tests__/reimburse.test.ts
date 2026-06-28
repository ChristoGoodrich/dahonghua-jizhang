import {
  store$, addEntry, refundEntry, removeEntry,
  toggleReimburse, confirmReimburse, runSubscriptions,
} from '../ledger';
import type { Sub } from '@/domain/types';

beforeEach(() => {
  store$.data.set([]);
  store$.subs.set([]);
  store$.curAccount.set('default');
});

describe('refundEntry', () => {
  it('bumps refund total and logs a linked income', () => {
    const e = addEntry({ io: 'exp', cat: 'food', amt: 100 });
    const r = refundEntry(e.id, 30, 'en');
    expect(r).toBe(30);
    const data = store$.data.peek();
    const orig = data.find((d) => d.id === e.id)!;
    expect(orig.refund).toBe(30);
    const income = data.find((d) => d.refundOf === e.id)!;
    expect(income.io).toBe('inc');
    expect(income.amt).toBe(30);
  });

  it('clamps the refund to the remaining refundable amount', () => {
    const e = addEntry({ io: 'exp', cat: 'food', amt: 50 });
    refundEntry(e.id, 40, 'en');
    const second = refundEntry(e.id, 999, 'en'); // only 10 left
    expect(second).toBe(10);
    expect(store$.data.peek().find((d) => d.id === e.id)!.refund).toBe(50);
  });

  it('removeEntry on the income reverses the original refund counter', () => {
    const e = addEntry({ io: 'exp', cat: 'food', amt: 100 });
    refundEntry(e.id, 30, 'en');
    const income = store$.data.peek().find((d) => d.refundOf === e.id)!;
    removeEntry(income.id);
    expect(store$.data.peek().find((d) => d.id === e.id)!.refund).toBeUndefined();
  });
});

describe('reimbursement', () => {
  it('toggles pending then confirms with rbAmt', () => {
    const e = addEntry({ io: 'exp', cat: 'food', amt: 80 });
    toggleReimburse(e.id);
    expect(store$.data.peek().find((d) => d.id === e.id)!.rb).toBe('pending');
    confirmReimburse(e.id);
    const d = store$.data.peek().find((x) => x.id === e.id)!;
    expect(d.rb).toBe('done');
    expect(d.rbAmt).toBe(80);
  });
});

describe('runSubscriptions', () => {
  it('logs catch-up charges and advances lastCharged', () => {
    const sub: Sub = {
      id: 's1', name: 'Netflix', emoji: '🔁', amt: 30, freq: 'monthly', day: 15,
      cat: 'fun', created: new Date(2026, 0, 1).getTime(), lastCharged: '2026-0-15',
    };
    store$.subs.set([sub]);
    const fired = runSubscriptions(new Date(2026, 3, 20)); // Feb/Mar/Apr 15
    expect(fired).toHaveLength(3);
    const subEntries = store$.data.peek().filter((d) => d.fromSub);
    expect(subEntries).toHaveLength(3);
    expect(subEntries.every((d) => d.amt === 30 && d.cat === 'fun')).toBe(true);
    expect(store$.subs.peek()[0].lastCharged).toBe('2026-3-15');
  });

  it('is a no-op when nothing is due', () => {
    store$.subs.set([{ id: 's2', name: 'X', emoji: '🔁', amt: 10, freq: 'monthly', day: 15, cat: 'home', created: Date.now(), lastCharged: '2026-3-15' }]);
    expect(runSubscriptions(new Date(2026, 3, 20))).toHaveLength(0);
    expect(store$.data.peek().filter((d) => d.fromSub)).toHaveLength(0);
  });
});
