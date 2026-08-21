//! The capture inbox: what the notification listener caught, sorted into the
//! ledger, a confirm queue, and a pile of text no rule understood.
//!
//! Ported from `src/store/inbox.ts` — the deciding half. Reading the native
//! queue, acknowledging it, and persisting the result stay on the platform
//! side; what moves here is the classification, which is the part with rules in
//! it.
//!
//! The split matters more than usual for this module. `drainInbox` acknowledges
//! the native queue *only after* the results are in the store, so that a crash
//! mid-drain replays instead of losing a payment. That ordering is a property
//! of the caller, and putting the I/O in here would have buried it.
//!
//! This slice never syncs. Everything else in the store is serialised into the
//! cloud config blob, and raw notification text is device-local by nature —
//! it would be both a privacy leak and useless on another phone.

use crate::catalog::Category;
use crate::entry::{Entry, EntrySource, Io};
use crate::notif::{
    full_text, is_duplicate, parse_notification, to_entry_draft, NotifEntryDraft, NotifSource,
    PaymentKey, RawNotif, DUP_WINDOW_MS,
};

/// A parsed payment that was not confident enough to post unattended.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingItem {
    pub id: String,
    pub draft: NotifEntryDraft,
    pub source: NotifSource,
    /// What the notification actually said, shown on the confirm sheet.
    pub raw: String,
}

/// A capture from a watched app that no rule understood.
///
/// Kept on purpose. Notification wording differs by app version, by bank and by
/// region, and there is no way to write rules for text nobody has seen — this
/// list is how the real strings on a real phone become visible so the parser
/// can be tightened against them.
#[derive(Debug, Clone, PartialEq)]
pub struct UnparsedItem {
    pub id: String,
    pub pkg: String,
    pub raw: String,
    pub posted_at: i64,
}

/// How many unparsed captures to keep. Bounded because this grows without
/// anything ever consuming it.
pub const MAX_UNPARSED: usize = 30;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Inbox {
    pub pending: Vec<PendingItem>,
    pub unparsed: Vec<UnparsedItem>,
}

/// What one drain decided. The caller does the writing.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DrainOutcome {
    /// Confident enough to post to the ledger outright.
    pub post: Vec<NotifEntryDraft>,
    /// Parsed, but waiting for a tap.
    pub queue: Vec<PendingItem>,
    /// Text no rule matched.
    pub unparsed: Vec<UnparsedItem>,
}

impl DrainOutcome {
    /// The counts the UI reports, matching `DrainResult` in the TypeScript.
    pub fn counts(&self) -> (usize, usize, usize) {
        (self.post.len(), self.queue.len(), self.unparsed.len())
    }
}

/// Payments already known about in a time window, so a re-delivered
/// notification is not posted twice.
///
/// The window is around the *notifications'* own timestamps rather than around
/// now. A listener can deliver a backlog hours late — that is when the app
/// happens to be opened — and a wall-clock "recent entries" window would have
/// forgotten the original by then.
///
/// Queued items count as seen too: something waiting for a tap has not reached
/// the ledger, but it is still the same payment.
///
/// The `from`/`to` filter is a **narrowing pass, not a rule**. [`is_duplicate`]
/// re-checks the time distance itself, so a window that is too wide changes no
/// answer — it only makes `seen` longer than it needs to be over a large
/// ledger. A window that is too *narrow* does change answers, by hiding a row
/// the duplicate check would have matched. Removing the filter entirely is
/// caught by nothing, and correctly so; narrowing it is caught immediately.
///
/// The transfer guard is defensive in the same way: `is_duplicate` compares
/// direction, and a capture is only ever an expense or an income, so an `xfer`
/// key could never match one.
pub fn already_seen(inbox: &Inbox, entries: &[Entry], from: i64, to: i64) -> Vec<PaymentKey> {
    let mut seen: Vec<PaymentKey> = inbox
        .pending
        .iter()
        .map(|p| PaymentKey {
            io: p.draft.io,
            amt: p.draft.amt,
            posted_at: p.draft.ts,
        })
        .collect();

    for e in entries {
        // only captures, only live rows, and never a transfer
        if e.src != Some(EntrySource::Notif) || e.deleted_at.is_some() || e.io == Some(Io::Xfer) {
            continue;
        }
        if e.ts < from || e.ts > to {
            continue;
        }
        if let Some(io) = e.io {
            seen.push(PaymentKey {
                io,
                amt: e.amt,
                posted_at: e.ts,
            });
        }
    }
    seen
}

/// Sort a batch of captures into what to post, what to queue, and what nobody
/// could read.
///
/// Account and ledger are deliberately left unset on the drafts. A notification
/// says nothing about which account paid or which ledger it belongs to, and
/// guessing "whatever was last used" silently corrupts account balances — the
/// confirm sheet is where that gets decided.
///
/// A capture that duplicates something already seen is dropped silently and
/// counted nowhere, which is what the TypeScript's bare `continue` does.
pub fn drain(
    raws: &[RawNotif],
    inbox: &Inbox,
    entries: &[Entry],
    custom: &[Category],
) -> DrainOutcome {
    if raws.is_empty() {
        return DrainOutcome::default();
    }

    let min = raws.iter().map(|r| r.posted_at).min().expect("non-empty");
    let max = raws.iter().map(|r| r.posted_at).max().expect("non-empty");
    let mut seen = already_seen(inbox, entries, min - DUP_WINDOW_MS, max + DUP_WINDOW_MS);

    let mut out = DrainOutcome::default();
    for r in raws {
        let Some(candidate) = parse_notification(r) else {
            out.unparsed.push(UnparsedItem {
                id: r.id.clone(),
                pkg: r.pkg.clone(),
                raw: full_text(r),
                posted_at: r.posted_at,
            });
            continue;
        };
        let key = PaymentKey::from(&candidate);
        if is_duplicate(&key, &seen) {
            continue;
        }
        // added to `seen` before the next iteration, so two identical captures
        // in one batch also collapse
        seen.push(key);

        let draft = to_entry_draft(&candidate, custom);
        if draft.confident {
            out.post.push(draft);
        } else {
            out.queue.push(PendingItem {
                id: r.id.clone(),
                draft,
                source: candidate.source,
                raw: full_text(r),
            });
        }
    }
    out
}

impl Inbox {
    /// Fold a drain's queue and unparsed pile into the inbox.
    ///
    /// The unparsed list keeps only the newest [`MAX_UNPARSED`]; the pending
    /// list is unbounded, because every item there is a payment the user still
    /// has to decide about and silently dropping one loses money.
    pub fn absorb(&mut self, outcome: &DrainOutcome) {
        if !outcome.queue.is_empty() {
            self.pending.extend(outcome.queue.iter().cloned());
        }
        if !outcome.unparsed.is_empty() {
            self.unparsed.extend(outcome.unparsed.iter().cloned());
            let excess = self.unparsed.len().saturating_sub(MAX_UNPARSED);
            self.unparsed.drain(..excess);
        }
    }

    /// Accept a queued capture, optionally with edits from the confirm sheet.
    ///
    /// Returns the draft to post, or `None` for an id that is no longer
    /// queued — a no-op rather than an error, because the caller is a UI that
    /// may be acting on a row another drain has since resolved.
    pub fn confirm_pending(&mut self, id: &str, patch: &DraftPatch) -> Option<NotifEntryDraft> {
        let item = self.pending.iter().find(|p| p.id == id)?;
        let mut d = item.draft.clone();
        patch.apply(&mut d);
        self.dismiss_pending(id);
        Some(d)
    }

    pub fn dismiss_pending(&mut self, id: &str) {
        self.pending.retain(|p| p.id != id);
    }

    pub fn clear_pending(&mut self) {
        self.pending.clear();
    }

    pub fn clear_unparsed(&mut self) {
        self.unparsed.clear();
    }
}

/// The edits the confirm sheet may make. Every field absent means "as parsed".
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DraftPatch {
    pub io: Option<Io>,
    pub amt: Option<f64>,
    pub cat: Option<String>,
    pub note: Option<String>,
    pub ts: Option<i64>,
}

impl DraftPatch {
    fn apply(&self, d: &mut NotifEntryDraft) {
        if let Some(io) = self.io {
            d.io = io;
        }
        if let Some(amt) = self.amt {
            d.amt = amt;
        }
        if let Some(cat) = &self.cat {
            d.cat = cat.clone();
        }
        if let Some(note) = &self.note {
            d.note = note.clone();
        }
        if let Some(ts) = self.ts {
            d.ts = ts;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(id: &str, pkg: &str, title: &str, text: &str, posted_at: i64) -> RawNotif {
        RawNotif {
            id: id.into(),
            pkg: pkg.into(),
            title: Some(title.into()),
            text: Some(text.into()),
            big_text: None,
            posted_at,
        }
    }

    /// Alipay wording that parses with a merchant, so it posts unattended.
    ///
    /// `在…消费` rather than `付款…收款方：` — the latter reads as *income*,
    /// because 收款 matches the income pattern and income is tested first. That
    /// is the parser behaving correctly and the fixture being wrong, which is
    /// worth a note since it cost a round of failing tests.
    fn confident(id: &str, amt: &str, at: i64) -> RawNotif {
        raw(
            id,
            "com.eg.android.AlipayGphone",
            "支付宝",
            &format!("在星巴克消费{amt}元"),
            at,
        )
    }

    fn entry(io: Io, amt: f64, ts: i64, src: Option<EntrySource>) -> Entry {
        Entry {
            ts,
            io: Some(io),
            cat: "food".into(),
            amt,
            src,
            ..Default::default()
        }
    }

    #[test]
    fn an_empty_batch_decides_nothing() {
        let out = drain(&[], &Inbox::default(), &[], &[]);
        assert_eq!(out, DrainOutcome::default());
        assert_eq!(out.counts(), (0, 0, 0));
    }

    #[test]
    fn text_no_rule_understands_is_kept_rather_than_dropped() {
        let r = raw(
            "n1",
            "com.eg.android.AlipayGphone",
            "支付宝",
            "您有一条新消息",
            1_000,
        );
        let out = drain(&[r], &Inbox::default(), &[], &[]);
        assert_eq!(out.post.len(), 0);
        assert_eq!(out.queue.len(), 0);
        assert_eq!(out.unparsed.len(), 1);
        assert_eq!(out.unparsed[0].pkg, "com.eg.android.AlipayGphone");
        assert_eq!(out.unparsed[0].posted_at, 1_000);
    }

    #[test]
    fn a_confident_capture_posts_without_a_tap() {
        let out = drain(
            &[confident("n1", "35.50", 1_000)],
            &Inbox::default(),
            &[],
            &[],
        );
        assert_eq!(out.post.len(), 1);
        assert_eq!(out.post[0].amt, 35.5);
        assert_eq!(out.post[0].io, Io::Exp);
        assert!(out.queue.is_empty());
    }

    #[test]
    fn a_capture_already_in_the_ledger_is_dropped_silently() {
        let entries = vec![entry(Io::Exp, 35.5, 1_000, Some(EntrySource::Notif))];
        let out = drain(
            &[confident("n1", "35.50", 1_000)],
            &Inbox::default(),
            &entries,
            &[],
        );
        // counted nowhere — not posted, not queued, not unparsed
        assert_eq!(out.counts(), (0, 0, 0));
    }

    #[test]
    fn only_captures_count_as_already_seen() {
        // the same amount typed by hand is not the same payment
        let entries = vec![entry(Io::Exp, 35.5, 1_000, None)];
        let out = drain(
            &[confident("n1", "35.50", 1_000)],
            &Inbox::default(),
            &entries,
            &[],
        );
        assert_eq!(out.post.len(), 1);
    }

    #[test]
    fn a_deleted_capture_does_not_block_a_fresh_one() {
        let mut e = entry(Io::Exp, 35.5, 1_000, Some(EntrySource::Notif));
        e.deleted_at = Some(2_000);
        let out = drain(
            &[confident("n1", "35.50", 1_000)],
            &Inbox::default(),
            &[e],
            &[],
        );
        assert_eq!(out.post.len(), 1);
    }

    #[test]
    fn a_transfer_never_counts_as_a_seen_payment() {
        let mut e = entry(Io::Exp, 35.5, 1_000, Some(EntrySource::Notif));
        e.io = Some(Io::Xfer);
        let out = drain(
            &[confident("n1", "35.50", 1_000)],
            &Inbox::default(),
            &[e],
            &[],
        );
        assert_eq!(out.post.len(), 1);
    }

    #[test]
    fn the_window_is_around_the_notifications_not_around_now() {
        // an entry far outside the batch's own window does not suppress it
        let entries = vec![entry(
            Io::Exp,
            35.5,
            1_000 + DUP_WINDOW_MS * 4,
            Some(EntrySource::Notif),
        )];
        let out = drain(
            &[confident("n1", "35.50", 1_000)],
            &Inbox::default(),
            &entries,
            &[],
        );
        assert_eq!(out.post.len(), 1);

        // and one just inside it does
        let entries = vec![entry(
            Io::Exp,
            35.5,
            1_000 + DUP_WINDOW_MS / 2,
            Some(EntrySource::Notif),
        )];
        let out = drain(
            &[confident("n1", "35.50", 1_000)],
            &Inbox::default(),
            &entries,
            &[],
        );
        assert_eq!(out.post.len(), 0);
    }

    #[test]
    fn two_identical_captures_in_one_batch_collapse() {
        let batch = vec![
            confident("n1", "35.50", 1_000),
            confident("n2", "35.50", 1_010),
        ];
        let out = drain(&batch, &Inbox::default(), &[], &[]);
        assert_eq!(out.post.len(), 1);
    }

    #[test]
    fn something_already_queued_counts_as_seen() {
        let first = drain(
            &[confident("n1", "35.50", 1_000)],
            &Inbox::default(),
            &[],
            &[],
        );
        // force it into the queue as if it had been unconfident
        let mut inbox = Inbox::default();
        inbox.pending.push(PendingItem {
            id: "n1".into(),
            draft: first.post[0].clone(),
            source: NotifSource::Alipay,
            raw: "x".into(),
        });
        let out = drain(&[confident("n2", "35.50", 1_010)], &inbox, &[], &[]);
        assert_eq!(out.counts(), (0, 0, 0));
    }

    #[test]
    fn the_unparsed_pile_is_bounded_and_keeps_the_newest() {
        let mut inbox = Inbox::default();
        for i in 0..40 {
            let out = DrainOutcome {
                unparsed: vec![UnparsedItem {
                    id: format!("u{i}"),
                    pkg: "p".into(),
                    raw: format!("raw{i}"),
                    posted_at: i,
                }],
                ..Default::default()
            };
            inbox.absorb(&out);
        }
        assert_eq!(inbox.unparsed.len(), MAX_UNPARSED);
        assert_eq!(inbox.unparsed.first().unwrap().id, "u10");
        assert_eq!(inbox.unparsed.last().unwrap().id, "u39");
    }

    #[test]
    fn the_pending_queue_is_not_bounded() {
        // every item is a payment awaiting a decision; dropping one loses money
        let mut inbox = Inbox::default();
        for i in 0..40 {
            inbox.absorb(&DrainOutcome {
                queue: vec![PendingItem {
                    id: format!("p{i}"),
                    draft: NotifEntryDraft {
                        io: Io::Exp,
                        amt: 1.0,
                        cat: "other".into(),
                        note: String::new(),
                        ts: i,
                        confident: false,
                    },
                    source: NotifSource::Alipay,
                    raw: String::new(),
                }],
                ..Default::default()
            });
        }
        assert_eq!(inbox.pending.len(), 40);
    }

    fn queued(id: &str) -> PendingItem {
        PendingItem {
            id: id.into(),
            draft: NotifEntryDraft {
                io: Io::Exp,
                amt: 12.0,
                cat: "food".into(),
                note: "星巴克".into(),
                ts: 1_000,
                confident: false,
            },
            source: NotifSource::Alipay,
            raw: "raw".into(),
        }
    }

    #[test]
    fn confirming_hands_back_the_draft_and_clears_the_row() {
        let mut inbox = Inbox {
            pending: vec![queued("p1"), queued("p2")],
            unparsed: vec![],
        };
        let d = inbox.confirm_pending("p1", &DraftPatch::default()).unwrap();
        assert_eq!(d.amt, 12.0);
        assert_eq!(inbox.pending.len(), 1);
        assert_eq!(inbox.pending[0].id, "p2");
    }

    #[test]
    fn the_confirm_sheets_edits_win_over_what_was_parsed() {
        let mut inbox = Inbox {
            pending: vec![queued("p1")],
            unparsed: vec![],
        };
        let patch = DraftPatch {
            amt: Some(99.0),
            cat: Some("trans".into()),
            ..Default::default()
        };
        let d = inbox.confirm_pending("p1", &patch).unwrap();
        assert_eq!(d.amt, 99.0);
        assert_eq!(d.cat, "trans");
        // untouched fields survive
        assert_eq!(d.note, "星巴克");
        assert_eq!(d.ts, 1_000);
    }

    #[test]
    fn confirming_a_row_that_is_gone_is_a_no_op() {
        let mut inbox = Inbox::default();
        assert!(inbox
            .confirm_pending("nope", &DraftPatch::default())
            .is_none());
        assert!(inbox.pending.is_empty());
    }

    #[test]
    fn dismissing_and_clearing_do_what_they_say() {
        let mut inbox = Inbox {
            pending: vec![queued("p1"), queued("p2")],
            unparsed: vec![UnparsedItem {
                id: "u1".into(),
                pkg: "p".into(),
                raw: "r".into(),
                posted_at: 0,
            }],
        };
        inbox.dismiss_pending("p1");
        assert_eq!(inbox.pending.len(), 1);
        inbox.clear_pending();
        assert!(inbox.pending.is_empty());
        assert_eq!(inbox.unparsed.len(), 1);
        inbox.clear_unparsed();
        assert!(inbox.unparsed.is_empty());
    }
}
