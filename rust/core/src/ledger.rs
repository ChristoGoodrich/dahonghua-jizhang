//! The ledger: owned entry state, and the commands that change it.
//!
//! Ported from the core entry CRUD in `src/store/state.ts`. This is the first
//! module in the port that owns anything — everything before it was a function
//! over data handed in.
//!
//! **Time and identity are injected.** The TypeScript reaches for `Date.now()`
//! and an internal `newId()` inside each mutation, which makes a command
//! sequence unreproducible: run it twice and you get different stamps and
//! different ids. Here `now` and `id` are arguments. That is not a stylistic
//! preference — it is what lets a command sequence be replayed identically on
//! both sides and the resulting ledgers compared, which is the only way a
//! stateful port can be held to the same bar as the pure ones.
//!
//! Id *generation* stays outside the crate for the same reason it stays outside
//! `civil.rs`: it reads a clock and a random source, neither of which a pure
//! core should own.
//!
//! Tombstones are the other thing to know. Deleting does not remove a row; it
//! stamps `deleted_at` and leaves it in place so the deletion can be pushed to
//! other devices. Every display and calculation path filters on `is_live`.

use crate::entry::{Entry, Patch};

/// Owned entry list. Insertion-ordered, like the TypeScript array — the UI
/// sorts for display, and merge order matters to sync, so this deliberately
/// does not keep itself sorted.
#[derive(Debug, Clone, Default)]
pub struct Ledger {
    entries: Vec<Entry>,
}

/// Everything [`Ledger::unremove`] needs to reverse one [`Ledger::remove`].
///
/// Deliberately **not** a snapshot of the old rows. Replaying stale rows — with
/// their old `updated_at` and `field_ts` — is invisible to the sync push
/// watermark, so once the tombstone had been pushed the next pull would delete
/// the entry all over again. The undo therefore records only what to reverse,
/// and the reversal is written as fresh stamps.
#[derive(Debug, Clone, PartialEq)]
pub struct RemoveUndo {
    pub id: String,
    /// Refund incomes tombstoned along with the entry.
    pub child_ids: Vec<String>,
    /// The original whose refund counter was reduced, if any.
    pub refunded_id: Option<String>,
    /// That counter's value before the delete.
    pub prev_refund: Option<f64>,
}

/// Stamp a patch onto an entry: apply it, then record `now` against every field
/// it touched plus `updated_at`.
///
/// `field_ts` is what makes field-level merge possible — two devices editing
/// different fields of the same row both win. `field_ts` and `updated_at`
/// themselves are never given entries in `field_ts`; they are metadata about
/// the write, not part of it.
pub fn stamp(entry: &Entry, patch: &Patch, now: i64) -> Entry {
    let mut next = entry.clone();
    patch.apply_to(&mut next);
    for field in patch.touched() {
        next.field_ts.insert(field.to_string(), now);
    }
    next.updated_at = Some(now);
    next
}

impl Ledger {
    pub fn new() -> Self {
        Self::default()
    }

    /// Build from rows already on disk or pulled from sync. No stamping — these
    /// carry their own metadata.
    pub fn from_entries(entries: Vec<Entry>) -> Self {
        Ledger { entries }
    }

    /// Every row, tombstones included. Sync needs the tombstones; display does
    /// not — use [`Ledger::live`] there.
    pub fn all(&self) -> &[Entry] {
        &self.entries
    }

    /// Rows that have not been deleted.
    pub fn live(&self) -> impl Iterator<Item = &Entry> {
        self.entries.iter().filter(|e| e.is_live())
    }

    pub fn get(&self, id: &str) -> Option<&Entry> {
        self.entries.iter().find(|e| e.id == id)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Append a new entry. `id` and `now` come from the caller, and `ts` is
    /// `None` for "stamp it now" — a backdated entry passes its own.
    ///
    /// `ts` is an explicit `Option` rather than a sentinel value because the
    /// TypeScript writes `e.ts ?? now`, and `??` falls back only on null or
    /// undefined. Treating `0` as "absent" — which an earlier version of this
    /// did — quietly rewrites an entry dated at the epoch. Absurd as a real
    /// date, ordinary as a bug, and the parity harness found it.
    pub fn add(&mut self, mut entry: Entry, id: String, ts: Option<i64>, now: i64) -> &Entry {
        entry.id = id;
        entry.ts = ts.unwrap_or(now);
        entry.updated_at = Some(now);
        self.entries.push(entry);
        self.entries.last().expect("just pushed")
    }

    /// Append a row exactly as given — no id assignment, no stamping.
    ///
    /// `refundEntry` builds its linked income inline and pushes it onto the
    /// array rather than going through `addEntry`, so the row carries
    /// `updated_at` but no `field_ts`, and the current account does not move.
    /// Routing it through [`Ledger::add`] would be tidier and would change
    /// behaviour on both counts, so the seam is kept explicit instead.
    pub fn push_raw(&mut self, entry: Entry) {
        self.entries.push(entry);
    }

    /// Patch one entry. Unknown ids are ignored, matching the TypeScript's
    /// `map` — a no-op rather than an error, because the caller is a UI that
    /// may be acting on a row sync has since removed.
    pub fn update(&mut self, id: &str, patch: &Patch, now: i64) -> bool {
        match self.entries.iter_mut().find(|e| e.id == id) {
            Some(e) => {
                *e = stamp(e, patch, now);
                true
            }
            None => false,
        }
    }

    /// Soft-delete an entry, keeping refund bookkeeping consistent.
    ///
    /// Three things happen, and the order of the checks matters:
    ///
    /// 1. Deleting a refund income gives its amount back to the expense it
    ///    refunded. A counter that falls to zero is *cleared*, not set to 0 —
    ///    the TypeScript writes `refund || undefined`, and a stored 0 would
    ///    show a refund badge on an entry with no refunds.
    /// 2. The entry itself is tombstoned.
    /// 3. So is every refund income pointing at it, so deleting an expense does
    ///    not leave orphaned refunds behind.
    ///
    /// Returns `None` when the id is unknown.
    pub fn remove(&mut self, id: &str, now: i64) -> Option<RemoveUndo> {
        let target = self.get(id)?.clone();
        let mut undo = RemoveUndo {
            id: id.to_string(),
            child_ids: Vec::new(),
            refunded_id: None,
            prev_refund: None,
        };

        let mut next = Vec::with_capacity(self.entries.len());
        for e in &self.entries {
            // 1. hand the refunded amount back to the original
            if let (Some(refund_of), Some(refund)) = (target.refund_of.as_deref(), e.refund) {
                if e.id == refund_of && refund != 0.0 {
                    undo.refunded_id = Some(e.id.clone());
                    undo.prev_refund = Some(refund);
                    let left = (refund - target.amt).max(0.0);
                    let patch = if left == 0.0 {
                        Patch {
                            clear: vec!["refund"],
                            ..Default::default()
                        }
                    } else {
                        Patch {
                            refund: Some(left),
                            ..Default::default()
                        }
                    };
                    next.push(stamp(e, &patch, now));
                    continue;
                }
            }
            // 2 and 3. tombstone the entry and any refunds pointing at it
            if e.id == id || e.refund_of.as_deref() == Some(id) {
                if e.id != id {
                    undo.child_ids.push(e.id.clone());
                }
                let patch = Patch {
                    deleted_at: Some(now),
                    ..Default::default()
                };
                next.push(stamp(e, &patch, now));
                continue;
            }
            next.push(e.clone());
        }
        self.entries = next;
        Some(undo)
    }

    /// Reverse one [`Ledger::remove`] as **new** stamped writes: clear the
    /// tombstones and restore the refund counter with fresh field times, so the
    /// restore beats the already-pushed delete on every device instead of being
    /// quietly re-deleted by the next merge.
    pub fn unremove(&mut self, undo: &RemoveUndo, now: i64) {
        let restore: Vec<&str> = std::iter::once(undo.id.as_str())
            .chain(undo.child_ids.iter().map(|s| s.as_str()))
            .collect();

        let mut next = Vec::with_capacity(self.entries.len());
        for e in &self.entries {
            if restore.contains(&e.id.as_str()) {
                let patch = Patch {
                    clear: vec!["deletedAt"],
                    ..Default::default()
                };
                next.push(stamp(e, &patch, now));
                continue;
            }
            if undo.refunded_id.as_deref() == Some(e.id.as_str()) {
                let patch = match undo.prev_refund {
                    Some(v) => Patch {
                        refund: Some(v),
                        ..Default::default()
                    },
                    None => Patch {
                        clear: vec!["refund"],
                        ..Default::default()
                    },
                };
                next.push(stamp(e, &patch, now));
                continue;
            }
            next.push(e.clone());
        }
        self.entries = next;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::Io;

    fn expense(id: &str, amt: f64) -> Entry {
        Entry {
            id: id.into(),
            ts: 1_000,
            io: Some(Io::Exp),
            cat: "food".into(),
            amt,
            ..Default::default()
        }
    }

    fn seeded() -> Ledger {
        Ledger::from_entries(vec![expense("a", 100.0), expense("b", 50.0)])
    }

    #[test]
    fn adding_stamps_the_write_and_keeps_insertion_order() {
        let mut l = Ledger::new();
        l.add(expense("", 35.0), "e1".into(), Some(1_000), 7_000);
        l.add(expense("", 12.0), "e2".into(), Some(1_000), 7_001);
        assert_eq!(
            l.all().iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["e1", "e2"]
        );
        assert_eq!(l.get("e1").unwrap().updated_at, Some(7_000));
    }

    #[test]
    fn adding_without_a_timestamp_uses_now() {
        let mut l = Ledger::new();
        l.add(expense("", 35.0), "e1".into(), None, 7_000);
        assert_eq!(l.get("e1").unwrap().ts, 7_000);
    }

    #[test]
    fn an_entry_dated_at_the_epoch_keeps_that_date() {
        // 0 is a timestamp, not an absence
        let mut l = Ledger::new();
        l.add(expense("", 35.0), "e1".into(), Some(0), 7_000);
        assert_eq!(l.get("e1").unwrap().ts, 0);
    }

    #[test]
    fn a_backdated_entry_keeps_its_own_timestamp() {
        let mut l = Ledger::new();
        l.add(expense("", 35.0), "e1".into(), Some(1_000), 7_000);
        assert_eq!(l.get("e1").unwrap().ts, 1_000);
    }

    #[test]
    fn updating_records_a_time_against_each_touched_field() {
        let mut l = seeded();
        let patch = Patch {
            amt: Some(120.0),
            note: Some("rent".into()),
            ..Default::default()
        };
        assert!(l.update("a", &patch, 9_000));

        let e = l.get("a").unwrap();
        assert_eq!(e.amt, 120.0);
        assert_eq!(e.note.as_deref(), Some("rent"));
        assert_eq!(e.updated_at, Some(9_000));
        assert_eq!(e.field_ts.get("amt"), Some(&9_000));
        assert_eq!(e.field_ts.get("note"), Some(&9_000));
        assert_eq!(e.field_ts.get("cat"), None); // untouched
    }

    #[test]
    fn field_times_accumulate_across_edits() {
        let mut l = seeded();
        l.update(
            "a",
            &Patch {
                amt: Some(1.0),
                ..Default::default()
            },
            100,
        );
        l.update(
            "a",
            &Patch {
                note: Some("x".into()),
                ..Default::default()
            },
            200,
        );
        let e = l.get("a").unwrap();
        assert_eq!(e.field_ts.get("amt"), Some(&100)); // not rewritten
        assert_eq!(e.field_ts.get("note"), Some(&200));
        assert_eq!(e.updated_at, Some(200));
    }

    #[test]
    fn updating_an_unknown_id_is_a_no_op() {
        let mut l = seeded();
        assert!(!l.update(
            "nope",
            &Patch {
                amt: Some(1.0),
                ..Default::default()
            },
            100
        ));
        assert_eq!(l.len(), 2);
    }

    #[test]
    fn removing_tombstones_rather_than_deleting() {
        let mut l = seeded();
        let undo = l.remove("a", 9_000).unwrap();
        assert_eq!(undo.id, "a");
        assert_eq!(l.len(), 2); // still there
        assert_eq!(l.get("a").unwrap().deleted_at, Some(9_000));
        assert_eq!(l.live().count(), 1);
    }

    #[test]
    fn removing_an_unknown_id_yields_nothing() {
        let mut l = seeded();
        assert!(l.remove("nope", 9_000).is_none());
    }

    #[test]
    fn removing_an_expense_tombstones_the_refunds_pointing_at_it() {
        let mut refund = expense("r", 30.0);
        refund.io = Some(Io::Inc);
        refund.refund_of = Some("a".into());
        let mut l = Ledger::from_entries(vec![expense("a", 100.0), refund]);

        let undo = l.remove("a", 9_000).unwrap();
        assert_eq!(undo.child_ids, ["r"]);
        assert_eq!(l.get("r").unwrap().deleted_at, Some(9_000));
    }

    #[test]
    fn removing_a_refund_gives_the_amount_back_to_the_original() {
        let mut original = expense("a", 100.0);
        original.refund = Some(30.0);
        let mut refund = expense("r", 30.0);
        refund.io = Some(Io::Inc);
        refund.refund_of = Some("a".into());
        let mut l = Ledger::from_entries(vec![original, refund]);

        let undo = l.remove("r", 9_000).unwrap();
        assert_eq!(undo.refunded_id.as_deref(), Some("a"));
        assert_eq!(undo.prev_refund, Some(30.0));
        // fell to nothing, so it is cleared rather than stored as 0
        assert_eq!(l.get("a").unwrap().refund, None);
        assert_eq!(l.get("r").unwrap().deleted_at, Some(9_000));
    }

    #[test]
    fn a_partial_refund_leaves_the_remainder_on_the_counter() {
        let mut original = expense("a", 100.0);
        original.refund = Some(50.0);
        let mut refund = expense("r", 30.0);
        refund.refund_of = Some("a".into());
        let mut l = Ledger::from_entries(vec![original, refund]);

        l.remove("r", 9_000);
        assert_eq!(l.get("a").unwrap().refund, Some(20.0));
    }

    #[test]
    fn the_refund_counter_never_goes_negative() {
        let mut original = expense("a", 100.0);
        original.refund = Some(10.0);
        let mut refund = expense("r", 30.0); // more than was recorded
        refund.refund_of = Some("a".into());
        let mut l = Ledger::from_entries(vec![original, refund]);

        l.remove("r", 9_000);
        assert_eq!(l.get("a").unwrap().refund, None);
    }

    #[test]
    fn undo_restores_the_entry_and_its_children() {
        let mut refund = expense("r", 30.0);
        refund.refund_of = Some("a".into());
        let mut l = Ledger::from_entries(vec![expense("a", 100.0), refund]);

        let undo = l.remove("a", 9_000).unwrap();
        l.unremove(&undo, 9_500);

        assert!(l.get("a").unwrap().is_live());
        assert!(l.get("r").unwrap().is_live());
        assert_eq!(l.live().count(), 2);
    }

    #[test]
    fn undo_restores_the_refund_counter() {
        let mut original = expense("a", 100.0);
        original.refund = Some(30.0);
        let mut refund = expense("r", 30.0);
        refund.refund_of = Some("a".into());
        let mut l = Ledger::from_entries(vec![original, refund]);

        let undo = l.remove("r", 9_000).unwrap();
        assert_eq!(l.get("a").unwrap().refund, None);
        l.unremove(&undo, 9_500);
        assert_eq!(l.get("a").unwrap().refund, Some(30.0));
    }

    #[test]
    fn undo_writes_fresh_stamps_rather_than_replaying_the_old_row() {
        // the whole reason RemoveUndo is not a snapshot: a restore has to beat
        // the delete that sync already pushed
        let mut l = seeded();
        let undo = l.remove("a", 9_000).unwrap();
        l.unremove(&undo, 9_500);

        let e = l.get("a").unwrap();
        assert_eq!(e.updated_at, Some(9_500));
        assert_eq!(e.field_ts.get("deletedAt"), Some(&9_500));
    }

    #[test]
    fn live_hides_tombstones_from_display() {
        let mut l = seeded();
        l.remove("a", 9_000);
        assert_eq!(l.live().map(|e| e.id.as_str()).collect::<Vec<_>>(), ["b"]);
        assert_eq!(l.all().len(), 2);
    }
}
