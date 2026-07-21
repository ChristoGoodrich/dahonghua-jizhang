// Tag & ledger actions — labels and the multi-ledger switcher.
import type { Tags } from '@/domain/types';
import { store$ } from './state';

export function addTag(type: keyof Tags, name: string): void {
  const list = store$.tags[type].peek();
  if (!list.includes(name)) store$.tags[type].set([...list, name]);
}

export function removeTag(type: keyof Tags, name: string): void {
  store$.tags[type].set(store$.tags[type].peek().filter((g) => g !== name));
  if (type === 'ledger' && store$.curLedger.peek() === name) store$.curLedger.set('');
}

export function setCurLedger(ledger: string): void {
  store$.curLedger.set(ledger);
}

/** Archive/unarchive a ledger. Archived ledgers drop out of the filter bar and
 *  the record-sheet picker; entries already tagged with it keep the tag. If the
 *  active filter is the ledger being archived, reset to "all". */
export function archiveLedger(name: string, archived: boolean): void {
  const list = store$.settings.archivedLedgers.peek() ?? [];
  const next = archived ? (list.includes(name) ? list : [...list, name]) : list.filter((l) => l !== name);
  store$.settings.archivedLedgers.set(next.length ? next : undefined);
  if (archived && store$.curLedger.peek() === name) store$.curLedger.set('');
}
