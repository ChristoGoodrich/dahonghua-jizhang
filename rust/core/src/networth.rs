//! Assets, liabilities and loans — the things that make up net worth but are
//! not entries.
//!
//! Ported from `src/store/assets.ts`. Two details here run against the
//! falsy-means-absent habit the rest of the store has, and both are deliberate
//! in the TypeScript: a new asset is created with `noCount: false` and a new
//! loan with `repaid: 0`, both stored rather than left out. They are counters
//! and flags the user will change, not optional metadata.

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
