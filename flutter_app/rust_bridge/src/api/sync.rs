//! Syncing two devices through a file.
//!
//! No server, no account, no credentials. The app writes a document; you put
//! it wherever you already keep files that follow you around; the other device
//! reads it, merges, and writes it back. What the app does is decide what the
//! merge of two ledgers *is* — which is the part that is hard and the part
//! that was already ported and tested.
//!
//! `merge_by_id` is doing the work here, and it is the most heavily checked
//! function in the project: 7,043 parity cases against the TypeScript, plus
//! the wire shape's own 4,539. Field-level last-write-wins where both sides
//! carry stamps, whole-row newest-wins where they do not. None of that is new
//! in this file. This file is the envelope.
//!
//! ## What is synced, and what is not
//!
//! Entries, and accounts. Not the rest of the config.
//!
//! Entries because they are the ledger. Accounts because an entry names one,
//! and a merge that brought entries across without them would leave rows
//! pointing at accounts that do not exist on this device.
//!
//! Accounts merge as a **union by id**, not through `merge_by_id`: an account
//! has no `updatedAt`, so there is nothing to compare and nothing to be
//! field-level about. Both sides keep every account either had, and where both
//! have the same id the local copy stands. That never loses an account and
//! never orphans an entry. What it does not do is carry a *rename* across —
//! renaming an account on the other device leaves the old name here. That is a
//! real limit, it is the safe direction to be wrong in, and doing better needs
//! the per-section stamps `core::sync::adopt_sections` expects, which this
//! build does not yet maintain.
//!
//! Currencies, budgets, reminders, the theme, the lock: not synced. They are
//! per-device settings more often than not, and a naive newest-wins on a whole
//! config blob would silently drop whichever side wrote second.
//!
//! ## The one thing a file cannot do
//!
//! Two devices writing the document at the same moment is a conflict the file
//! itself cannot resolve — a sync folder will keep both copies under different
//! names. That is survivable rather than fatal: the merge is idempotent and
//! order-independent, so merging both copies in either order converges. It is
//! worth knowing rather than worth preventing.

use flutter_rust_bridge::frb;

use dahonghua_core::jsval::{parse_checked, stable, Value};
use dahonghua_core::merge::merge_by_id;

use crate::api::db;
use crate::api::store::{load_config, load_entries, snapshot_config, snapshot_entries};

/// The document format this build writes.
///
/// Refused rather than guessed at when it is higher: a newer document may
/// carry rows this build would drop on the write-back, which turns one
/// device's sync into the other device's data loss.
pub const SYNC_FORMAT: i64 = 1;

/// What a merge did, in the terms a person would ask about it.
#[derive(Debug, Clone, PartialEq)]
pub struct SyncReport {
    /// Empty when it worked; otherwise why it did not.
    pub error: String,
    /// Rows this device did not have.
    pub added: i64,
    /// Rows both sides had, where the merge chose something different from
    /// what was here.
    pub updated: i64,
    /// Rows where both sides had edited the same entry. Resolved — this is a
    /// count of decisions made, not of problems left.
    pub conflicts: i64,
    /// Accounts brought across.
    pub accounts_added: i64,
    /// Rows in the document, whatever happened to them.
    pub incoming: i64,
}

impl SyncReport {
    fn failed(why: &str) -> SyncReport {
        SyncReport {
            error: why.to_string(),
            ..SyncReport::empty()
        }
    }

    fn empty() -> SyncReport {
        SyncReport {
            error: String::new(),
            added: 0,
            updated: 0,
            conflicts: 0,
            accounts_added: 0,
            incoming: 0,
        }
    }
}

/// The document to write out: this device's whole ledger, plus its accounts.
///
/// The whole ledger rather than a delta, because a file has no memory of what
/// the other device already saw. Tombstones included — they are how the other
/// device learns of a deletion, and a document that dropped them would
/// resurrect everything either side had ever deleted.
#[frb(sync)]
pub fn sync_document(now: i64) -> String {
    let entries = snapshot_entries();
    let accounts = accounts_json();
    format!(
        "{{\"v\":{SYNC_FORMAT},\"writtenAt\":{now},\"entries\":{entries},\"accounts\":{accounts}}}"
    )
}

fn accounts_json() -> String {
    let cfg = parse_checked(&snapshot_config()).unwrap_or(Value::Null);
    match cfg.get("accounts") {
        Some(a @ Value::Arr(_)) => stable(a),
        _ => "[]".to_string(),
    }
}

/// Merge a document written by another device into this one.
///
/// The local ledger is replaced by the merge of both, which is not the same as
/// "the document is imported": a row this device has and the document does not
/// survives, and a row the document has that this device deleted stays
/// deleted, because the tombstone is newer than the row.
#[frb(sync)]
pub fn merge_document(json: String) -> SyncReport {
    let Some(doc) = parse_checked(&json) else {
        return SyncReport::failed("this file is not a sync document");
    };

    match doc.get("v") {
        Some(Value::Num(v)) if *v as i64 > SYNC_FORMAT => {
            return SyncReport::failed(
                "this file was written by a newer version of the app than this one",
            );
        }
        Some(Value::Num(_)) => {}
        _ => return SyncReport::failed("this file is not a sync document"),
    }

    let Some(Value::Arr(remote)) = doc.get("entries") else {
        return SyncReport::failed("the file carries no entries");
    };

    let local = match parse_checked(&snapshot_entries()) {
        Some(Value::Arr(rows)) => rows,
        _ => Vec::new(),
    };

    let result = merge_by_id(&local, remote);

    // `to_push` is what the *other* side is missing, which under a file is
    // simply what gets written back. What changed HERE is the difference
    // between the merged set and what was here before.
    let mut added = 0i64;
    let mut updated = 0i64;
    for row in &result.merged {
        let id = row.get("id").and_then(as_str);
        let Some(id) = id else { continue };
        match local
            .iter()
            .find(|l| l.get("id").and_then(as_str) == Some(id))
        {
            None => added += 1,
            Some(before) if stable(before) != stable(row) => updated += 1,
            Some(_) => {}
        }
    }

    let merged_json = format!(
        "[{}]",
        result
            .merged
            .iter()
            .map(stable)
            .collect::<Vec<_>>()
            .join(",")
    );

    let accounts_added = merge_accounts(doc.get("accounts"));

    if load_entries(merged_json) < 0 {
        return SyncReport::failed("the merged ledger could not be stored");
    }

    // The whole ledger was replaced, so every row differs from what the
    // database holds.
    db::mark_all();
    db::mark_config();

    SyncReport {
        error: String::new(),
        added,
        updated,
        conflicts: result.conflicts.len() as i64,
        accounts_added,
        incoming: remote.len() as i64,
    }
}

fn as_str(v: &Value) -> Option<&str> {
    match v {
        Value::Str(s) => Some(s.as_str()),
        _ => None,
    }
}

/// Union by id, local wins on a collision. Returns how many were new here.
fn merge_accounts(remote: Option<&Value>) -> i64 {
    let Some(Value::Arr(incoming)) = remote else {
        return 0;
    };
    let Some(cfg) = parse_checked(&snapshot_config()) else {
        return 0;
    };
    let Some(Value::Arr(mine)) = cfg.get("accounts") else {
        return 0;
    };

    let mut out = mine.clone();
    let mut added = 0;
    for r in incoming {
        let Some(id) = r.get("id").and_then(as_str) else {
            continue;
        };
        if out.iter().any(|m| m.get("id").and_then(as_str) == Some(id)) {
            continue;
        }
        out.push(r.clone());
        added += 1;
    }
    if added == 0 {
        return 0;
    }

    // Rebuild the config with the wider account list and put it back through
    // the same loader the app uses at startup, rather than reaching into the
    // store: that loader is what decides what a config *is*, and it has a
    // corpus behind it.
    let Value::Obj(fields) = cfg else {
        return 0;
    };
    let rebuilt: Vec<(String, Value)> = fields
        .into_iter()
        .map(|(k, v)| {
            if k == "accounts" {
                (k, Value::Arr(out.clone()))
            } else {
                (k, v)
            }
        })
        .collect();
    if load_config(stable(&Value::Obj(rebuilt))) {
        added
    } else {
        0
    }
}

/// Whether a document can be read at all, without merging it.
///
/// For a preview: a person about to merge a file into their ledger should be
/// able to see how many entries are in it first.
#[frb(sync)]
pub fn inspect_document(json: String) -> SyncReport {
    let Some(doc) = parse_checked(&json) else {
        return SyncReport::failed("this file is not a sync document");
    };
    match doc.get("v") {
        Some(Value::Num(v)) if *v as i64 > SYNC_FORMAT => {
            return SyncReport::failed(
                "this file was written by a newer version of the app than this one",
            );
        }
        Some(Value::Num(_)) => {}
        _ => return SyncReport::failed("this file is not a sync document"),
    }
    let incoming = match doc.get("entries") {
        Some(Value::Arr(rows)) => rows.len() as i64,
        _ => return SyncReport::failed("the file carries no entries"),
    };
    SyncReport {
        incoming,
        ..SyncReport::empty()
    }
}
