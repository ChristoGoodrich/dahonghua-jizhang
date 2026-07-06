// Credit-card statement cycle — inspired by Cookie 记账's 信用卡账单周期 (出账日 /
// 还款日 / 本期待还 / 未出账 / 溢缴款). A credit `Account` optionally carries a
// `statementDay` (the day each month its statement closes) and a `dueDay` (the
// day payment is due). From those + the account's transactions we derive what
// the last statement billed, what's been charged since, and when it's due.
//
// All pure and date-driven so the cycle math is unit-testable. Balances come
// from networth.ts::acctBalance (negative = debt for a credit card).
import type { Account, Entry } from './types';
import { acctBalance } from './networth';

const DAY_MS = 86_400_000;

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}
/** Clamp a day-of-month to a month's real length (e.g. a 31 statement day in Feb). */
function clampDay(day: number, year: number, month: number): number {
  return Math.min(Math.max(1, day), daysInMonth(year, month));
}
function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * The most recent statement-close instant at or before `ref`, as epoch ms at the
 * END of the close day (23:59:59.999) so transactions dated that day are billed.
 * If ref's day-of-month is on/after the statement day the statement closed this
 * month, otherwise last month.
 */
export function lastStatementClose(statementDay: number, ref: number): number {
  const r = new Date(ref);
  let year = r.getFullYear();
  let month = r.getMonth();
  if (r.getDate() < clampDay(statementDay, year, month)) {
    month -= 1;
    if (month < 0) { month = 11; year -= 1; }
  }
  const day = clampDay(statementDay, year, month);
  return new Date(year, month, day, 23, 59, 59, 999).getTime();
}

/**
 * The payment due date for the statement that closed at `closeMs`. If the due
 * day is after the statement day the payment falls in the same month as the
 * close; otherwise the following month. Returned as epoch ms at 00:00 of the
 * due day.
 */
export function dueDateFor(closeMs: number, statementDay: number, dueDay: number): number {
  const c = new Date(closeMs);
  let year = c.getFullYear();
  let month = c.getMonth();
  if (dueDay <= statementDay) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return new Date(year, month, clampDay(dueDay, year, month)).getTime();
}

export interface StatementSummary {
  statementClose: number; // 出账日 (epoch ms, end of close day)
  billedDue: number; // 本期待还: debt owed as of the last statement close (≥0)
  overpay: number; // 溢缴款: credit balance as of the last close (≥0)
  unbilled: number; // 未出账: net new charges since the close (≥0)
  currentDebt: number; // 待还: total debt right now (≥0)
  dueDate: number | null; // 还款日 (epoch ms), null if no dueDay set
  daysToDue: number | null; // whole days from today to the due date (may be <0 if overdue)
}

/**
 * Summarize a credit account's current statement cycle. Returns null unless the
 * account is a credit card with a `statementDay` configured.
 */
export function statementSummary(
  account: Account,
  accounts: Account[],
  entries: Entry[],
  ref: number = Date.now(),
): StatementSummary | null {
  if (account.kind !== 'credit' || !account.statementDay) return null;
  const close = lastStatementClose(account.statementDay, ref);
  const billedBal = acctBalance(account.id, accounts, entries, close);
  const nowBal = acctBalance(account.id, accounts, entries);
  const dueDate = account.dueDay ? dueDateFor(close, account.statementDay, account.dueDay) : null;
  return {
    statementClose: close,
    billedDue: billedBal < 0 ? -billedBal : 0,
    overpay: billedBal > 0 ? billedBal : 0,
    unbilled: Math.max(0, billedBal - nowBal), // debt grew since close = new charges
    currentDebt: nowBal < 0 ? -nowBal : 0,
    dueDate,
    daysToDue: dueDate != null ? Math.round((startOfDay(dueDate) - startOfDay(ref)) / DAY_MS) : null,
  };
}

export interface DueReminder {
  account: Account;
  billedDue: number;
  daysToDue: number;
  dueDate: number;
}

/**
 * Credit cards with an outstanding statement balance whose due date is within
 * `withinDays` (past-due included). Sorted soonest-due first — drives a home
 * repayment reminder.
 */
export function dueSoon(
  accounts: Account[],
  entries: Entry[],
  ref: number = Date.now(),
  withinDays = 7,
): DueReminder[] {
  const out: DueReminder[] = [];
  for (const a of accounts) {
    const sm = statementSummary(a, accounts, entries, ref);
    if (!sm || sm.dueDate == null || sm.daysToDue == null) continue;
    if (sm.billedDue > 0 && sm.daysToDue <= withinDays) {
      out.push({ account: a, billedDue: sm.billedDue, daysToDue: sm.daysToDue, dueDate: sm.dueDate });
    }
  }
  return out.sort((x, y) => x.daysToDue - y.daysToDue);
}
