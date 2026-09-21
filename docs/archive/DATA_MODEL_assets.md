# Asset / Balance / Transfer model — gap analysis vs Cookie 记账

> **Status (2026-06-28): both gaps below are IMPLEMENTED & verified.** Gap A
> (transfers, `io:'xfer'`) and Gap B (`Account.kind`, credit accounts as
> liabilities) are shipped — see migration `0002_transfers.sql`, `networth.ts`,
> `RecordSheet.tsx`, `accounts.tsx`. This doc is kept as the design rationale.

> Scope: what the **transaction ↔ account-balance** relationship should be, judged
> against Cookie 记账 (observed live: deleting an entry auto-reverts related balances).
> **Finding: our derived-balance model is already correct.** The genuine gaps are
> (1) no **transfer** entry type and (2) no **transactional credit account** (a card
> whose derived balance counts as a liability). Everything here slots into the existing
> architecture: account/asset *definitions* in `profiles.config` JSONB; ledger
> row-per-entry in `public.entries`; soft-delete via `deletedAt`.

## 0. What already exists and is right ✅

`src/domain/networth.ts::acctBalance` already derives an account's balance as
`startingBalance + Σ signed entries, skipping deletedAt`. So:

- **Balances are derived, never stored** — the correct choice (sync-safe, edit-safe).
- **Delete auto-reverts** — a tombstoned entry drops out of the sum, exactly like
  Cookie's "相关金额自动退回". No change needed; we already match Cookie here.

Also intentionally fine and *ahead* of Cookie-Android: the separate **manual** `Asset`
(`type: asset|liab`, manual `val`, `noCount`) and `Loan` line items — these are
standalone net-worth entries (a house, a portfolio, a personal IOU) that are **not**
transactional. Keep them. Net worth already = derived account balances + manual assets
− manual liabilities + lent − borrowed (`netWorthParts`).

## 1. Gap A — add `transfer` (转账) as a first-class entry type

Cookie's 转账 moves money between two accounts, with an optional handling **fee**
(charged to the out account) and **discount** (credited to the in account), and is
**excluded from income/expense** by default. We can't represent "moved ¥1000 储蓄卡 →
信用卡 还款" today without faking it as expense+income.

Model it as **one** entry row (one row = one tombstone = clean LWW sync):

```ts
export type IO = 'exp' | 'inc' | 'xfer';   // + 'xfer'

export interface Entry {
  // …existing…
  io: IO;
  acct?: string;      // xfer: FROM account
  acctTo?: string;    // xfer: TO account
  fee?: number;       // xfer: handling fee, deducted from FROM (转出费用)
  discount?: number;  // xfer: bonus credited to TO   (转入优惠)
}
```

Extend the existing fold so transfers move balances and never touch income/expense
totals:

```ts
// networth.ts — acctBalance inner loop gains the xfer legs:
for (const d of data) {
  if (d.deletedAt) continue;
  if (d.io === 'xfer') {
    if (d.acct === id)   bal -= d.amt + (d.fee ?? 0);
    if (d.acctTo === id) bal += d.amt + (d.discount ?? 0);
  } else if (d.acct === id || (!d.acct && id === 'default')) {
    bal += d.io === 'inc' ? d.amt : -d.amt;
  }
}
```

Stats/budget/cycle reads must **skip `io === 'xfer'`** (a transfer is not spending or
income — matches Cookie's "转账不计入收支"). Audit every place that filters by
`io === 'exp'` / `'inc'`; xfer naturally falls through, but the cycle/stats sums that
iterate all entries need an explicit `if (e.io === 'xfer') continue;`.

New store action `addTransfer({from, to, amt, fee, discount, note, ts})` writing one
`io:'xfer'` entry, stamped with `updatedAt` like every other mutation. The record sheet
gets a third tab (支出 / 收入 / **转账**) with from/to account pickers + fee/discount.

## 2. Gap B — transactional credit accounts (信用账户)

Cookie folds credit cards **into the account list** (信用账户): you spend on the card,
its derived balance goes negative (debt), and that debt counts on the liability side of
net worth. Today `Account` has no kind and `totalAccountBalance` adds **every** account
balance to the asset side — a credit card can't be a transactional liability.

Minimal change: give `Account` an optional kind, default cash.

```ts
export interface Account {
  id: string;
  name: string;
  nameEn?: string;
  balance: number;                 // opening balance (credit card: usually 0)
  kind?: 'cash' | 'credit' | 'prepaid';  // default 'cash'
}
```

Then split account balances by kind in `netWorthParts` instead of dumping all into
`assetSum`:

```ts
for (const a of accounts) {
  const b = acctBalance(a.id, accounts, data);
  if (a.kind === 'credit') liabSum += Math.max(0, -b); // owed shows as liability
  else                     assetSum += b;
}
```

This unifies the two Cookie cases (a card you actively use = transactional `Account`
with `kind:'credit'`; a static debt like a mortgage = manual `Asset{type:'liab'}`),
without disturbing the manual `Asset`/`Loan` paths.

## 3. SQL migration (additive, sync-safe)

```sql
-- 0002_transfers.sql
alter table public.entries drop constraint if exists entries_io_check;
alter table public.entries add constraint entries_io_check
  check (io in ('exp','inc','xfer'));
alter table public.entries add column if not exists acct_to  text;
alter table public.entries add column if not exists fee      numeric;
alter table public.entries add column if not exists discount numeric;
```

Account/Asset definitions stay in `profiles.config` (no new table) — config, edited
rarely, single-user LWW is fine. `Account.kind` is just a new field in that blob.
`src/sync/rows.ts` Entry↔DbEntry mapping gains `acctTo`/`fee`/`discount` (add roundtrip
tests alongside the existing 4).

## 4. Deliberately unchanged

Budgets / catBudgets, subscriptions, templates, reimbursement, refunds, loans, lock —
already present and at/ahead of Cookie-Android. Category sub-hierarchy + per-category
quick-notes (Cookie keeps 子分类 and 快捷备注 under each category) is a separate
follow-up, not part of the asset/transfer model.
