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

use dahonghua_core::accounts::{Account, AccountKind};
use dahonghua_core::civil::Civil;
use dahonghua_core::entry::{Entry, EntrySource, Io, Patch, Reimburse};
use dahonghua_core::jsval::{parse_checked, stable, Value};
use dahonghua_core::ledger::Ledger;
use dahonghua_core::list::{self, DayLabel, FlatItem};
use dahonghua_core::model::{Asset, AssetKind, Loan, LoanKind, Sub, SubFreq, Template};
use dahonghua_core::money::Currencies;
use dahonghua_core::rows::{entry_from_value, entry_to_value};
use dahonghua_core::store::{ImportedBill, Store, TransferOpts};
use flutter_rust_bridge::frb;
use std::sync::{Mutex, MutexGuard, OnceLock};

pub(crate) fn store() -> MutexGuard<'static, Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    let m = STORE.get_or_init(|| Mutex::new(Store::new()));
    // A panic inside one command poisons the lock. Taking the value anyway is
    // the right call here: the alternative is that every later call fails too,
    // which turns one bad row into an unusable ledger.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// The currency settings, which the record sheet's decisions read.
///
/// A second lock rather than a field on `Store`, because `Store` is core's and
/// answers to the parity corpus — this is the bridge holding one more piece of
/// config until the config sections themselves come across.
fn currencies_lock() -> MutexGuard<'static, Currencies> {
    static CUR: OnceLock<Mutex<Currencies>> = OnceLock::new();
    let m = CUR.get_or_init(|| {
        Mutex::new(Currencies {
            base: "CNY".to_string(),
            ..Default::default()
        })
    });
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// The budget settings, which the budget screen's comparisons read.
///
/// Alongside `currencies` and for the same reason: these are config the Rust
/// store owns until the config sections themselves come across, and a second
/// copy in Dart is a second chance to disagree about what a cap of zero means.
#[derive(Debug, Clone, Default)]
pub struct BudgetSettings {
    pub budget: f64,
    pub daily_budget: f64,
    pub cycle_start: i32,
    /// Insertion-ordered, because `cat_budget_rows` applies JavaScript's own
    /// key ordering to it and a `HashMap` has none to apply it to.
    pub caps: Vec<(String, f64)>,
}

fn settings_lock() -> MutexGuard<'static, BudgetSettings> {
    static SET: OnceLock<Mutex<BudgetSettings>> = OnceLock::new();
    let m = SET.get_or_init(|| {
        Mutex::new(BudgetSettings {
            cycle_start: 1,
            ..Default::default()
        })
    });
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// The reader's language, `zh` or `en`.
///
/// Its own lock rather than a field on `BudgetSettings`, because it is a
/// top-level config section on the other side — `lang` sits beside `settings`
/// in the blob, and the per-section stamps that decide a sync merge are keyed
/// on exactly those names.
fn lang_lock() -> MutexGuard<'static, String> {
    static L: OnceLock<Mutex<String>> = OnceLock::new();
    let m = L.get_or_init(|| Mutex::new("zh".to_string()));
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// `zh` unless the config says otherwise.
#[frb(sync)]
pub fn language() -> String {
    lang_lock().clone()
}

/// Anything that is not `en` is `zh`, which is what a restored config with a
/// language this build has never heard of should fall back to.
#[frb(sync)]
pub fn set_language(lang: String) {
    *lang_lock() = if lang == "en" { "en" } else { "zh" }.to_string();
}

pub(crate) fn settings_of() -> BudgetSettings {
    settings_lock().clone()
}

pub(crate) fn set_settings_inner(s: BudgetSettings) {
    *settings_lock() = s;
}

pub(crate) fn currencies_of() -> Currencies {
    currencies_lock().clone()
}

pub(crate) fn set_currencies_inner(c: Currencies) {
    *currencies_lock() = c;
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

impl From<&Account> for AccountView {
    fn from(a: &Account) -> Self {
        AccountView {
            id: a.id.clone(),
            name: a.name.clone(),
            name_en: a.name_en.clone(),
            balance: a.balance,
            kind: a.kind.map(|k| k.as_str().to_string()).unwrap_or_default(),
            statement_day: a.statement_day,
            due_day: a.due_day,
            fx_code: a.fx_code.clone(),
            fx_rate: a.fx_rate,
            // `archived?: boolean` — absent and false are the same thing to
            // every reader, so the view flattens it
            archived: a.archived == Some(true),
        }
    }
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
    store().accounts.iter().map(AccountView::from).collect()
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
/// The shape is the app's own on-disk format — the same array the React Native
/// build writes under `dhh_entries_v1`. That makes a backup exported from one
/// importable into the other; it does **not** mean this build can read that
/// one's storage, because AsyncStorage on Android is a SQLite database rather
/// than a file. Moving an existing install across is Phase 4 platform work and
/// is not what this is.
///
/// Returns how many rows landed, or **-1** when the document could not be read.
///
/// The difference matters more than it looks. `parse` is lenient by design —
/// everything the sync path hands it has been through `JSON.stringify` once —
/// but a file is where that assumption fails. A write interrupted by a full
/// disk leaves a truncated array, and reading it leniently recovers whichever
/// rows happen to be complete. Loading 1 of 5,000 entries is not a partial
/// success; it is the first half of losing 4,999, because the next save writes
/// the 1 back.
///
/// So this refuses, leaves the ledger alone, and says so. The caller's job is
/// then to not overwrite the file it could not read.
#[frb(sync)]
pub fn load_entries(json: String) -> i32 {
    let Some(parsed) = parse_checked(&json) else {
        return -1;
    };
    let Value::Arr(items) = &parsed else {
        return -1;
    };
    let entries: Vec<Entry> = items.iter().map(entry_from_value).collect();
    let n = entries.len() as i32;
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

/// The config as JSON: accounts, the current account, the currency table.
///
/// Separate from the ledger deliberately, and the React Native build splits it
/// the same way (`dhh_entries_v1` and `dhh_config_v1`). Renaming an account
/// should not rewrite ten thousand entries, and a write that fails halfway
/// should not be able to take both with it.
#[frb(sync)]
pub fn snapshot_config() -> String {
    let s = store();
    let c = currencies_of();
    let accounts: Vec<Value> = s
        .accounts
        .iter()
        .map(|a| {
            let mut o: Vec<(String, Value)> = vec![
                ("id".into(), Value::Str(a.id.clone())),
                ("name".into(), Value::Str(a.name.clone())),
                ("balance".into(), Value::Num(a.balance)),
            ];
            if let Some(n) = &a.name_en {
                o.push(("nameEn".into(), Value::Str(n.clone())));
            }
            if let Some(k) = a.kind {
                o.push(("kind".into(), Value::Str(k.as_str().to_string())));
            }
            if let Some(d) = a.statement_day {
                o.push(("statementDay".into(), Value::Num(d as f64)));
            }
            if let Some(d) = a.due_day {
                o.push(("dueDay".into(), Value::Num(d as f64)));
            }
            if let Some(c) = &a.fx_code {
                o.push(("fxCode".into(), Value::Str(c.clone())));
            }
            if let Some(r) = a.fx_rate {
                o.push(("fxRate".into(), Value::Num(r)));
            }
            if let Some(true) = a.archived {
                o.push(("archived".into(), Value::Bool(true)));
            }
            Value::Obj(o)
        })
        .collect();
    let rates: Vec<(String, Value)> = {
        let mut v: Vec<(String, Value)> = c
            .rates
            .iter()
            .map(|(k, r)| (k.clone(), Value::Num(*r)))
            .collect();
        // a HashMap has no order and the file should, or a config that did not
        // change would still write a different byte string every time
        v.sort_by(|a, b| a.0.cmp(&b.0));
        v
    };
    let set = settings_of();
    let caps: Vec<(String, Value)> = set
        .caps
        .iter()
        .map(|(k, v)| (k.clone(), Value::Num(*v)))
        .collect();
    let subs: Vec<Value> = super::subscriptions::subs_of()
        .iter()
        .map(|b| {
            let mut o: Vec<(String, Value)> = vec![
                ("id".into(), Value::Str(b.id.clone())),
                ("name".into(), Value::Str(b.name.clone())),
                ("emoji".into(), Value::Str(b.emoji.clone())),
                ("amt".into(), Value::Num(b.amt)),
                (
                    "freq".into(),
                    Value::Str(
                        match b.freq {
                            SubFreq::Yearly => "yearly",
                            SubFreq::Monthly => "monthly",
                        }
                        .to_string(),
                    ),
                ),
                ("day".into(), Value::Num(b.day as f64)),
                ("cat".into(), Value::Str(b.cat.clone())),
                ("created".into(), Value::Num(b.created as f64)),
            ];
            if let Some(m) = b.month {
                o.push(("month".into(), Value::Num(m as f64)));
            }
            if let Some(l) = &b.last_charged {
                o.push(("lastCharged".into(), Value::Str(l.clone())));
            }
            // `kind: 'transfer'` is how v7 spells it, and the importer reads
            // that key rather than a boolean
            if b.is_transfer == Some(true) {
                o.push(("kind".into(), Value::Str("transfer".into())));
            }
            if let Some(f) = &b.from {
                o.push(("from".into(), Value::Str(f.clone())));
            }
            if let Some(t) = &b.to {
                o.push(("to".into(), Value::Str(t.clone())));
            }
            if let Some(n) = b.periods {
                o.push(("periods".into(), Value::Num(n as f64)));
            }
            if let Some(n) = b.charged {
                o.push(("charged".into(), Value::Num(n as f64)));
            }
            Value::Obj(o)
        })
        .collect();
    let assets: Vec<Value> = super::networth::assets_of()
        .iter()
        .map(|a| {
            Value::Obj(vec![
                ("id".into(), Value::Str(a.id.clone())),
                ("name".into(), Value::Str(a.name.clone())),
                (
                    "type".into(),
                    Value::Str(
                        match a.kind {
                            AssetKind::Liab => "liab",
                            AssetKind::Asset => "asset",
                        }
                        .to_string(),
                    ),
                ),
                ("val".into(), Value::Num(a.val)),
                // written even when false: it is a flag the user changes, not
                // optional metadata, and absent would read as false on a device
                // that had never seen it set
                ("noCount".into(), Value::Bool(a.no_count == Some(true))),
            ])
        })
        .collect();
    let loans: Vec<Value> = super::networth::loans_of()
        .iter()
        .map(|l| {
            Value::Obj(vec![
                ("id".into(), Value::Str(l.id.clone())),
                ("who".into(), Value::Str(l.who.clone())),
                (
                    "type".into(),
                    Value::Str(
                        match l.kind {
                            LoanKind::Borrow => "borrow",
                            LoanKind::Lend => "lend",
                        }
                        .to_string(),
                    ),
                ),
                ("amt".into(), Value::Num(l.amt)),
                ("repaid".into(), Value::Num(l.repaid.unwrap_or(0.0))),
                ("ts".into(), Value::Num(l.ts as f64)),
            ])
        })
        .collect();
    let lib = super::catalog::library_of();
    let templates: Vec<Value> = lib
        .templates
        .iter()
        .map(|t| {
            let mut o: Vec<(String, Value)> = vec![
                ("id".into(), Value::Str(t.id.clone())),
                ("io".into(), Value::Str(t.io.as_str().to_string())),
                ("cat".into(), Value::Str(t.cat.clone())),
                ("amt".into(), Value::Num(t.amt)),
                ("name".into(), Value::Str(t.name.clone())),
            ];
            if let Some(n) = &t.note {
                o.push(("note".into(), Value::Str(n.clone())));
            }
            Value::Obj(o)
        })
        .collect();
    let strs = |v: &[String]| Value::Arr(v.iter().map(|x| Value::Str(x.clone())).collect());
    let mut settings_obj: Vec<(String, Value)> = Vec::new();
    stable(&Value::Obj(vec![
        ("accounts".into(), Value::Arr(accounts)),
        (
            "tags".into(),
            Value::Obj(vec![
                ("normal".into(), strs(&lib.tags.normal)),
                ("ledger".into(), strs(&lib.tags.ledger)),
            ]),
        ),
        ("templates".into(), Value::Arr(templates)),
        ("curLedger".into(), Value::Str(lib.current_ledger.clone())),
        ("lang".into(), Value::Str(language())),
        ("theme".into(), Value::Str(super::theme::theme_key())),
        ("dark".into(), Value::Bool(super::theme::is_dark())),
        ("lock".into(), Value::Bool(super::lock::lock_enabled())),
        ("assets".into(), Value::Arr(assets)),
        ("loans".into(), Value::Arr(loans)),
        ("subs".into(), Value::Arr(subs)),
        (
            "settings".into(),
            Value::Obj({
                settings_obj.push(("budget".into(), Value::Num(set.budget)));
                settings_obj.push(("dailyBudget".into(), Value::Num(set.daily_budget)));
                settings_obj.push(("cycleStart".into(), Value::Num(set.cycle_start as f64)));
                settings_obj.push(("catBudgets".into(), Value::Obj(caps)));
                // absent rather than an empty array when nothing is archived,
                // or a sync round-trip would carry it back as a field that is
                // set — the same falsy-means-absent rule as everywhere else
                if let Some(a) = &lib.archived {
                    settings_obj.push(("archivedLedgers".into(), strs(a)));
                }
                settings_obj
            }),
        ),
        ("curAccount".into(), Value::Str(s.current_account.clone())),
        (
            "currencies".into(),
            Value::Obj(vec![
                ("base".into(), Value::Str(c.base.clone())),
                ("rates".into(), Value::Obj(rates)),
            ]),
        ),
    ]))
}

/// Restore the config. Anything the blob does not carry is left alone.
///
/// Left alone rather than defaulted: a config file written by an older build
/// will not mention a section a newer one added, and defaulting it would wipe
/// what the user had every time they upgraded.
/// Returns false when the document could not be read, for the same reason
/// [`load_entries`] does.
#[frb(sync)]
pub fn load_config(json: String) -> bool {
    let Some(v) = parse_checked(&json) else {
        return false;
    };
    if let Some(Value::Arr(items)) = v.get("accounts") {
        let accounts: Vec<Account> = items
            .iter()
            .map(|a| Account {
                id: str_of(a.get("id")),
                name: str_of(a.get("name")),
                name_en: a.get("nameEn").and_then(as_str),
                balance: a.num("balance").unwrap_or(0.0),
                kind: a
                    .get("kind")
                    .and_then(as_str)
                    .as_deref()
                    .and_then(AccountKind::parse),
                statement_day: a.num("statementDay").map(|n| n as u32),
                due_day: a.num("dueDay").map(|n| n as u32),
                fx_code: a.get("fxCode").and_then(as_str),
                fx_rate: a.num("fxRate"),
                archived: matches!(a.get("archived"), Some(Value::Bool(true))).then_some(true),
            })
            .collect();
        if !accounts.is_empty() {
            store().accounts = accounts;
        }
    }
    if let Some(Value::Str(l)) = v.get("lang") {
        set_language(l.clone());
    }
    {
        // Read together, because they are one choice. A config with a theme
        // and no `dark` key is one written before dark mode existed, and its
        // room was lit.
        let key = v
            .get("theme")
            .and_then(|x| match x {
                Value::Str(s) => Some(s.clone()),
                _ => None,
            })
            .unwrap_or_else(|| "default".into());
        let dark = matches!(v.get("dark"), Some(Value::Bool(true)));
        super::theme::set_theme(key, dark);
    }
    // Restored, not switched on: loading a file is not a user turning the lock
    // on, and prompting here would ask before there is a screen to ask over.
    super::lock::lock_load(matches!(v.get("lock"), Some(Value::Bool(true))));
    if let Some(Value::Str(id)) = v.get("curAccount") {
        store().current_account = id.clone();
    }
    {
        let mut lib = super::catalog::library_of();
        let mut touched = false;
        if let Some(t @ Value::Obj(_)) = v.get("tags") {
            let list = |k: &str| match t.get(k) {
                Some(Value::Arr(items)) => items.iter().filter_map(as_str).collect(),
                _ => Vec::new(),
            };
            lib.tags.normal = list("normal");
            lib.tags.ledger = list("ledger");
            touched = true;
        }
        if let Some(Value::Arr(items)) = v.get("templates") {
            lib.templates = items
                .iter()
                .map(|t| Template {
                    id: str_of(t.get("id")),
                    io: t
                        .get("io")
                        .and_then(as_str)
                        .as_deref()
                        .and_then(Io::parse)
                        .unwrap_or(Io::Exp),
                    cat: str_of(t.get("cat")),
                    amt: t.num("amt").unwrap_or(0.0),
                    note: t.get("note").and_then(as_str),
                    name: str_of(t.get("name")),
                })
                .collect();
            touched = true;
        }
        if let Some(Value::Str(l)) = v.get("curLedger") {
            lib.current_ledger = l.clone();
            touched = true;
        }
        if let Some(set @ Value::Obj(_)) = v.get("settings") {
            if let Some(Value::Arr(items)) = set.get("archivedLedgers") {
                let list: Vec<String> = items.iter().filter_map(as_str).collect();
                lib.archived = (!list.is_empty()).then_some(list);
                touched = true;
            }
        }
        if touched {
            super::catalog::set_library_inner(lib);
        }
    }
    if let Some(Value::Arr(items)) = v.get("assets") {
        let assets: Vec<Asset> = items
            .iter()
            .map(|a| Asset {
                id: str_of(a.get("id")),
                name: str_of(a.get("name")),
                kind: match a.get("type").and_then(as_str).as_deref() {
                    Some("liab") => AssetKind::Liab,
                    _ => AssetKind::Asset,
                },
                val: a.num("val").unwrap_or(0.0),
                no_count: Some(matches!(a.get("noCount"), Some(Value::Bool(true)))),
            })
            .collect();
        super::networth::set_assets_inner(assets);
    }
    if let Some(Value::Arr(items)) = v.get("loans") {
        let loans: Vec<Loan> = items
            .iter()
            .map(|l| Loan {
                id: str_of(l.get("id")),
                who: str_of(l.get("who")),
                kind: match l.get("type").and_then(as_str).as_deref() {
                    Some("borrow") => LoanKind::Borrow,
                    _ => LoanKind::Lend,
                },
                amt: l.num("amt").unwrap_or(0.0),
                repaid: Some(l.num("repaid").unwrap_or(0.0)),
                ts: l.num("ts").map(|n| n as i64).unwrap_or(0),
            })
            .collect();
        super::networth::set_loans_inner(loans);
    }
    if let Some(Value::Arr(items)) = v.get("subs") {
        let subs: Vec<Sub> = items
            .iter()
            .map(|b| Sub {
                id: str_of(b.get("id")),
                name: str_of(b.get("name")),
                emoji: str_of(b.get("emoji")),
                amt: b.num("amt").unwrap_or(0.0),
                freq: match b.get("freq").and_then(as_str).as_deref() {
                    Some("yearly") => SubFreq::Yearly,
                    _ => SubFreq::Monthly,
                },
                // a day outside 1..=28 would skip the months that have no such
                // day; the form never offers one, a restored file can say
                // anything
                day: b.num("day").map(|n| (n as u32).clamp(1, 28)).unwrap_or(1),
                month: b.num("month").map(|n| (n as u32).clamp(1, 12)),
                cat: str_of(b.get("cat")),
                created: b.num("created").map(|n| n as i64).unwrap_or(0),
                last_charged: b.get("lastCharged").and_then(as_str),
                is_transfer: matches!(b.get("kind").and_then(as_str).as_deref(), Some("transfer"))
                    .then_some(true),
                from: b.get("from").and_then(as_str),
                to: b.get("to").and_then(as_str),
                periods: b.num("periods").map(|n| n as u32),
                charged: b.num("charged").map(|n| n as u32),
            })
            .collect();
        super::subscriptions::set_subs_inner(subs);
    }
    if let Some(set @ Value::Obj(_)) = v.get("settings") {
        set_settings_inner(BudgetSettings {
            budget: set.num("budget").unwrap_or(0.0),
            daily_budget: set.num("dailyBudget").unwrap_or(0.0),
            // a cycle start outside 1..28 would skip the months that have no
            // such day; the settings screen never offers one, and a restored
            // file can say anything
            cycle_start: set
                .num("cycleStart")
                .map(|n| (n as i32).clamp(1, 28))
                .unwrap_or(1),
            caps: match set.get("catBudgets") {
                Some(Value::Obj(entries)) => entries
                    .iter()
                    .filter_map(|(k, val)| match val {
                        Value::Num(n) => Some((k.clone(), *n)),
                        _ => None,
                    })
                    .collect(),
                _ => vec![],
            },
        });
    }
    if let Some(c @ Value::Obj(_)) = v.get("currencies") {
        let base = match c.get("base") {
            Some(Value::Str(b)) if !b.is_empty() => b.clone(),
            _ => "CNY".to_string(),
        };
        let rates = match c.get("rates") {
            Some(Value::Obj(entries)) => entries
                .iter()
                .filter_map(|(k, val)| match val {
                    Value::Num(n) => Some((k.clone(), *n)),
                    _ => None,
                })
                .collect(),
            _ => Default::default(),
        };
        set_currencies_inner(Currencies { base, rates });
    }
    true
}

fn str_of(v: Option<&Value>) -> String {
    as_str(v.unwrap_or(&Value::Undefined)).unwrap_or_default()
}

fn as_str(v: &Value) -> Option<String> {
    match v {
        Value::Str(s) => Some(s.clone()),
        _ => None,
    }
}

/// How long a write waits for the next change, in milliseconds.
///
/// The React Native build debounces its two saves by this much. It is here
/// rather than in the Dart so both builds agree about how much work a crash
/// can lose — which is what a save debounce actually decides.
#[frb(sync)]
pub fn persist_debounce_ms() -> i64 {
    400
}

/// Empty the store. For tests and for sign-out.
#[frb(sync)]
pub fn reset() {
    *store() = Store::new();
    // the currency table too: a test that inherited the previous one's rates
    // would take a different branch through `validate` for no stated reason,
    // which is the fixture gap the TypeScript suite had
    set_currencies_inner(Currencies {
        base: "CNY".to_string(),
        ..Default::default()
    });
    set_settings_inner(BudgetSettings {
        cycle_start: 1,
        ..Default::default()
    });
    super::subscriptions::set_subs_inner(Vec::new());
    super::networth::set_assets_inner(Vec::new());
    super::networth::set_loans_inner(Vec::new());
    super::catalog::set_library_inner(Default::default());
    set_language("zh".to_string());
}
