//! Backups across the boundary: what a snapshot is called, what goes in it,
//! and which of them to keep.
//!
//! The bytes are Dart's — reading a directory and writing a file is the
//! platform's job and always has been. What crosses is the naming, the
//! ordering, the pruning and the document.
//!
//! Encryption is deliberately absent. It is AES-256-GCM over a PBKDF2 key,
//! which would cost the core three dependencies against the one it has, and a
//! cipher is not a decision the ledger needs to own. The name says whether a
//! file is encrypted; nothing here can produce one yet, and the screen says so.

use dahonghua_core::backup as core;
use dahonghua_core::jsval::{parse_checked, stable, Value};
use dahonghua_core::rows::entry_to_value;
use flutter_rust_bridge::frb;

use super::store::{load_config, load_entries, snapshot_config, store};

/// One snapshot, as read back off a directory listing.
#[derive(Debug, Clone, PartialEq)]
pub struct BackupInfoView {
    pub name: String,
    /// Epoch milliseconds. `NaN` when the name carries no usable number — which
    /// sorts last rather than pretending to be a time.
    pub time: f64,
    pub encrypted: bool,
}

/// What a backup taken now is called.
#[frb(sync)]
pub fn backup_name(ts: f64, encrypted: bool) -> String {
    core::backup_name(ts, encrypted)
}

/// A directory listing, filtered to backups and sorted newest first.
///
/// The sort matters more than it looks: pruning keeps the first `keep`, so a
/// listing that came back in the wrong order would delete the wrong files.
#[frb(sync)]
pub fn list_backups(names: Vec<String>) -> Vec<BackupInfoView> {
    core::list_backups(&names)
        .into_iter()
        .map(|b| BackupInfoView {
            name: b.name,
            time: b.time,
            encrypted: b.encrypted,
        })
        .collect()
}

/// Which files to delete so that `keep` remain. Newest-first input.
#[frb(sync)]
pub fn prune_backups(names: Vec<String>, keep: u32) -> Vec<String> {
    let list = core::list_backups(&names);
    core::prune(&list, keep as usize)
        .into_iter()
        .map(|b| b.name.clone())
        .collect()
}

/// How many snapshots are kept by default.
#[frb(sync)]
pub fn max_backups() -> u32 {
    core::MAX_BACKUPS as u32
}

/// The document a backup holds: the whole store, stamped.
///
/// `version` is the **app's** schema version and not the file format's — an
/// importer needs to know which shape the ledger is in, which is a different
/// question from which shape the wrapper is in.
///
/// Returns an empty string when the snapshot cannot be produced. Writing a
/// document that *looks* like a backup and holds an empty ledger is worse than
/// writing nothing: the user believes they are covered, and the first restore
/// is the discovery. The caller refuses the empty string.
#[frb(sync)]
pub fn build_backup(ts: f64) -> String {
    // Entries are built from the rows themselves. Re-reading their JSON only
    // to parse it back invites exactly the failure this function must not
    // paper over.
    let entries = Value::Arr(store().ledger.all().iter().map(entry_to_value).collect());
    let Some(config) = parse_checked(&snapshot_config()) else {
        return String::new();
    };
    if !matches!(config, Value::Obj(_)) {
        return String::new();
    }
    stable(&Value::Obj(vec![
        ("app".into(), Value::Str("dahonghua".into())),
        (
            "version".into(),
            Value::Num(core::BACKUP_APP_VERSION as f64),
        ),
        ("timestamp".into(), Value::Num(ts)),
        ("entries".into(), entries),
        ("config".into(), config),
    ]))
}

/// What restoring a document did.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RestoreResult {
    /// False when the document could not be read at all. Nothing is written in
    /// that case — a half-restored ledger is worse than a refused one.
    pub ok: bool,
    /// How many rows landed.
    pub entries: u32,
    /// Whether the document carried a config section to restore.
    pub config: bool,
}

/// Restore a backup document, replacing the ledger and the config.
///
/// Refuses outright rather than restoring what it can: a document that will not
/// parse says nothing about which half of it was intended, and a ledger half
/// replaced is worse than one not replaced. The same reason `load_entries`
/// answers `-1` instead of loading the rows it managed to read.
#[frb(sync)]
pub fn restore_backup(json: String) -> RestoreResult {
    let Some(doc) = parse_checked(&json) else {
        return RestoreResult {
            ok: false,
            entries: 0,
            config: false,
        };
    };
    // The wrapper is not required. A document that is just an array of entries
    // is what an older export produced, and refusing it would be refusing the
    // files this feature exists to read.
    let entries_json = match doc.get("entries") {
        Some(v @ Value::Arr(_)) => stable(v),
        _ => match &doc {
            Value::Arr(_) => stable(&doc),
            _ => {
                return RestoreResult {
                    ok: false,
                    entries: 0,
                    config: false,
                }
            }
        },
    };
    let n = load_entries(entries_json);
    if n < 0 {
        return RestoreResult {
            ok: false,
            entries: 0,
            config: false,
        };
    }
    let config = match doc.get("config") {
        Some(c @ Value::Obj(_)) => load_config(stable(c)),
        _ => false,
    };
    RestoreResult {
        ok: true,
        entries: n as u32,
        config,
    }
}
