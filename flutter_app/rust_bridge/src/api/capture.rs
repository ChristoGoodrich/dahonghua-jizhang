//! Auto-capture: what to do with the notifications the listener queued.
//!
//! The Kotlin listener is deliberately dumb — whitelist, three text fields,
//! write the row. Everything that decides what a notification *means* is here
//! and in the core's `notif` module, which answers to a 1,284-case parity
//! corpus. Every rule that lives in Kotlin costs a full rebuild to change and
//! cannot be tested; that was true of the shipping build and is why it drew the
//! line in the same place.
//!
//! [`plan_drain`] decides and writes nothing. Dart applies the plan, then
//! acknowledges the native queue — in that order, so a crash mid-drain replays
//! instead of losing payments.

use flutter_rust_bridge::frb;

use dahonghua_core::entry::{Entry, EntrySource, Io};
use dahonghua_core::notif::{
    full_text, is_duplicate, parse_notification, to_entry_draft, PaymentKey, RawNotif,
    DUP_WINDOW_MS,
};
use dahonghua_core::store::ImportedBill;

use super::store::store;

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

/// A payment ready to become an entry.
#[derive(Debug, Clone, PartialEq)]
pub struct DraftView {
    pub io: String,
    pub cat: String,
    pub amt: f64,
    pub note: String,
    pub ts: i64,
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
    pub draft: DraftView,
}

/// A capture from a watched app that no rule understood.
///
/// Kept on purpose. Notification wording differs by app version, bank and
/// region, and there is no way to write rules for text nobody has seen — this
/// is how the real strings on a real phone become visible.
#[derive(Debug, Clone, PartialEq)]
pub struct UnparsedView {
    pub id: String,
    pub pkg: String,
    pub raw: String,
    pub posted_at: i64,
}

/// What draining the queue would do. Nothing has happened yet.
#[derive(Debug, Clone, PartialEq)]
pub struct DrainPlan {
    /// Confident captures: a merchant name came through, so the note means
    /// something and the row can post unattended.
    pub posted: Vec<DraftView>,
    pub pending: Vec<PendingView>,
    pub unparsed: Vec<UnparsedView>,
    /// Every id handed in, including the ones that became nothing. A duplicate
    /// push is still handled — leaving it in the queue would re-examine it on
    /// every drain forever.
    pub consumed: Vec<String>,
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

/// Payments already represented, so a re-drain cannot double-post.
///
/// The ledger scan is bounded by the *event* times in this batch, not by the
/// clock. One payment's follow-up push can be drained an hour after the first
/// if that is when the app happens to be opened, and a wall-clock "recent
/// entries" window would have forgotten the original by then.
fn already_seen(entries: &[Entry], from: i64, to: i64, waiting: &[PaymentKey]) -> Vec<PaymentKey> {
    let mut seen = waiting.to_vec();
    for e in entries {
        if e.src != Some(EntrySource::Notif) || e.deleted_at.is_some() {
            continue;
        }
        let Some(io) = e.io else { continue };
        if io == Io::Xfer || e.ts < from || e.ts > to {
            continue;
        }
        seen.push(PaymentKey {
            io,
            amt: e.amt,
            posted_at: e.ts,
        });
    }
    seen
}

/// Work out what the queue would add to the ledger and to the inbox.
///
/// `waiting_*` are the drafts already sitting in the inbox from an earlier
/// drain, passed in parallel arrays because they live on the Dart side. They
/// count as already-represented payments: a follow-up push for something the
/// user has not confirmed yet must not queue twice.
///
/// Account and ledger are left unset on purpose. A notification says nothing
/// about which account paid, and guessing "whatever was last used" silently
/// corrupts account balances.
#[frb(sync)]
pub fn plan_drain(
    raws: Vec<RawNotifView>,
    waiting_io: Vec<String>,
    waiting_amt: Vec<f64>,
    waiting_ts: Vec<i64>,
) -> DrainPlan {
    let mut plan = DrainPlan {
        posted: Vec::new(),
        pending: Vec::new(),
        unparsed: Vec::new(),
        consumed: raws.iter().map(|r| r.id.clone()).collect(),
    };
    if raws.is_empty() {
        return plan;
    }

    let n = waiting_io
        .len()
        .min(waiting_amt.len())
        .min(waiting_ts.len());
    let waiting: Vec<PaymentKey> = (0..n)
        .filter_map(|i| {
            Some(PaymentKey {
                io: Io::parse(&waiting_io[i])?,
                amt: waiting_amt[i],
                posted_at: waiting_ts[i],
            })
        })
        .collect();

    let lo = raws.iter().map(|r| r.posted_at).min().unwrap_or(0) - DUP_WINDOW_MS;
    let hi = raws.iter().map(|r| r.posted_at).max().unwrap_or(0) + DUP_WINDOW_MS;

    let mut seen = {
        let s = store();
        already_seen(s.ledger.all(), lo, hi, &waiting)
    };

    for v in &raws {
        let raw: RawNotif = v.into();
        let Some(c) = parse_notification(&raw) else {
            plan.unparsed.push(UnparsedView {
                id: v.id.clone(),
                pkg: v.pkg.clone(),
                raw: full_text(&raw),
                posted_at: v.posted_at,
            });
            continue;
        };
        let key = PaymentKey::from(&c);
        if is_duplicate(&key, &seen) {
            continue; // the same payment, pushed twice
        }
        seen.push(key);

        // No custom categories: this port has no editor for them yet. The core
        // already takes them and prefers a custom keyword over a built-in one.
        let d = to_entry_draft(&c, &[]);
        let draft = DraftView {
            io: d.io.as_str().to_string(),
            cat: d.cat,
            amt: d.amt,
            note: d.note,
            ts: d.ts,
        };
        if d.confident {
            plan.posted.push(draft);
        } else {
            plan.pending.push(PendingView {
                id: v.id.clone(),
                source: c.source.as_str().to_string(),
                raw: full_text(&raw),
                draft,
            });
        }
    }
    plan
}

/// Write captured payments to the ledger in one go. Returns how many landed.
///
/// Tagged `src: notif`, which is what lets a later drain know these rows
/// already stand for those payments. Account and ledger stay unset: a
/// notification does not say which account paid, and a guess would corrupt a
/// balance silently.
#[frb(sync)]
pub fn post_captured(
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
    let drafts: Vec<ImportedBill> = (0..n)
        .map(|i| ImportedBill {
            io: Io::parse(&io[i]).unwrap_or(Io::Exp),
            cat: cat[i].clone(),
            amt: amt[i],
            note: note[i].clone(),
            ts: ts[i],
        })
        .collect();
    store().post_captured(&drafts, &ids, now) as u32
}
