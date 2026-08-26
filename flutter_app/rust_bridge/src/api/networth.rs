//! Net worth across the boundary: assets, loans, and the split between them.
//!
//! Two things here run against the falsy-means-absent habit the rest of the
//! store has, and both are deliberate in the TypeScript: a new asset is created
//! with `noCount: false` and a new loan with `repaid: 0`, both **stored** rather
//! than omitted. They are counters and flags the user will change, not optional
//! metadata, and a reader that treats absent as false would still be wrong the
//! moment one of them is synced.
//!
//! The one rule worth knowing before reading a screen that uses this: a credit
//! account **in debt** is a liability, and every other account — an overpaid
//! card included — is an asset. `net` is the sum either way; the split only
//! decides which of the two cards a number lands on.

use dahonghua_core::model::{Asset, AssetKind, Loan, LoanKind};
use dahonghua_core::networth as core;
use flutter_rust_bridge::frb;
use std::sync::{Mutex, MutexGuard, OnceLock};

use super::store::store;

pub(crate) fn assets_lock() -> MutexGuard<'static, Vec<Asset>> {
    static A: OnceLock<Mutex<Vec<Asset>>> = OnceLock::new();
    let m = A.get_or_init(|| Mutex::new(Vec::new()));
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub(crate) fn loans_lock() -> MutexGuard<'static, Vec<Loan>> {
    static L: OnceLock<Mutex<Vec<Loan>>> = OnceLock::new();
    let m = L.get_or_init(|| Mutex::new(Vec::new()));
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub(crate) fn assets_of() -> Vec<Asset> {
    assets_lock().clone()
}

pub(crate) fn loans_of() -> Vec<Loan> {
    loans_lock().clone()
}

pub(crate) fn set_assets_inner(v: Vec<Asset>) {
    *assets_lock() = v;
}

pub(crate) fn set_loans_inner(v: Vec<Loan>) {
    *loans_lock() = v;
}

/// Something owned or owed that is not an account — a flat, a car, a mortgage.
#[derive(Debug, Clone, PartialEq)]
pub struct AssetView {
    pub id: String,
    pub name: String,
    /// `asset` | `liab`.
    pub kind: String,
    pub val: f64,
    /// Left out of the net-worth total, without being deleted.
    pub no_count: bool,
}

impl From<&Asset> for AssetView {
    fn from(a: &Asset) -> Self {
        AssetView {
            id: a.id.clone(),
            name: a.name.clone(),
            kind: match a.kind {
                AssetKind::Liab => "liab".into(),
                AssetKind::Asset => "asset".into(),
            },
            val: a.val,
            no_count: a.no_count == Some(true),
        }
    }
}

/// Money lent to someone, or borrowed from them.
#[derive(Debug, Clone, PartialEq)]
pub struct LoanView {
    pub id: String,
    pub who: String,
    /// `lend` — they owe me — or `borrow`.
    pub kind: String,
    pub amt: f64,
    pub repaid: f64,
    /// `amt - repaid`, never negative. A `NaN` amount stays `NaN` rather than
    /// reading as settled.
    pub remaining: f64,
    pub ts: i64,
}

impl From<&Loan> for LoanView {
    fn from(l: &Loan) -> Self {
        LoanView {
            id: l.id.clone(),
            who: l.who.clone(),
            kind: match l.kind {
                LoanKind::Lend => "lend".into(),
                LoanKind::Borrow => "borrow".into(),
            },
            amt: l.amt,
            repaid: l.repaid.unwrap_or(0.0),
            remaining: core::loan_remaining(l),
            ts: l.ts,
        }
    }
}

#[frb(sync)]
pub fn assets() -> Vec<AssetView> {
    assets_lock().iter().map(AssetView::from).collect()
}

#[frb(sync)]
pub fn add_asset(id: String, name: String, kind: String, val: f64) -> String {
    let a = core::add_asset(
        &mut assets_lock(),
        id,
        name,
        if kind == "liab" {
            AssetKind::Liab
        } else {
            AssetKind::Asset
        },
        val,
    );
    a.id
}

#[frb(sync)]
pub fn remove_asset(id: String) {
    core::remove_asset(&mut assets_lock(), &id);
}

/// Keep an asset on the list but out of the total.
///
/// The flag is stored either way rather than omitted when false — see the
/// module docs.
#[frb(sync)]
pub fn set_asset_no_count(id: String, no_count: bool) -> bool {
    let mut a = assets_lock();
    match a.iter_mut().find(|x| x.id == id) {
        Some(x) => {
            x.no_count = Some(no_count);
            true
        }
        None => false,
    }
}

#[frb(sync)]
pub fn loans() -> Vec<LoanView> {
    loans_lock().iter().map(LoanView::from).collect()
}

/// Create a loan. `ts` is the caller's, because the TypeScript reads
/// `Date.now()` there and clocks stay outside the core.
#[frb(sync)]
pub fn add_loan(id: String, who: String, kind: String, amt: f64, ts: i64) -> String {
    let l = core::add_loan(
        &mut loans_lock(),
        id,
        who,
        if kind == "borrow" {
            LoanKind::Borrow
        } else {
            LoanKind::Lend
        },
        amt,
        ts,
    );
    l.id
}

/// Record a repayment, capped at what is still owed.
///
/// The cap is **one-sided**, exactly as in the TypeScript: `Math.min(amount,
/// remaining)` stops an overpayment but does nothing about a negative amount,
/// which walks the counter back down. That is how a mis-tap is undone, so it is
/// left reachable rather than validated away here.
#[frb(sync)]
pub fn repay_loan(id: String, amount: f64) {
    core::repay_loan(&mut loans_lock(), &id, amount);
}

#[frb(sync)]
pub fn remove_loan(id: String) {
    core::remove_loan(&mut loans_lock(), &id);
}

/// What the two cards on the net-worth screen show.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NetWorthView {
    pub asset: f64,
    pub liab: f64,
    /// The difference, and the sum of every balance either way.
    pub net: f64,
}

#[frb(sync)]
pub fn net_worth() -> NetWorthView {
    let s = store();
    let p = core::net_worth_parts(&s.accounts, s.ledger.all(), &assets_of(), &loans_of());
    NetWorthView {
        asset: p.asset,
        liab: p.liab,
        net: p.net,
    }
}
