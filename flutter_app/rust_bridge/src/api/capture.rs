//! Auto-capture: what to do with the notifications the listener queued.
//!
//! The Kotlin listener is deliberately dumb — whitelist, three text fields,
//! write the row. Everything that decides what a notification *means* is in
//! the core's `notif` and `inbox` modules, which answer to parity corpora.
//! Every rule that lives in Kotlin costs a full rebuild to change and cannot be
//! tested; that was true of the shipping build and is why it drew the line in
//! the same place.
//!
//! Nothing here re-implements a decision. `inbox::drain` classifies a batch,
//! `Inbox::absorb` bounds the unparsed pile, `Inbox::confirm_pending` resolves
//! a queued capture. This module holds the inbox, converts shapes across the
//! boundary, and does the ledger write the core deliberately leaves to its
//! caller.
//!
//! The one property that is the caller's and cannot move here: the native queue
//! is acknowledged only *after* these results are durable, so a crash mid-drain
//! replays instead of losing payments. That ordering lives in Dart, where the
//! acknowledgement is.

use std::sync::{Mutex, MutexGuard, OnceLock};

use flutter_rust_bridge::frb;

use dahonghua_core::entry::Io;
use dahonghua_core::inbox::{drain, DraftPatch, Inbox, PendingItem, UnparsedItem, MAX_UNPARSED};
use dahonghua_core::jsval::{parse_checked, stable, Value};
use dahonghua_core::notif::{NotifEntryDraft, NotifSource, RawNotif};
use dahonghua_core::store::ImportedBill;

use super::store::{store, store_mut};

/// The inbox, which is device-local and is not part of the config blob.
///
/// Raw notification text belongs to the phone it was captured on — the shipping
/// build kept it out of the synced blob for that reason, and it keeps its own
/// file here for the same one.
fn inbox_lock() -> MutexGuard<'static, Inbox> {
    static I: OnceLock<Mutex<Inbox>> = OnceLock::new();
    let m = I.get_or_init(|| Mutex::new(Inbox::default()));
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// One row out of the native queue.
#[derive(Debug, Clone, PartialEq)]
pub struct RawNotifView {
    pub id: String,
    pub pkg: String,
    pub title: Option<String>,
    pub text: Option<String>,
    pub big_text: Option<String>,
    pub posted_at: i64,
}

impl From<&RawNotifView> for RawNotif {
    fn from(v: &RawNotifView) -> Self {
        RawNotif {
            id: v.id.clone(),
            pkg: v.pkg.clone(),
            title: v.title.clone(),
            text: v.text.clone(),
            big_text: v.big_text.clone(),
            posted_at: v.posted_at,
        }
    }
}

/// A parsed payment that was not confident enough to post unattended.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingView {
    /// The native queue id, so a decision can name the row it came from.
    pub id: String,
    pub source: String,
    /// What the notification actually said, for the confirm sheet. A user
    /// asked to accept a guess deserves to see what it was a guess about.
    pub raw: String,
    pub io: String,
    pub cat: String,
    pub amt: f64,
    pub note: String,
    pub ts: i64,
}

/// A capture from a watched app that no rule understood.
#[derive(Debug, Clone, PartialEq)]
pub struct UnparsedView {
    pub id: String,
    pub pkg: String,
    pub raw: String,
    pub posted_at: i64,
}

/// What one drain did.
#[derive(Debug, Clone, PartialEq)]
pub struct DrainSummary {
    /// Added to the ledger outright.
    pub posted: u32,
    /// Parsed, but waiting for a tap.
    pub queued: u32,
    pub unparsed: u32,
}

fn pending_view(p: &PendingItem) -> PendingView {
    PendingView {
        id: p.id.clone(),
        source: p.source.as_str().to_string(),
        raw: p.raw.clone(),
        io: p.draft.io.as_str().to_string(),
        cat: p.draft.cat.clone(),
        amt: p.draft.amt,
        note: p.draft.note.clone(),
        ts: p.draft.ts,
    }
}

fn unparsed_view(u: &UnparsedItem) -> UnparsedView {
    UnparsedView {
        id: u.id.clone(),
        pkg: u.pkg.clone(),
        raw: u.raw.clone(),
        posted_at: u.posted_at,
    }
}

/// Post drafts as `src: notif` entries.
///
/// That source is not a label: it is what tells the next drain the ledger
/// already stands for these payments. A row written without it is invisible to
/// the dedup and gets posted a second time.
fn post(drafts: &[NotifEntryDraft], now: i64, tag: &str) -> u32 {
    if drafts.is_empty() {
        return 0;
    }
    let bills: Vec<ImportedBill> = drafts
        .iter()
        .map(|d| ImportedBill {
            io: d.io,
            cat: d.cat.clone(),
            amt: d.amt,
            note: d.note.clone(),
            ts: d.ts,
        })
        .collect();
    let ids: Vec<String> = (0..bills.len())
        .map(|i| format!("n{now}{tag}{i}"))
        .collect();
    store_mut().post_captured(&bills, &ids, now) as u32
}

/// Drain the native queue: classify, record what is confident, keep the rest.
///
/// Writes before returning, deliberately — Dart acknowledges the native queue
/// after this call, and nothing may sit between the decision and the row
/// reaching the ledger.
#[frb(sync)]
pub fn drain_captures(raws: Vec<RawNotifView>, now: i64) -> DrainSummary {
    let raw: Vec<RawNotif> = raws.iter().map(RawNotif::from).collect();
    let mut inbox = inbox_lock();

    // No custom categories: this port has no editor for them yet. The core
    // already takes them and prefers a custom keyword over a built-in one.
    let outcome = {
        let s = store();
        drain(&raw, &inbox, s.ledger.all(), &[])
    };
    inbox.absorb(&outcome);

    let (post_n, queue_n, unparsed_n) = outcome.counts();
    post(&outcome.post, now, "i");

    DrainSummary {
        posted: post_n as u32,
        queued: queue_n as u32,
        unparsed: unparsed_n as u32,
    }
}

#[frb(sync)]
pub fn inbox_pending() -> Vec<PendingView> {
    inbox_lock().pending.iter().map(pending_view).collect()
}

#[frb(sync)]
pub fn inbox_unparsed() -> Vec<UnparsedView> {
    inbox_lock().unparsed.iter().map(unparsed_view).collect()
}

/// Accept a waiting payment.
///
/// False for an id that is no longer queued, which is a no-op rather than an
/// error: the caller is a screen that may be acting on a row a later drain has
/// since resolved.
#[frb(sync)]
pub fn confirm_pending(id: String, now: i64) -> bool {
    let mut inbox = inbox_lock();
    match inbox.confirm_pending(&id, &DraftPatch::default()) {
        Some(d) => {
            post(std::slice::from_ref(&d), now, "a");
            true
        }
        None => false,
    }
}

#[frb(sync)]
pub fn dismiss_pending(id: String) {
    inbox_lock().dismiss_pending(&id);
}

#[frb(sync)]
pub fn clear_unparsed() {
    inbox_lock().clear_unparsed();
}

/// Everything the inbox holds, for the file that carries it across a restart.
#[frb(sync)]
pub fn inbox_blob() -> String {
    let inbox = inbox_lock();
    let pending: Vec<Value> = inbox
        .pending
        .iter()
        .map(|p| {
            Value::Obj(vec![
                ("id".into(), Value::Str(p.id.clone())),
                ("source".into(), Value::Str(p.source.as_str().into())),
                ("raw".into(), Value::Str(p.raw.clone())),
                ("io".into(), Value::Str(p.draft.io.as_str().into())),
                ("cat".into(), Value::Str(p.draft.cat.clone())),
                ("amt".into(), Value::Num(p.draft.amt)),
                ("note".into(), Value::Str(p.draft.note.clone())),
                ("ts".into(), Value::Num(p.draft.ts as f64)),
            ])
        })
        .collect();
    let unparsed: Vec<Value> = inbox
        .unparsed
        .iter()
        .map(|u| {
            Value::Obj(vec![
                ("id".into(), Value::Str(u.id.clone())),
                ("pkg".into(), Value::Str(u.pkg.clone())),
                ("raw".into(), Value::Str(u.raw.clone())),
                ("postedAt".into(), Value::Num(u.posted_at as f64)),
            ])
        })
        .collect();
    stable(&Value::Obj(vec![
        ("pending".into(), Value::Arr(pending)),
        ("unparsed".into(), Value::Arr(unparsed)),
    ]))
}

/// Read the inbox back. False for a document that cannot be read at all.
///
/// Unlike the ledger, a failure here is not something to refuse over: every
/// item is either replaceable from the wallet's own export or was never going
/// to become an entry. It starts empty and says so.
#[frb(sync)]
pub fn load_inbox(json: String) -> bool {
    let Some(v) = parse_checked(&json) else {
        return false;
    };
    let mut inbox = inbox_lock();
    inbox.pending.clear();
    inbox.unparsed.clear();

    if let Some(Value::Arr(items)) = v.get("pending") {
        for it in items {
            let Some(io) = it.get("io").and_then(as_str).and_then(|s| Io::parse(&s)) else {
                continue;
            };
            inbox.pending.push(PendingItem {
                id: it.get("id").and_then(as_str).unwrap_or_default(),
                source: it
                    .get("source")
                    .and_then(as_str)
                    .and_then(|s| parse_source(&s))
                    .unwrap_or(NotifSource::Bank),
                raw: it.get("raw").and_then(as_str).unwrap_or_default(),
                draft: NotifEntryDraft {
                    io,
                    amt: it.num("amt").unwrap_or(0.0),
                    cat: it.get("cat").and_then(as_str).unwrap_or_default(),
                    note: it.get("note").and_then(as_str).unwrap_or_default(),
                    ts: it.num("ts").unwrap_or(0.0) as i64,
                    // Anything in this list was NOT confident — that is why it
                    // is in this list rather than in the ledger. Storing the
                    // flag would let an edited file put an unconfident draft
                    // back as a confident one.
                    confident: false,
                },
            });
        }
    }
    if let Some(Value::Arr(items)) = v.get("unparsed") {
        for it in items {
            inbox.unparsed.push(UnparsedItem {
                id: it.get("id").and_then(as_str).unwrap_or_default(),
                pkg: it.get("pkg").and_then(as_str).unwrap_or_default(),
                raw: it.get("raw").and_then(as_str).unwrap_or_default(),
                posted_at: it.num("postedAt").unwrap_or(0.0) as i64,
            });
        }
    }
    true
}

fn as_str(v: &Value) -> Option<String> {
    match v {
        Value::Str(s) => Some(s.clone()),
        _ => None,
    }
}

fn parse_source(s: &str) -> Option<NotifSource> {
    match s {
        "alipay" => Some(NotifSource::Alipay),
        "wechat" => Some(NotifSource::Wechat),
        "unionpay" => Some(NotifSource::Unionpay),
        "bank" => Some(NotifSource::Bank),
        _ => None,
    }
}

/// How many unparsed captures are kept. Asked rather than restated, so a test
/// that checks the bound is checking the core's bound and not a copy of it.
#[frb(sync)]
pub fn max_unparsed() -> u32 {
    MAX_UNPARSED as u32
}

/// Forget everything the inbox holds. For tests, which share one process.
#[frb(sync)]
pub fn reset_inbox() {
    let mut inbox = inbox_lock();
    inbox.clear_pending();
    inbox.clear_unparsed();
}
