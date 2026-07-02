// Quick-template actions — one-tap recurring entries.
import type { Template, Entry } from '@/domain/types';
import { store$, newId, addEntry } from './state';

export function addTemplate(tpl: Omit<Template, 'id'>): Template {
  const t: Template = { ...tpl, id: newId('t') };
  store$.templates.set([...store$.templates.peek(), t]);
  return t;
}

export function removeTemplate(id: string): void {
  store$.templates.set(store$.templates.peek().filter((t) => t.id !== id));
}

/** Instantly log an entry from a template (uses the current account/ledger). */
export function logTemplate(id: string): Entry | null {
  const tpl = store$.templates.peek().find((t) => t.id === id);
  if (!tpl) return null;
  return addEntry({
    io: tpl.io,
    cat: tpl.cat,
    amt: tpl.amt,
    note: tpl.note ?? '',
    acct: store$.curAccount.peek(),
    ledger: store$.curLedger.peek() || undefined,
  });
}
