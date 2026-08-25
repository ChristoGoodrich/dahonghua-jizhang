//! Net worth: account balances, assets, liabilities and loans.
//!
//! Ported from `src/store/assets.ts` and `src/domain/networth.ts`. Two details here run against the
//! falsy-means-absent habit the rest of the store has, and both are deliberate
//! in the TypeScript: a new asset is created with `noCount: false` and a new
//! loan with `repaid: 0`, both stored rather than left out. They are counters
//! and flags the user will change, not optional metadata.

use crate::accounts::{Account, AccountKind};
use crate::entry::{Entry, Io};
use crate::model::{Asset, AssetKind, Loan, LoanKind};

pub fn add_asset(
    assets: &mut Vec<Asset>,
    id: String,
    name: String,
    kind: AssetKind,
    val: f64,
) -> Asset {
    let a = Asset {
        id,
        name,
        kind,
        val,
        // stored as false rather than omitted, matching the TypeScript
        no_count: Some(false),
    };
    assets.push(a.clone());
    a
}

pub fn remove_asset(assets: &mut Vec<Asset>, id: &str) {
    assets.retain(|a| a.id != id);
}

/// Create a loan. `ts` is the caller's: the TypeScript reads `Date.now()` here,
/// which is a clock, and clocks stay outside this crate.
pub fn add_loan(
    loans: &mut Vec<Loan>,
    id: String,
    who: String,
    kind: LoanKind,
    amt: f64,
    ts: i64,
) -> Loan {
    let l = Loan {
        id,
        who,
        kind,
        amt,
        repaid: Some(0.0),
        ts,
    };
    loans.push(l.clone());
    l
}

/// Record a repayment, clamped to what is still owed.
///
/// The clamp is one-sided, exactly as in the TypeScript: `Math.min(amount,
/// remaining)` caps an overpayment but does nothing about a *negative* amount,
/// which walks the counter back down. That is not obviously wrong — it is how
/// the UI undoes a mis-tap — but it is worth knowing it is reachable, so the
/// tests pin it rather than pretending the input is validated here.
pub fn repay_loan(loans: &mut [Loan], id: &str, amount: f64) {
    for l in loans.iter_mut() {
        if l.id != id {
            continue;
        }
        let paid = l.repaid.unwrap_or(0.0);
        let remaining = (l.amt - paid).max(0.0);
        l.repaid = Some(paid + amount.min(remaining));
    }
}

pub fn remove_loan(loans: &mut Vec<Loan>, id: &str) {
    loans.retain(|l| l.id != id);
}

/* ------------------------------------------------- account balances -- */

/// Every account's running balance in one pass over the ledger.
///
/// Returned in the order the accounts were given, which is what a JavaScript
/// `Map` iterates in. Nothing downstream depends on the order today, but a
/// `HashMap` here would make that unknowable rather than merely unused.
///
/// `as_of` values the balances at an instant. Note it is checked against `None`
/// rather than for truthiness — `if (asOf != null && d.ts > asOf)` — so a cutoff
/// of epoch zero really does exclude everything after 1970, where the
/// falsy-means-absent idiom used elsewhere in this crate would have ignored it.
pub fn acct_balances(
    accounts: &[Account],
    data: &[Entry],
    as_of: Option<i64>,
) -> Vec<(String, f64)> {
    acct_balances_with(accounts, data, |d| as_of.is_none_or(|c| d.ts <= c))
}

/// [`acct_balances`] with the cutoff expressed as a test rather than an instant.
///
/// `statement` needs the balance as of the *end of a calendar day*, and an
/// end-of-day instant is not something this crate can name — it would need the
/// platform's timezone. Giving the one implementation a predicate keeps the
/// epoch and the civil callers on the same code instead of on two copies that
/// drift.
pub fn acct_balances_with(
    accounts: &[Account],
    data: &[Entry],
    include: impl Fn(&Entry) -> bool,
) -> Vec<(String, f64)> {
    // `a.balance || 0` — falsy means zero, so a NaN opening balance starts at
    // zero rather than poisoning the account for good
    let mut bal: Vec<(String, f64)> = accounts
        .iter()
        .map(|a| {
            (
                a.id.clone(),
                if a.balance != 0.0 && !a.balance.is_nan() {
                    a.balance
                } else {
                    0.0
                },
            )
        })
        .collect();

    for d in data {
        if d.deleted_at.is_some_and(|v| v != 0) {
            continue;
        }
        if !include(d) {
            continue;
        }
        // an entry naming an account that no longer exists is dropped, not
        // resurrected: `add` only writes keys the map already holds
        let mut add = |id: &str, delta: f64| {
            if let Some((_, v)) = bal.iter_mut().find(|(k, _)| k == id) {
                *v += delta;
            }
        };
        if d.io == Some(Io::Xfer) {
            // the fee leaves the source, the discount credits the destination
            if let Some(from) = d.acct.as_deref().filter(|s| !s.is_empty()) {
                add(from, -(d.amt + d.fee.unwrap_or(0.0)));
            }
            if let Some(to) = d.acct_to.as_deref().filter(|s| !s.is_empty()) {
                add(to, d.amt + d.discount.unwrap_or(0.0));
            }
            continue;
        }
        // `d.acct || 'default'` — an entry with no account lands on the
        // default one, which is what v7 did and what the store still seeds
        let id = d
            .acct
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("default");
        add(id, if d.io == Some(Io::Inc) { d.amt } else { -d.amt });
    }
    bal
}

/// One account's running balance. Zero for an id that is not an account.
///
/// The batch form is the one to reach for when more than one balance is
/// wanted: this rescans the whole ledger each call, which made the accounts
/// screen quadratic before `acct_balances` existed.
pub fn acct_balance(id: &str, accounts: &[Account], data: &[Entry], as_of: Option<i64>) -> f64 {
    if !accounts.iter().any(|x| x.id == id) {
        return 0.0;
    }
    acct_balances(accounts, data, as_of)
        .into_iter()
        .find(|(k, _)| k == id)
        .map(|(_, v)| v)
        .unwrap_or(0.0)
}

/// Every account balance summed.
pub fn total_account_balance(accounts: &[Account], data: &[Entry]) -> f64 {
    acct_balances(accounts, data, None)
        .iter()
        .map(|(_, v)| v)
        .sum()
}

/// What is still owed on a loan, never negative.
///
/// `Math.max(0, …)` propagates `NaN` where `f64::max` would swallow it, so an
/// unparseable amount stays unparseable rather than reading as settled.
pub fn loan_remaining(l: &Loan) -> f64 {
    let rem = l.amt - l.repaid.unwrap_or(0.0);
    if rem.is_nan() {
        f64::NAN
    } else {
        rem.max(0.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NetWorthParts {
    pub asset: f64,
    pub liab: f64,
    pub net: f64,
}

/// Assets, liabilities, and the difference.
///
/// A credit account **in debt** is a liability; every other account — an
/// overpaid card included — counts as an asset. The split only drives the two
/// cards on screen: `net` is the sum of the balances either way.
pub fn net_worth_parts(
    accounts: &[Account],
    data: &[Entry],
    assets: &[Asset],
    loans: &[Loan],
) -> NetWorthParts {
    let mut asset_sum = 0.0;
    let mut liab_sum = 0.0;
    let balances = acct_balances(accounts, data, None);
    for a in accounts {
        let b = balances
            .iter()
            .find(|(k, _)| *k == a.id)
            .map(|(_, v)| *v)
            .unwrap_or(0.0);
        if a.kind == Some(AccountKind::Credit) && b < 0.0 {
            liab_sum += -b;
        } else {
            asset_sum += b;
        }
    }
    for a in assets {
        if a.no_count == Some(true) {
            continue;
        }
        if a.kind == AssetKind::Liab {
            liab_sum += a.val;
        } else {
            asset_sum += a.val;
        }
    }
    for l in loans {
        let rem = loan_remaining(l);
        if l.kind == LoanKind::Lend {
            asset_sum += rem;
        } else {
            liab_sum += rem;
        }
    }
    NetWorthParts {
        asset: asset_sum,
        liab: liab_sum,
        net: asset_sum - liab_sum,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_asset_stores_its_flag_rather_than_omitting_it() {
        let mut v = vec![];
        let a = add_asset(
            &mut v,
            "as0".into(),
            "车".into(),
            AssetKind::Asset,
            72_000.0,
        );
        assert_eq!(a.no_count, Some(false));
        assert_eq!(v.len(), 1);
    }

    #[test]
    fn assets_are_removed_by_id() {
        let mut v = vec![];
        add_asset(&mut v, "as0".into(), "车".into(), AssetKind::Asset, 1.0);
        add_asset(&mut v, "as1".into(), "房贷".into(), AssetKind::Liab, 2.0);
        remove_asset(&mut v, "as0");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].id, "as1");
        remove_asset(&mut v, "nope"); // idempotent
        assert_eq!(v.len(), 1);
    }

    #[test]
    fn a_new_loan_starts_at_zero_repaid() {
        let mut v = vec![];
        let l = add_loan(
            &mut v,
            "l0".into(),
            "张三".into(),
            LoanKind::Lend,
            1_000.0,
            5_000,
        );
        assert_eq!(l.repaid, Some(0.0));
        assert_eq!(l.ts, 5_000);
    }

    #[test]
    fn a_repayment_accumulates() {
        let mut v = vec![];
        add_loan(
            &mut v,
            "l0".into(),
            "张三".into(),
            LoanKind::Lend,
            1_000.0,
            0,
        );
        repay_loan(&mut v, "l0", 300.0);
        repay_loan(&mut v, "l0", 200.0);
        assert_eq!(v[0].repaid, Some(500.0));
    }

    #[test]
    fn a_repayment_is_capped_at_what_is_still_owed() {
        let mut v = vec![];
        add_loan(
            &mut v,
            "l0".into(),
            "张三".into(),
            LoanKind::Lend,
            1_000.0,
            0,
        );
        repay_loan(&mut v, "l0", 5_000.0);
        assert_eq!(v[0].repaid, Some(1_000.0));
    }

    #[test]
    fn repaying_a_settled_loan_adds_nothing() {
        let mut v = vec![];
        add_loan(
            &mut v,
            "l0".into(),
            "张三".into(),
            LoanKind::Lend,
            1_000.0,
            0,
        );
        repay_loan(&mut v, "l0", 1_000.0);
        repay_loan(&mut v, "l0", 100.0);
        assert_eq!(v[0].repaid, Some(1_000.0));
    }

    #[test]
    fn a_negative_repayment_walks_the_counter_back() {
        // reachable, and inherited: the clamp caps overpayment only
        let mut v = vec![];
        add_loan(
            &mut v,
            "l0".into(),
            "张三".into(),
            LoanKind::Lend,
            1_000.0,
            0,
        );
        repay_loan(&mut v, "l0", 300.0);
        repay_loan(&mut v, "l0", -100.0);
        assert_eq!(v[0].repaid, Some(200.0));
    }

    #[test]
    fn an_overpaid_loan_clamps_its_remaining_at_zero() {
        // repaid already past the principal: remaining is 0, not negative, so a
        // further payment adds nothing rather than subtracting
        let mut v = vec![Loan {
            id: "l0".into(),
            who: "张三".into(),
            kind: LoanKind::Lend,
            amt: 100.0,
            repaid: Some(150.0),
            ts: 0,
        }];
        repay_loan(&mut v, "l0", 50.0);
        assert_eq!(v[0].repaid, Some(150.0));
    }

    #[test]
    fn repaying_an_unknown_loan_does_nothing() {
        let mut v = vec![];
        add_loan(
            &mut v,
            "l0".into(),
            "张三".into(),
            LoanKind::Lend,
            1_000.0,
            0,
        );
        repay_loan(&mut v, "nope", 100.0);
        assert_eq!(v[0].repaid, Some(0.0));
    }

    #[test]
    fn loans_are_removed_by_id() {
        let mut v = vec![];
        add_loan(&mut v, "l0".into(), "张三".into(), LoanKind::Lend, 1.0, 0);
        remove_loan(&mut v, "l0");
        assert!(v.is_empty());
    }
}
