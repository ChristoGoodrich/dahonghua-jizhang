//! 快捷指令 — what the iPhone's Shortcuts hand the app, into entries.
//!
//! iOS lets no app read another's notifications, so Android's 自动记账 has no
//! iPhone counterpart. What iOS has instead is Shortcuts: Siri, the Action
//! button, Spotlight, and a Wallet automation that runs after every Apple Pay
//! payment with its amount and its merchant. Each of those runs one of this
//! app's App Intents, which only writes the request down (`NativeChannels`'
//! queue); the app reads the queue the next time it runs, and this is what it
//! reads it with.
//!
//! Two kinds of request:
//!
//! * a **sentence** — 午饭35 打车12, said to Siri or typed into a shortcut —
//!   read by the same reader as 一句话记账 (`ai::quick::parse_offline`), so the
//!   two cannot come to differ about what a sentence says;
//! * a **payment** — an amount and a merchant from the Wallet automation —
//!   one expense, its category guessed from the merchant the way 一句话记账
//!   guesses one from a note.
//!
//! A request becomes its entries at most once. The queue is acknowledged only
//! after the ledger is on disk, so a crash in between hands the same request
//! over again; its entries' ids are derived from the request's own, and an id
//! the ledger already holds — a tombstone included, so a payment somebody
//! deleted stays deleted — is not written twice.

use crate::ai::quick::{guess_category, parse_offline, tidy_note, Custom};
use crate::ai::words::clean_amount;
use crate::civil::Civil;
use crate::entry::{Entry, EntrySource, Io};
use crate::ledger::Ledger;

/// What a shortcut asked for.
#[derive(Debug, Clone, PartialEq)]
pub enum Ask {
    /// Words, read like 一句话记账's.
    Sentence(String),
    /// A payment the Wallet automation saw: how much, and where.
    Payment { amount: f64, merchant: String },
}

/// One request off the queue.
#[derive(Debug, Clone, PartialEq)]
pub struct Request {
    /// The queue's id for it, unique per request.
    pub id: String,
    pub ask: Ask,
}

/// One entry a request asks for, not yet written.
#[derive(Debug, Clone, PartialEq)]
pub struct Draft {
    /// The entry's id, derived from the request's (see [`entry_id`]).
    pub id: String,
    pub io: Io,
    pub cat: String,
    pub amt: f64,
    pub note: String,
    /// The day the words named, for a sentence that named one. `None` is the
    /// moment the shortcut ran, which is when a payment happened.
    pub day: Option<Civil>,
    /// What wrote it. A payment is a capture, as Android's 自动记账 rows are:
    /// a sentence is the user's own words, as the record sheet's are.
    pub src: Option<EntrySource>,
}

/// The id of a request's `i`th entry.
///
/// Derived, not chosen: the same request handed over twice must land on the
/// same ids, or the second time would be a second set of entries.
pub fn entry_id(request_id: &str, i: usize) -> String {
    format!("s{request_id}-{i}")
}

/// The entries a request asks for, before anything is checked against the
/// ledger. Empty when it asks for none: a sentence with no amount in it, or a
/// payment of nothing, a negative or an absurd amount.
pub fn read(req: &Request, today: Civil, history: &[&Entry], custom: Custom) -> Vec<Draft> {
    match &req.ask {
        Ask::Sentence(text) => parse_offline(text, today, history, custom)
            .into_iter()
            .enumerate()
            .map(|(i, d)| Draft {
                id: entry_id(&req.id, i),
                io: d.io,
                cat: d.cat,
                amt: d.amt,
                note: d.note,
                day: d.day,
                src: None,
            })
            .collect(),
        Ask::Payment { amount, merchant } => {
            let Some(amt) = clean_amount(*amount) else {
                return Vec::new();
            };
            let note = tidy_note(merchant);
            vec![Draft {
                id: entry_id(&req.id, 0),
                io: Io::Exp,
                cat: guess_category(&note, Io::Exp, history, custom),
                amt,
                note,
                day: None,
                src: Some(EntrySource::Notif),
            }]
        }
    }
}

/// The drafts the ledger does not stand for yet, in order.
///
/// An id the ledger holds — live or a tombstone — is a request already
/// recorded: handed over again after a crash, or deleted by somebody since.
pub fn unrecorded(drafts: Vec<Draft>, ledger: &Ledger) -> Vec<Draft> {
    drafts
        .into_iter()
        .filter(|d| ledger.get(&d.id).is_none())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> Civil {
        Civil::new(2026, 11, 9)
    }

    fn sentence(id: &str, text: &str) -> Request {
        Request {
            id: id.into(),
            ask: Ask::Sentence(text.into()),
        }
    }

    fn payment(id: &str, amount: f64, merchant: &str) -> Request {
        Request {
            id: id.into(),
            ask: Ask::Payment {
                amount,
                merchant: merchant.into(),
            },
        }
    }

    fn read_now(r: &Request) -> Vec<Draft> {
        read(r, today(), &[], Custom::default())
    }

    #[test]
    fn a_sentence_is_read_as_one_sentence_to_jizhang_reads_it() {
        let drafts = read_now(&sentence("q1", "午饭35 打车12"));
        let quick = parse_offline("午饭35 打车12", today(), &[], Custom::default());
        assert_eq!(drafts.len(), 2);
        for (d, q) in drafts.iter().zip(&quick) {
            assert_eq!(
                (d.io, &d.cat, d.amt, &d.note, d.day),
                (q.io, &q.cat, q.amt, &q.note, q.day)
            );
        }
        assert_eq!(drafts[0].note, "午饭");
        assert_eq!(drafts[1].amt, 12.0);
    }

    #[test]
    fn a_sentence_keeps_the_day_it_names() {
        let d = read_now(&sentence("q1", "昨天超市128"));
        assert_eq!(d[0].day, Some(Civil::new(2026, 11, 8)));
    }

    #[test]
    fn a_sentence_is_the_users_own_words_and_carries_no_source() {
        assert_eq!(read_now(&sentence("q1", "咖啡28"))[0].src, None);
    }

    #[test]
    fn a_sentence_with_no_amount_asks_for_nothing() {
        assert!(read_now(&sentence("q1", "今天天气不错")).is_empty());
    }

    #[test]
    fn a_payment_is_one_expense_at_the_moment_it_ran() {
        let d = read_now(&payment("p1", 35.5, "星巴克"));
        assert_eq!(d.len(), 1);
        assert_eq!((d[0].io, d[0].amt, d[0].day), (Io::Exp, 35.5, None));
        assert_eq!(d[0].note, "星巴克");
        assert_eq!(d[0].src, Some(EntrySource::Notif));
    }

    #[test]
    fn a_payments_category_comes_from_its_merchant() {
        assert_eq!(read_now(&payment("p1", 12.0, "滴滴出行"))[0].cat, "trans");
        assert_eq!(
            read_now(&payment("p2", 12.0, "星巴克"))[0].cat,
            guess_category("星巴克", Io::Exp, &[], Custom::default())
        );
    }

    #[test]
    fn a_payment_follows_what_this_user_called_the_merchant_before() {
        let past = Entry {
            id: "e1".into(),
            io: Some(Io::Exp),
            cat: "health".into(),
            note: Some("全家便利店".into()),
            amt: 9.0,
            ..Default::default()
        };
        let d = read(
            &payment("p1", 8.0, "全家便利店"),
            today(),
            &[&past],
            Custom::default(),
        );
        assert_eq!(d[0].cat, "health");
        // and not what the table alone would have said
        assert_ne!(read_now(&payment("p2", 8.0, "全家便利店"))[0].cat, "health");
    }

    #[test]
    fn a_payment_of_nothing_or_less_or_an_absurd_amount_asks_for_nothing() {
        for amount in [0.0, -5.0, f64::NAN, f64::INFINITY, 1e13] {
            assert!(read_now(&payment("p", amount, "店")).is_empty(), "{amount}");
        }
    }

    #[test]
    fn a_payment_is_rounded_to_the_cent() {
        assert_eq!(read_now(&payment("p", 12.345, "店"))[0].amt, 12.35);
    }

    #[test]
    fn a_payment_with_no_merchant_is_still_a_payment() {
        let d = read_now(&payment("p", 20.0, "  "));
        assert_eq!((d.len(), d[0].note.as_str()), (1, ""));
    }

    #[test]
    fn ids_come_from_the_request_so_a_replay_lands_on_the_same_ones() {
        let a = read_now(&sentence("q7", "午饭35 打车12"));
        let b = read_now(&sentence("q7", "午饭35 打车12"));
        assert_eq!(a, b);
        assert_eq!(a[0].id, "sq7-0");
        assert_eq!(a[1].id, "sq7-1");
        assert_ne!(read_now(&sentence("q8", "午饭35"))[0].id, a[0].id);
    }

    #[test]
    fn a_request_the_ledger_already_stands_for_is_not_recorded_again() {
        let drafts = read_now(&sentence("q1", "午饭35 打车12"));
        let mut ledger = Ledger::default();
        ledger.add(
            Entry {
                amt: 35.0,
                ..Default::default()
            },
            "sq1-0".into(),
            None,
            1,
        );
        let left = unrecorded(drafts, &ledger);
        assert_eq!(
            left.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(),
            ["sq1-1"]
        );
    }

    #[test]
    fn a_deleted_one_stays_deleted() {
        let drafts = read_now(&payment("p1", 9.0, "店"));
        let mut ledger = Ledger::default();
        ledger.add(
            Entry {
                amt: 9.0,
                deleted_at: Some(5),
                ..Default::default()
            },
            "sp1-0".into(),
            None,
            1,
        );
        assert!(unrecorded(drafts, &ledger).is_empty());
    }
}
