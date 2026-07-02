// Net-worth actions — assets/liabilities and loans (borrow / lend).
import type { Asset, Loan } from '@/domain/types';
import { store$, newId } from './state';

export function addAsset(name: string, type: 'asset' | 'liab', val: number): Asset {
  const a: Asset = { id: newId('as'), name, type, val, noCount: false };
  store$.assets.set([...store$.assets.peek(), a]);
  return a;
}

export function removeAsset(id: string): void {
  store$.assets.set(store$.assets.peek().filter((a) => a.id !== id));
}

export function addLoan(who: string, type: 'lend' | 'borrow', amt: number): Loan {
  const l: Loan = { id: newId('ln'), who, type, amt, repaid: 0, ts: Date.now() };
  store$.loans.set([...store$.loans.peek(), l]);
  return l;
}

/** Record a repayment, clamped to the remaining balance. */
export function repayLoan(id: string, amount: number): void {
  store$.loans.set(
    store$.loans.peek().map((l) => {
      if (l.id !== id) return l;
      const remaining = Math.max(0, l.amt - (l.repaid ?? 0));
      return { ...l, repaid: (l.repaid ?? 0) + Math.min(amount, remaining) };
    }),
  );
}

export function removeLoan(id: string): void {
  store$.loans.set(store$.loans.peek().filter((l) => l.id !== id));
}
