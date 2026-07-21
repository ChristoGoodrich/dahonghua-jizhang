// Net worth — ported from v7's acctBalance / totalAccountBalance /
// loanRemaining / netWorthParts.
//
// net worth = sum(account balances) + sum(counted assets) - sum(liabilities)
//           + sum(remaining lent) - sum(remaining borrowed)
import type { Account, Asset, Entry, Loan } from './types';

/** Running balance of EVERY account in one pass over the ledger.
 *
 *  Prefer this whenever more than one account is needed: calling acctBalance in
 *  a loop re-scans the whole ledger per account, so the accounts screen and the
 *  net-worth card were O(accounts × entries) on every render.
 *
 *  Entries with no acct are attributed to the default account (matches v7).
 *  Pass `asOf` (epoch ms) to value balances at that instant (used by the
 *  credit-card statement math to value the balance at a statement close). */
export function acctBalances(accounts: Account[], data: Entry[], asOf?: number): Map<string, number> {
  const bal = new Map<string, number>();
  for (const a of accounts) bal.set(a.id, a.balance || 0);
  const add = (id: string, delta: number) => {
    const cur = bal.get(id);
    if (cur !== undefined) bal.set(id, cur + delta); // ignore entries on deleted accounts
  };
  for (const d of data) {
    if (d.deletedAt) continue;
    if (asOf != null && d.ts > asOf) continue;
    if (d.io === 'xfer') {
      // money moves between accounts; fee leaves the FROM, discount credits the TO
      if (d.acct) add(d.acct, -(d.amt + (d.fee ?? 0)));
      if (d.acctTo) add(d.acctTo, d.amt + (d.discount ?? 0));
      continue;
    }
    add(d.acct || 'default', d.io === 'inc' ? d.amt : -d.amt);
  }
  return bal;
}

/** Running balance of a single account. See acctBalances for the batch form. */
export function acctBalance(id: string, accounts: Account[], data: Entry[], asOf?: number): number {
  if (!accounts.some((x) => x.id === id)) return 0;
  return acctBalances(accounts, data, asOf).get(id) ?? 0;
}

export function totalAccountBalance(accounts: Account[], data: Entry[]): number {
  let sum = 0;
  for (const b of acctBalances(accounts, data).values()) sum += b;
  return sum;
}

export function loanRemaining(l: Loan): number {
  return Math.max(0, l.amt - (l.repaid ?? 0));
}

export interface NetWorthParts {
  asset: number;
  liab: number;
  net: number;
}

export function netWorthParts(
  accounts: Account[],
  data: Entry[],
  assets: Asset[],
  loans: Loan[],
): NetWorthParts {
  let assetSum = 0;
  let liabSum = 0;
  // transactional accounts: a 'credit' account in debt (negative balance) is a
  // liability; everything else (incl. an overpaid card) counts as an asset. Either
  // way net = sum of balances — the split only drives the assets/liabilities cards.
  const balances = acctBalances(accounts, data); // one pass, not one per account
  for (const a of accounts) {
    const b = balances.get(a.id) ?? 0;
    if (a.kind === 'credit' && b < 0) liabSum += -b;
    else assetSum += b;
  }
  for (const a of assets) {
    if (a.noCount) continue;
    if (a.type === 'liab') liabSum += a.val;
    else assetSum += a.val;
  }
  for (const l of loans) {
    const rem = loanRemaining(l);
    if (l.type === 'lend') assetSum += rem;
    else liabSum += rem;
  }
  return { asset: assetSum, liab: liabSum, net: assetSum - liabSum };
}
