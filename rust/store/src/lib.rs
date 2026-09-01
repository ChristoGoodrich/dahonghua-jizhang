//! The ledger on disk.
//!
//! `core` decides what an entry *is*; this decides where it lives and what
//! happens when a phone is full. The split is the same one the rest of the
//! migration draws, moved one layer down: nothing in here knows a category
//! from a currency, and nothing in `core` knows what a file is.
//!
//! ## Why SQLite, given the JSON files worked
//!
//! They did work — atomically, through a temp file and a rename, which is more
//! than most apps manage. What they could not do is write *part* of a ledger.
//! Every change rewrote every entry: one edited note re-serialised ten thousand
//! rows and pushed the whole array back through the filesystem. That is fine at
//! a hundred entries and wrong at ten thousand, and the difference arrives
//! gradually enough that nobody notices the day it starts mattering.
//!
//! ## Why the rows are documents
//!
//! `entries` has five columns and one of them is the entry. Not twenty-five
//! columns, one per field, which is what "we moved to SQLite" usually means.
//!
//! Three reasons, in the order they mattered. The app does not query in SQL —
//! `core::Ledger` holds the ledger in memory and every question is answered
//! there, so a wide table would buy queryability nothing asks for. The JSON
//! encoding in `core::rows` is already the app's on-disk shape and already
//! checked against the TypeScript by the parity corpus, so reusing it keeps a
//! backup from either build readable by the other. And `Entry` grows: a wide
//! table would need a schema migration every time a field is added, which is a
//! migration written under time pressure against a user's only copy of their
//! data.
//!
//! What *is* a column is what gets searched or ordered: the id, the timestamp,
//! and the two sync stamps. Those are the questions SQL is being asked here.

use std::collections::BTreeSet;
use std::fmt;

use dahonghua_core::jsval::{parse_checked, stable, Value};
use dahonghua_core::rows::{entry_from_value, entry_to_value};
use dahonghua_core::Entry;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

/// The schema this build writes.
///
/// Stored in SQLite's own `user_version`, which costs no table and cannot be
/// forgotten by a migration that renames things.
pub const SCHEMA_VERSION: i32 = 1;

#[derive(Debug)]
pub enum StoreError {
    /// The database could not be opened, read or written.
    Sql(rusqlite::Error),
    /// A file written by a build newer than this one.
    ///
    /// Refused rather than opened. A newer schema may store something this
    /// build would drop on the next write, and dropping it silently is worse
    /// than not starting.
    TooNew { found: i32, supported: i32 },
    /// A stored row that is not the JSON this crate wrote.
    Corrupt { id: String },
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::Sql(e) => write!(f, "sqlite: {e}"),
            StoreError::TooNew { found, supported } => write!(
                f,
                "database schema v{found} is newer than this build understands (v{supported})"
            ),
            StoreError::Corrupt { id } => write!(f, "row {id} is not readable"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        StoreError::Sql(e)
    }
}

type Result<T> = std::result::Result<T, StoreError>;

pub struct Db {
    conn: Connection,
}

impl Db {
    /// Open, creating and migrating as needed.
    pub fn open(path: &str) -> Result<Db> {
        Db::wrap(Connection::open(path)?)
    }

    /// An in-memory database. For tests, and for a build that has been handed
    /// no path yet.
    pub fn open_memory() -> Result<Db> {
        Db::wrap(Connection::open_in_memory()?)
    }

    fn wrap(conn: Connection) -> Result<Db> {
        // WAL survives a kill mid-write, which on a phone is the ordinary way
        // a process ends rather than an exceptional one. NORMAL rather than
        // FULL: with WAL it loses at most the last transaction to a power cut
        // and not to a crash, and an app that fsyncs on every keystroke is an
        // app that flattens a battery.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;

        let mut db = Db { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&mut self) -> Result<()> {
        let found: i32 = self
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))?;

        if found > SCHEMA_VERSION {
            return Err(StoreError::TooNew {
                found,
                supported: SCHEMA_VERSION,
            });
        }
        if found == SCHEMA_VERSION {
            return Ok(());
        }

        // v0 -> v1. One batch in one transaction, so a kill here leaves either
        // no schema or all of it.
        if found < 1 {
            self.conn.execute_batch(
                "BEGIN;
                 CREATE TABLE IF NOT EXISTS entries (
                     id         TEXT PRIMARY KEY,
                     ts         INTEGER NOT NULL,
                     updated_at INTEGER,
                     deleted_at INTEGER,
                     doc        TEXT NOT NULL
                 );
                 -- The list screen reads newest first and the sync path reads
                 -- by stamp; nothing else is asked of SQL here.
                 CREATE INDEX IF NOT EXISTS entries_ts ON entries(ts DESC);
                 CREATE INDEX IF NOT EXISTS entries_updated ON entries(updated_at);
                 CREATE TABLE IF NOT EXISTS kv (
                     k TEXT PRIMARY KEY,
                     v TEXT NOT NULL
                 );
                 COMMIT;",
            )?;
        }

        self.conn
            .pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(())
    }

    /// Every row, tombstones included.
    ///
    /// Tombstones included deliberately: they are how another device learns of
    /// a deletion, and a load that dropped them would resurrect every deleted
    /// row on the next sync.
    pub fn all_entries(&self) -> Result<Vec<Entry>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, doc FROM entries ORDER BY ts DESC, id")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;

        let mut out = Vec::new();
        for row in rows {
            let (id, doc) = row?;
            let Some(v) = parse_checked(&doc) else {
                return Err(StoreError::Corrupt { id });
            };
            out.push(entry_from_value(&v));
        }
        Ok(out)
    }

    pub fn count_entries(&self) -> Result<i64> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM entries", [], |r| r.get(0))?)
    }

    /// Write these entries, replacing any row with the same id.
    ///
    /// One transaction: a save that wrote half its rows and then met a full
    /// disk would otherwise leave a ledger that never existed, with some edits
    /// applied and some not.
    pub fn put_entries(&mut self, entries: &[&Entry]) -> Result<usize> {
        let tx = self.conn.transaction()?;
        put_all(&tx, entries)?;
        tx.commit()?;
        Ok(entries.len())
    }

    /// Replace the entire contents with these entries.
    ///
    /// For a restored backup or a first import, where what is on disk is not a
    /// parent of what is in memory and merging the two would invent a ledger
    /// neither device ever had.
    pub fn replace_all(&mut self, entries: &[&Entry]) -> Result<usize> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM entries", [])?;
        put_all(&tx, entries)?;
        tx.commit()?;
        Ok(entries.len())
    }

    /// Forget rows whose ids are not in `keep`.
    ///
    /// A hard delete, unlike the app's own remove, which tombstones. For rows
    /// that were never real — an import that was rolled back — because a row
    /// that has ever existed on another device has to leave a tombstone behind
    /// or it comes back on the next sync.
    pub fn forget_missing(&mut self, keep: &BTreeSet<String>) -> Result<usize> {
        let tx = self.conn.transaction()?;
        let ids: Vec<String> = {
            let mut stmt = tx.prepare("SELECT id FROM entries")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        let mut n = 0;
        for id in ids {
            if !keep.contains(&id) {
                tx.execute("DELETE FROM entries WHERE id = ?1", params![id])?;
                n += 1;
            }
        }
        tx.commit()?;
        Ok(n)
    }

    pub fn get(&self, k: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT v FROM kv WHERE k = ?1", params![k], |r| r.get(0))
            .optional()?)
    }

    pub fn set(&mut self, k: &str, v: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO kv (k, v) VALUES (?1, ?2)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            params![k, v],
        )?;
        Ok(())
    }

    /// Reclaim space and defragment. Slow, and never on a save path.
    pub fn compact(&self) -> Result<()> {
        self.conn.execute_batch("VACUUM")?;
        Ok(())
    }

    pub fn schema_version(&self) -> Result<i32> {
        Ok(self
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))?)
    }
}

fn put_all(tx: &Transaction, entries: &[&Entry]) -> Result<()> {
    let mut stmt = tx.prepare(
        "INSERT INTO entries (id, ts, updated_at, deleted_at, doc)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
             ts = excluded.ts,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             doc = excluded.doc",
    )?;
    for e in entries {
        let doc = stable(&entry_to_value(e));
        stmt.execute(params![e.id, e.ts, e.updated_at, e.deleted_at, doc])?;
    }
    Ok(())
}

/// The config blob, as one key. Kept whole rather than split into rows.
///
/// It is small, it is written as a unit, and every field in it is read at
/// startup — three properties that make a row per setting pure ceremony. The
/// ledger is the thing that needed decomposing, and it is the thing that got
/// decomposed.
pub const KEY_CONFIG: &str = "config";

/// Set once a legacy JSON import has been done, so it is not done twice.
pub const KEY_MIGRATED: &str = "migrated_from_json";

/// Read the config blob as a parsed document, or `None` if absent.
pub fn config_of(db: &Db) -> Result<Option<Value>> {
    let Some(raw) = db.get(KEY_CONFIG)? else {
        return Ok(None);
    };
    Ok(parse_checked(&raw))
}
