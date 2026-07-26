import { store$, addAccount, removeAccount, archiveAccount } from '../ledger';

beforeEach(() => {
  store$.accounts.set([{ id: 'default', name: '默认', nameEn: 'Default', balance: 0 }]);
  store$.data.set([]);
  store$.curAccount.set('default');
});

describe('addAccount', () => {
  it('creates a cash account by default', () => {
    const a = addAccount('钱包');
    expect(a.kind).toBe('cash');
    expect(a.name).toBe('钱包');
    expect(a.balance).toBe(0);
    expect(store$.accounts.peek()).toHaveLength(2);
  });

  it('creates a credit card account with statement/due days', () => {
    const a = addAccount('招商', 0, 'credit', { statementDay: 5, dueDay: 25 });
    expect(a.kind).toBe('credit');
    expect(a.statementDay).toBe(5);
    expect(a.dueDay).toBe(25);
  });

  it('creates an fx account with uppercased currency code', () => {
    const a = addAccount('美元', 100, 'fx', { fxCode: 'usd' });
    expect(a.kind).toBe('fx');
    expect(a.fxCode).toBe('USD');
    expect(a.balance).toBe(100);
  });

  it('omits statementDay/dueDay when not provided for credit', () => {
    const a = addAccount('信用卡', 0, 'credit');
    expect(a.statementDay).toBeUndefined();
    expect(a.dueDay).toBeUndefined();
  });

  it('omits fxCode when not provided for fx', () => {
    const a = addAccount('外币', 0, 'fx');
    expect(a.fxCode).toBeUndefined();
  });

  it('gives each account a unique id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => addAccount('x').id));
    expect(ids.size).toBe(50);
  });
});

describe('removeAccount', () => {
  it('removes the targeted account', () => {
    const a = addAccount('A');
    addAccount('B');
    removeAccount(a.id);
    expect(store$.accounts.peek().map((x) => x.name)).toEqual(['默认', 'B']);
  });

  it('migrates transactions to default', () => {
    const a = addAccount('A');
    store$.data.set([{ id: 'e1', ts: 1, io: 'exp', cat: 'food', amt: 10, acct: a.id }]);
    removeAccount(a.id);
    expect(store$.data.peek()[0].acct).toBe('default');
  });

  it('resets curAccount to default if removing the current account', () => {
    const a = addAccount('A');
    store$.curAccount.set(a.id);
    removeAccount(a.id);
    expect(store$.curAccount.peek()).toBe('default');
  });

  it('refuses to remove the default account', () => {
    removeAccount('default');
    expect(store$.accounts.peek()).toHaveLength(1);
    expect(store$.accounts.peek()[0].id).toBe('default');
  });

  it('does not touch transactions of other accounts', () => {
    const a = addAccount('A');
    const b = addAccount('B');
    store$.data.set([
      { id: 'e1', ts: 1, io: 'exp', cat: 'food', amt: 10, acct: a.id },
      { id: 'e2', ts: 2, io: 'exp', cat: 'food', amt: 20, acct: b.id },
    ]);
    removeAccount(a.id);
    expect(store$.data.peek().find((d) => d.id === 'e2')!.acct).toBe(b.id);
  });
});

describe('archiveAccount', () => {
  it('archives an account', () => {
    const a = addAccount('A');
    archiveAccount(a.id, true);
    expect(store$.accounts.peek().find((x) => x.id === a.id)!.archived).toBe(true);
  });

  it('unarchives an account', () => {
    const a = addAccount('A');
    archiveAccount(a.id, true);
    archiveAccount(a.id, false);
    expect(store$.accounts.peek().find((x) => x.id === a.id)!.archived).toBeUndefined();
  });

  it('resets curAccount if archiving the current account', () => {
    const a = addAccount('A');
    store$.curAccount.set(a.id);
    archiveAccount(a.id, true);
    expect(store$.curAccount.peek()).toBe('default');
  });

  it('does not change curAccount if archiving a non-current account', () => {
    const a = addAccount('A');
    const b = addAccount('B');
    store$.curAccount.set(b.id);
    archiveAccount(a.id, true);
    expect(store$.curAccount.peek()).toBe(b.id);
  });

  it('refuses to archive the default account', () => {
    archiveAccount('default', true);
    expect(store$.accounts.peek()[0].archived).toBeUndefined();
  });
});
