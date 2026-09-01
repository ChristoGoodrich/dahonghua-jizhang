//! Which entries touched one account, and by how much.
//!
//! Ported from `src/features/assets/acctRows.ts` — the account detail screen's
//! only real decision. The screen shows a list; what belongs on it, and what
//! number sits at the end of each row, is here.
//!
//! ## Three rules, none of them symmetric
//!
//! **A transfer appears twice, once per side, with a different delta each
//! time.** Leaving an account costs the amount *plus the fee*; arriving credits
//! the amount *plus any discount*. The fee is paid by the sender and the
//! discount is received by the recipient, so they attach to opposite sides and
//! a transfer's two rows are not negatives of each other. A port that treated
//! them as one signed number would be right for every transfer without a fee,
//! which is most of them.
//!
//! **An entry with no account at all belongs to `default`.** The ledger
//! predates accounts and still contains rows written before they existed; they
//! have to appear somewhere, and `default` is the account that cannot be
//! deleted. Note the asymmetry: this holds for ordinary entries and *not* for
//! transfers, which always name both sides explicitly.
//!
//! **Tombstones are skipped.** This is a display list, not a sync payload.

use crate::entry::{Entry, Io};

/// One row of an account's history: the entry, and what it did to the balance
/// *of this account*.
#[derive(Debug, Clone, PartialEq)]
pub struct AcctRow<'a> {
    pub entry: &'a Entry,
    /// Signed, in the base currency. Negative leaves the account.
    pub delta: f64,
}

/// The entries touching `id`, newest first.
///
/// An empty `id` matches nothing rather than everything — the screen reaches
/// here before its route parameter has arrived, and "no account selected" is
/// not the same question as "every account".
pub fn acct_rows<'a>(id: &str, data: &'a [Entry]) -> Vec<AcctRow<'a>> {
    if id.is_empty() {
        return Vec::new();
    }

    let mut out: Vec<AcctRow<'a>> = Vec::new();
    for d in data {
        if d.deleted_at.is_some() {
            continue;
        }

        if d.io == Some(Io::Xfer) {
            if d.acct.as_deref() == Some(id) {
                out.push(AcctRow {
                    entry: d,
                    delta: -(d.amt + d.fee.unwrap_or(0.0)),
                });
            } else if d.acct_to.as_deref() == Some(id) {
                out.push(AcctRow {
                    entry: d,
                    delta: d.amt + d.discount.unwrap_or(0.0),
                });
            }
        } else if d.acct.as_deref() == Some(id) || (no_account(d) && id == "default") {
            out.push(AcctRow {
                entry: d,
                delta: if d.io == Some(Io::Inc) { d.amt } else { -d.amt },
            });
        }
    }

    // `Array.prototype.sort` is stable in every engine this app runs on, and
    // the corpus contains entries sharing a timestamp — so this has to be a
    // stable sort too, or two rows on the same day swap places between the two
    // implementations and the parity run says so.
    out.sort_by_key(|r| std::cmp::Reverse(r.entry.ts));
    out
}

/// JavaScript's `!d.acct` — absent, and also the empty string.
///
/// The distinction is not academic: `acct: ''` is what a form writes when its
/// picker was never touched, and treating it as a named account would hide
/// those rows from every list.
fn no_account(d: &Entry) -> bool {
    match d.acct.as_deref() {
        None => true,
        Some(s) => s.is_empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(id: &str, ts: i64, amt: f64, io: Io) -> Entry {
        Entry {
            id: id.into(),
            ts,
            io: Some(io),
            cat: "food".into(),
            amt,
            ..Default::default()
        }
    }

    fn on(mut d: Entry, acct: &str) -> Entry {
        d.acct = Some(acct.into());
        d
    }

    #[test]
    fn an_expense_leaves_the_account() {
        let data = vec![on(e("a", 100, 12.0, Io::Exp), "wallet")];
        let rows = acct_rows("wallet", &data);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].delta, -12.0);
    }

    #[test]
    fn income_arrives() {
        let data = vec![on(e("a", 100, 12.0, Io::Inc), "wallet")];
        assert_eq!(acct_rows("wallet", &data)[0].delta, 12.0);
    }

    #[test]
    fn another_accounts_entries_are_not_here() {
        let data = vec![on(e("a", 100, 12.0, Io::Exp), "bank")];
        assert!(acct_rows("wallet", &data).is_empty());
    }

    #[test]
    fn a_tombstone_is_not_a_row() {
        let mut d = on(e("a", 100, 12.0, Io::Exp), "wallet");
        d.deleted_at = Some(1);
        assert!(acct_rows("wallet", std::slice::from_ref(&d)).is_empty());
    }

    #[test]
    fn an_entry_with_no_account_belongs_to_default() {
        let data = vec![e("a", 100, 12.0, Io::Exp)];
        assert_eq!(acct_rows("default", &data).len(), 1);
        assert!(acct_rows("wallet", &data).is_empty());
    }

    /// `!d.acct` in JavaScript, and an empty string is falsy.
    #[test]
    fn an_empty_account_string_also_belongs_to_default() {
        let data = vec![on(e("a", 100, 12.0, Io::Exp), "")];
        assert_eq!(acct_rows("default", &data).len(), 1);
    }

    /// The rule for a missing account does NOT extend to transfers, which
    /// always name both sides.
    #[test]
    fn a_transfer_with_no_account_is_not_defaults() {
        let mut d = e("a", 100, 12.0, Io::Xfer);
        d.acct = None;
        d.acct_to = None;
        assert!(acct_rows("default", std::slice::from_ref(&d)).is_empty());
    }

    #[test]
    fn a_transfer_out_pays_the_fee() {
        let mut d = on(e("a", 100, 100.0, Io::Xfer), "wallet");
        d.acct_to = Some("bank".into());
        d.fee = Some(2.0);
        let rows = acct_rows("wallet", std::slice::from_ref(&d));
        assert_eq!(rows.unwrap_one().delta, -102.0);
    }

    #[test]
    fn a_transfer_in_does_not_pay_the_fee() {
        let mut d = on(e("a", 100, 100.0, Io::Xfer), "wallet");
        d.acct_to = Some("bank".into());
        d.fee = Some(2.0);
        let rows = acct_rows("bank", std::slice::from_ref(&d));
        assert_eq!(rows.unwrap_one().delta, 100.0);
    }

    #[test]
    fn a_transfer_in_receives_the_discount() {
        let mut d = on(e("a", 100, 100.0, Io::Xfer), "wallet");
        d.acct_to = Some("bank".into());
        d.discount = Some(3.0);
        let rows = acct_rows("bank", std::slice::from_ref(&d));
        assert_eq!(rows.unwrap_one().delta, 103.0);
    }

    #[test]
    fn a_transfer_out_does_not_receive_the_discount() {
        let mut d = on(e("a", 100, 100.0, Io::Xfer), "wallet");
        d.acct_to = Some("bank".into());
        d.discount = Some(3.0);
        let rows = acct_rows("wallet", std::slice::from_ref(&d));
        assert_eq!(rows.unwrap_one().delta, -100.0);
    }

    /// The two sides of one transfer are not negatives of each other once a
    /// fee or a discount is involved, which is the whole reason they are
    /// computed separately.
    #[test]
    fn the_two_sides_of_a_transfer_do_not_cancel() {
        let mut d = on(e("a", 100, 100.0, Io::Xfer), "wallet");
        d.acct_to = Some("bank".into());
        d.fee = Some(2.0);
        d.discount = Some(3.0);

        let out = acct_rows("wallet", std::slice::from_ref(&d))[0].delta;
        let inn = acct_rows("bank", std::slice::from_ref(&d))[0].delta;
        assert_eq!(out, -102.0);
        assert_eq!(inn, 103.0);
        assert_ne!(out + inn, 0.0);
    }

    #[test]
    fn a_transfer_to_and_from_the_same_account_counts_once() {
        // The out-side is checked first and wins, which is what the `else if`
        // on the TypeScript side does.
        let mut d = on(e("a", 100, 100.0, Io::Xfer), "wallet");
        d.acct_to = Some("wallet".into());
        d.fee = Some(2.0);
        let rows = acct_rows("wallet", std::slice::from_ref(&d));
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].delta, -102.0);
    }

    #[test]
    fn rows_come_back_newest_first() {
        let data = vec![
            on(e("old", 100, 1.0, Io::Exp), "w"),
            on(e("new", 300, 1.0, Io::Exp), "w"),
            on(e("mid", 200, 1.0, Io::Exp), "w"),
        ];
        let ids: Vec<&str> = acct_rows("w", &data)
            .iter()
            .map(|r| r.entry.id.as_str())
            .collect();
        assert_eq!(ids, vec!["new", "mid", "old"]);
    }

    /// A stable sort, because JavaScript's is. Two entries on the same stamp
    /// keep the order they were in.
    #[test]
    fn a_shared_timestamp_keeps_its_original_order() {
        let data = vec![
            on(e("first", 100, 1.0, Io::Exp), "w"),
            on(e("second", 100, 1.0, Io::Exp), "w"),
        ];
        let ids: Vec<&str> = acct_rows("w", &data)
            .iter()
            .map(|r| r.entry.id.as_str())
            .collect();
        assert_eq!(ids, vec!["first", "second"]);
    }

    #[test]
    fn an_empty_id_matches_nothing_rather_than_everything() {
        let data = vec![on(e("a", 100, 12.0, Io::Exp), "wallet")];
        assert!(acct_rows("", &data).is_empty());
    }

    trait One {
        fn unwrap_one(&self) -> &AcctRow<'_>;
    }
    impl One for Vec<AcctRow<'_>> {
        fn unwrap_one(&self) -> &AcctRow<'_> {
            assert_eq!(self.len(), 1, "expected exactly one row");
            &self[0]
        }
    }
}
