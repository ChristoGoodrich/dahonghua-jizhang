// Every mutation that writes entry fields must stamp a per-field timestamp.
//
// merge.ts only resolves a field by recency when BOTH sides carry a `fieldTs`
// entry for it. Without one it falls through to the deterministic content
// tiebreak, which compares serialized values — so a newer `rb:'done'` lost to an
// older `rb:'pending'` purely because "done" sorts before "pending", silently
// reverting a reimbursement mark. These tests pin the stamping at each mutation
// and then prove the merge outcome that depends on it.
import {
  store$, addEntry, updateEntry, removeEntry,
  toggleReimburse, confirmReimburse, unmarkReimburse, refundEntry,
} from '../ledger';
import { mergeById } from '@/sync/merge';
import type { Entry } from '@/domain/types';

const only = () => store$.data.peek()[0];

beforeEach(() => {
  store$.data.set([]);
  store$.customCats.set({ exp: [], inc: [], xfer: [] });
  store$.curAccount.set('default');
});

describe('stamping', () => {
  it('updateEntry stamps each patched field', () => {
    const e = addEntry({ io: 'exp', cat: 'food', amt: 10 });
    updateEntry(e.id, { amt: 20, note: 'x' });
    const ft = only().fieldTs!;
    expect(ft.amt).toBeGreaterThan(0);
    expect(ft.note).toBeGreaterThan(0);
    expect(ft.cat).toBeUndefined(); // untouched fields stay unstamped
  });

  it('toggleReimburse stamps rb in both directions', () => {
    const e = addEntry({ io: 'exp', cat: 'food', amt: 10 });
    toggleReimburse(e.id);
    expect(only().rb).toBe('pending');
    expect(only().fieldTs!.rb).toBeGreaterThan(0);

    toggleReimburse(e.id); // clearing is a stamped write too
    expect(only().rb).toBeUndefined();
    expect(only().fieldTs!.rb).toBeGreaterThan(0);
  });

  it('confirmReimburse stamps rb and rbAmt', () => {
    const e = addEntry({ io: 'exp', cat: 'food', amt: 42 });
    confirmReimburse(e.id);
    expect(only().rb).toBe('done');
    expect(only().rbAmt).toBe(42);
    expect(only().fieldTs!.rb).toBeGreaterThan(0);
    expect(only().fieldTs!.rbAmt).toBeGreaterThan(0);
  });

  it('unmarkReimburse stamps the clear', () => {
    const e = addEntry({ io: 'exp', cat: 'food', amt: 10 });
    confirmReimburse(e.id);
    unmarkReimburse(e.id);
    expect(only().rb).toBeUndefined();
    expect(only().rbAmt).toBeUndefined();
    expect(only().fieldTs!.rb).toBeGreaterThan(0);
  });

  it('refundEntry stamps refund on the original', () => {
    const e = addEntry({ io: 'exp', cat: 'food', amt: 100 });
    expect(refundEntry(e.id, 30, 'zh')).toBe(30);
    const orig = store$.data.peek().find((d) => d.id === e.id)!;
    expect(orig.refund).toBe(30);
    expect(orig.fieldTs!.refund).toBeGreaterThan(0);
  });

  it('removeEntry stamps the refund reversal it writes back', () => {
    const exp = addEntry({ io: 'exp', cat: 'food', amt: 100 });
    refundEntry(exp.id, 40, 'zh');
    const refundInc = store$.data.peek().find((d) => d.refundOf === exp.id)!;

    removeEntry(refundInc.id);

    const orig = store$.data.peek().find((d) => d.id === exp.id)!;
    expect(orig.refund).toBeUndefined(); // 40 given back, drops to 0 -> undefined
    expect(orig.fieldTs!.refund).toBeGreaterThan(0);
  });
});

describe('refundEntry clamping', () => {
  it('never refunds more than the outstanding amount', () => {
    const e = addEntry({ io: 'exp', cat: 'food', amt: 50 });
    expect(refundEntry(e.id, 999, 'zh')).toBe(50);
    expect(refundEntry(e.id, 10, 'zh')).toBe(0); // nothing left
    expect(store$.data.peek().find((d) => d.id === e.id)!.refund).toBe(50);
  });

  it('ignores a non-existent entry', () => {
    expect(refundEntry('nope', 10, 'zh')).toBe(0);
  });

  it('logs a linked income carrying the refund back to the account', () => {
    const e = addEntry({ io: 'exp', cat: 'food', amt: 80, acct: 'wallet' });
    refundEntry(e.id, 25, 'zh');
    const inc = store$.data.peek().find((d) => d.refundOf === e.id)!;
    expect(inc.io).toBe('inc');
    expect(inc.amt).toBe(25);
    expect(inc.acct).toBe('wallet');
  });
});

// The outcome the stamping exists for.
describe('merge outcome', () => {
  const stamped = (over: Partial<Entry>): Entry => ({
    id: 'e1', ts: 1, io: 'exp', cat: 'food', amt: 50, fieldTs: { amt: 1000 }, ...over,
  });

  it('a newer reimbursement mark survives a staler device', () => {
    // both carry fieldTs from an earlier edit, so field-level merge runs
    const local = stamped({ updatedAt: 2000, rb: 'done', fieldTs: { amt: 1000, rb: 2000 } });
    const remote = stamped({ updatedAt: 1000, rb: 'pending', fieldTs: { amt: 1000, rb: 1000 } });

    expect(mergeById([local], [remote]).merged[0].rb).toBe('done');
    // and the same the other way round, so it is recency and not ordering
    expect(mergeById([remote], [local]).merged[0].rb).toBe('done');
  });

  it('a newer CLEAR beats a stale device still holding a value', () => {
    const local = stamped({ updatedAt: 2000, rb: undefined, fieldTs: { amt: 1000, rb: 2000 } });
    const remote = stamped({ updatedAt: 1000, rb: 'pending', fieldTs: { amt: 1000, rb: 1000 } });

    expect(mergeById([local], [remote]).merged[0].rb).toBeUndefined();
  });

  it('unstamped rb would have gone the wrong way (documents the original bug)', () => {
    const local = stamped({ updatedAt: 2000, rb: 'done' });
    const remote = stamped({ updatedAt: 1000, rb: 'pending' });
    // "done" < "pending", so the content tiebreak picks the STALER value —
    // this is exactly what the stamping above prevents
    expect(mergeById([local], [remote]).merged[0].rb).toBe('pending');
  });
});
