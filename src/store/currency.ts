// Multi-currency actions — base currency, per-code rates, and rate refresh.
import { store$ } from './state';

export function setBaseCurrency(code: string): void {
  store$.currencies.base.set(code);
}

export function setRate(code: string, rate: number): void {
  store$.currencies.rates.set({ ...store$.currencies.rates.peek(), [code]: rate });
}

export function addRate(code: string): void {
  const rates = store$.currencies.rates.peek();
  if (!rates[code]) store$.currencies.rates.set({ ...rates, [code]: 1 });
}

export function removeRate(code: string): void {
  const rates = { ...store$.currencies.rates.peek() };
  delete rates[code];
  store$.currencies.rates.set(rates);
}

/** Refresh rates from a free exchange-rate API (1 foreign = ? base). */
export async function updateRates(): Promise<boolean> {
  const base = store$.currencies.base.peek() || 'CNY';
  const codes = Object.keys(store$.currencies.rates.peek());
  if (!codes.length) return false;
  try {
    const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${base}`);
    const j = await res.json();
    const rates = { ...store$.currencies.rates.peek() };
    codes.forEach((c) => {
      if (j.rates && j.rates[c]) rates[c] = +(1 / j.rates[c]).toFixed(4);
    });
    store$.currencies.rates.set(rates);
    return true;
  } catch {
    return false;
  }
}
