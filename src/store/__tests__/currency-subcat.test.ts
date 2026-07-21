import {
  store$, setBaseCurrency, setRate, addRate, removeRate, updateRates,
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

// updateRates writes the numbers that multiply every foreign-currency amount, so
// a poisoned table silently misvalues the whole ledger. It was uncovered.
describe('updateRates', () => {
  const okResponse = (rates: Record<string, unknown>) => ({
    ok: true,
    json: async () => ({ rates }),
  });
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    store$.currencies.set({ base: 'CNY', rates: { USD: 1, JPY: 1 } });
  });

  it('inverts the API quote into "1 foreign = N base"', async () => {
    // the API returns base->foreign (1 CNY = 0.14 USD); we store the inverse
    fetchMock.mockResolvedValue(okResponse({ USD: 0.14, JPY: 21 }));
    await expect(updateRates()).resolves.toBe(true);
    const r = store$.currencies.rates.peek();
    expect(r.USD).toBeCloseTo(1 / 0.14, 4);
    expect(r.JPY).toBeCloseTo(1 / 21, 4);
  });

  it('does nothing when no currencies are tracked', async () => {
    store$.currencies.set({ base: 'CNY', rates: {} });
    await expect(updateRates()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the table untouched on a non-ok status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(updateRates()).resolves.toBe(false);
    expect(store$.currencies.rates.peek()).toEqual({ USD: 1, JPY: 1 });
  });

  it('leaves the table untouched when the network fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(updateRates()).resolves.toBe(false);
    expect(store$.currencies.rates.peek()).toEqual({ USD: 1, JPY: 1 });
  });

  it('rejects a response with no rates object', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(updateRates()).resolves.toBe(false);
    expect(store$.currencies.rates.peek()).toEqual({ USD: 1, JPY: 1 });
  });

  it('skips zero, negative and non-numeric quotes instead of poisoning the table', async () => {
    // 1/0 is Infinity and a negative rate would flip every converted amount
    fetchMock.mockResolvedValue(okResponse({ USD: 0, JPY: -5 }));
    await expect(updateRates()).resolves.toBe(false);
    expect(store$.currencies.rates.peek()).toEqual({ USD: 1, JPY: 1 });

    fetchMock.mockResolvedValue(okResponse({ USD: 'abc', JPY: null }));
    await expect(updateRates()).resolves.toBe(false);
    expect(store$.currencies.rates.peek()).toEqual({ USD: 1, JPY: 1 });
  });

  it('applies the good quotes and keeps the previous value for the bad ones', async () => {
    fetchMock.mockResolvedValue(okResponse({ USD: 0.14, JPY: 0 }));
    await expect(updateRates()).resolves.toBe(true);
    const r = store$.currencies.rates.peek();
    expect(r.USD).toBeCloseTo(1 / 0.14, 4);
    expect(r.JPY).toBe(1); // untouched, not Infinity
  });

  it('queries the API for the current base currency', async () => {
    store$.currencies.set({ base: 'AUD', rates: { USD: 1 } });
    fetchMock.mockResolvedValue(okResponse({ USD: 0.65 }));
    await updateRates();
    expect(fetchMock.mock.calls[0][0]).toContain('/latest/AUD');
  });
});
