// Net worth — ported from v7's acctBalance / totalAccountBalance /
// loanRemaining / netWorthParts.
//
// net worth = sum(account balances) + sum(counted assets) - sum(liabilities)
//           + sum(remaining lent) - sum(remaining borrowed)
import type { Account, Asset, Entry, Loan } from './types';

/** Running balance of an account: its starting balance +/- its entries.
 *  Entries with no acct are attributed to the default account (matches v7). */
export function acctBalance(id: string, accounts: Account[], data: Entry[]): number {
  const a = accounts.find((x) => x.id === id);
  if (!a) return 0;
  let bal = a.balance || 0;
  for (const d of data) {
    if (d.deletedAt) continue;
    if (d.io === 'xfer') {
      // money moves between accounts; fee leaves the FROM, discount credits the TO
      if (d.acct === id) bal -= d.amt + (d.fee ?? 0);
      if (d.acctTo === id) bal += d.amt + (d.discount ?? 0);
      continue;
    }
    if (d.acct === id || (!d.acct && id === 'default')) {
      bal += d.io === 'inc' ? d.amt : -d.amt;
    }
  }
  return bal;
}

export function totalAccountBalance(accounts: Account[], data: Entry[]): number {
  return accounts.reduce((s, a) => s + acctBalance(a.id, accounts, data), 0);
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
  for (const a of accounts) {
    const b = acctBalance(a.id, accounts, data);
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
