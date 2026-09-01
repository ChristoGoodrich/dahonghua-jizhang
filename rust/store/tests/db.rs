//! What the store has to survive.
//!
//! The happy path is three lines and is not what these are for. A ledger's
//! storage layer earns its keep in the cases where something has already gone
//! wrong: a row written by a newer build, a document that is not readable, a
//! save that met a full disk halfway through.

use std::collections::BTreeSet;

use dahonghua_core::entry::Io;
use dahonghua_core::Entry;
use dahonghua_store::{config_of, Db, StoreError, KEY_CONFIG, SCHEMA_VERSION};

fn entry(id: &str, ts: i64, amt: f64) -> Entry {
    Entry {
        id: id.into(),
        ts,
        io: Some(Io::Exp),
        cat: "food".into(),
        amt,
        ..Default::default()
    }
}

fn open() -> Db {
    Db::open_memory().expect("in-memory database")
}

#[test]
fn a_fresh_database_is_at_the_current_schema() {
    let db = open();
    assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
    assert_eq!(db.count_entries().unwrap(), 0);
}

#[test]
fn opening_twice_does_not_migrate_twice() {
    let dir = tempdir();
    let path = dir.join("ledger.db");
    let p = path.to_str().unwrap();

    {
        let mut db = Db::open(p).unwrap();
        db.put_entries(&[&entry("a", 100, 12.0)]).unwrap();
    }
    let db = Db::open(p).unwrap();
    assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
    assert_eq!(db.count_entries().unwrap(), 1);
}

#[test]
fn an_entry_survives_a_round_trip_whole() {
    let mut db = open();
    let mut e = entry("a", 1_700_000_000_000, 12.5);
    e.note = Some("午饭".into());
    e.tags = Some(vec!["工作".into(), "报销".into()]);
    e.cur = Some("USD".into());
    e.orig_amt = Some(1.75);
    e.rate = Some(7.14);
    e.updated_at = Some(42);

    db.put_entries(&[&e]).unwrap();
    let back = db.all_entries().unwrap();

    assert_eq!(back.len(), 1);
    assert_eq!(back[0], e, "a stored entry has to come back identical");
}

/// The distinction `field_ts` documents in `core`: never edited is not the
/// same as edited with an empty patch, and 631 parity cases turned on it.
/// A storage layer that collapsed them would undo that quietly.
#[test]
fn an_absent_field_map_stays_absent_and_an_empty_one_stays_empty() {
    let mut db = open();
    let mut never = entry("never", 100, 1.0);
    never.field_ts = None;
    let mut empty = entry("empty", 200, 1.0);
    empty.field_ts = Some(Default::default());

    db.put_entries(&[&never, &empty]).unwrap();
    let back = db.all_entries().unwrap();
    let got = |id: &str| back.iter().find(|e| e.id == id).unwrap().clone();

    assert_eq!(got("never").field_ts, None);
    assert_eq!(got("empty").field_ts, Some(Default::default()));
}

#[test]
fn writing_the_same_id_replaces_rather_than_duplicates() {
    let mut db = open();
    db.put_entries(&[&entry("a", 100, 12.0)]).unwrap();
    db.put_entries(&[&entry("a", 100, 99.0)]).unwrap();

    let back = db.all_entries().unwrap();
    assert_eq!(back.len(), 1);
    assert_eq!(back[0].amt, 99.0);
}

#[test]
fn rows_come_back_newest_first() {
    let mut db = open();
    db.put_entries(&[
        &entry("old", 100, 1.0),
        &entry("new", 300, 1.0),
        &entry("mid", 200, 1.0),
    ])
    .unwrap();

    let ids: Vec<String> = db
        .all_entries()
        .unwrap()
        .into_iter()
        .map(|e| e.id)
        .collect();
    assert_eq!(ids, vec!["new", "mid", "old"]);
}

/// Two rows sharing a timestamp must not swap places between loads. An
/// unstable order means a backup exported twice differs from itself.
#[test]
fn a_shared_timestamp_still_orders_the_same_way_every_time() {
    let mut db = open();
    db.put_entries(&[&entry("b", 100, 1.0), &entry("a", 100, 1.0)])
        .unwrap();

    let first: Vec<String> = db
        .all_entries()
        .unwrap()
        .into_iter()
        .map(|e| e.id)
        .collect();
    let again: Vec<String> = db
        .all_entries()
        .unwrap()
        .into_iter()
        .map(|e| e.id)
        .collect();
    assert_eq!(first, again);
    assert_eq!(first, vec!["a", "b"], "the id breaks the tie");
}

#[test]
fn a_tombstone_is_stored_rather_than_dropped() {
    let mut db = open();
    let mut gone = entry("gone", 100, 12.0);
    gone.deleted_at = Some(999);

    db.put_entries(&[&gone]).unwrap();
    let back = db.all_entries().unwrap();

    assert_eq!(back.len(), 1, "a deletion another device has not seen yet");
    assert_eq!(back[0].deleted_at, Some(999));
}

#[test]
fn replace_all_leaves_only_what_it_was_given() {
    let mut db = open();
    db.put_entries(&[&entry("a", 100, 1.0), &entry("b", 200, 1.0)])
        .unwrap();
    db.replace_all(&[&entry("c", 300, 1.0)]).unwrap();

    let ids: Vec<String> = db
        .all_entries()
        .unwrap()
        .into_iter()
        .map(|e| e.id)
        .collect();
    assert_eq!(ids, vec!["c"]);
}

#[test]
fn forget_missing_removes_only_what_is_not_kept() {
    let mut db = open();
    db.put_entries(&[
        &entry("a", 100, 1.0),
        &entry("b", 200, 1.0),
        &entry("c", 300, 1.0),
    ])
    .unwrap();

    let keep: BTreeSet<String> = ["a".to_string(), "c".to_string()].into_iter().collect();
    assert_eq!(db.forget_missing(&keep).unwrap(), 1);

    let ids: Vec<String> = db
        .all_entries()
        .unwrap()
        .into_iter()
        .map(|e| e.id)
        .collect();
    assert_eq!(ids, vec!["c", "a"]);
}

#[test]
fn the_key_value_side_stores_and_replaces() {
    let mut db = open();
    assert_eq!(db.get("nothing").unwrap(), None);

    db.set(KEY_CONFIG, "{\"a\":1}").unwrap();
    assert_eq!(db.get(KEY_CONFIG).unwrap().as_deref(), Some("{\"a\":1}"));

    db.set(KEY_CONFIG, "{\"a\":2}").unwrap();
    assert_eq!(db.get(KEY_CONFIG).unwrap().as_deref(), Some("{\"a\":2}"));
}

#[test]
fn a_stored_config_parses_back_and_an_absent_one_is_none() {
    let mut db = open();
    assert!(config_of(&db).unwrap().is_none());

    db.set(KEY_CONFIG, "{\"base\":\"CNY\"}").unwrap();
    assert!(config_of(&db).unwrap().is_some());
}

/// The one that matters most. A file from a newer build is refused, not
/// opened: a schema this build does not understand may hold something it
/// would drop on the next write, and dropping a user's data silently is worse
/// than refusing to start.
#[test]
fn a_database_from_a_newer_build_is_refused() {
    let dir = tempdir();
    let path = dir.join("future.db");
    let p = path.to_str().unwrap();

    {
        let conn = rusqlite::Connection::open(p).unwrap();
        conn.pragma_update(None, "user_version", SCHEMA_VERSION + 7)
            .unwrap();
    }

    match Db::open(p) {
        Err(StoreError::TooNew { found, supported }) => {
            assert_eq!(found, SCHEMA_VERSION + 7);
            assert_eq!(supported, SCHEMA_VERSION);
        }
        Err(e) => panic!("wrong error: {e}"),
        Ok(_) => panic!("a newer database must not be opened"),
    }
}

/// A row that is not the JSON this crate wrote names itself and stops the
/// load, rather than being skipped. Loading 4,999 of 5,000 entries is not a
/// partial success — it is the first half of losing one, because the next
/// save writes the 4,999 back.
#[test]
fn an_unreadable_row_fails_the_load_and_says_which() {
    let dir = tempdir();
    let path = dir.join("corrupt.db");
    let p = path.to_str().unwrap();

    {
        let mut db = Db::open(p).unwrap();
        db.put_entries(&[&entry("good", 100, 1.0)]).unwrap();
    }
    {
        let conn = rusqlite::Connection::open(p).unwrap();
        conn.execute(
            "INSERT INTO entries (id, ts, updated_at, deleted_at, doc)
             VALUES ('bad', 200, NULL, NULL, '{ this is not json')",
            [],
        )
        .unwrap();
    }

    let db = Db::open(p).unwrap();
    match db.all_entries() {
        Err(StoreError::Corrupt { id }) => assert_eq!(id, "bad"),
        Err(e) => panic!("wrong error: {e}"),
        Ok(_) => panic!("an unreadable row must not load as nothing"),
    }
}

/// Atomicity, with a real mid-transaction failure rather than a described one.
///
/// A trigger refuses one id. The batch contains a good row before it, so if
/// `put_entries` were not one transaction the good row would land and the
/// ledger would be a state that never existed — some edits applied, some not.
#[test]
fn a_batch_that_fails_partway_lands_none_of_it() {
    let dir = tempdir();
    let path = dir.join("atomic.db");
    let p = path.to_str().unwrap();

    {
        let mut db = Db::open(p).unwrap();
        db.put_entries(&[&entry("existing", 100, 1.0)]).unwrap();
    }
    {
        let conn = rusqlite::Connection::open(p).unwrap();
        conn.execute_batch(
            "CREATE TRIGGER refuse BEFORE INSERT ON entries
             WHEN NEW.id = 'boom'
             BEGIN SELECT RAISE(ABORT, 'refused'); END;",
        )
        .unwrap();
    }

    let mut db = Db::open(p).unwrap();
    let err = db.put_entries(&[&entry("fine", 200, 5.0), &entry("boom", 300, 5.0)]);
    assert!(err.is_err(), "the batch has to fail");

    let ids: Vec<String> = db
        .all_entries()
        .unwrap()
        .into_iter()
        .map(|e| e.id)
        .collect();
    assert_eq!(
        ids,
        vec!["existing"],
        "the row before the failure must not have landed"
    );
}

fn tempdir() -> std::path::PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!(
        "dhh-store-test-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&p);
    std::fs::create_dir_all(&p).unwrap();
    p
}
