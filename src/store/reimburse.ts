// Reimbursement & refund actions — mark claims pending/done and log refunds.
import type { Lang } from '@/i18n';
import { catOf, catName } from '@/domain/cats';
import { store$, newId, stampEntry } from './state';

// All of these go through stampEntry: writing rb/rbAmt/refund without a per-field
// timestamp left them to merge.ts's content tiebreak, so marking an expense
// 已报销 on one device could be silently reverted to 待报销 by a staler one.

export function toggleReimburse(id: string): void {
  const now = Date.now();
  store$.data.set(
    store$.data.peek().map((d) => {
      if (d.id !== id) return d;
      // clearing is a stamped write too, so it beats a device still holding 'pending'
      return d.rb === 'pending'
        ? stampEntry(d, { rb: undefined }, now)
        : stampEntry(d, { rb: 'pending' }, now);
    }),
  );
}

export function confirmReimburse(id: string): void {
  const now = Date.now();
  store$.data.set(
    store$.data.peek().map((d) => (d.id === id ? stampEntry(d, { rb: 'done', rbAmt: d.amt }, now) : d)),
  );
}

export function unmarkReimburse(id: string): void {
  const now = Date.now();
  store$.data.set(
    store$.data.peek().map((d) => (d.id === id ? stampEntry(d, { rb: undefined, rbAmt: undefined }, now) : d)),
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
  const next = list.map((x) => (x.id === id ? stampEntry(x, { refund: already + r }, now) : x));
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
