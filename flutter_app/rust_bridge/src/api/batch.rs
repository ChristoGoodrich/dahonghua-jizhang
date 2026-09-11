//! 批量处理 across the FFI boundary.
//!
//! Every command here is the single-row command in a loop, deliberately. The
//! single-row paths already mark their rows dirty, already stamp per field,
//! and in the case of a delete already tombstone the refund incomes and rewind
//! the original's refund counter. A batch that reached into the ledger itself
//! would be a second implementation of all three, and the third is the one
//! nobody would think to test.
//!
//! Which rows a loop runs over is `core::batch`'s answer, not this file's, and
//! not the screen's. What is left here is the ordering the lock forces:
//! **read, drop, then write.** The store's mutex is not reentrant, so holding
//! a read guard while calling a command that takes its own is a deadlock — the
//! app would freeze on the first batch rather than fail on it.

use dahonghua_core::batch as core;
use dahonghua_core::entry::Io;
use dahonghua_core::reimburse;
use flutter_rust_bridge::frb;

use super::store::{by_id, store, store_mut, EntryPatch, UndoToken};

/// What the selection header says.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct BatchTally {
    pub count: u32,
    pub inc: f64,
    pub exp: f64,
    /// `inc` or `exp` when every selected row is on that side, otherwise
    /// absent. The screen offers 改分类 only when there is one, because a
    /// category belongs to a side and a mixed selection has no answer.
    pub shared_io: Option<String>,
    /// How many rows a claim change could touch. The screen offers 报销 only
    /// when this is not zero — reimbursement is an expense's business, and the
    /// rule for that lives in `core::batch`, not in the button.
    pub claimable: u32,
}

/// Where a batch is moving the claim state. `Cleared` drops the claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimTo {
    Pending,
    Done,
    Cleared,
}

impl From<ClaimTo> for core::ClaimTo {
    fn from(t: ClaimTo) -> Self {
        match t {
            ClaimTo::Pending => core::ClaimTo::Pending,
            ClaimTo::Done => core::ClaimTo::Done,
            ClaimTo::Cleared => core::ClaimTo::Cleared,
        }
    }
}

/// Look the ids up, skipping the ones the ledger does not have.
///
/// Takes the ids by reference and returns owned rows so the caller can drop
/// the guard before writing. Cloning a handful of entries costs nothing next
/// to the deadlock the alternative buys.
fn rows(ids: &[String]) -> Vec<dahonghua_core::entry::Entry> {
    let s = store();
    let by = by_id(&s);
    ids.iter()
        .filter_map(|id| by.get(id.as_str()).copied())
        .filter(|e| e.is_live())
        .cloned()
        .collect()
}

#[frb(sync)]
pub fn tally(ids: Vec<String>) -> BatchTally {
    let rows = rows(&ids);
    let t = core::tally(rows.iter());
    BatchTally {
        count: t.count as u32,
        inc: t.inc,
        exp: t.exp,
        shared_io: core::shared_io(rows.iter()).map(|io| io.as_str().to_string()),
        claimable: core::claimable(rows.iter()) as u32,
    }
}

/// Delete every selected row, newest write last, returning one token each.
///
/// The tokens come back in the order they were taken and go back in the same
/// order. That matters for a refund pair: deleting the expense tombstones its
/// refund income too, and putting them back the other way round would restore
/// an income pointing at a row that is still deleted.
#[frb(sync)]
pub fn remove_all(ids: Vec<String>, now: i64) -> Vec<UndoToken> {
    ids.into_iter()
        .filter_map(|id| super::store::remove_entry(id, now))
        .collect()
}

/// Put back what [`remove_all`] took, as fresh stamped writes.
#[frb(sync)]
pub fn unremove_all(undo: Vec<UndoToken>, now: i64) {
    for u in undo {
        super::store::unremove_entry(u, now);
    }
}

/// Move every selected row on one side of the ledger into a category.
///
/// Returns how many rows were actually written, which is not the size of the
/// selection: rows already in that category are left alone so their `cat`
/// stamp does not jump ahead of another device's real edit.
#[frb(sync)]
pub fn categorize(ids: Vec<String>, io: String, cat: String, now: i64) -> u32 {
    let Some(io) = Io::parse(&io) else {
        return 0;
    };
    let targets = core::category_targets(rows(&ids).iter(), io, &cat);
    let mut n = 0;
    for id in targets {
        let patch = EntryPatch {
            cat: Some(cat.clone()),
            ..Default::default()
        };
        if super::store::update_entry(id, patch, now) {
            n += 1;
        }
    }
    n
}

/// Move every selected expense's claim to one state.
///
/// Returns how many rows were written. Income and transfers are not among
/// them and neither are rows already in that state — `core::batch` decides
/// both, and the screen reports the difference so a batch that touched two of
/// four rows says so.
///
/// `Pending` goes through the toggle rather than a patch of its own: the
/// toggle clears a pending claim and sets everything else to pending, and the
/// targets never include a row that is already pending, so it always lands
/// where it was asked to. Using the shipping function is what keeps the
/// stamping rule in one place.
#[frb(sync)]
pub fn set_claim(ids: Vec<String>, to: ClaimTo, now: i64) -> u32 {
    let targets = core::claim_targets(rows(&ids).iter(), to.into());
    if targets.is_empty() {
        return 0;
    }
    // One wide mark for the whole batch rather than one narrow mark per row:
    // the reimburse commands take the wide mark anyway, and taking it once is
    // the cheaper of the two.
    let mut s = store_mut();
    let mut n = 0;
    for id in &targets {
        let ok = match to {
            ClaimTo::Pending => reimburse::toggle_reimburse(&mut s.ledger, id, now),
            ClaimTo::Done => reimburse::confirm_reimburse(&mut s.ledger, id, now),
            ClaimTo::Cleared => reimburse::unmark_reimburse(&mut s.ledger, id, now),
        };
        if ok {
            n += 1;
        }
    }
    n
}
