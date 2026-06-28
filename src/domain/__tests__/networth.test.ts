import { acctBalance, totalAccountBalance, loanRemaining, netWorthParts } from '../networth';
import type { Account, Asset, Entry, Loan } from '../types';

const accounts: Account[] = [
  { id: 'default', name: 'Cash', balance: 100 },
  { id: 'card', name: 'Card', balance: 0 },
];
const data: Entry[] = [
  { id: '1', ts: 1, io: 'exp', cat: 'food', amt: 30 }, // no acct -> default
  { id: '2', ts: 2, io: 'inc', cat: 'salary', amt: 200, acct: 'card' },
  { id: '3', ts: 3, io: 'exp', cat: 'shop', amt: 50, acct: 'card' },
  { id: '4', ts: 4, io: 'exp', cat: 'fun', amt: 999, acct: 'card', deletedAt: 5 }, // soft-deleted, ignored
];

describe('acctBalance', () => {
  it('attributes account-less entries to default', () => {
    expect(acctBalance('default', accounts, data)).toBe(70); // 100 - 30
  });
  it('sums an account and ignores soft-deleted entries', () => {
    expect(acctBalance('card', accounts, data)).toBe(150); // 0 + 200 - 50
  });
});

describe('totalAccountBalance', () => {
  it('adds all accounts', () => {
    expect(totalAccountBalance(accounts, data)).toBe(220); // 70 + 150
  });
});

describe('acctBalance with transfers', () => {
  const accts: Account[] = [
    { id: 'a', name: 'A', balance: 1000 },
    { id: 'b', name: 'B', balance: 0 },
  ];
  it('moves money from->to, fee charged to source, discount to dest', () => {
    const d: Entry[] = [
      { id: 't', ts: 1, io: 'xfer', cat: 'transfer', amt: 200, acct: 'a', acctTo: 'b', fee: 5, discount: 3 },
    ];
    expect(acctBalance('a', accts, d)).toBe(795); // 1000 - (200 + 5)
    expect(acctBalance('b', accts, d)).toBe(203); // 0 + (200 + 3)
  });
  it('a tombstoned transfer reverts both balances (Cookie 自动退回)', () => {
    const d: Entry[] = [
      { id: 't', ts: 1, io: 'xfer', cat: 'transfer', amt: 200, acct: 'a', acctTo: 'b', deletedAt: 9 },
    ];
    expect(acctBalance('a', accts, d)).toBe(1000);
    expect(acctBalance('b', accts, d)).toBe(0);
  });
  it('does not leak a transfer onto the account-less default rule', () => {
    const d: Entry[] = [{ id: 't', ts: 1, io: 'xfer', cat: 'transfer', amt: 50, acct: 'a', acctTo: 'b' }];
    expect(acctBalance('default', [{ id: 'default', name: 'D', balance: 10 }], d)).toBe(10);
  });
});

describe('loanRemaining', () => {
  it('is amount minus repaid, floored at 0', () => {
    expect(loanRemaining({ id: 'l', who: 'A', type: 'lend', amt: 100, repaid: 40, ts: 0 })).toBe(60);
    expect(loanRemaining({ id: 'l', who: 'A', type: 'lend', amt: 100, repaid: 200, ts: 0 })).toBe(0);
  });
});

describe('netWorthParts', () => {
  const assets: Asset[] = [
    { id: 'a', name: 'House', type: 'asset', val: 1000 },
    { id: 'b', name: 'Card debt', type: 'liab', val: 300 },
    { id: 'c', name: 'Excluded', type: 'asset', val: 9999, noCount: true },
  ];
  const loans: Loan[] = [
    { id: 'l1', who: 'A', type: 'lend', amt: 100, repaid: 40, ts: 0 }, // they owe me 60
    { id: 'l2', who: 'B', type: 'borrow', amt: 80, repaid: 0, ts: 0 }, // I owe 80
  ];

  it('combines accounts, assets, liabilities and loans', () => {
    const p = netWorthParts(accounts, data, assets, loans);
    // assets: 220 (accounts) + 1000 (house) + 60 (lent remaining) = 1280
    // liabs: 300 (card debt) + 80 (borrowed remaining) = 380
    expect(p.asset).toBe(1280);
    expect(p.liab).toBe(380);
    expect(p.net).toBe(900);
  });
});

describe('netWorthParts with transactional credit accounts', () => {
  it('counts a credit card in debt as a liability, not a negative asset', () => {
    const accts: Account[] = [
      { id: 'default', name: 'Cash', balance: 1000 },
      { id: 'visa', name: 'Visa', balance: 0, kind: 'credit' },
    ];
    const d: Entry[] = [{ id: 'e1', ts: 1, io: 'exp', cat: 'shop', amt: 300, acct: 'visa' }]; // visa -> -300
    const p = netWorthParts(accts, d, [], []);
    expect(p.asset).toBe(1000); // cash only
    expect(p.liab).toBe(300); // visa debt
    expect(p.net).toBe(700);
  });

  it('treats an overpaid credit account (positive balance) as an asset', () => {
    const accts: Account[] = [{ id: 'visa', name: 'Visa', balance: 0, kind: 'credit' }];
    const d: Entry[] = [{ id: 'e', ts: 1, io: 'inc', cat: 'other', amt: 50, acct: 'visa' }];
    const p = netWorthParts(accts, d, [], []);
    expect(p.asset).toBe(50);
    expect(p.liab).toBe(0);
  });

  it('a transfer that pays down a card moves debt without changing net worth', () => {
    const accts: Account[] = [
      { id: 'cash', name: 'Cash', balance: 500 },
      { id: 'visa', name: 'Visa', balance: -200, kind: 'credit' },
    ];
    const before = netWorthParts(accts, [], [], []);
    expect(before.net).toBe(300); // 500 - 200
    const d: Entry[] = [{ id: 't', ts: 1, io: 'xfer', cat: 'transfer', amt: 200, acct: 'cash', acctTo: 'visa' }];
    const after = netWorthParts(accts, d, [], []);
    expect(after.asset).toBe(300); // cash 500-200
    expect(after.liab).toBe(0); // visa -200+200 = 0
    expect(after.net).toBe(300); // unchanged
  });
});
