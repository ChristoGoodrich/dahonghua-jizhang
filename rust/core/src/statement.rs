//! The credit-card statement cycle: 出账日, 还款日, 本期待还, 未出账, 溢缴款.
//!
//! Ported from `src/domain/statement.ts`.
//!
//! A card carries a `statement_day` — the day of the month its statement closes
//! — and optionally a `due_day`. From those and the account's transactions the
//! module derives what the last statement billed, what has been charged since,
//! and when the payment is due.
//!
//! Everything is civil. The TypeScript closes a statement at
//! `23:59:59.999` on the close day so an entry dated that day is billed, and
//! then compares epoch stamps against it; an end-of-day instant is not
//! something this crate can name without a timezone, so [`DatedEntry`] carries
//! the local day the platform resolved each entry to and the comparison is
//! between calendar days. It means the same thing and cannot drift by an hour.

use crate::accounts::{Account, AccountKind};
use crate::civil::{days_in_month, Civil};
use crate::entry::{Entry, Io};
use crate::networth::acct_balances_with;

/// One entry with the local calendar day the platform resolved it to.
#[derive(Debug, Clone, PartialEq)]
pub struct DatedEntry {
    pub entry: Entry,
    pub day: Civil,
}

/// Clamp a day-of-month to a month's real length — a 31st statement day in
/// February closes on the 28th, or the 29th.
///
/// `Math.min(Math.max(1, day), daysInMonth(...))`, so zero becomes the first
/// and anything past the end becomes the last.
fn clamp_day(day: u32, y: i32, m: i32) -> i32 {
    (day.min(i32::MAX as u32) as i32)
        .max(1)
        .min(days_in_month(y, m))
}

/// The day the most recent statement closed, at or before `today`.
///
/// If today's day-of-month has reached the statement day the statement closed
/// this month; otherwise it closed last month. Note the second clamp is against
/// the month that was landed on, not the month we started in: a 31st statement
/// day read on the 1st of March closes on the 28th of February.
pub fn last_statement_close(statement_day: u32, today: Civil) -> Civil {
    let mut year = today.y;
    let mut month = today.m;
    if today.d < clamp_day(statement_day, year, month) {
        month -= 1;
        if month < 0 {
            month = 11;
            year -= 1;
        }
    }
    Civil::new(year, month, clamp_day(statement_day, year, month))
}

/// The day payment is due for the statement that closed on `close`.
///
/// A due day *after* the statement day falls in the same month as the close;
/// otherwise it falls in the next one. The comparison is between the raw
/// configured days, not the clamped ones — so in a February whose 30th and 31st
/// both clamp to the 28th, the branch still follows what the user set.
pub fn due_date_for(close: Civil, statement_day: u32, due_day: u32) -> Civil {
    let mut year = close.y;
    let mut month = close.m;
    if due_day <= statement_day {
        month += 1;
        if month > 11 {
            month = 0;
            year += 1;
        }
    }
    Civil::new(year, month, clamp_day(due_day, year, month))
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StatementSummary {
    /// 出账日 — the day the statement closed.
    pub statement_close: Civil,
    /// 本期待还 — statement debt still unpaid.
    pub billed_due: f64,
    /// 溢缴款 — credit balance as of the close, never negative.
    pub overpay: f64,
    /// 未出账 — charges since the close, net of any payment beyond the bill.
    pub unbilled: f64,
    /// 待还 — total debt right now, never negative.
    pub current_debt: f64,
    /// 还款日, absent when no due day is configured.
    pub due_date: Option<Civil>,
    /// Whole days from today to the due date; negative once overdue.
    pub days_to_due: Option<i64>,
}

/// Summarise a credit account's current statement cycle.
///
/// `None` unless the account is a credit card with a statement day set — and
/// "set" is a truthiness test, so a statement day of zero means unconfigured
/// rather than the zeroth of the month.
///
/// Payments made after the close pay down the **statement first**, which is
/// what a card does: a repaid bill stops showing 待还 and stops reminding. Only
/// what is left over offsets the unbilled charges. So
/// `billed_due + unbilled == current_debt` whenever the card carries debt.
pub fn statement_summary(
    account: &Account,
    accounts: &[Account],
    rows: &[DatedEntry],
    today: Civil,
) -> Option<StatementSummary> {
    if account.kind != Some(AccountKind::Credit) {
        return None;
    }
    let statement_day = account.statement_day.filter(|d| *d != 0)?;
    let close = last_statement_close(statement_day, today);

    let entries: Vec<Entry> = rows.iter().map(|r| r.entry.clone()).collect();
    let by_id: Vec<(String, Civil)> = rows.iter().map(|r| (r.entry.id.clone(), r.day)).collect();
    let day_of = |e: &Entry| {
        by_id
            .iter()
            .find(|(id, _)| *id == e.id)
            .map(|(_, d)| *d)
            .expect("every entry came from `rows`")
    };

    // `d.ts <= close`, where close is the last millisecond of the close day —
    // which is every stamp on that day and none after it
    let billed_bal = acct_balances_with(accounts, &entries, |e| day_of(e) <= close);
    let billed_bal = pick(&billed_bal, &account.id);
    let now_bal = pick(
        &acct_balances_with(accounts, &entries, |_| true),
        &account.id,
    );

    let due_date = account
        .due_day
        .filter(|d| *d != 0)
        .map(|dd| due_date_for(close, statement_day, dd));

    // The activity since the close, split by direction: money arriving at the
    // card is a payment or a refund, money leaving it is a new charge.
    //
    // Deliberately unbounded above. `current_debt` is taken with no cutoff at
    // all, so this split has to see every later entry too — bounding it would
    // break `billed + unbilled == debt` for a future-dated charge.
    let mut inflow = 0.0;
    let mut outflow = 0.0;
    for r in rows {
        let d = &r.entry;
        if d.deleted_at.is_some_and(|v| v != 0) || r.day <= close {
            continue;
        }
        let is_this = |a: &Option<String>| a.as_deref() == Some(account.id.as_str());
        if d.io == Some(Io::Inc) && is_this(&d.acct) {
            inflow += d.amt;
        } else if d.io == Some(Io::Exp) && is_this(&d.acct) {
            outflow += d.amt;
        } else if d.io == Some(Io::Xfer) {
            if is_this(&d.acct_to) {
                inflow += d.amt + d.discount.unwrap_or(0.0);
            }
            if is_this(&d.acct) {
                outflow += d.amt + d.fee.unwrap_or(0.0);
            }
        }
    }

    let billed_at_close = if billed_bal < 0.0 { -billed_bal } else { 0.0 };
    let billed_due = max0(billed_at_close - inflow);
    let inflow_beyond_bill = max0(inflow - billed_at_close);

    Some(StatementSummary {
        statement_close: close,
        billed_due,
        overpay: if billed_bal > 0.0 { billed_bal } else { 0.0 },
        unbilled: max0(outflow - inflow_beyond_bill),
        current_debt: if now_bal < 0.0 { -now_bal } else { 0.0 },
        due_date,
        days_to_due: due_date.map(|d| today.days_until(d)),
    })
}

/// `Math.max(0, x)`, which is not `x.max(0.0)`.
///
/// `Math.max` **propagates** `NaN`; `f64::max` ignores it and answers with the
/// other operand. The same difference bit [`crate::stats`] and it bites here
/// three times over — an unparseable amount has to poison the bill rather than
/// quietly floor it to zero.
fn max0(x: f64) -> f64 {
    if x.is_nan() {
        f64::NAN
    } else {
        x.max(0.0)
    }
}

fn pick(balances: &[(String, f64)], id: &str) -> f64 {
    balances
        .iter()
        .find(|(k, _)| k == id)
        .map(|(_, v)| *v)
        .unwrap_or(0.0)
}

#[derive(Debug, Clone, PartialEq)]
pub struct DueReminder {
    pub account: Account,
    pub billed_due: f64,
    pub days_to_due: i64,
    pub due_date: Civil,
}

/// Credit cards with an unpaid statement due within `within_days`, soonest
/// first. Past-due cards are included — their day count is negative.
pub fn due_soon(
    accounts: &[Account],
    rows: &[DatedEntry],
    today: Civil,
    within_days: i64,
) -> Vec<DueReminder> {
    let mut out: Vec<DueReminder> = accounts
        .iter()
        .filter_map(|a| {
            let sm = statement_summary(a, accounts, rows, today)?;
            let due_date = sm.due_date?;
            let days_to_due = sm.days_to_due?;
            (sm.billed_due > 0.0 && days_to_due <= within_days).then(|| DueReminder {
                account: a.clone(),
                billed_due: sm.billed_due,
                days_to_due,
                due_date,
            })
        })
        .collect();
    // `sort((x, y) => x.daysToDue - y.daysToDue)`, stable — two cards due the
    // same day keep the order the accounts were listed in
    out.sort_by_key(|r| r.days_to_due);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(id: &str, statement: Option<u32>, due: Option<u32>) -> Account {
        Account {
            id: id.into(),
            name: id.into(),
            kind: Some(AccountKind::Credit),
            statement_day: statement,
            due_day: due,
            ..Default::default()
        }
    }

    fn charge(id: &str, acct: &str, amt: f64, day: Civil) -> DatedEntry {
        DatedEntry {
            entry: Entry {
                id: id.into(),
                io: Some(Io::Exp),
                acct: Some(acct.into()),
                amt,
                ..Default::default()
            },
            day,
        }
    }

    fn payment(id: &str, acct: &str, amt: f64, day: Civil) -> DatedEntry {
        DatedEntry {
            entry: Entry {
                id: id.into(),
                io: Some(Io::Inc),
                acct: Some(acct.into()),
                amt,
                ..Default::default()
            },
            day,
        }
    }

    #[test]
    fn the_statement_closes_this_month_once_the_day_has_come() {
        // the 10th, read on the 15th
        assert_eq!(
            last_statement_close(10, Civil::new(2026, 5, 15)),
            Civil::new(2026, 5, 10)
        );
        // the 10th, read on the 5th — last month
        assert_eq!(
            last_statement_close(10, Civil::new(2026, 5, 5)),
            Civil::new(2026, 4, 10)
        );
    }

    #[test]
    fn the_close_day_is_reached_on_the_day_itself() {
        assert_eq!(
            last_statement_close(10, Civil::new(2026, 5, 10)),
            Civil::new(2026, 5, 10)
        );
    }

    #[test]
    fn a_close_rolls_back_across_a_year_boundary() {
        assert_eq!(
            last_statement_close(20, Civil::new(2026, 0, 5)),
            Civil::new(2025, 11, 20)
        );
    }

    #[test]
    fn a_thirty_first_clamps_to_the_month_it_lands_in() {
        // read on the 1st of March, so the close is February's — clamped to the
        // 28th by the *landed* month, not by March's 31
        assert_eq!(
            last_statement_close(31, Civil::new(2026, 2, 1)),
            Civil::new(2026, 1, 28)
        );
        // 2024 is a leap year
        assert_eq!(
            last_statement_close(31, Civil::new(2024, 2, 1)),
            Civil::new(2024, 1, 29)
        );
    }

    #[test]
    fn a_due_day_after_the_close_falls_in_the_same_month() {
        assert_eq!(
            due_date_for(Civil::new(2026, 5, 10), 10, 25),
            Civil::new(2026, 5, 25)
        );
    }

    #[test]
    fn a_due_day_at_or_before_the_close_falls_in_the_next_month() {
        assert_eq!(
            due_date_for(Civil::new(2026, 5, 25), 25, 10),
            Civil::new(2026, 6, 10)
        );
        // equal counts as before
        assert_eq!(
            due_date_for(Civil::new(2026, 5, 25), 25, 25),
            Civil::new(2026, 6, 25)
        );
    }

    #[test]
    fn a_due_date_rolls_across_a_year_boundary() {
        assert_eq!(
            due_date_for(Civil::new(2026, 11, 25), 25, 10),
            Civil::new(2027, 0, 10)
        );
    }

    #[test]
    fn the_branch_reads_the_configured_days_not_the_clamped_ones() {
        // both 30 and 31 clamp to February's 28th, but 31 > 30 keeps the due
        // date in the same month while 29 <= 30 pushes it to the next
        assert_eq!(
            due_date_for(Civil::new(2026, 1, 28), 30, 31),
            Civil::new(2026, 1, 28)
        );
        assert_eq!(
            due_date_for(Civil::new(2026, 1, 28), 30, 29),
            Civil::new(2026, 2, 29)
        );
    }

    #[test]
    fn a_non_credit_account_has_no_statement() {
        let mut a = card("c1", Some(10), Some(25));
        a.kind = Some(AccountKind::Cash);
        assert!(statement_summary(&a, std::slice::from_ref(&a), &[], Civil::new(2026, 5, 15)).is_none());
    }

    #[test]
    fn a_statement_day_of_zero_is_unconfigured() {
        let a = card("c1", Some(0), Some(25));
        assert!(statement_summary(&a, std::slice::from_ref(&a), &[], Civil::new(2026, 5, 15)).is_none());
    }

    #[test]
    fn a_charge_on_the_close_day_is_billed() {
        let a = card("c1", Some(10), Some(25));
        let rows = vec![charge("e1", "c1", 100.0, Civil::new(2026, 5, 10))];
        let s = statement_summary(&a, std::slice::from_ref(&a), &rows, Civil::new(2026, 5, 15)).unwrap();
        assert_eq!(s.billed_due, 100.0);
        assert_eq!(s.unbilled, 0.0);
        assert_eq!(s.current_debt, 100.0);
    }

    #[test]
    fn a_charge_after_the_close_is_unbilled() {
        let a = card("c1", Some(10), Some(25));
        let rows = vec![
            charge("e1", "c1", 100.0, Civil::new(2026, 5, 10)),
            charge("e2", "c1", 30.0, Civil::new(2026, 5, 11)),
        ];
        let s = statement_summary(&a, std::slice::from_ref(&a), &rows, Civil::new(2026, 5, 15)).unwrap();
        assert_eq!(s.billed_due, 100.0);
        assert_eq!(s.unbilled, 30.0);
        assert_eq!(s.current_debt, 130.0);
    }

    #[test]
    fn a_payment_clears_the_statement_before_it_touches_new_charges() {
        let a = card("c1", Some(10), Some(25));
        let rows = vec![
            charge("e1", "c1", 100.0, Civil::new(2026, 5, 10)),
            charge("e2", "c1", 30.0, Civil::new(2026, 5, 11)),
            payment("e3", "c1", 120.0, Civil::new(2026, 5, 12)),
        ];
        let s = statement_summary(&a, std::slice::from_ref(&a), &rows, Civil::new(2026, 5, 15)).unwrap();
        assert_eq!(s.billed_due, 0.0);
        // 20 of the payment was left over and offsets the 30 charged since
        assert_eq!(s.unbilled, 10.0);
        assert_eq!(s.current_debt, 10.0);
        assert_eq!(s.billed_due + s.unbilled, s.current_debt);
    }

    #[test]
    fn a_credit_balance_at_the_close_is_an_overpayment() {
        let mut a = card("c1", Some(10), Some(25));
        a.balance = 50.0;
        let s = statement_summary(&a, std::slice::from_ref(&a), &[], Civil::new(2026, 5, 15)).unwrap();
        assert_eq!(s.overpay, 50.0);
        assert_eq!(s.billed_due, 0.0);
        assert_eq!(s.current_debt, 0.0);
    }

    #[test]
    fn days_to_due_goes_negative_once_overdue() {
        let a = card("c1", Some(10), Some(25));
        let rows = vec![charge("e1", "c1", 100.0, Civil::new(2026, 5, 10))];
        let s = statement_summary(&a, std::slice::from_ref(&a), &rows, Civil::new(2026, 5, 28)).unwrap();
        assert_eq!(s.due_date, Some(Civil::new(2026, 5, 25)));
        assert_eq!(s.days_to_due, Some(-3));
    }

    #[test]
    fn no_due_day_means_no_due_date() {
        let a = card("c1", Some(10), None);
        let s = statement_summary(&a, std::slice::from_ref(&a), &[], Civil::new(2026, 5, 15)).unwrap();
        assert_eq!(s.due_date, None);
        assert_eq!(s.days_to_due, None);
    }

    #[test]
    fn due_soon_lists_the_soonest_first_and_skips_the_paid() {
        // due days chosen so both a and b land inside the seven-day window:
        // read on the 14th they are six and four days out
        let a = card("a", Some(10), Some(20));
        let b = card("b", Some(10), Some(18));
        let c = card("c", Some(10), Some(15));
        let accounts = vec![a, b, c];
        let rows = vec![
            charge("e1", "a", 100.0, Civil::new(2026, 5, 5)),
            charge("e2", "b", 100.0, Civil::new(2026, 5, 5)),
            // c is charged and then paid off, so it should not remind
            charge("e3", "c", 100.0, Civil::new(2026, 5, 5)),
            payment("e4", "c", 100.0, Civil::new(2026, 5, 12)),
        ];
        let out = due_soon(&accounts, &rows, Civil::new(2026, 5, 14), 7);
        let ids: Vec<&str> = out.iter().map(|r| r.account.id.as_str()).collect();
        assert_eq!(ids, vec!["b", "a"]);
        assert_eq!(out[0].days_to_due, 4);
    }

    #[test]
    fn due_soon_honours_its_window() {
        let a = card("a", Some(10), Some(25));
        let rows = vec![charge("e1", "a", 100.0, Civil::new(2026, 5, 5))];
        assert!(due_soon(std::slice::from_ref(&a), &rows, Civil::new(2026, 5, 14), 7).is_empty());
        assert_eq!(due_soon(std::slice::from_ref(&a), &rows, Civil::new(2026, 5, 20), 7).len(), 1);
    }
}
