//! 快捷指令 — the iPhone's Shortcuts requests, read and recorded.
//!
//! What a request means is `core::shortcut`'s. Two calls rather than one, and
//! the gap between them is the timezone: a sentence that names a day is put
//! at noon of it, and composing an instant from a day is Dart's (as
//! 一句话记账's `saveDrafts` does). Nothing writes to the ledger between the
//! two, so what the first found unrecorded is still unrecorded at the second;
//! the second checks again all the same, because it is the one that writes.

use flutter_rust_bridge::frb;

use dahonghua_core::ai::quick::Custom;
use dahonghua_core::entry::{EntrySource, Io};
use dahonghua_core::shortcut::{read, unrecorded, Ask, Request};
use dahonghua_core::store::ImportedBill;

use super::catalog::custom_cats_of;
use super::day::{parse_day, show_day};
use super::store::{store, store_marked};
use crate::api::db;

/// One request off the queue, as the iPhone wrote it down.
///
/// A sentence when `sentence` is set; otherwise a payment of `amount` at
/// `merchant`. A row with neither asks for nothing.
#[derive(Debug, Clone, PartialEq)]
pub struct ShortcutRequestView {
    pub id: String,
    pub sentence: Option<String>,
    pub amount: Option<f64>,
    pub merchant: Option<String>,
    /// The day the shortcut ran, `y-m-d`: what 昨天 in its words is counted
    /// from. Not the day the queue is read, which may be days later.
    pub today: String,
}

/// One entry a request asks for, not yet written.
#[derive(Debug, Clone, PartialEq)]
pub struct ShortcutDraftView {
    /// The entry's id, derived from the request's.
    pub id: String,
    /// The request it came from, whose moment it takes when no day is named.
    pub request_id: String,
    pub io: String,
    pub cat: String,
    pub amt: f64,
    pub note: String,
    /// `y-m-d` when the words named a day.
    pub day: Option<String>,
    /// A Wallet payment: written as a capture, as Android's 自动记账 rows are.
    pub captured: bool,
}

/// One entry to write, its moment decided.
#[derive(Debug, Clone, PartialEq)]
pub struct ShortcutEntryView {
    pub id: String,
    pub io: String,
    pub cat: String,
    pub amt: f64,
    pub note: String,
    pub ts: i64,
    pub captured: bool,
}

fn request_of(v: &ShortcutRequestView) -> Option<Request> {
    let ask = match (&v.sentence, v.amount) {
        (Some(s), _) => Ask::Sentence(s.clone()),
        (None, Some(amount)) => Ask::Payment {
            amount,
            merchant: v.merchant.clone().unwrap_or_default(),
        },
        (None, None) => return None,
    };
    Some(Request {
        id: v.id.clone(),
        ask,
    })
}

/// The entries `requests` ask for, less what the ledger already stands for.
#[frb(sync)]
pub fn shortcut_drafts(requests: Vec<ShortcutRequestView>) -> Vec<ShortcutDraftView> {
    let exp = custom_cats_of(Io::Exp);
    let inc = custom_cats_of(Io::Inc);
    let custom = Custom {
        exp: &exp,
        inc: &inc,
    };
    let s = store();
    let history: Vec<_> = s.ledger.live().collect();
    let mut out = Vec::new();
    for v in &requests {
        let Some(req) = request_of(v) else {
            continue;
        };
        let today = parse_day(&v.today);
        let drafts = unrecorded(read(&req, today, &history, custom), &s.ledger);
        out.extend(drafts.into_iter().map(|d| ShortcutDraftView {
            id: d.id,
            request_id: req.id.clone(),
            io: d.io.as_str().to_string(),
            cat: d.cat,
            amt: d.amt,
            note: d.note,
            day: d.day.map(show_day),
            captured: d.src == Some(EntrySource::Notif),
        }));
    }
    out
}

/// Write `entries`, skipping any id the ledger already holds. Returns the ids
/// that landed, each marked for the save.
#[frb(sync)]
pub fn post_shortcut_entries(entries: Vec<ShortcutEntryView>, now: i64) -> Vec<String> {
    let fresh: Vec<&ShortcutEntryView> = {
        let s = store();
        entries
            .iter()
            .filter(|e| s.ledger.get(&e.id).is_none())
            .collect()
    };
    if fresh.is_empty() {
        return Vec::new();
    }
    let bills: Vec<ImportedBill> = fresh
        .iter()
        .map(|e| ImportedBill {
            io: Io::parse(&e.io).unwrap_or(Io::Exp),
            cat: e.cat.clone(),
            amt: e.amt,
            note: e.note.clone(),
            ts: e.ts,
        })
        .collect();
    let ids: Vec<String> = fresh.iter().map(|e| e.id.clone()).collect();
    let srcs: Vec<Option<EntrySource>> = fresh
        .iter()
        .map(|e| e.captured.then_some(EntrySource::Notif))
        .collect();
    let landed = store_marked().post_shortcut(&bills, &ids, &srcs, now);
    db::mark_many(landed.clone());
    landed
}
