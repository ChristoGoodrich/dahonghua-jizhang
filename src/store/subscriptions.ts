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
  // a fully-charged installment advances lastCharged without posting anything;
  // that cursor still has to be persisted or it is recomputed on every boot
  let cursorMoved = false;
  const nextSubs = subs.map((sub) => {
    const { charges, lastCharged } = computeDueCharges(sub, now);
    if (!charges.length) return sub;
    // installment cap: never fire more than `periods` charges in total
    let toApply = charges;
    if (sub.periods && sub.periods > 0) {
      const remaining = Math.max(0, sub.periods - (sub.charged ?? 0));
      toApply = charges.slice(0, remaining);
    }
    if (!toApply.length) {
      cursorMoved = true; // still commit the advanced cursor (see `changed` below)
      return { ...sub, lastCharged };
    }
    changed = true;
    for (const ts of toApply) {
      // Deterministic id per (subscription, charge instant) instead of a random
      // one. hydrate() runs runSubscriptions() at boot, racing the initial cloud
      // pull, so a second device charges from its own stale `lastCharged` before
      // it ever sees that the first device already did. With random ids both
      // charges survive the merge and the user is billed twice; with a derived
      // id they are the same row and collapse into one.
      const id = `sub_${sub.id}_${ts}`;
      if (data.some((d) => d.id === id)) continue; // already charged locally
      if (sub.kind === 'transfer' && sub.from && sub.to) {
        data.push({ id, ts, io: 'xfer', cat: 'transfer', amt: sub.amt, acct: sub.from, acctTo: sub.to, note: sub.name, fromSub: true, updatedAt: Date.now() });
      } else {
        data.push({ id, ts, io: 'exp', cat: sub.cat || 'home', amt: sub.amt, note: sub.name, fromSub: true, updatedAt: Date.now() });
      }
      fired.push(sub.name);
    }
    return { ...sub, lastCharged, ...(sub.periods ? { charged: (sub.charged ?? 0) + toApply.length } : {}) };
  });
  if (changed) store$.data.set(data);
  if (changed || cursorMoved) store$.subs.set(nextSubs);
  return fired;
}
