// Archiving — declutter the "new entry" pickers without touching history.
//
// Archiving an account (a cancelled card, a used-up prepaid) or a ledger (a
// finished trip/project) removes it from the record-sheet pickers and the home
// ledger filter, but every past entry keeps its account/ledger and every
// balance still counts. It is purely a "don't offer this for NEW entries" flag,
// so it is always reversible and never rewrites data.
import type { Account } from './types';

/** Accounts offered for a new entry: the active ones, plus any id in `keepIds`
 *  (the currently-selected account, so editing an old entry on an archived
 *  account still shows it selected). Original order preserved. */
export function pickerAccounts(accounts: Account[], keepIds: (string | undefined)[] = []): Account[] {
  const keep = new Set(keepIds.filter((x): x is string => !!x));
  return accounts.filter((a) => !a.archived || keep.has(a.id));
}

/** Accounts shown in the archived section of the accounts screen. */
export function archivedAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => !!a.archived);
}

/** Ledgers offered in the filter bar / record sheet: active ones plus `keep`
 *  (the currently-applied filter or the entry's own ledger). */
export function pickerLedgers(ledgers: string[], archived: string[] = [], keep = ''): string[] {
  return ledgers.filter((l) => !archived.includes(l) || l === keep);
}

/** Ledgers currently archived, in their original order. */
export function archivedLedgers(ledgers: string[], archived: string[] = []): string[] {
  return ledgers.filter((l) => archived.includes(l));
}
