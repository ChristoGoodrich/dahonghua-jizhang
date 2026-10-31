//! 小票 — which receipt files the phone still needs.
//!
//! An entry's `photo` is a name, and the bytes are a file in the app's own
//! attachments folder. Nothing ever deleted one of those files, and four paths
//! leave a file that no row names:
//!
//! * a delete, which leaves the row as a tombstone that still names it;
//! * an edit that takes the receipt off or puts another one on;
//! * a sheet closed after a photo was picked, and a photo picked twice;
//! * a restore or a sync, which replaces the ledger the names were in.
//!
//! Deleting the file at each of those would be four places to get right and a
//! fifth to forget, and two rows can name one file. So the platform lists the
//! folder and asks once, and this module answers from everything that could
//! still show a receipt or bring one back:
//!
//! * **A live row** shows its receipt.
//! * **A tombstone, for [`TOMBSTONE_GRACE_MS`] after its delete.** 撤销 brings
//!   the row back with its name, and so can a sync: a newer 撤销 made on the
//!   other phone beats this phone's delete. Thirty days is long past the
//!   notice and long enough for the other phone to have been synced; after
//!   that the row has had its chances.
//! * **A sealed snapshot, for as long as it is kept.** Plain copies beside it
//!   would undo the seal, so its restore expects the receipts where they are,
//!   and the names are in the list written beside it
//!   ([`crate::backup::receipts_name`]). A sealed snapshot whose list is
//!   missing or will not read could name anything, and while one is kept
//!   **nothing** is swept — the safe way not to know.
//! * **What the platform has in hand**: a photo picked on a sheet that is
//!   still open is named by no row yet.
//!
//! And two that hold nothing, deliberately:
//!
//! * **A plain snapshot** carries copies in its own folder and its restore
//!   puts them back from there.
//! * **A sync document** carries names and never bytes, so a receipt it names
//!   is on whichever phone took it, whatever this one does.
//!
//! The answer is always a subset of the listing it was handed. A name in the
//! ledger is never turned into a path to delete, so a synced row naming
//! `../ledger.db` names nothing in the folder.

use std::collections::BTreeSet;

use crate::backup::{parse_backup_name, receipts_name};
use crate::entry::Entry;
use crate::jsval::{parse_checked, stable, Value};

/// How long a deleted row keeps its receipt: thirty days.
pub const TOMBSTONE_GRACE_MS: i64 = 30 * 86_400_000;

/// The name a row gives its receipt, if it gives one. An empty name is none:
/// a legacy row can carry `""`, and the store already reads it that way.
fn photo_of(e: &Entry) -> Option<&str> {
    e.photo.as_deref().filter(|p| !p.is_empty())
}

/// The receipts a snapshot taken now carries: every live row's, once each,
/// sorted. What a plain snapshot copies into its folder and what a sealed one
/// writes in its list — the same answer, so the two cannot disagree about
/// what a restore will look for.
pub fn carried(entries: &[Entry]) -> Vec<String> {
    let names: BTreeSet<&str> = entries
        .iter()
        .filter(|e| e.is_live())
        .filter_map(photo_of)
        .collect();
    names.into_iter().map(str::to_string).collect()
}

/// A sealed snapshot's list, as written beside it: a JSON array of names.
pub fn list_doc(names: &[String]) -> String {
    stable(&Value::Arr(
        names.iter().map(|n| Value::Str(n.clone())).collect(),
    ))
}

/// A list read back. `None` for one that will not read — truncated by a
/// write that never finished, or anything else — which the sweep takes as a
/// list that could have named anything.
pub fn read_list(doc: &str) -> Option<Vec<String>> {
    let Value::Arr(items) = parse_checked(doc)? else {
        return None;
    };
    items
        .into_iter()
        .map(|v| match v {
            Value::Str(s) => Some(s),
            _ => None,
        })
        .collect()
}

/// Every name the ledger still needs a file for at `now`: the live rows', and
/// the tombstones' within [`TOMBSTONE_GRACE_MS`] of their delete.
///
/// A delete stamped later than `now` — another phone's clock ahead of this
/// one's — counts as within it.
pub fn referenced(entries: &[Entry], now: i64) -> BTreeSet<&str> {
    entries
        .iter()
        .filter(|e| match e.deleted_at {
            None => true,
            Some(at) => now.saturating_sub(at) < TOMBSTONE_GRACE_MS,
        })
        .filter_map(photo_of)
        .collect()
}

/// What, besides the ledger, may still need a receipt.
#[derive(Debug, Clone, Copy, Default)]
pub struct Holds<'a> {
    /// The backup folder's files, by name: the snapshots, and the lists beside
    /// the sealed ones.
    pub backups: &'a [String],
    /// Each list the platform found and read, as `(file name, text)`.
    pub lists: &'a [(String, String)],
    /// Names the platform has in hand that no row may name yet.
    pub in_use: &'a [String],
}

/// The names every kept sealed snapshot holds, or `None` when one of them
/// cannot say.
fn sealed(holds: &Holds) -> Option<BTreeSet<String>> {
    let mut out = BTreeSet::new();
    for name in holds.backups {
        if !parse_backup_name(name).is_some_and(|b| b.encrypted) {
            continue;
        }
        let list = receipts_name(name)?;
        let (_, text) = holds.lists.iter().find(|(n, _)| *n == list)?;
        out.extend(read_list(text)?);
    }
    Some(out)
}

/// Which of `files` — the attachments folder, by name — nothing can show or
/// bring back. Every rule is in the module comment.
pub fn sweep(files: &[String], entries: &[Entry], now: i64, holds: &Holds) -> Vec<String> {
    let Some(sealed) = sealed(holds) else {
        return Vec::new();
    };
    let referenced = referenced(entries, now);
    files
        .iter()
        .filter(|f| !referenced.contains(f.as_str()))
        .filter(|f| !sealed.contains(*f))
        .filter(|f| !holds.in_use.contains(f))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 86_400_000;
    const NOW: i64 = 1_790_000_000_000;

    fn names(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    fn row(id: &str, photo: Option<&str>, deleted_at: Option<i64>) -> Entry {
        Entry {
            id: id.into(),
            ts: NOW,
            cat: "food".into(),
            amt: 35.0,
            photo: photo.map(str::to_string),
            deleted_at,
            ..Default::default()
        }
    }

    fn swept(files: &[&str], entries: &[Entry], holds: &Holds) -> Vec<String> {
        sweep(&names(files), entries, NOW, holds)
    }

    #[test]
    fn a_live_row_keeps_its_receipt_and_nothing_else_does() {
        // r2 was on the row before an edit put r3 there; r9 was picked on a
        // sheet that was closed. Neither is named by anything.
        let ledger = [
            row("e1", Some("r1.jpg"), None),
            row("e2", Some("r3.jpg"), None),
        ];
        assert_eq!(
            swept(
                &["r1.jpg", "r2.jpg", "r3.jpg", "r9.png"],
                &ledger,
                &Holds::default()
            ),
            names(&["r2.jpg", "r9.png"])
        );
    }

    #[test]
    fn a_tombstone_keeps_its_receipt_for_thirty_days() {
        let ledger = [
            row("just", Some("r1.jpg"), Some(NOW)),
            row("almost", Some("r2.jpg"), Some(NOW - TOMBSTONE_GRACE_MS + 1)),
            row("over", Some("r3.jpg"), Some(NOW - TOMBSTONE_GRACE_MS)),
            row("long", Some("r4.jpg"), Some(NOW - 400 * DAY)),
            // another phone's clock ahead of this one's
            row("ahead", Some("r5.jpg"), Some(NOW + DAY)),
        ];
        assert_eq!(
            swept(
                &["r1.jpg", "r2.jpg", "r3.jpg", "r4.jpg", "r5.jpg"],
                &ledger,
                &Holds::default()
            ),
            names(&["r3.jpg", "r4.jpg"])
        );
    }

    #[test]
    fn a_name_two_rows_share_stays_while_either_needs_it() {
        // the reason this is a referenced set and not a delete per path: the
        // row deleted long ago would have taken the live row's receipt
        let ledger = [
            row("old", Some("r1.jpg"), Some(NOW - 400 * DAY)),
            row("live", Some("r1.jpg"), None),
        ];
        assert!(swept(&["r1.jpg"], &ledger, &Holds::default()).is_empty());
    }

    #[test]
    fn an_empty_name_is_no_receipt() {
        let ledger = [row("e1", Some(""), None)];
        assert!(referenced(&ledger, NOW).is_empty());
        assert!(carried(&ledger).is_empty());
    }

    #[test]
    fn a_photo_in_hand_is_kept_though_no_row_names_it() {
        let holds = Holds {
            in_use: &names(&["r7.jpg"]),
            ..Default::default()
        };
        assert_eq!(
            swept(&["r7.jpg", "r8.jpg"], &[], &holds),
            names(&["r8.jpg"])
        );
    }

    #[test]
    fn a_sealed_snapshot_keeps_what_its_list_names() {
        let backups = names(&[
            "backup_100.enc.json",
            "backup_100.enc.receipts",
            // a plain one carries copies, so it holds nothing here
            "backup_200.json",
        ]);
        let lists = vec![(
            "backup_100.enc.receipts".to_string(),
            list_doc(&names(&["r1.jpg"])),
        )];
        let holds = Holds {
            backups: &backups,
            lists: &lists,
            ..Default::default()
        };
        assert_eq!(
            swept(&["r1.jpg", "r2.jpg"], &[], &holds),
            names(&["r2.jpg"])
        );
    }

    #[test]
    fn a_list_without_its_snapshot_holds_nothing() {
        // the prune took the snapshot and has not yet taken the list
        let backups = names(&["backup_100.enc.receipts"]);
        let lists = vec![(
            "backup_100.enc.receipts".to_string(),
            list_doc(&names(&["r1.jpg"])),
        )];
        let holds = Holds {
            backups: &backups,
            lists: &lists,
            ..Default::default()
        };
        assert_eq!(swept(&["r1.jpg"], &[], &holds), names(&["r1.jpg"]));
    }

    #[test]
    fn a_sealed_snapshot_that_cannot_say_stops_the_sweep() {
        let files = ["r1.jpg", "r2.jpg"];
        // taken before lists were written
        let backups = names(&["backup_100.enc.json"]);
        let holds = Holds {
            backups: &backups,
            ..Default::default()
        };
        assert!(swept(&files, &[], &holds).is_empty());

        // a list cut off halfway, or not a list of names
        for text in [r#"["r1.jpg","r2"#, r#"{"r1.jpg":1}"#, r#"["r1.jpg",3]"#] {
            let backups = names(&["backup_100.enc.json", "backup_100.enc.receipts"]);
            let lists = vec![("backup_100.enc.receipts".to_string(), text.to_string())];
            let holds = Holds {
                backups: &backups,
                lists: &lists,
                ..Default::default()
            };
            assert!(swept(&files, &[], &holds).is_empty(), "{text}");
        }
    }

    #[test]
    fn only_a_listed_file_is_ever_answered() {
        // the ledger names files that are not there — a restore from another
        // phone, a name with a path in it — and none of them comes back
        let ledger = [row("e1", Some("../ledger.db"), Some(NOW - 400 * DAY))];
        assert!(swept(&[], &ledger, &Holds::default()).is_empty());
        assert_eq!(
            swept(&["r1.jpg"], &ledger, &Holds::default()),
            names(&["r1.jpg"])
        );
    }

    #[test]
    fn a_snapshot_carries_the_live_receipts_once_each() {
        let ledger = [
            row("b", Some("r2.jpg"), None),
            row("a", Some("r1.jpg"), None),
            row("dup", Some("r1.jpg"), None),
            row("gone", Some("r3.jpg"), Some(NOW)),
            row("none", None, None),
        ];
        assert_eq!(carried(&ledger), names(&["r1.jpg", "r2.jpg"]));
    }

    #[test]
    fn a_list_reads_back_as_it_was_written() {
        let list = names(&["r1.jpg", "小票 2.png", "a\"b.jpg"]);
        assert_eq!(read_list(&list_doc(&list)), Some(list));
        assert_eq!(read_list(&list_doc(&[])), Some(vec![]));
        assert_eq!(read_list(""), None);
    }
}
