// assets.ts was at 0% coverage — every net-worth figure outside the ledger
// (assets, liabilities, money lent and borrowed) is written here.
import { store$, addAsset, removeAsset, addLoan, repayLoan, removeLoan } from '../ledger';
import { loanRemaining, netWorthParts } from '@/domain/networth';

beforeEach(() => {
  store$.assets.set([]);
  store$.loans.set([]);
  store$.data.set([]);
  store$.accounts.set([{ id: 'default', name: '默认', balance: 0 }]);
});

describe('assets', () => {
  it('adds an asset counted toward net worth by default', () => {
    const a = addAsset('房子', 'asset', 100);
    expect(a.noCount).toBe(false);
    expect(store$.assets.peek()).toHaveLength(1);
  });

  it('adds a liability', () => {
    addAsset('房贷', 'liab', 60);
    expect(store$.assets.peek()[0].type).toBe('liab');
  });

  it('gives each asset a distinct id', () => {
    const ids = new Set(Array.from({ length: 200 }, (_, i) => addAsset('a' + i, 'asset', 1).id));
    expect(ids.size).toBe(200);
  });

  it('removes only the targeted asset', () => {
    const a = addAsset('A', 'asset', 1);
    addAsset('B', 'asset', 2);
    removeAsset(a.id);
    expect(store$.assets.peek().map((x) => x.name)).toEqual(['B']);
  });

  it('ignores a remove for an unknown id', () => {
    addAsset('A', 'asset', 1);
    removeAsset('nope');
    expect(store$.assets.peek()).toHaveLength(1);
  });
});

describe('loans', () => {
  it('starts a loan fully outstanding', () => {
    const l = addLoan('小明', 'lend', 500);
    expect(l.repaid).toBe(0);
    expect(loanRemaining(l)).toBe(500);
  });

  it('accumulates repayments', () => {
    const l = addLoan('小明', 'lend', 500);
    repayLoan(l.id, 200);
    repayLoan(l.id, 100);
    expect(store$.loans.peek()[0].repaid).toBe(300);
    expect(loanRemaining(store$.loans.peek()[0])).toBe(200);
  });

  it('clamps an overpayment to the outstanding balance', () => {
    const l = addLoan('小明', 'borrow', 100);
    repayLoan(l.id, 999);
    expect(store$.loans.peek()[0].repaid).toBe(100); // not 999
    expect(loanRemaining(store$.loans.peek()[0])).toBe(0);
  });

  it('stays settled once fully repaid', () => {
    const l = addLoan('小明', 'lend', 100);
    repayLoan(l.id, 100);
    repayLoan(l.id, 50); // nothing left to repay
    expect(store$.loans.peek()[0].repaid).toBe(100);
  });

  it('only touches the targeted loan', () => {
    const a = addLoan('A', 'lend', 100);
    const b = addLoan('B', 'borrow', 100);
    repayLoan(a.id, 40);
    expect(store$.loans.peek().find((l) => l.id === b.id)!.repaid).toBe(0);
  });

  it('removes a loan', () => {
    const l = addLoan('A', 'lend', 100);
    removeLoan(l.id);
    expect(store$.loans.peek()).toHaveLength(0);
  });
});

describe('net-worth integration', () => {
  it('splits assets, liabilities and both loan directions', () => {
    addAsset('房子', 'asset', 1000);
    addAsset('房贷', 'liab', 400);
    addLoan('借出', 'lend', 100); // they owe me -> asset
    addLoan('借入', 'borrow', 50); // I owe them -> liability

    const p = netWorthParts(store$.accounts.peek(), [], store$.assets.peek(), store$.loans.peek());
    expect(p.asset).toBe(1100);
    expect(p.liab).toBe(450);
    expect(p.net).toBe(650);
  });

  it('a repayment shrinks the outstanding side of net worth', () => {
    const l = addLoan('借出', 'lend', 100);
    repayLoan(l.id, 60);
    const p = netWorthParts(store$.accounts.peek(), [], [], store$.loans.peek());
    expect(p.asset).toBe(40);
  });

  it('excludes a noCount asset from the total', () => {
    const a = addAsset('不计入', 'asset', 999);
    store$.assets.set(store$.assets.peek().map((x) => (x.id === a.id ? { ...x, noCount: true } : x)));
    const p = netWorthParts(store$.accounts.peek(), [], store$.assets.peek(), []);
    expect(p.asset).toBe(0);
  });
});
