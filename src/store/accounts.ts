// Account actions — create/delete money containers.
import type { Account, Entry } from '@/domain/types';
import { store$, newId, stampEntry } from './state';

export function addAccount(
  name: string,
  balance = 0,
  kind: Account['kind'] = 'cash',
  opts?: { statementDay?: number; dueDay?: number; fxCode?: string },
): Account {
  const a: Account = { id: newId('a'), name, nameEn: name, balance, kind };
  if (kind === 'credit') {
    if (opts?.statementDay) a.statementDay = opts.statementDay;
    if (opts?.dueDay) a.dueDay = opts.dueDay;
  }
  if (kind === 'fx') {
    if (opts?.fxCode) a.fxCode = opts.fxCode.toUpperCase();
  }
  store$.accounts.set([...store$.accounts.peek(), a]);
  return a;
}

/** Delete an account, migrating its transactions to default (ported from v7).
 *  The migration goes through stampEntry — an unstamped rewrite is invisible to
 *  the push watermark and loses the field-level merge, so other devices would
 *  keep pointing entries at the deleted account. Transfers TARGETING the
 *  account (acctTo) migrate too; v7 left them dangling. */
export function removeAccount(id: string): void {
  if (id === 'default') return;
  const now = Date.now();
  store$.data.set(
    store$.data.peek().map((d) => {
      const patch: Partial<Entry> = {};
      if (d.acct === id) patch.acct = 'default';
      if (d.acctTo === id) patch.acctTo = 'default';
      return Object.keys(patch).length ? stampEntry(d, patch, now) : d;
    }),
  );
  store$.accounts.set(store$.accounts.peek().filter((a) => a.id !== id));
  if (store$.curAccount.peek() === id) store$.curAccount.set('default');
}

/** Archive/unarchive an account. Archived accounts vanish from the record-sheet
 *  pickers but keep their transactions and balance; the default account can't be
 *  archived (it's the fallback every orphaned entry migrates to). */
export function archiveAccount(id: string, archived: boolean): void {
  if (id === 'default') return;
  store$.accounts.set(
    store$.accounts.peek().map((a) => (a.id === id ? { ...a, archived: archived || undefined } : a)),
  );
  // don't leave a just-archived account as the "current" default for new entries
  if (archived && store$.curAccount.peek() === id) store$.curAccount.set('default');
}
