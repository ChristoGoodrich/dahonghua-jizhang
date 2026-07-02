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
