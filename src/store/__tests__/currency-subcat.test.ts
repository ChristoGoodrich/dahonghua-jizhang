import {
  store$, setBaseCurrency, setRate, addRate, removeRate,
  addSubcat, removeSubcat,
} from '../ledger';

beforeEach(() => {
  store$.currencies.set({ base: 'CNY', rates: {} });
  store$.subcats.set({});
});

describe('currency actions', () => {
  it('sets the base currency', () => {
    setBaseCurrency('USD');
    expect(store$.currencies.base.peek()).toBe('USD');
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
