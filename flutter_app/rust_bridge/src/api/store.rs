//! The ledger, owned by Rust.
//!
//! This is the architecture decision made early on, arriving: the entries, the
//! accounts and the current-account selection live **here**, and Dart drives
//! them with commands and reads view models back. Dart holds no copy of the
//! ledger to drift out of sync with, and no logic that could disagree with the
//! parity corpus.
//!
//! Three rules the whole crate already follows, restated because this is where
//! a caller would be tempted to break them:
//!
//! * **Identity is the platform's.** Every command that creates a row takes the
//!   id from Dart. `dahonghua_core` has no random source and does not want one.
//! * **The clock is the platform's.** Every command takes `now`. That is what
//!   makes the ledger replayable and what let a 3,678-scenario corpus pin it.
//! * **The timezone is the platform's.** A calendar day arrives computed;
//!   nothing here converts an instant into one.
//!
//! Locking: one `Mutex` around the whole store. The operations are microseconds
//! of arithmetic over a `Vec`, so there is nothing to gain from finer grain and
//! a great deal to lose in reasoning about it. A poisoned lock is recovered
//! rather than propagated — a panic in one command must not brick the ledger
//! for the rest of the session.

use dahonghua_core::civil::Civil;
use dahonghua_core::entry::{Entry, EntrySource, Io, Patch, Reimburse};
use dahonghua_core::jsval::{parse, stable, Value};
use dahonghua_core::ledger::Ledger;
use dahonghua_core::list::{self, DayLabel, FlatItem};
use dahonghua_core::rows::{entry_from_value, entry_to_value};
use dahonghua_core::store::{ImportedBill, Store, TransferOpts};
use flutter_rust_bridge::frb;
use std::sync::{Mutex, MutexGuard, OnceLock};

fn store() -> MutexGuard<'static, Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    let m = STORE.get_or_init(|| Mutex::new(Store::new()));
    // A panic inside one command poisons the lock. Taking the value anyway is
    // the right call here: the alternative is that every later call fails too,
    // which turns one bad row into an unusable ledger.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------- shapes that cross ----------

/// One entry, as Dart holds it.
///
/// A flat mirror of `core::Entry` rather than a re-export: the core answers to
/// the parity corpus and its shapes are chosen to match the TypeScript it
/// replaces. The moment an FFI attribute appears there, it is answering to two
/// masters.
#[derive(Debug, Clone, PartialEq)]
pub struct EntryView {
    pub id: String,
    pub ts: i64,
    /// `"exp" | "inc" | "xfer"`, or empty when the row names none.
    pub io: String,
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
    /// `"pending" | "done"`, or absent.
    pub rb: Option<String>,
    pub rb_amt: Option<f64>,
    pub refund: Option<f64>,
    pub refund_of: Option<String>,
    pub from_sub: Option<bool>,
    /// `"bill" | "notif"`, or absent when typed by hand.
    pub src: Option<String>,
    pub deleted_at: Option<i64>,
    pub updated_at: Option<i64>,
}

impl From<&Entry> for EntryView {
    fn from(e: &Entry) -> Self {
        EntryView {
            id: e.id.clone(),
            ts: e.ts,
            io: e.io.map(|i| i.as_str().to_string()).unwrap_or_default(),
            cat: e.cat.clone(),
            amt: e.amt,
            note: e.note.clone(),
            acct: e.acct.clone(),
            acct_to: e.acct_to.clone(),
            fee: e.fee,
            discount: e.discount,
            subcat: e.subcat.clone(),
            cur: e.cur.clone(),
            orig_amt: e.orig_amt,
            rate: e.rate,
            tags: e.tags.clone(),
            ledger: e.ledger.clone(),
            rb: e.rb.map(|r| r.as_str().to_string()),
            rb_amt: e.rb_amt,
            refund: e.refund,
            refund_of: e.refund_of.clone(),
            from_sub: e.from_sub,
            src: e.src.map(|s| s.as_str().to_string()),
            deleted_at: e.deleted_at,
            updated_at: e.updated_at,
        }
    }
}

/// A new entry, as the record sheet supplies it.
///
/// Separate from [`EntryView`] because they are not the same thing: this has no
/// `updatedAt`, no tombstone and no id — those are the store's to set, and a
/// caller that could set them could write a row the sync merge cannot reason
/// about.
#[derive(Debug, Clone, Default)]
pub struct NewEntry {
    pub io: String,
    pub cat: String,
    pub amt: f64,
    pub note: Option<String>,
    pub acct: Option<String>,
    pub subcat: Option<String>,
    pub cur: Option<String>,
    pub orig_amt: Option<f64>,
    pub rate: Option<f64>,
    pub tags: Option<Vec<String>>,
    pub ledger: Option<String>,
    /// When it happened. The store's `now` when absent.
    pub ts: Option<i64>,
}

impl From<NewEntry> for Entry {
    fn from(n: NewEntry) -> Self {
        Entry {
            ts: n.ts.unwrap_or(0),
            io: Io::parse(&n.io),
            cat: n.cat,
            amt: n.amt,
            note: n.note,
            acct: n.acct,
            subcat: n.subcat,
            cur: n.cur,
            orig_amt: n.orig_amt,
            rate: n.rate,
            tags: n.tags,
            ledger: n.ledger,
            ..Default::default()
        }
    }
}

/// A partial edit. Every field is "leave alone" when absent.
///
/// Modelled field by field rather than as a map of strings so a typo cannot
/// silently write a field nobody reads — the same reason `core::Patch` is.
#[derive(Debug, Clone, Default)]
pub struct EntryPatch {
    pub ts: Option<i64>,
    pub io: Option<String>,
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
    pub rb: Option<String>,
    pub rb_amt: Option<f64>,
    pub refund: Option<f64>,
    pub refund_of: Option<String>,
    pub from_sub: Option<bool>,
    pub src: Option<String>,
}

impl From<EntryPatch> for Patch {
    fn from(p: EntryPatch) -> Self {
        Patch {
            ts: p.ts,
            io: p.io.as_deref().and_then(Io::parse),
            cat: p.cat,
            amt: p.amt,
            note: p.note,
            acct: p.acct,
            acct_to: p.acct_to,
            fee: p.fee,
            discount: p.discount,
            subcat: p.subcat,
            cur: p.cur,
            orig_amt: p.orig_amt,
            rate: p.rate,
            tags: p.tags,
            ledger: p.ledger,
            rb: p.rb.as_deref().and_then(Reimburse::parse),
            rb_amt: p.rb_amt,
            refund: p.refund,
            refund_of: p.refund_of,
            from_sub: p.from_sub,
            src: p.src.as_deref().and_then(EntrySource::parse),
            ..Default::default()
        }
    }
}

/// An account, as Dart holds it.
#[derive(Debug, Clone, PartialEq)]
pub struct AccountView {
    pub id: String,
    pub name: String,
    pub name_en: Option<String>,
    pub balance: f64,
    /// `"cash" | "credit" | "prepaid" | "fx"`, empty for the default.
    pub kind: String,
    pub statement_day: Option<u32>,
    pub due_day: Option<u32>,
    pub fx_code: Option<String>,
    pub fx_rate: Option<f64>,
    pub archived: bool,
}

/// What one undoable delete needs to be reversed.
///
/// Opaque to Dart on purpose: it is a token to hand back, not a thing to
/// inspect or construct. Deleting an entry also tombstones its refund incomes
/// and rewinds the original's refund counter, and a caller assembling this by
/// hand would get that wrong.
#[derive(Debug, Clone)]
pub struct UndoToken {
    pub id: String,
    pub child_ids: Vec<String>,
    pub refunded_id: Option<String>,
    pub prev_refund: Option<f64>,
}

// ---------- commands ----------

/// Record an entry. Returns its id.
///
/// `id` and `now` come from Dart because identity and the clock are the
/// platform's, everywhere in this crate.
///
/// Recording also moves the current account to wherever the entry landed, so
/// the next record sheet opens there — a side effect the parity harness found
/// rather than the TypeScript announced.
#[frb(sync)]
pub fn add_entry(entry: NewEntry, id: String, now: i64) -> String {
    let ts = entry.ts;
    let e: Entry = entry.into();
    store().add_entry(e, id, ts, now)
}

/// Edit an entry in place. Answers whether the id was found.
///
/// Every field the patch names is stamped with `now`, which is what lets two
/// devices editing *different* fields of one entry both keep their edit.
#[frb(sync)]
pub fn update_entry(id: String, patch: EntryPatch, now: i64) -> bool {
    store().update_entry(&id, &patch.into(), now)
}

/// Soft-delete an entry, returning the token that reverses it.
///
/// The row stays in the ledger as a tombstone so other devices learn of the
/// deletion; every display path filters it out. `None` means the id was
/// unknown.
#[frb(sync)]
pub fn remove_entry(id: String, now: i64) -> Option<UndoToken> {
    store().remove_entry(&id, now).map(|u| UndoToken {
        id: u.id,
        child_ids: u.child_ids,
        refunded_id: u.refunded_id,
        prev_refund: u.prev_refund,
    })
}

/// Reverse a delete, as fresh stamped writes rather than a replayed snapshot.
///
/// Replaying the old rows would restore their old `updatedAt` too, which sits
/// below the push watermark — so the undo would never reach the cloud, and the
/// next pull would re-delete the entry.
#[frb(sync)]
pub fn unremove_entry(undo: UndoToken, now: i64) {
    store().unremove_entry(
        &dahonghua_core::ledger::RemoveUndo {
            id: undo.id,
            child_ids: undo.child_ids,
            refunded_id: undo.refunded_id,
            prev_refund: undo.prev_refund,
        },
        now,
    );
}

/// What a transfer needs. `from` and `to` are account ids.
///
/// A struct rather than ten parameters, which is not only a lint: a transfer
/// has two accounts, two optional adjustments and two optional labels, and at
/// the call site `fee` and `discount` are the same type in adjacent positions.
#[derive(Debug, Clone, Default)]
pub struct NewTransfer {
    pub from: String,
    pub to: String,
    pub amt: f64,
    /// Comes off the FROM account. A zero is no fee, not a fee of zero.
    pub fee: Option<f64>,
    /// Credits the TO account, same rule.
    pub discount: Option<f64>,
    pub note: Option<String>,
    pub ledger: Option<String>,
    /// When it happened; the caller's clock when absent.
    pub ts: Option<i64>,
}

/// A transfer between two accounts, as one `xfer` row. Returns its id.
///
/// `io` is `xfer`, which keeps the row out of income and expense statistics —
/// moving money is neither. The current account moves unconditionally, unlike
/// [`add_entry`]: a transfer always names a `from`, so there is nothing to
/// guard against.
#[frb(sync)]
pub fn add_transfer(transfer: NewTransfer, id: String, now: i64) -> String {
    store().add_transfer(
        TransferOpts {
            from: transfer.from,
            to: transfer.to,
            amt: transfer.amt,
            fee: transfer.fee,
            discount: transfer.discount,
            note: transfer.note,
            ledger: transfer.ledger,
            ts: transfer.ts,
        },
        id,
        now,
    )
}

/// Import accepted bill rows in one write. Returns how many landed.
#[frb(sync)]
pub fn import_bills(
    io: Vec<String>,
    cat: Vec<String>,
    amt: Vec<f64>,
    note: Vec<String>,
    ts: Vec<i64>,
    ids: Vec<String>,
    now: i64,
) -> u32 {
    let n = [io.len(), cat.len(), amt.len(), note.len(), ts.len()]
        .into_iter()
        .min()
        .unwrap_or(0);
    let bills: Vec<ImportedBill> = (0..n)
        .map(|i| ImportedBill {
            io: Io::parse(&io[i]).unwrap_or(Io::Exp),
            cat: cat[i].clone(),
            amt: amt[i],
            note: note[i].clone(),
            ts: ts[i],
        })
        .collect();
    store().import_bills(&bills, &ids, now) as u32
}

/// Where the next entry defaults to.
#[frb(sync)]
pub fn set_current_account(id: String) {
    store().current_account = id;
}

// ---------- queries ----------

#[frb(sync)]
pub fn current_account() -> String {
    store().current_account.clone()
}

#[frb(sync)]
pub fn entry_count() -> u32 {
    store().ledger.len() as u32
}

#[frb(sync)]
pub fn get_entry(id: String) -> Option<EntryView> {
    store().ledger.get(&id).map(EntryView::from)
}

#[frb(sync)]
pub fn accounts() -> Vec<AccountView> {
    store()
        .accounts
        .iter()
        .map(|a| AccountView {
            id: a.id.clone(),
            name: a.name.clone(),
            name_en: a.name_en.clone(),
            balance: a.balance,
            kind: a.kind.map(|k| k.as_str().to_string()).unwrap_or_default(),
            statement_day: a.statement_day,
            due_day: a.due_day,
            fx_code: a.fx_code.clone(),
            fx_rate: a.fx_rate,
            // `archived?: boolean` — absent and false are the same
            // thing to every reader, so the view flattens it
            archived: a.archived.unwrap_or(false),
        })
        .collect()
}

/// Every live row, newest first. Tombstones are not included.
#[frb(sync)]
pub fn live_entries() -> Vec<EntryView> {
    let s = store();
    let mut rows: Vec<&Entry> = s.ledger.live().collect();
    rows.sort_by_key(|e| std::cmp::Reverse(e.ts));
    rows.into_iter().map(EntryView::from).collect()
}

// ---------- the entry list ----------

/// One row of the flattened day-grouped list.
///
/// `kind` is `"header"`, `"entry"` or `"row"`. A flat shape with a tag rather
/// than three types, because `flutter_rust_bridge` renders a Rust enum with
/// fields as a sealed Dart class hierarchy, and a `ListView.builder` reading
/// one field is easier to get right than a visitor over three.
#[derive(Debug, Clone, PartialEq)]
pub struct ListItem {
    pub kind: String,
    /// `y-m-d` of the day this item belongs to.
    pub day: String,
    /// Headers only: `"today"`, `"yesterday"` or `"date"` — *which* name the
    /// day takes. Spelling the third is `toLocaleDateString`, which is Intl and
    /// therefore Dart's.
    pub label: String,
    /// Headers only.
    pub exp: f64,
    /// Headers only.
    pub inc: f64,
    /// Entry rows: the one id. Packed rows: several.
    pub ids: Vec<String>,
}

/// The entry list, grouped into calendar days and flattened for a builder.
///
/// `days` is parallel to `ids`: each entry's local calendar day, as `y-m-d`,
/// computed by Dart because the timezone is the platform's. Passing the ids
/// rather than whole entries keeps this a projection of state the store already
/// owns — Dart names which rows it is showing, not what they contain.
#[frb(sync)]
pub fn list_items(
    ids: Vec<String>,
    days: Vec<String>,
    today: String,
    columns: u32,
) -> Vec<ListItem> {
    let s = store();
    let n = ids.len().min(days.len());
    let rows: Vec<list::ListRow> = (0..n)
        .filter_map(|i| {
            let e = s.ledger.get(&ids[i])?;
            Some(list::ListRow {
                id: e.id.clone(),
                io: e.io,
                amt: e.amt,
                ts: e.ts,
                day: parse_day(&days[i]),
            })
        })
        .collect();
    let groups = list::group_by_day(&rows, parse_day(&today));
    list::flatten(&groups, columns as usize)
        .into_iter()
        .map(|it| match it {
            FlatItem::Header {
                day,
                label,
                exp,
                inc,
            } => ListItem {
                kind: "header".into(),
                day: show_day(day),
                label: match label {
                    DayLabel::Today => "today",
                    DayLabel::Yesterday => "yesterday",
                    DayLabel::Date => "date",
                }
                .into(),
                exp,
                inc,
                ids: vec![],
            },
            FlatItem::Entry { id, group } => ListItem {
                kind: "entry".into(),
                day: show_day(group),
                label: String::new(),
                exp: 0.0,
                inc: 0.0,
                ids: vec![id],
            },
            FlatItem::EntryRow { ids, group } => ListItem {
                kind: "row".into(),
                day: show_day(group),
                label: String::new(),
                exp: 0.0,
                inc: 0.0,
                ids,
            },
        })
        .collect()
}

fn parse_day(s: &str) -> Civil {
    let mut it = s.split('-');
    let y = it.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    Civil::new(y, m - 1, d)
}

fn show_day(d: Civil) -> String {
    format!("{}-{}-{}", d.y, d.m + 1, d.d)
}

// ---------- persistence ----------
//
// The store holds the ledger; the platform holds the file. Dart reads and
// writes the bytes, and these two turn them into state — which is the same
// split every other module here takes, with `jsval` doing the JSON because the
// sync boundary needed it anyway.

/// Replace the whole ledger from a JSON array of entries.
///
/// The shape is the app's own on-disk format, so a Flutter build reads what a
/// React Native build wrote. Returns how many rows landed.
#[frb(sync)]
pub fn load_entries(json: String) -> u32 {
    let parsed = parse(&json);
    let entries: Vec<Entry> = match &parsed {
        Value::Arr(items) => items.iter().map(entry_from_value).collect(),
        _ => vec![],
    };
    let n = entries.len() as u32;
    store().ledger = Ledger::from_entries(entries);
    n
}

/// The whole ledger as JSON, tombstones included.
///
/// Tombstones included deliberately: they are how another device learns of a
/// deletion, and a snapshot that dropped them would resurrect every deleted
/// row on the next restore.
#[frb(sync)]
pub fn snapshot_entries() -> String {
    let s = store();
    let parts: Vec<String> = s
        .ledger
        .all()
        .iter()
        .map(|e| stable(&entry_to_value(e)))
        .collect();
    format!("[{}]", parts.join(","))
}

/// Empty the store. For tests and for sign-out.
#[frb(sync)]
pub fn reset() {
    *store() = Store::new();
}
