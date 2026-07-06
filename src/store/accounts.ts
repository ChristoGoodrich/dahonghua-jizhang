// Account actions — create/delete money containers.
import type { Account } from '@/domain/types';
import { store$, newId } from './state';

export function addAccount(name: string, balance = 0, kind: Account['kind'] = 'cash'): Account {
  const a: Account = { id: newId('a'), name, nameEn: name, balance, kind };
  store$.accounts.set([...store$.accounts.peek(), a]);
  return a;
}

/** Delete an account, migrating its transactions to default (ported from v7). */
export function removeAccount(id: string): void {
  if (id === 'default') return;
  store$.data.set(store$.data.peek().map((d) => (d.acct === id ? { ...d, acct: 'default' } : d)));
  store$.accounts.set(store$.accounts.peek().filter((a) => a.id !== id));
  if (store$.curAccount.peek() === id) store$.curAccount.set('default');
}
