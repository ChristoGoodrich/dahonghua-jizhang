//! The credit-card statement cycle: 出账日, 还款日, 本期待还, 未出账, 溢缴款.
//!
//! All of it is `statement.rs`'s arithmetic under a corpus. What crosses here
//! is the shape, and the days — a statement closes on a calendar day, and which
//! calendar day an entry falls on is the device's zone to answer.
//!
//! One rule from the core worth repeating where a caller will read it: a
//! payment made after the close pays down the **statement first**, which is
//! what a card does. A repaid bill stops showing 待还 and stops reminding; only
//! what is left over offsets the unbilled charges.

use flutter_rust_bridge::frb;

use dahonghua_core::civil::Civil;
use dahonghua_core::entry::Entry;
use dahonghua_core::statement::{due_soon, statement_summary, DatedEntry};

use super::store::store;

fn parse_day(s: &str) -> Civil {
    let mut it = s.split('-');
    let y = it.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    Civil::new(y, m - 1, d)
}

fn show_day(c: Civil) -> String {
    format!("{}-{}-{}", c.y, c.m + 1, c.d)
}

/// The entries named by `ids`, paired with the day Dart resolved for each.
fn dated(ids: &[String], days_of: &[String]) -> Vec<DatedEntry> {
    let s = store();
    let n = ids.len().min(days_of.len());
    (0..n)
        .filter_map(|i| {
            let e: &Entry = s.ledger.get(&ids[i])?;
            Some(DatedEntry {
                entry: e.clone(),
                day: parse_day(&days_of[i]),
            })
        })
        .collect()
}

/// Where a credit card stands in its cycle.
#[derive(Debug, Clone, PartialEq)]
pub struct StatementView {
    /// 出账日 — the day the statement closed.
    pub statement_close: String,
    /// 本期待还 — statement debt still unpaid.
    pub billed_due: f64,
    /// 溢缴款 — credit balance as of the close, never negative.
    pub overpay: f64,
    /// 未出账 — charges since the close, net of any payment beyond the bill.
    pub unbilled: f64,
    /// 待还 — total debt right now, never negative.
    pub current_debt: f64,
    /// 还款日. Absent when the account has no due day set.
    pub due_date: Option<String>,
    /// Whole days from today to the due date; negative once overdue.
    pub days_to_due: Option<i64>,
}

/// A card with a bill coming due.
#[derive(Debug, Clone, PartialEq)]
pub struct DueView {
    pub account_id: String,
    pub account_name: String,
    pub billed_due: f64,
    pub days_to_due: i64,
    pub due_date: String,
}

/// Summarise one account's cycle.
///
/// `None` unless it is a credit card with a statement day — and "set" is a
/// truthiness test, so a statement day of zero means unconfigured rather than
/// the zeroth of the month.
#[frb(sync)]
pub fn statement_of(
    account_id: String,
    ids: Vec<String>,
    days_of: Vec<String>,
    today: String,
) -> Option<StatementView> {
    let rows = dated(&ids, &days_of);
    let s = store();
    let account = s.accounts.iter().find(|a| a.id == account_id)?;
    let sm = statement_summary(account, &s.accounts, &rows, parse_day(&today))?;
    Some(StatementView {
        statement_close: show_day(sm.statement_close),
        billed_due: sm.billed_due,
        overpay: sm.overpay,
        unbilled: sm.unbilled,
        current_debt: sm.current_debt,
        due_date: sm.due_date.map(show_day),
        days_to_due: sm.days_to_due,
    })
}

/// Cards with an unpaid statement due within `within_days`, soonest first.
///
/// Past-due cards are included, with a negative day count. Leaving them out
/// would make the one thing a reminder exists for disappear exactly when it
/// starts to matter.
#[frb(sync)]
pub fn due_within(
    ids: Vec<String>,
    days_of: Vec<String>,
    today: String,
    within_days: i64,
) -> Vec<DueView> {
    let rows = dated(&ids, &days_of);
    let s = store();
    due_soon(&s.accounts, &rows, parse_day(&today), within_days)
        .into_iter()
        .map(|r| DueView {
            account_id: r.account.id.clone(),
            account_name: r.account.name.clone(),
            billed_due: r.billed_due,
            days_to_due: r.days_to_due,
            due_date: show_day(r.due_date),
        })
        .collect()
}
