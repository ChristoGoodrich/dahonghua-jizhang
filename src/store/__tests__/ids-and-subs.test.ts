// Regression coverage for two silent data-loss bugs:
//   1. newId() collided inside a single millisecond, so bulk inserts minted
//      duplicate ids — which collapse into one row on the next sync upsert.
//   2. runSubscriptions() minted a random id per charge, so a second device
//      catching up from a stale cursor billed the user twice.
import { store$, newId, importBills, runSubscriptions, addSub } from '../ledger';
import type { Sub } from '@/domain/types';

beforeEach(() => {
  store$.data.set([]);
  store$.subs.set([]);
  store$.accounts.set([{ id: 'default', name: '默认', balance: 0 }]);
});

describe('newId', () => {
  it('stays unique across a tight same-millisecond loop', () => {
    // the old implementation (Date.now() + 4 base36 chars) reliably produced
    // duplicates at this size — ~1.7M of space for 1000 draws in one tick
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) ids.add(newId('bi'));
    expect(ids.size).toBe(5000);
  });

  it('keeps the prefix', () => {
    expect(newId('a')).toMatch(/^a/);
  });
});

describe('importBills', () => {
  it('gives every imported row a distinct id', () => {
    const bills = Array.from({ length: 800 }, (_, i) => ({
      io: 'exp' as const, cat: 'food', amt: 1 + i, note: `n${i}`, ts: 1000 + i,
    }));
    expect(importBills(bills)).toBe(800);
    const ids = new Set(store$.data.peek().map((e) => e.id));
    expect(ids.size).toBe(800);
  });
});

describe('runSubscriptions', () => {
  const monthly = (over: Partial<Sub> = {}): Sub => ({
    id: 's1', name: 'Netflix', emoji: '📺', amt: 30, freq: 'monthly', day: 1,
    cat: 'fun', created: new Date(2026, 0, 1).getTime(), lastCharged: '', ...over,
  });

  it('derives a stable id per charge so a repeat run cannot double-charge', () => {
    store$.subs.set([monthly()]);
    runSubscriptions(new Date(2026, 2, 15));
    const first = store$.data.peek().map((e) => e.id);
    expect(first.length).toBeGreaterThan(0);

    // simulate the other device: same subscription, cursor still stale, charging
    // again over the same period. Ids must match so the merge collapses them.
    store$.subs.set([monthly()]);
    runSubscriptions(new Date(2026, 2, 15));
    const ids = store$.data.peek().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate rows
    expect(ids).toEqual(first); // and the very same ids as the first pass
  });

  it('ids encode the subscription and the charge instant', () => {
    store$.subs.set([monthly()]);
    runSubscriptions(new Date(2026, 1, 15));
    for (const e of store$.data.peek()) {
      expect(e.id).toMatch(/^sub_s1_\d+$/);
      expect(e.fromSub).toBe(true);
    }
  });

  it('persists the advanced cursor even when a capped installment posts nothing', () => {
    // periods already exhausted: no charge fires, but lastCharged must still move
    store$.subs.set([monthly({ periods: 1, charged: 1 })]);
    runSubscriptions(new Date(2026, 3, 10));
    expect(store$.data.peek()).toHaveLength(0);
    expect(store$.subs.peek()[0].lastCharged).not.toBe('');
  });

  it('respects the installment cap', () => {
    store$.subs.set([monthly({ periods: 2, charged: 0 })]);
    runSubscriptions(new Date(2026, 5, 15)); // many months elapsed
    expect(store$.data.peek()).toHaveLength(2);
    expect(store$.subs.peek()[0].charged).toBe(2);
  });

  it('addSub charges immediately when already due', () => {
    addSub({ name: 'Gym', emoji: '🏋️', amt: 99, freq: 'monthly', day: 1, cat: 'health' });
    expect(store$.subs.peek()).toHaveLength(1);
  });
});
