//! The ledger's storage, as the platform sees it.
//!
//! Dart supplies the path — `path_provider` knows where an app may write, and
//! that has never been this side's business — and everything after it is
//! Rust's: the schema, the transaction, and what happens when the write fails.
//! That is the whole of the change. Before this, Dart held the file and Rust
//! held the state; now Rust holds both, and Dart holds a string.
//!
//! ## Which rows get written
//!
//! The point of moving off the JSON files was to stop rewriting ten thousand
//! entries to save one, so something has to know which ones changed. That is
//! the dirty set here, and the risk it carries is obvious: a mutation that
//! forgets to mark its rows saves nothing, silently, and the loss only shows
//! up after a restart.
//!
//! Two things guard against it. Every operation that can touch rows it was not
//! handed — a delete cascading to refunds, an account removal reassigning
//! entries, any bulk import — marks *everything* rather than guessing; only
//! the operations whose blast radius the core reports exactly get a narrow
//! mark. And `flush_and_reload` in the tests performs each mutation, writes,
//! reopens the database and looks for the change, which is the only check that
//! actually catches a missing mark rather than trusting one.
//!
//! ## Errors are strings
//!
//! `""` means it worked. Anything else is a message meant for a person, and
//! Dart shows it rather than interpreting it. A storage failure is not a
//! condition the UI can branch on usefully — the disk is full, or the file is
//! from a newer build — and the honest thing is to say which.

use std::collections::BTreeSet;
use std::sync::{Mutex, MutexGuard, OnceLock};

use flutter_rust_bridge::frb;

use dahonghua_core::Entry;
use dahonghua_store::{Db, StoreError, KEY_CONFIG, KEY_MIGRATED, SCHEMA_VERSION};

use crate::api::store::{load_config, load_entries, snapshot_config, store};

/// The open database, and what still needs writing to it.
#[frb(ignore)]
#[derive(Default)]
struct Handle {
    db: Option<Db>,
    /// Ids whose rows differ from what is on disk.
    dirty: BTreeSet<String>,
    /// Every row differs — a bulk change, or a load that replaced the ledger.
    dirty_all: bool,
    /// Somebody said the config changed. A hint now, not the rule: see
    /// `written_config`.
    dirty_config: bool,
    /// The config as the disk holds it, in the form `snapshot_config` writes.
    ///
    /// The save compares against this rather than trusting `dirty_config`,
    /// because trusting it lost data. Four setters marked the config — the
    /// currency table, the current account, accounts and sync — and the rest
    /// did not: the theme, the budget, templates, tags, assets, loans,
    /// subscriptions, reminders, the language and the lock were all changed
    /// in memory and never written, and came back as defaults on the next
    /// launch unless something that did mark happened to be changed after
    /// them. Each looked saved, because a snapshot held it.
    ///
    /// It is the store's lesson again (see `store_mut`), and this time the
    /// fix does not depend on the next setter remembering: the config is one
    /// row, a snapshot of it is small, and a comparison cannot forget.
    written_config: Option<String>,
}

fn handle() -> MutexGuard<'static, Handle> {
    static H: OnceLock<Mutex<Handle>> = OnceLock::new();
    let m = H.get_or_init(|| Mutex::new(Handle::default()));
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn say(e: StoreError) -> String {
    e.to_string()
}

// ---------- marking ----------
//
// Called from the mutating side of `store.rs`. Cheap enough to do
// unconditionally: a BTreeSet insert against a store that is not open yet is
// still just an insert, and the alternative is a branch nobody remembers.

pub(crate) fn mark(id: &str) {
    let mut h = handle();
    if !h.dirty_all {
        h.dirty.insert(id.to_string());
    }
}

pub(crate) fn mark_many<I: IntoIterator<Item = String>>(ids: I) {
    let mut h = handle();
    if h.dirty_all {
        return;
    }
    for id in ids {
        h.dirty.insert(id);
    }
}

/// Everything changed, or something changed rows we cannot enumerate.
///
/// Used by every bulk path and by anything that reassigns rows it was not
/// handed. Marking too much costs a slower save; marking too little costs
/// data, so the doubt resolves in one direction only.
pub(crate) fn mark_all() {
    let mut h = handle();
    h.dirty_all = true;
    h.dirty.clear();
}

pub(crate) fn mark_config() {
    handle().dirty_config = true;
}

// ---------- opening ----------

/// Open (or create) the ledger database at `path`.
///
/// Returns `""` on success. An existing file from a newer build is refused
/// here rather than opened, so the caller can say so instead of the app
/// quietly dropping fields it does not know about on the next save.
#[frb(sync)]
pub fn open_store(path: String) -> String {
    match Db::open(&path) {
        Ok(db) => {
            let mut h = handle();
            h.db = Some(db);
            h.dirty.clear();
            h.dirty_all = false;
            h.dirty_config = false;
            // Unknown until a load says; a first launch that saves before
            // loading writes its config, which is what it should do.
            h.written_config = None;
            String::new()
        }
        Err(e) => say(e),
    }
}

#[frb(sync)]
pub fn store_is_open() -> bool {
    handle().db.is_some()
}

/// Close the database. Flushes first: a caller that remembered to save and a
/// caller that forgot should end in the same place, and "the process is going
/// away" is exactly when forgetting is most likely.
#[frb(sync)]
pub fn close_store() {
    let _ = flush_store();
    handle().db = None;
}

/// The schema version of the open database, or of a fresh one when none is
/// open. `-1` if SQLite itself could not be reached.
#[frb(sync)]
pub fn store_schema_version() -> i32 {
    let h = handle();
    match h.db.as_ref() {
        Some(db) => db.schema_version().unwrap_or(-1),
        None => match Db::open_memory() {
            Ok(db) => db.schema_version().unwrap_or(-1),
            Err(_) => -1,
        },
    }
}

// ---------- loading ----------

/// Read the database into the in-memory store.
///
/// Returns the number of entries, or `-1` with the message in `last_error`
/// when the file could not be read. The distinction matters the same way it
/// did for the JSON files: an empty database is a first launch, and an
/// unreadable one is a thing the caller must not save over.
#[frb(sync)]
pub fn load_from_store() -> i64 {
    let h = handle();
    let Some(db) = h.db.as_ref() else {
        return -1;
    };

    // Config first: it carries the accounts an entry's `acct` points at, and a
    // ledger loaded before them would briefly name accounts that do not exist.
    let cfg = match db.get(KEY_CONFIG) {
        Ok(v) => v,
        Err(_) => return -1,
    };

    let entries = match db.all_entries() {
        Ok(v) => v,
        Err(_) => return -1,
    };

    // Dropped before calling back into store.rs: those paths mark rows dirty,
    // and marking takes this same lock.
    drop(h);

    if let Some(raw) = cfg {
        load_config(raw);
    }
    let json = entries_to_json(&entries);
    let n = load_entries(json);

    // A load is not a change. Whatever the two calls above marked, the ledger
    // now matches the disk exactly, and leaving it marked would rewrite every
    // row on the first save for nothing. The config is recorded in the form
    // the next save would write it, so the comparison there finds nothing.
    let loaded = snapshot_config();
    let mut h = handle();
    h.dirty.clear();
    h.dirty_all = false;
    h.dirty_config = false;
    h.written_config = Some(loaded);
    n as i64
}

fn entries_to_json(entries: &[Entry]) -> String {
    use dahonghua_core::jsval::stable;
    use dahonghua_core::rows::entry_to_value;
    let parts: Vec<String> = entries.iter().map(|e| stable(&entry_to_value(e))).collect();
    format!("[{}]", parts.join(","))
}

// ---------- saving ----------

/// How many entry rows a save would write right now.
///
/// `-1` means "all of them" — a bulk change is pending. Exposed so a test can
/// assert that editing one entry writes one row, which is the entire reason
/// this file exists.
#[frb(sync)]
pub fn dirty_entry_count() -> i64 {
    let h = handle();
    if h.dirty_all {
        -1
    } else {
        h.dirty.len() as i64
    }
}

/// Write everything outstanding. `""` on success.
#[frb(sync)]
pub fn flush_store() -> String {
    let (dirty, all, marked, written) = {
        let h = handle();
        if h.db.is_none() {
            return "no database is open".to_string();
        }
        (
            h.dirty.clone(),
            h.dirty_all,
            h.dirty_config,
            h.written_config.clone(),
        )
    };

    // Compared, not trusted — `written_config` says why. Taken with the
    // handle lock released, like the rows below.
    let config_now = snapshot_config();
    let cfg_changed = marked || written.as_deref() != Some(config_now.as_str());

    if !all && dirty.is_empty() && !cfg_changed {
        return String::new();
    }

    // The snapshot is taken while the store lock is held and the handle lock
    // is not; taking both in one scope is how this deadlocks.
    let rows: Vec<Entry> = {
        let s = store();
        if all {
            s.ledger.all().to_vec()
        } else {
            s.ledger
                .all()
                .iter()
                .filter(|e| dirty.contains(&e.id))
                .cloned()
                .collect()
        }
    };
    let config = cfg_changed.then_some(config_now);

    let mut h = handle();
    let Some(db) = h.db.as_mut() else {
        return "no database is open".to_string();
    };

    let refs: Vec<&Entry> = rows.iter().collect();
    let result = if all {
        db.replace_all(&refs)
    } else {
        db.put_entries(&refs)
    };
    if let Err(e) = result {
        return say(e);
    }
    if let Some(json) = &config {
        if let Err(e) = db.set(KEY_CONFIG, json) {
            return say(e);
        }
    }

    h.dirty.clear();
    h.dirty_all = false;
    h.dirty_config = false;
    if let Some(json) = config {
        h.written_config = Some(json);
    }
    String::new()
}

// ---------- the one-time move off JSON ----------

/// Has a legacy import already been done against this database?
#[frb(sync)]
pub fn already_migrated() -> bool {
    let h = handle();
    match h.db.as_ref() {
        Some(db) => matches!(db.get(KEY_MIGRATED), Ok(Some(_))),
        None => false,
    }
}

/// Import the old `entries.json` / `config.json` contents, once.
///
/// Returns `""` on success. Either string may be empty for a file that did not
/// exist; an entries document that cannot be read is refused outright rather
/// than partially imported, because a lenient parse of a truncated array
/// recovers whichever rows happen to be complete and calls the rest gone.
///
/// The caller keeps the JSON files afterwards. Deleting the only copy of a
/// ledger on the first run of new storage code is not a thing to do, however
/// well this is tested.
#[frb(sync)]
pub fn migrate_from_json(entries_json: String, config_json: String) -> String {
    if !store_is_open() {
        return "no database is open".to_string();
    }
    if already_migrated() {
        return String::new();
    }

    if !config_json.is_empty() && !load_config(config_json) {
        return "the old config file could not be read".to_string();
    }
    if !entries_json.is_empty() && load_entries(entries_json) < 0 {
        return "the old ledger file could not be read".to_string();
    }

    mark_all();
    mark_config();
    let err = flush_store();
    if !err.is_empty() {
        return err;
    }

    let mut h = handle();
    if let Some(db) = h.db.as_mut() {
        if let Err(e) = db.set(KEY_MIGRATED, "1") {
            return say(e);
        }
    }
    String::new()
}

/// Forget the open database and everything pending. For tests, which share one
/// process and must not leak a handle from one case into the next.
#[frb(sync)]
pub fn reset_store_handle() {
    *handle() = Handle::default();
}

/// The schema this build writes, without touching SQLite.
#[frb(sync)]
pub fn supported_schema_version() -> i32 {
    SCHEMA_VERSION
}
