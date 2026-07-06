// Subscription actions — recurring charges that auto-post entries when due.
import type { Sub } from '@/domain/types';
import { computeDueCharges } from '@/domain/subscriptions';
import { store$, newId } from './state';

export function addSub(sub: Omit<Sub, 'id' | 'created' | 'lastCharged'>): Sub {
  const s: Sub = { ...sub, id: newId('s'), created: Date.now(), lastCharged: '' };
  store$.subs.set([...store$.subs.peek(), s]);
  runSubscriptions(); // charge immediately if already due today
  return s;
}

export function removeSub(id: string): void {
  store$.subs.set(store$.subs.peek().filter((s) => s.id !== id));
}

/** Apply any due subscription charges. Returns the names that fired. */
export function runSubscriptions(now: Date = new Date()): string[] {
  const subs = store$.subs.peek();
  if (!subs.length) return [];
  const data = [...store$.data.peek()];
  const fired: string[] = [];
  let changed = false;
  const nextSubs = subs.map((sub) => {
    const { charges, lastCharged } = computeDueCharges(sub, now);
    if (!charges.length) return sub;
    // installment cap: never fire more than `periods` charges in total
    let toApply = charges;
    if (sub.periods && sub.periods > 0) {
      const remaining = Math.max(0, sub.periods - (sub.charged ?? 0));
      toApply = charges.slice(0, remaining);
    }
    if (!toApply.length) return { ...sub, lastCharged }; // advance the cursor, charge nothing
    changed = true;
    for (const ts of toApply) {
      if (sub.kind === 'transfer' && sub.from && sub.to) {
        data.push({ id: newId('sub'), ts, io: 'xfer', cat: 'transfer', amt: sub.amt, acct: sub.from, acctTo: sub.to, note: sub.name, fromSub: true, updatedAt: Date.now() });
      } else {
        data.push({ id: newId('sub'), ts, io: 'exp', cat: sub.cat || 'home', amt: sub.amt, note: sub.name, fromSub: true, updatedAt: Date.now() });
      }
      fired.push(sub.name);
    }
    return { ...sub, lastCharged, ...(sub.periods ? { charged: (sub.charged ?? 0) + toApply.length } : {}) };
  });
  if (changed) {
    store$.data.set(data);
    store$.subs.set(nextSubs);
  }
  return fired;
}
