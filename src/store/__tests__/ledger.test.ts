import { store$, addEntry, addTransfer, updateEntry, removeEntry, runSubscriptions } from '../ledger';
import { importV7 } from '@/migrate/importV7';
import type { Entry } from '@/domain/types';

function reset() {
  store$.data.set([]);
  store$.curAccount.set('default');
  store$.settings.set({ budget: 0, cycleStart: 1, theme: 'default', dark: false });
}

beforeEach(reset);

describe('ledger actions', () => {
  it('adds an entry with generated id/ts and updates curAccount', () => {
    const e = addEntry({ io: 'exp', cat: 'food', amt: 32, acct: 'a1' });
    expect(e.id).toBeTruthy();
    expect(e.ts).toBeGreaterThan(0);
    expect(store$.data.peek()).toHaveLength(1);
    expect(store$.curAccount.peek()).toBe('a1');
  });

  it('addTransfer writes one xfer entry with from/to/fee/discount', () => {
    const e = addTransfer({ from: 'a', to: 'b', amt: 100, fee: 2, discount: 1, note: ' move ' });
    expect(e.io).toBe('xfer');
    expect(e.cat).toBe('transfer');
    expect(e.acct).toBe('a');
    expect(e.acctTo).toBe('b');
    expect(e.fee).toBe(2);
    expect(e.discount).toBe(1);
    expect(e.note).toBe('move');
    expect(e.updatedAt).toBeGreaterThan(0);
    expect(store$.data.peek()).toHaveLength(1);
    expect(store$.curAccount.peek()).toBe('a');
  });

  it('addTransfer omits zero fee/discount', () => {
    const e = addTransfer({ from: 'a', to: 'b', amt: 100 });
    expect(e.fee).toBeUndefined();
    expect(e.discount).toBeUndefined();
  });

  it('updates an existing entry', () => {
    const e = addEntry({ io: 'exp', cat: 'food', amt: 10 });
    updateEntry(e.id, { amt: 25, note: 'lunch' });
    const d = store$.data.peek()[0];
    expect(d.amt).toBe(25);
    expect(d.note).toBe('lunch');
  });

  it('removing a refund income tombstones it and restores the original refund counter', () => {
    const orig: Entry = { id: 'orig', ts: 1, io: 'exp', cat: 'food', amt: 100, refund: 30 };
    const ref: Entry = { id: 'ref', ts: 2, io: 'inc', cat: 'other', amt: 30, refundOf: 'orig' };
    store$.data.set([orig, ref]);
    removeEntry('ref');
    const left = store$.data.peek();
    // soft delete: the row stays as a tombstone (so the deletion can sync)
    expect(left.find((x) => x.id === 'ref')!.deletedAt).toBeTruthy();
    expect(left.find((x) => x.id === 'orig')!.refund).toBeUndefined(); // 30-30=0 -> cleared
  });

  it('removing an original expense also tombstones its linked refund incomes', () => {
    store$.data.set([
      { id: 'o2', ts: 1, io: 'exp', cat: 'food', amt: 50, refund: 10 },
      { id: 'r2', ts: 2, io: 'inc', cat: 'other', amt: 10, refundOf: 'o2' },
    ]);
    removeEntry('o2');
    const live = store$.data.peek().filter((d) => !d.deletedAt);
    expect(live).toHaveLength(0); // both hidden from the UI
    expect(store$.data.peek()).toHaveLength(2); // but both kept as tombstones
  });
});

describe('runSubscriptions — recurring transfers', () => {
  beforeEach(() => {
    store$.data.set([]);
    store$.subs.set([]);
    store$.accounts.set([
      { id: 'cash', name: 'Cash', balance: 0 },
      { id: 'save', name: 'Save', balance: 0 },
    ]);
  });

  it('posts an xfer entry for a transfer-kind sub', () => {
    store$.subs.set([
      {
        id: 's1', name: '每月存钱', emoji: '🔄', amt: 500, freq: 'monthly', day: 1,
        cat: 'transfer', kind: 'transfer', from: 'cash', to: 'save',
        created: new Date(2026, 0, 1).getTime(), lastCharged: '',
      },
    ]);
    const fired = runSubscriptions(new Date(2026, 2, 15));
    expect(fired.length).toBeGreaterThan(0);
    const xfers = store$.data.peek().filter((d) => d.io === 'xfer');
    expect(xfers.length).toBe(fired.length);
    expect(xfers[0]).toMatchObject({
      io: 'xfer', cat: 'transfer', amt: 500, acct: 'cash', acctTo: 'save', fromSub: true,
    });
  });

  it('still posts an expense for an expense-kind sub', () => {
    store$.subs.set([
      {
        id: 's2', name: 'Netflix', emoji: '🎬', amt: 30, freq: 'monthly', day: 1,
        cat: 'fun', created: new Date(2026, 0, 1).getTime(), lastCharged: '',
      },
    ]);
    runSubscriptions(new Date(2026, 2, 15));
    const exps = store$.data.peek().filter((d) => d.io === 'exp');
    expect(exps.length).toBeGreaterThan(0);
    expect(exps[0].acctTo).toBeUndefined();
    expect(exps[0].cat).toBe('fun');
  });

  it('an installment fires exactly `periods` charges total, then stops', () => {
    store$.subs.set([
      {
        id: 'i1', name: '手机分期', emoji: '📱', amt: 200, freq: 'monthly', day: 1,
        cat: 'shop', periods: 3, created: new Date(2026, 0, 1).getTime(), lastCharged: '',
      },
    ]);
    runSubscriptions(new Date(2027, 0, 1)); // ~12 due, but capped at 3
    expect(store$.data.peek().filter((d) => d.io === 'exp').length).toBe(3);
    expect(store$.subs.peek()[0].charged).toBe(3);
    // a later run adds nothing more
    runSubscriptions(new Date(2027, 6, 1));
    expect(store$.data.peek().filter((d) => d.io === 'exp').length).toBe(3);
  });
});

describe('importV7', () => {
  const backup = {
    app: 'dahonghua',
    version: 7,
    data: [
      { id: 'a', ts: 1, io: 'exp', cat: 'food', amt: 40 },
      { id: 'b', ts: 2, io: 'inc', cat: 'salary', amt: 100 },
    ],
    settings: { budget: 2000, cycleStart: 25, theme: 'sakura', passcode: '1234', passHash: 'x', passSalt: 'y' },
    accounts: [{ id: 'default', name: '默认', balance: 0 }],
    currencies: { base: 'USD', rates: { CNY: 0.14 } },
  };

  it('imports entries and computes net, stripping secrets', () => {
    const res = importV7(backup);
    expect(res.entries).toBe(2);
    expect(res.net).toBe(60); // 100 - 40
    expect(store$.data.peek()).toHaveLength(2);
    expect(store$.settings.peek().cycleStart).toBe(25);
    expect(store$.settings.peek().theme).toBe('sakura');
    // secrets must never be carried over
    expect((store$.settings.peek() as Record<string, unknown>).passcode).toBeUndefined();
    expect((store$.settings.peek() as Record<string, unknown>).passHash).toBeUndefined();
    expect(store$.currencies.peek().base).toBe('USD');
  });

  it('rejects a malformed backup', () => {
    expect(() => importV7({ nope: true })).toThrow();
  });
});
