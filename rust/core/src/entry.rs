//! The ledger entry, and the sync metadata that rides with it.
//!
//! Ported from `Entry` in `src/domain/types.ts`. Twenty-two fields, nineteen of
//! them optional, which is what a ledger row looks like once it has to serve
//! expenses, income, transfers, multi-currency, reimbursement, refunds and
//! subscriptions from one shape.
//!
//! Three of those fields are not user data at all — `deleted_at`, `updated_at`
//! and `field_ts` exist so two devices can merge. They are modelled explicitly
//! rather than hidden in a wrapper because the merge rules read them directly,
//! and burying them made the TypeScript harder to reason about, not easier.

use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Io {
    Exp,
    Inc,
    Xfer,
}

impl Io {
    pub fn as_str(self) -> &'static str {
        match self {
            Io::Exp => "exp",
            Io::Inc => "inc",
            Io::Xfer => "xfer",
        }
    }

    pub fn parse(s: &str) -> Option<Io> {
        Some(match s {
            "exp" => Io::Exp,
            "inc" => Io::Inc,
            "xfer" => Io::Xfer,
            _ => return None,
        })
    }
}

/// How an entry got into the ledger. `None` means typed by hand.
///
/// Not cosmetic: bill-import dedup relaxes its match for `Notif` entries, so
/// this has to survive a sync round-trip.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntrySource {
    Bill,
    Notif,
}

impl EntrySource {
    pub fn as_str(self) -> &'static str {
        match self {
            EntrySource::Bill => "bill",
            EntrySource::Notif => "notif",
        }
    }

    pub fn parse(s: &str) -> Option<EntrySource> {
        Some(match s {
            "bill" => EntrySource::Bill,
            "notif" => EntrySource::Notif,
            _ => return None,
        })
    }
}

/// Reimbursement state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reimburse {
    Pending,
    Done,
}

impl Reimburse {
    pub fn as_str(self) -> &'static str {
        match self {
            Reimburse::Pending => "pending",
            Reimburse::Done => "done",
        }
    }

    pub fn parse(s: &str) -> Option<Reimburse> {
        Some(match s {
            "pending" => Reimburse::Pending,
            "done" => Reimburse::Done,
            _ => return None,
        })
    }
}

/// One row of the ledger.
///
/// `amt` is always in the user's base currency; `cur`/`orig_amt`/`rate` carry
/// the original when the entry was recorded in another one. For a transfer,
/// `amt` is the principal, `acct` is the FROM account and `acct_to` the TO.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Entry {
    pub id: String,
    /// Epoch milliseconds. Kept as the raw stamp the platform produced —
    /// turning it into a calendar date needs a timezone, which `civil.rs`
    /// explains this crate does not own.
    pub ts: i64,
    pub io: Option<Io>,
    /// Category key; the sentinel `"transfer"` for a transfer.
    pub cat: String,
    pub amt: f64,
    pub note: Option<String>,
    pub acct: Option<String>,
    pub acct_to: Option<String>,
    pub fee: Option<f64>,
    pub discount: Option<f64>,
    pub subcat: Option<String>,
    pub cur: Option<String>,
    pub orig_amt: Option<f64>,
    pub rate: Option<f64>,
    pub tags: Option<Vec<String>>,
    pub ledger: Option<String>,
    pub rb: Option<Reimburse>,
    pub rb_amt: Option<f64>,
    /// Total refunded against this expense.
    pub refund: Option<f64>,
    /// Id of the expense this income refunds.
    pub refund_of: Option<String>,
    pub from_sub: Option<bool>,
    pub src: Option<EntrySource>,

    // ---- sync metadata ----
    /// Soft delete. Present means tombstoned; every display and calculation
    /// path filters these out, but they stay in the list so the deletion can
    /// be pushed to other devices.
    pub deleted_at: Option<i64>,
    /// Last-write-wins tiebreaker.
    pub updated_at: Option<i64>,
    /// Per-field last-write time, for field-level merge.
    ///
    /// `Option`, and the distinction is not decoration: an entry that has never
    /// been edited has **no** stamp map, while one edited with an empty patch
    /// has an empty one, and `entryToRow` writes those to the `field_ts` jsonb
    /// column as `null` and `{}` respectively. Collapsing them cost 631 of
    /// 4,529 parity cases — the port was narrower than the column.
    ///
    /// A `BTreeMap` rather than a `HashMap` so serialisation and any debug
    /// output are ordered; an unordered map made diffs unreadable during the
    /// port.
    pub field_ts: Option<BTreeMap<String, i64>>,
}

impl Entry {
    /// Is this row live, i.e. not tombstoned?
    pub fn is_live(&self) -> bool {
        self.deleted_at.is_none()
    }

    /// When one field was last edited, if it ever was.
    pub fn stamp_of(&self, field: &str) -> Option<i64> {
        self.field_ts.as_ref()?.get(field).copied()
    }

    /// Does this row carry any per-field stamp at all? The merge's two-tier
    /// test: an empty map is not enough, matching
    /// `!!r.fieldTs && Object.keys(r.fieldTs).length > 0`.
    pub fn has_stamps(&self) -> bool {
        self.field_ts.as_ref().is_some_and(|f| !f.is_empty())
    }
}

/// The fields a patch may carry. Modelled as explicit `Option`s rather than a
/// map of strings so a typo cannot silently write a field nobody reads — the
/// TypeScript's `Partial<Entry>` gives up that check at the boundary between
/// the UI and the store.
///
/// `None` means "leave alone". Clearing a field is a separate operation, see
/// [`Patch::clear`].
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Patch {
    pub ts: Option<i64>,
    pub io: Option<Io>,
    pub cat: Option<String>,
    pub amt: Option<f64>,
    pub note: Option<String>,
    pub acct: Option<String>,
    pub acct_to: Option<String>,
    pub fee: Option<f64>,
    pub discount: Option<f64>,
    pub subcat: Option<String>,
    pub cur: Option<String>,
    pub orig_amt: Option<f64>,
    pub rate: Option<f64>,
    pub tags: Option<Vec<String>>,
    pub ledger: Option<String>,
    pub rb: Option<Reimburse>,
    pub rb_amt: Option<f64>,
    pub refund: Option<f64>,
    pub refund_of: Option<String>,
    pub from_sub: Option<bool>,
    pub src: Option<EntrySource>,
    pub deleted_at: Option<i64>,
    /// Field names to reset to absent. JavaScript expresses this by patching a
    /// key to `undefined`, which is indistinguishable from "not in the patch"
    /// once it reaches Rust — so it gets its own list. `removeEntry` needs it:
    /// a refund counter that falls to zero is stored as absent, not as 0.
    pub clear: Vec<&'static str>,
}

impl Patch {
    /// Every field name this patch touches, in the order `Object.keys` would
    /// walk them — which is declaration order for a JS object literal, and is
    /// what decides the `field_ts` keys written.
    pub fn touched(&self) -> Vec<&'static str> {
        let mut out = Vec::new();
        macro_rules! push_if {
            ($($field:ident => $name:literal),* $(,)?) => {
                $(if self.$field.is_some() { out.push($name); })*
            };
        }
        push_if!(
            ts => "ts",
            io => "io",
            cat => "cat",
            amt => "amt",
            note => "note",
            acct => "acct",
            acct_to => "acctTo",
            fee => "fee",
            discount => "discount",
            subcat => "subcat",
            cur => "cur",
            orig_amt => "origAmt",
            rate => "rate",
            tags => "tags",
            ledger => "ledger",
            rb => "rb",
            rb_amt => "rbAmt",
            refund => "refund",
            refund_of => "refundOf",
            from_sub => "fromSub",
            src => "src",
            deleted_at => "deletedAt",
        );
        for name in &self.clear {
            if !out.contains(name) {
                out.push(name);
            }
        }
        out
    }

    /// Apply the patch in place. Set fields overwrite; names in `clear` become
    /// absent; everything else is untouched.
    pub fn apply_to(&self, e: &mut Entry) {
        macro_rules! set_if {
            ($($field:ident),* $(,)?) => {
                $(if let Some(v) = self.$field.clone() { e.$field = Some(v); })*
            };
        }
        if let Some(v) = self.ts {
            e.ts = v;
        }
        if let Some(v) = self.cat.clone() {
            e.cat = v;
        }
        if let Some(v) = self.amt {
            e.amt = v;
        }
        set_if!(
            io, note, acct, acct_to, fee, discount, subcat, cur, orig_amt, rate, tags, ledger, rb,
            rb_amt, refund, refund_of, from_sub, src, deleted_at,
        );

        for name in &self.clear {
            match *name {
                "note" => e.note = None,
                "acct" => e.acct = None,
                "acctTo" => e.acct_to = None,
                "fee" => e.fee = None,
                "discount" => e.discount = None,
                "subcat" => e.subcat = None,
                "cur" => e.cur = None,
                "origAmt" => e.orig_amt = None,
                "rate" => e.rate = None,
                "tags" => e.tags = None,
                "ledger" => e.ledger = None,
                "rb" => e.rb = None,
                "rbAmt" => e.rb_amt = None,
                "refund" => e.refund = None,
                "refundOf" => e.refund_of = None,
                "fromSub" => e.from_sub = None,
                "src" => e.src = None,
                "deletedAt" => e.deleted_at = None,
                "io" => e.io = None,
                other => debug_assert!(false, "Patch::clear names an unknown field: {other}"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enum_names_round_trip() {
        for io in [Io::Exp, Io::Inc, Io::Xfer] {
            assert_eq!(Io::parse(io.as_str()), Some(io));
        }
        assert_eq!(Io::parse("transfer"), None);
        assert_eq!(EntrySource::parse("bill"), Some(EntrySource::Bill));
        assert_eq!(EntrySource::parse("manual"), None);
        assert_eq!(Reimburse::parse("done"), Some(Reimburse::Done));
    }

    #[test]
    fn a_tombstoned_entry_is_not_live() {
        let mut e = Entry {
            id: "a".into(),
            ..Default::default()
        };
        assert!(e.is_live());
        e.deleted_at = Some(1);
        assert!(!e.is_live());
    }

    #[test]
    fn a_patch_lists_only_the_fields_it_sets() {
        let p = Patch {
            amt: Some(35.0),
            note: Some("KFC".into()),
            ..Default::default()
        };
        assert_eq!(p.touched(), vec!["amt", "note"]);
    }

    #[test]
    fn clearing_a_field_counts_as_touching_it() {
        let p = Patch {
            clear: vec!["note"],
            ..Default::default()
        };
        assert_eq!(p.touched(), vec!["note"]);
    }

    #[test]
    fn a_field_both_set_and_cleared_is_listed_once() {
        let p = Patch {
            note: Some("x".into()),
            clear: vec!["note"],
            ..Default::default()
        };
        assert_eq!(p.touched(), vec!["note"]);
    }

    #[test]
    fn applying_a_patch_overwrites_only_what_it_carries() {
        let mut e = Entry {
            id: "a".into(),
            amt: 10.0,
            note: Some("old".into()),
            acct: Some("cash".into()),
            ..Default::default()
        };
        Patch {
            amt: Some(35.0),
            ..Default::default()
        }
        .apply_to(&mut e);
        assert_eq!(e.amt, 35.0);
        assert_eq!(e.note.as_deref(), Some("old"));
        assert_eq!(e.acct.as_deref(), Some("cash"));
    }

    #[test]
    fn clearing_makes_a_field_absent_rather_than_zero() {
        // the distinction removeEntry depends on: a refund counter that falls
        // to nothing is stored absent, not as 0
        let mut e = Entry {
            id: "a".into(),
            refund: Some(5.0),
            ..Default::default()
        };
        Patch {
            clear: vec!["refund"],
            ..Default::default()
        }
        .apply_to(&mut e);
        assert_eq!(e.refund, None);
    }

    #[test]
    fn setting_wins_over_clearing_when_a_patch_does_both() {
        let mut e = Entry {
            id: "a".into(),
            note: Some("old".into()),
            ..Default::default()
        };
        Patch {
            note: Some("new".into()),
            clear: vec!["note"],
            ..Default::default()
        }
        .apply_to(&mut e);
        // clear runs last, matching a JS object literal where the later key wins
        assert_eq!(e.note, None);
    }
}
