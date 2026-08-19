//! Reimbursement claims and refunds.
//!
//! Ported from `src/store/reimburse.ts`. Every write here goes through the
//! ledger's stamping, and the TypeScript says why in a comment worth repeating:
//! writing `rb`/`rb_amt`/`refund` without a per-field time left them to the
//! merge's content tiebreak, so marking an expense 已报销 on one device could be
//! silently reverted to 待报销 by a staler one. Clearing is a stamped write for
//! the same reason — it has to beat a device still holding `pending`.

use crate::catalog::{cat_name, cat_of, Category};
use crate::entry::{Entry, Io, Patch, Reimburse};
use crate::ledger::Ledger;

/// Cycle the claim state.
///
/// Only `pending` clears; **`done` goes back to `pending`**, not to nothing.
/// The TypeScript tests `rb === 'pending'` rather than `rb != null`, so a
/// settled claim re-opens rather than disappearing.
pub fn toggle_reimburse(ledger: &mut Ledger, id: &str, now: i64) -> bool {
    let is_pending = match ledger.get(id) {
        Some(e) => e.rb == Some(Reimburse::Pending),
        None => return false,
    };
    let patch = if is_pending {
        Patch {
            clear: vec!["rb"],
            ..Default::default()
        }
    } else {
        Patch {
            rb: Some(Reimburse::Pending),
            ..Default::default()
        }
    };
    ledger.update(id, &patch, now)
}

/// Settle a claim, recording how much came back. `rb_amt` is the entry's full
/// amount — the UI has no partial-claim affordance.
pub fn confirm_reimburse(ledger: &mut Ledger, id: &str, now: i64) -> bool {
    let amt = match ledger.get(id) {
        Some(e) => e.amt,
        None => return false,
    };
    let patch = Patch {
        rb: Some(Reimburse::Done),
        rb_amt: Some(amt),
        ..Default::default()
    };
    ledger.update(id, &patch, now)
}

/// Drop the claim entirely, state and amount together.
pub fn unmark_reimburse(ledger: &mut Ledger, id: &str, now: i64) -> bool {
    let patch = Patch {
        clear: vec!["rb", "rbAmt"],
        ..Default::default()
    };
    ledger.update(id, &patch, now)
}

/// Refund part or all of an expense.
///
/// Two things happen: the original's `refund` counter goes up, and a linked
/// income is logged so the balances reflect money coming back. Returns how much
/// was actually refunded, which is `0` when the id is unknown, when the expense
/// is already fully refunded, or when the amount is not positive.
///
/// The new income is pushed **raw**, not through the ledger's `add`: the
/// TypeScript builds the row inline and appends it, so it carries `updated_at`
/// but no `field_ts`, and it does not move the current account the way
/// `addEntry` would. Routing it through `add` would have been tidier and would
/// have changed behaviour on both counts.
#[allow(clippy::too_many_arguments)]
pub fn refund_entry(
    ledger: &mut Ledger,
    id: &str,
    amount: f64,
    zh: bool,
    custom_cats: &[Category],
    current_account: &str,
    new_id: String,
    now: i64,
) -> f64 {
    let (already, amt, io, cat, note, acct) = match ledger.get(id) {
        Some(e) => (
            e.refund.unwrap_or(0.0),
            e.amt,
            e.io.unwrap_or(Io::Exp),
            e.cat.clone(),
            e.note.clone().unwrap_or_default(),
            e.acct.clone(),
        ),
        None => return 0.0,
    };

    let r = amount.min(amt - already);
    if r <= 0.0 {
        return 0.0;
    }

    let label = if note.is_empty() {
        cat_name(&cat_of(io, &cat, custom_cats), zh)
    } else {
        note
    };
    let prefix = if zh { "退款·" } else { "Refund·" };

    ledger.update(
        id,
        &Patch {
            refund: Some(already + r),
            ..Default::default()
        },
        now,
    );

    let income = Entry {
        id: new_id,
        ts: now,
        io: Some(Io::Inc),
        cat: "other".into(),
        amt: r,
        note: Some(format!("{prefix}{label}")),
        acct: Some(match acct {
            Some(a) if !a.is_empty() => a,
            _ => current_account.to_string(),
        }),
        refund_of: Some(id.to_string()),
        updated_at: Some(now),
        ..Default::default()
    };
    ledger.push_raw(income);
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expense(id: &str, amt: f64) -> Entry {
        Entry {
            id: id.into(),
            ts: 1_000,
            io: Some(Io::Exp),
            cat: "food".into(),
            amt,
            acct: Some("a1".into()),
            ..Default::default()
        }
    }

    fn ledger() -> Ledger {
        Ledger::from_entries(vec![expense("e0", 100.0)])
    }

    #[test]
    fn toggling_marks_an_unclaimed_expense_pending() {
        let mut l = ledger();
        assert!(toggle_reimburse(&mut l, "e0", 9_000));
        assert_eq!(l.get("e0").unwrap().rb, Some(Reimburse::Pending));
        assert_eq!(l.get("e0").unwrap().field_ts.get("rb"), Some(&9_000));
    }

    #[test]
    fn toggling_a_pending_claim_clears_it() {
        let mut l = ledger();
        toggle_reimburse(&mut l, "e0", 9_000);
        toggle_reimburse(&mut l, "e0", 9_100);
        assert_eq!(l.get("e0").unwrap().rb, None);
        // the clear is stamped too, so it beats a device still holding pending
        assert_eq!(l.get("e0").unwrap().field_ts.get("rb"), Some(&9_100));
    }

    #[test]
    fn toggling_a_settled_claim_reopens_it_rather_than_clearing() {
        // `rb === 'pending'`, not `rb != null`
        let mut l = ledger();
        confirm_reimburse(&mut l, "e0", 9_000);
        toggle_reimburse(&mut l, "e0", 9_100);
        assert_eq!(l.get("e0").unwrap().rb, Some(Reimburse::Pending));
    }

    #[test]
    fn confirming_records_the_full_amount() {
        let mut l = ledger();
        confirm_reimburse(&mut l, "e0", 9_000);
        let e = l.get("e0").unwrap();
        assert_eq!(e.rb, Some(Reimburse::Done));
        assert_eq!(e.rb_amt, Some(100.0));
    }

    #[test]
    fn unmarking_drops_state_and_amount_together() {
        let mut l = ledger();
        confirm_reimburse(&mut l, "e0", 9_000);
        unmark_reimburse(&mut l, "e0", 9_100);
        let e = l.get("e0").unwrap();
        assert_eq!(e.rb, None);
        assert_eq!(e.rb_amt, None);
        assert_eq!(e.field_ts.get("rbAmt"), Some(&9_100));
    }

    #[test]
    fn claim_operations_on_an_unknown_id_do_nothing() {
        let mut l = ledger();
        assert!(!toggle_reimburse(&mut l, "nope", 9_000));
        assert!(!confirm_reimburse(&mut l, "nope", 9_000));
        assert!(!unmark_reimburse(&mut l, "nope", 9_000));
        assert_eq!(l.len(), 1);
    }

    #[test]
    fn a_refund_bumps_the_counter_and_logs_a_linked_income() {
        let mut l = ledger();
        let r = refund_entry(&mut l, "e0", 30.0, true, &[], "default", "r0".into(), 9_000);
        assert_eq!(r, 30.0);

        assert_eq!(l.get("e0").unwrap().refund, Some(30.0));
        let inc = l.get("r0").unwrap();
        assert_eq!(inc.io, Some(Io::Inc));
        assert_eq!(inc.amt, 30.0);
        assert_eq!(inc.cat, "other");
        assert_eq!(inc.refund_of.as_deref(), Some("e0"));
        assert_eq!(inc.acct.as_deref(), Some("a1")); // the original's account
    }

    #[test]
    fn the_refund_income_carries_no_field_times() {
        // pushed raw rather than through Ledger::add, matching the TypeScript
        let mut l = ledger();
        refund_entry(&mut l, "e0", 30.0, true, &[], "default", "r0".into(), 9_000);
        let inc = l.get("r0").unwrap();
        assert_eq!(inc.updated_at, Some(9_000));
        assert!(inc.field_ts.is_empty());
    }

    #[test]
    fn a_refund_is_capped_at_what_is_left() {
        let mut l = ledger();
        let r = refund_entry(
            &mut l,
            "e0",
            500.0,
            true,
            &[],
            "default",
            "r0".into(),
            9_000,
        );
        assert_eq!(r, 100.0);
        assert_eq!(l.get("e0").unwrap().refund, Some(100.0));
    }

    #[test]
    fn refunds_accumulate_up_to_the_original() {
        let mut l = ledger();
        refund_entry(&mut l, "e0", 60.0, true, &[], "default", "r0".into(), 9_000);
        let second = refund_entry(&mut l, "e0", 60.0, true, &[], "default", "r1".into(), 9_100);
        assert_eq!(second, 40.0);
        assert_eq!(l.get("e0").unwrap().refund, Some(100.0));
    }

    #[test]
    fn a_fully_refunded_expense_refunds_nothing_more() {
        let mut l = ledger();
        refund_entry(
            &mut l,
            "e0",
            100.0,
            true,
            &[],
            "default",
            "r0".into(),
            9_000,
        );
        let again = refund_entry(&mut l, "e0", 10.0, true, &[], "default", "r1".into(), 9_100);
        assert_eq!(again, 0.0);
        assert!(l.get("r1").is_none()); // no income logged
    }

    #[test]
    fn a_non_positive_refund_does_nothing() {
        let mut l = ledger();
        assert_eq!(
            refund_entry(&mut l, "e0", 0.0, true, &[], "default", "r0".into(), 9_000),
            0.0
        );
        assert_eq!(
            refund_entry(&mut l, "e0", -5.0, true, &[], "default", "r1".into(), 9_000),
            0.0
        );
        assert_eq!(l.len(), 1);
    }

    #[test]
    fn refunding_an_unknown_entry_does_nothing() {
        let mut l = ledger();
        assert_eq!(
            refund_entry(
                &mut l,
                "nope",
                10.0,
                true,
                &[],
                "default",
                "r0".into(),
                9_000
            ),
            0.0
        );
        assert_eq!(l.len(), 1);
    }

    #[test]
    fn the_note_uses_the_original_note_when_it_has_one() {
        let mut l = Ledger::from_entries(vec![Entry {
            note: Some("肯德基".into()),
            ..expense("e0", 100.0)
        }]);
        refund_entry(&mut l, "e0", 30.0, true, &[], "default", "r0".into(), 9_000);
        assert_eq!(l.get("r0").unwrap().note.as_deref(), Some("退款·肯德基"));
    }

    #[test]
    fn the_note_falls_back_to_the_category_name() {
        let mut l = ledger();
        refund_entry(&mut l, "e0", 30.0, true, &[], "default", "r0".into(), 9_000);
        assert_eq!(l.get("r0").unwrap().note.as_deref(), Some("退款·餐饮"));

        let mut l = ledger();
        refund_entry(
            &mut l,
            "e0",
            30.0,
            false,
            &[],
            "default",
            "r0".into(),
            9_000,
        );
        assert_eq!(l.get("r0").unwrap().note.as_deref(), Some("Refund·Food"));
    }

    #[test]
    fn an_entry_without_an_account_falls_back_to_the_current_one() {
        let mut l = Ledger::from_entries(vec![Entry {
            acct: None,
            ..expense("e0", 100.0)
        }]);
        refund_entry(&mut l, "e0", 30.0, true, &[], "a9", "r0".into(), 9_000);
        assert_eq!(l.get("r0").unwrap().acct.as_deref(), Some("a9"));
    }
}
