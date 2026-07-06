// Reimbursement & refund actions — mark claims pending/done and log refunds.
import type { Lang } from '@/i18n';
import { catOf, catName } from '@/domain/cats';
import { store$, newId } from './state';

export function toggleReimburse(id: string): void {
  const now = Date.now();
  store$.data.set(
    store$.data.peek().map((d) => {
      if (d.id !== id) return d;
      if (d.rb === 'pending') {
        const { rb, ...rest } = d;
        return { ...rest, updatedAt: now };
      }
      return { ...d, rb: 'pending' as const, updatedAt: now };
    }),
  );
}

export function confirmReimburse(id: string): void {
  const now = Date.now();
  store$.data.set(
    store$.data.peek().map((d) => (d.id === id ? { ...d, rb: 'done' as const, rbAmt: d.amt, updatedAt: now } : d)),
  );
}

export function unmarkReimburse(id: string): void {
  const now = Date.now();
  store$.data.set(
    store$.data.peek().map((d) => {
      if (d.id !== id) return d;
      const { rb, rbAmt, ...rest } = d;
      return { ...rest, updatedAt: now };
    }),
  );
}

/** Refund part/all of an expense: bumps its `refund` total and logs a linked
 *  income so balances reflect the money coming back (ported from v7). */
export function refundEntry(id: string, amount: number, lang: Lang): number {
  const list = store$.data.peek();
  const d = list.find((x) => x.id === id);
  if (!d) return 0;
  const already = d.refund ?? 0;
  const maxR = d.amt - already;
  const r = Math.min(amount, maxR);
  if (r <= 0) return 0;
  const now = Date.now();
  const c = catOf(d.io, d.cat, store$.customCats.peek());
  const note = (lang === 'zh' ? '退款·' : 'Refund·') + (d.note || catName(c, lang));
  const next = list.map((x) => (x.id === id ? { ...x, refund: already + r, updatedAt: now } : x));
  next.push({
    id: newId(),
    ts: now,
    io: 'inc',
    cat: 'other',
    amt: r,
    note,
    acct: d.acct || store$.curAccount.peek(),
    refundOf: id,
    updatedAt: now,
  });
  store$.data.set(next);
  return r;
}
