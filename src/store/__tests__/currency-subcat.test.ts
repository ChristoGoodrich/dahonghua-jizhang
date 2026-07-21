import {
  store$, setBaseCurrency, setRate, addRate, removeRate,
  addSubcat, removeSubcat,
} from '../ledger';

beforeEach(() => {
  store$.currencies.set({ base: 'CNY', rates: {} });
  store$.subcats.set({});
  store$.data.set([]);
  store$.accounts.set([{ id: 'default', name: '默认', balance: 0 }]);
  store$.settings.assign({ budget: 0 });
});

describe('currency actions', () => {
  it('refuses to switch base without a rate, leaving the ledger untouched', () => {
    store$.data.set([{ id: 'e1', ts: 1, io: 'exp', cat: 'food', amt: 720 }]);
    // switching with no rate used to silently relabel ¥720 as $720
    expect(setBaseCurrency('USD')).toBe('no-rate');
    expect(store$.currencies.base.peek()).toBe('CNY');
    expect(store$.data.peek()[0].amt).toBe(720);
  });

  it('re-denominates entries, accounts and budgets when the base switches', () => {
    store$.currencies.set({ base: 'CNY', rates: { USD: 7.2 } });
    store$.data.set([{ id: 'e1', ts: 1, io: 'exp', cat: 'food', amt: 720 }]);
    store$.accounts.set([{ id: 'default', name: '默认', balance: 1440 }]);
    store$.settings.assign({ budget: 3600 });

    expect(setBaseCurrency('USD')).toBe('ok');
    expect(store$.currencies.base.peek()).toBe('USD');
    expect(store$.data.peek()[0].amt).toBe(100);
    expect(store$.accounts.peek()[0].balance).toBe(200);
    expect(store$.settings.budget.peek()).toBe(500);
    // the table re-anchors: USD leaves it, the old base joins at the inverse rate
    expect(store$.currencies.rates.peek()).toEqual({ CNY: +(1 / 7.2).toFixed(6) });
  });

  it('round-trips an entry that was originally typed in the incoming currency', () => {
    store$.currencies.set({ base: 'CNY', rates: { USD: 7.2 } });
    store$.data.set([{ id: 'e1', ts: 1, io: 'exp', cat: 'food', amt: 71.99, cur: 'USD', origAmt: 9.99 }]);

    expect(setBaseCurrency('USD')).toBe('ok');
    const e = store$.data.peek()[0];
    expect(e.amt).toBe(9.99); // exact, not 71.99/7.2
    expect(e.cur).toBeUndefined(); // no longer foreign
    expect(e.origAmt).toBeUndefined();
  });

  it('reports a no-op switch to the current base', () => {
    expect(setBaseCurrency('CNY')).toBe('same');
  });

  it('adds a currency (default rate 1), edits, and removes it', () => {
    addRate('USD');
    expect(store$.currencies.rates.peek()).toEqual({ USD: 1 });
    addRate('USD'); // dup ignored
    expect(Object.keys(store$.currencies.rates.peek())).toHaveLength(1);
    setRate('USD', 7.2);
    expect(store$.currencies.rates.peek().USD).toBe(7.2);
    removeRate('USD');
    expect(store$.currencies.rates.peek()).toEqual({});
  });
});

describe('subcategory actions', () => {
  it('adds and removes subcategories per category', () => {
    addSubcat('food', '早餐');
    addSubcat('food', '午餐');
    expect(store$.subcats.peek().food.map((s) => s.name)).toEqual(['早餐', '午餐']);
    const k = store$.subcats.peek().food[0].k;
    removeSubcat('food', k);
    expect(store$.subcats.peek().food.map((s) => s.name)).toEqual(['午餐']);
  });
});
