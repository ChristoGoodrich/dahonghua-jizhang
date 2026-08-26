//! Accounts and their balances, across the boundary.
//!
//! A balance is an opening figure plus every entry that touched the account,
//! and the arithmetic has two properties this side must not be allowed to
//! re-derive:
//!
//! * a **transfer** subtracts from one account and adds to the other, minus a
//!   fee and plus a discount, which is four signs to get right in one row;
//! * an opening balance of `NaN` starts at **zero** rather than poisoning the
//!   account for good, because `a.balance || 0` is a truthiness test.
//!
//! Deleting an account is the other thing worth keeping here. It migrates every
//! entry that referenced it to `default` rather than orphaning them, and it
//! refuses to delete `default` itself.

use dahonghua_core::accounts::{self as core, Account, AccountKind, NewAccountOpts};
use dahonghua_core::networth;
use flutter_rust_bridge::frb;

use super::store::{store, AccountView};

/// An account with its live balance.
#[derive(Debug, Clone, PartialEq)]
pub struct AccountBalance {
    pub id: String,
    pub name: String,
    pub name_en: Option<String>,
    /// The opening figure the account was created with.
    pub opening: f64,
    /// Opening plus every entry that touched it.
    pub balance: f64,
    /// `"cash" | "credit" | "prepaid" | "fx"`, empty for the default kind.
    pub kind: String,
    pub statement_day: Option<u32>,
    pub due_day: Option<u32>,
    pub fx_code: Option<String>,
    pub fx_rate: Option<f64>,
    pub archived: bool,
    /// True for the one account that cannot be deleted.
    pub is_default: bool,
}

fn view(a: &Account, balance: f64) -> AccountBalance {
    AccountBalance {
        id: a.id.clone(),
        name: a.name.clone(),
        name_en: a.name_en.clone(),
        opening: a.balance,
        balance,
        kind: a.kind.map(|k| k.as_str().to_string()).unwrap_or_default(),
        statement_day: a.statement_day,
        due_day: a.due_day,
        fx_code: a.fx_code.clone(),
        fx_rate: a.fx_rate,
        archived: a.archived == Some(true),
        is_default: a.id == core::DEFAULT_ACCOUNT,
    }
}

/// Every account, with the balance each one is actually at.
///
/// One call rather than a balance lookup per row: the arithmetic walks the
/// whole ledger once for all of them, and doing it per account would walk it
/// once per account.
#[frb(sync)]
pub fn balances() -> Vec<AccountBalance> {
    let s = store();
    let totals = networth::acct_balances(&s.accounts, s.ledger.all(), None);
    s.accounts
        .iter()
        .map(|a| {
            let b = totals
                .iter()
                .find(|(id, _)| *id == a.id)
                .map(|(_, v)| *v)
                .unwrap_or(0.0);
            view(a, b)
        })
        .collect()
}

/// Every account's balance added together.
#[frb(sync)]
pub fn total_balance() -> f64 {
    let s = store();
    networth::total_account_balance(&s.accounts, s.ledger.all())
}

/// The accounts a picker should offer: everything unarchived, plus whichever
/// one is currently selected even when it is archived.
///
/// The exception is the point — editing an old entry that lives on an archived
/// account must not silently move it somewhere else.
#[frb(sync)]
pub fn pickable(selected: String) -> Vec<AccountView> {
    let s = store();
    core::pickable(&s.accounts, &selected)
        .into_iter()
        .map(AccountView::from)
        .collect()
}

/// Create an account. Returns its id.
///
/// `id` comes from Dart for the same reason it does on the ledger: generating
/// one reads a clock and a random source, and this crate has neither.
#[frb(sync)]
pub fn add_account(
    id: String,
    name: String,
    balance: f64,
    kind: String,
    statement_day: Option<u32>,
    due_day: Option<u32>,
    fx_code: Option<String>,
) -> String {
    let mut s = store();
    let a = core::add_account(
        &mut s.accounts,
        id,
        name,
        balance,
        AccountKind::parse(&kind).unwrap_or(AccountKind::Cash),
        &NewAccountOpts {
            statement_day,
            due_day,
            fx_code,
        },
    );
    a.id
}

/// Delete an account, moving everything that referenced it to `default`.
///
/// Returns false for `default` itself, which is not deletable — the ledger
/// would have nowhere to move its entries to.
#[frb(sync)]
pub fn remove_account(id: String, now: i64) -> bool {
    let mut s = store();
    let store_ref = &mut *s;
    core::remove_account(
        &mut store_ref.accounts,
        &mut store_ref.ledger,
        &mut store_ref.current_account,
        &id,
        now,
    )
}

/// Hide an account from the pickers without touching its history.
///
/// Archiving the *current* account moves the selection back to `default`, so
/// the next record sheet does not open on an account the picker will not show.
#[frb(sync)]
pub fn archive_account(id: String, archived: bool) -> bool {
    let mut s = store();
    let store_ref = &mut *s;
    core::archive_account(
        &mut store_ref.accounts,
        &mut store_ref.current_account,
        &id,
        archived,
    )
}
