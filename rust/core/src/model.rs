//! The stored shapes that are not entries: what the user owns, owes, pays
//! monthly, and keeps as a shortcut.
//!
//! Ported from `src/domain/types.ts`. Only the fields the core needs are here.
//! `Settings` in particular is mostly UI preference — theme, dark mode, backup
//! frequency, whether amounts are masked — none of which pure ledger logic has
//! any business knowing. What it does need is [`Budgets`], because switching
//! the base currency has to re-express every budget along with every amount.

use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetKind {
    /// Something owned.
    Asset,
    /// Something owed.
    Liab,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Asset {
    pub id: String,
    pub name: String,
    pub kind: AssetKind,
    pub val: f64,
    /// Excluded from the net-worth total.
    pub no_count: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoanKind {
    /// They owe me.
    Lend,
    /// I owe them.
    Borrow,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Loan {
    pub id: String,
    pub who: String,
    pub kind: LoanKind,
    pub amt: f64,
    pub repaid: Option<f64>,
    pub ts: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubFreq {
    Monthly,
    Yearly,
}

/// A recurring charge. `periods`/`charged` turn it into an instalment plan;
/// absent, it runs until cancelled.
#[derive(Debug, Clone, PartialEq)]
pub struct Sub {
    pub id: String,
    pub name: String,
    pub emoji: String,
    pub amt: f64,
    pub freq: SubFreq,
    /// 1..=28.
    pub day: u32,
    /// 1..=12, the charge month for a yearly sub.
    pub month: Option<u32>,
    pub cat: String,
    pub created: i64,
    /// `YYYY-M-D` with a 0-indexed month, inherited from v7.
    pub last_charged: Option<String>,
    /// `Some(true)` posts a transfer rather than an expense.
    pub is_transfer: Option<bool>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub periods: Option<u32>,
    pub charged: Option<u32>,
}

/// A pinned entry the record sheet offers as a one-tap chip.
#[derive(Debug, Clone, PartialEq)]
pub struct Template {
    pub id: String,
    pub io: crate::entry::Io,
    pub cat: String,
    pub amt: f64,
    pub note: Option<String>,
    pub name: String,
}

/// The money-carrying half of `Settings`.
///
/// Split out because it is the only part the core touches: a base-currency
/// switch has to re-express these alongside every entry, and a budget left in
/// the old unit is a budget that silently changes meaning.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Budgets {
    /// The monthly (or weekly, per `budget_mode`) pot. Zero means unset.
    pub budget: f64,
    pub daily: Option<f64>,
    pub weekly: Option<f64>,
    /// Per-category caps. Ordered so output is stable to diff.
    pub per_category: Option<BTreeMap<String, f64>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budgets_default_to_nothing_set() {
        let b = Budgets::default();
        assert_eq!(b.budget, 0.0);
        assert!(b.daily.is_none());
        assert!(b.per_category.is_none());
    }
}
