//! 批量处理 — what a selection of rows means, and what may be done to it.
//!
//! The screen owns which rows are ticked; everything downstream of that is a
//! decision, and decisions live here. Three of them:
//!
//! * **What the selection adds up to.** The header says "已选中 3 项 · 支出
//!   ¥128.50", and a screen that summed its own rows would be a second
//!   implementation of the sums the day headers already show.
//! * **Whether an action is offered at all.** A category belongs to one side
//!   of the ledger — 餐饮 is an expense category and 工资 an income one — so
//!   recategorising a mixed selection has no answer, and the action is not
//!   offered rather than being offered and then doing something arbitrary.
//! * **Which of the ticked rows an action actually writes.** Marking four
//!   rows 待报销 where one is income and one is already pending writes two,
//!   and the difference is what the screen reports back.
//!
//! The last is the reason this is a module and not three lines in the bridge.
//! A batch that silently skips rows is a batch the user has to audit by hand,
//! and a batch that does not skip them writes a reimbursement claim onto a
//! salary.

use crate::entry::{Entry, Io, Reimburse};

/// What a selection comes to.
///
/// Transfers are counted but summed into neither side, the same way they are
/// left out of every other total in the app: moving money between two of your
/// own accounts is not income and not spending.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Tally {
    pub count: usize,
    pub inc: f64,
    pub exp: f64,
}

pub fn tally<'a>(rows: impl IntoIterator<Item = &'a Entry>) -> Tally {
    let mut t = Tally::default();
    for e in rows {
        t.count += 1;
        match e.io {
            Some(Io::Inc) => t.inc += e.amt,
            Some(Io::Exp) => t.exp += e.amt,
            _ => {}
        }
    }
    t
}

/// The one side every selected row is on, if they are all on one.
///
/// `None` for a mixed selection, for an empty one, and for anything with a
/// transfer in it — a transfer's category is the sentinel `"transfer"`, and
/// offering to change it would break the row's meaning rather than edit it.
pub fn shared_io<'a>(rows: impl IntoIterator<Item = &'a Entry>) -> Option<Io> {
    let mut seen: Option<Io> = None;
    for e in rows {
        let io = match e.io {
            Some(Io::Inc) => Io::Inc,
            Some(Io::Exp) => Io::Exp,
            // a transfer, or a row with no side at all
            _ => return None,
        };
        if seen.is_some_and(|s| s != io) {
            return None;
        }
        seen = Some(io);
    }
    seen
}

/// Where a batch is trying to move the claim state.
///
/// `Cleared` is 取消报销 — dropping the claim, not leaving it alone. A named
/// variant rather than an `Option<Reimburse>`, because "maybe a state" reads
/// as "no change" and would silently make clearing a no-op.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimTo {
    Pending,
    Done,
    Cleared,
}

impl ClaimTo {
    fn matches(self, rb: Option<Reimburse>) -> bool {
        match self {
            ClaimTo::Pending => rb == Some(Reimburse::Pending),
            ClaimTo::Done => rb == Some(Reimburse::Done),
            ClaimTo::Cleared => rb.is_none(),
        }
    }
}

/// The ids a claim change actually writes.
///
/// Two filters, and both matter. **Expenses only** — reimbursement is money
/// you laid out coming back, and there is no such thing for income; the
/// single-row menu never offers it on an income row and neither does this.
/// **And only rows not already there** — writing `pending` onto a row that is
/// already pending would stamp `rb` with a fresh time for no change, which the
/// merge would then hand to this device over another device's real edit.
///
/// A settled claim moving to `Cleared` is included: dropping a claim is a
/// stamped write precisely so it beats a device still holding `pending`.
pub fn claim_targets<'a>(rows: impl IntoIterator<Item = &'a Entry>, to: ClaimTo) -> Vec<String> {
    rows.into_iter()
        .filter(|e| e.io == Some(Io::Exp))
        .filter(|e| !to.matches(e.rb))
        .map(|e| e.id.clone())
        .collect()
}

/// How many of the selected rows a claim change could ever touch.
///
/// Not `claim_targets(.., to).len()`, which answers for one destination: the
/// screen asks this to decide whether to OFFER 报销 at all, before the user has
/// picked a state. Zero means the selection is all income and transfers, and
/// the button is dimmed rather than being offered and then writing nothing.
pub fn claimable<'a>(rows: impl IntoIterator<Item = &'a Entry>) -> usize {
    rows.into_iter().filter(|e| e.io == Some(Io::Exp)).count()
}

/// The ids a recategorisation writes.
///
/// Rows already in that category are left alone, for the same stamping reason
/// as [`claim_targets`], and rows on the other side of the ledger are not
/// there at all — [`shared_io`] is what the screen asks before offering this,
/// and this is what holds if it asked wrongly.
pub fn category_targets<'a>(
    rows: impl IntoIterator<Item = &'a Entry>,
    io: Io,
    cat: &str,
) -> Vec<String> {
    rows.into_iter()
        .filter(|e| e.io == Some(io) && e.cat != cat)
        .map(|e| e.id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(id: &str, io: Option<Io>, amt: f64) -> Entry {
        Entry {
            id: id.to_string(),
            io,
            amt,
            cat: "food".to_string(),
            ..Default::default()
        }
    }

    fn claimed(id: &str, rb: Option<Reimburse>) -> Entry {
        Entry {
            rb,
            ..e(id, Some(Io::Exp), 10.0)
        }
    }

    #[test]
    fn a_transfer_is_counted_but_summed_into_neither_side() {
        let rows = [
            e("a", Some(Io::Exp), 30.0),
            e("b", Some(Io::Inc), 100.0),
            e("c", Some(Io::Xfer), 500.0),
        ];
        let t = tally(rows.iter());
        assert_eq!(t.count, 3);
        assert_eq!(t.exp, 30.0);
        assert_eq!(t.inc, 100.0);
    }

    #[test]
    fn one_side_is_shared_and_a_mix_is_not() {
        let exp = [e("a", Some(Io::Exp), 1.0), e("b", Some(Io::Exp), 2.0)];
        assert_eq!(shared_io(exp.iter()), Some(Io::Exp));

        let mixed = [e("a", Some(Io::Exp), 1.0), e("b", Some(Io::Inc), 2.0)];
        assert_eq!(shared_io(mixed.iter()), None);

        let empty: [Entry; 0] = [];
        assert_eq!(shared_io(empty.iter()), None, "nothing shares nothing");
    }

    /// A transfer has no side to recategorise onto, so one in the selection
    /// takes the action away from all of it.
    #[test]
    fn a_transfer_in_the_selection_blocks_recategorising() {
        let rows = [e("a", Some(Io::Exp), 1.0), e("x", Some(Io::Xfer), 2.0)];
        assert_eq!(shared_io(rows.iter()), None);
    }

    #[test]
    fn only_expenses_can_be_claimed() {
        let rows = [
            e("exp", Some(Io::Exp), 10.0),
            e("inc", Some(Io::Inc), 10.0),
            e("xfer", Some(Io::Xfer), 10.0),
        ];
        assert_eq!(claim_targets(rows.iter(), ClaimTo::Pending), vec!["exp"]);
    }

    /// The stamping rule, as a test: a row already in the state is not
    /// rewritten, because the write would carry a time that beats another
    /// device's real edit.
    #[test]
    fn a_row_already_there_is_not_written_again() {
        let rows = [
            claimed("none", None),
            claimed("pending", Some(Reimburse::Pending)),
            claimed("done", Some(Reimburse::Done)),
        ];
        assert_eq!(
            claim_targets(rows.iter(), ClaimTo::Pending),
            vec!["none", "done"]
        );
        assert_eq!(
            claim_targets(rows.iter(), ClaimTo::Done),
            vec!["none", "pending"]
        );
        assert_eq!(
            claim_targets(rows.iter(), ClaimTo::Cleared),
            vec!["pending", "done"],
            "clearing writes, and only where there is a claim to clear"
        );
    }

    /// What the screen asks before offering the button, and it is not the
    /// same question as "how many would this particular state write".
    #[test]
    fn claimable_counts_expenses_whatever_state_they_are_in() {
        let rows = [
            claimed("a", None),
            claimed("b", Some(Reimburse::Pending)),
            e("c", Some(Io::Inc), 1.0),
        ];
        assert_eq!(claimable(rows.iter()), 2);
        assert_eq!(
            claim_targets(rows.iter(), ClaimTo::Pending).len(),
            1,
            "b is already pending; the button is still offered"
        );
        let none = [e("c", Some(Io::Inc), 1.0)];
        assert_eq!(claimable(none.iter()), 0);
    }

    #[test]
    fn recategorising_skips_the_rows_already_in_it() {
        let mut rows = [
            e("a", Some(Io::Exp), 1.0),
            e("b", Some(Io::Exp), 2.0),
            e("c", Some(Io::Inc), 3.0),
        ];
        rows[1].cat = "transport".to_string();
        assert_eq!(
            category_targets(rows.iter(), Io::Exp, "food"),
            vec!["b"],
            "a is already food; c is the other side"
        );
    }
}
