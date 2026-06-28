import { entryToRow, rowToEntry } from '../rows';
import type { Entry } from '@/domain/types';

describe('entry <-> row mapping', () => {
  it('round-trips a full entry losslessly', () => {
    const e: Entry = {
      id: 'x1', ts: 1717000000000, io: 'exp', cat: 'food', subcat: 'sc1', amt: 48.5,
      cur: 'USD', origAmt: 6.7, note: '叮咚买菜', acct: 'card', tags: ['旅行'], ledger: '家庭',
      rb: 'pending', rbAmt: 48.5, refund: 10, refundOf: 'y2', fromSub: true,
      deletedAt: null, updatedAt: 1717000001000,
    };
    const back = rowToEntry(entryToRow(e, 'user-1'));
    // null deletedAt becomes absent (optional); everything else round-trips
    const { deletedAt, ...rest } = e;
    expect(back).toEqual(rest);
  });

  it('maps a minimal entry and stamps user_id', () => {
    const e: Entry = { id: 'm', ts: 5, io: 'inc', cat: 'salary', amt: 100, updatedAt: 7 };
    const row = entryToRow(e, 'user-2');
    expect(row.user_id).toBe('user-2');
    expect(row.updated_at).toBe(7);
    expect(row.note).toBeNull();
    expect(rowToEntry(row)).toEqual(e);
  });

  it('falls back updated_at to ts when missing', () => {
    const e: Entry = { id: 'n', ts: 42, io: 'exp', cat: 'food', amt: 1 };
    expect(entryToRow(e, 'u').updated_at).toBe(42);
  });

  it('preserves a soft-delete tombstone', () => {
    const e: Entry = { id: 'd', ts: 1, io: 'exp', cat: 'food', amt: 1, deletedAt: 999, updatedAt: 999 };
    expect(rowToEntry(entryToRow(e, 'u')).deletedAt).toBe(999);
  });

  it('round-trips a transfer entry (acctTo/fee/discount)', () => {
    const e: Entry = {
      id: 'x', ts: 1, io: 'xfer', cat: 'transfer', amt: 200,
      acct: 'a', acctTo: 'b', fee: 5, discount: 3, note: '还款', ledger: '家庭', updatedAt: 2,
    };
    expect(rowToEntry(entryToRow(e, 'u'))).toEqual(e);
  });
});
