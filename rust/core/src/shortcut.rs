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
//! **Wallet hands the amount over as words**, not a number: `¥35.00`,
//! `US$5.40`, `100,50 €`, written by the phone's own currency formatter. So
//! the intent passes the words through untouched and [`read_amount`] reads
//! them here — the number, whichever mark it decimals with, and the currency
//! they name. A bare `$` or `¥` is the phone's region's own when that region
//! writes its currency so; otherwise the dollar and the yuan.
//!
//! A payment in a currency that is not the ledger's is converted the way the
//! record sheet converts one ([`priced`]): the base amount stored, the
//! original and the rate beside it. Without a rate it is not written at all
//! — it waits in the queue, as the record sheet refuses to save one.
//!
//! A request becomes its entries at most once. The queue is acknowledged only
//! after the ledger is on disk, so a crash in between hands the same request
//! over again; its entries' ids are derived from the request's own, and an id
//! the ledger already holds — a tombstone included, so a payment somebody
//! deleted stays deleted — is not written twice.

use crate::ai::quick::{guess_category, parse_offline, tidy_note, Custom};
use crate::ai::words::{clean_amount, half_width};
use crate::civil::Civil;
use crate::entry::{Entry, EntrySource, Io};
use crate::ledger::Ledger;

/// What a shortcut asked for.
#[derive(Debug, Clone, PartialEq)]
pub enum Ask {
    /// Words, read like 一句话记账's.
    Sentence(String),
    /// A payment the Wallet automation saw.
    Payment {
        /// The amount as Wallet wrote it — `¥35.00`, `US$5.40` — or as
        /// somebody typed it into the shortcut.
        amount: String,
        /// Where it was paid.
        merchant: String,
        /// The currency of the phone's region when the shortcut ran, as an
        /// ISO code: what a bare `$` or `¥` means. Empty when it did not say.
        region: String,
    },
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
    /// In [`Draft::cur`] when that is set; otherwise in the ledger's own.
    pub amt: f64,
    pub note: String,
    /// The day the words named, for a sentence that named one. `None` is the
    /// moment the shortcut ran, which is when a payment happened.
    pub day: Option<Civil>,
    /// What wrote it. A payment is a capture, as Android's 自动记账 rows are:
    /// a sentence is the user's own words, as the record sheet's are.
    pub src: Option<EntrySource>,
    /// A payment's currency, when it is not the ledger's: it needs a rate
    /// before it can be written ([`priced`]).
    pub cur: Option<String>,
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
///
/// `base` is the ledger's currency; empty is the yuan, as everywhere.
pub fn read(
    req: &Request,
    today: Civil,
    history: &[&Entry],
    custom: Custom,
    base: &str,
) -> Vec<Draft> {
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
                cur: None,
            })
            .collect(),
        Ask::Payment {
            amount,
            merchant,
            region,
        } => {
            let Some(paid) = read_amount(amount, region) else {
                return Vec::new();
            };
            let base = if base.is_empty() { "CNY" } else { base };
            let note = tidy_note(merchant);
            vec![Draft {
                id: entry_id(&req.id, 0),
                io: Io::Exp,
                cat: guess_category(&note, Io::Exp, history, custom),
                amt: paid.amt,
                note,
                day: None,
                src: Some(EntrySource::Notif),
                cur: paid.cur.filter(|c| c != base),
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

/* ------------------------------------------------------------ amounts ---- */

/// A payment's amount, read from the words it was written in.
#[derive(Debug, Clone, PartialEq)]
pub struct Paid {
    /// Rounded to the cent.
    pub amt: f64,
    /// The currency the words named, as an ISO code; `None` when they named
    /// none, which is the ledger's own.
    pub cur: Option<String>,
}

/// The amount in what Wallet wrote, or `None` when there is none to take.
///
/// The number is the first in the words. Whichever of `.` and `,` comes last
/// in it, followed by one or two digits, is the decimal mark, and every other
/// mark in it groups thousands — so `1,234.50`, `1.234,50` and `1 234,50` are
/// one amount, and `1,234` is a thousand and more, not one and a bit. A minus
/// sign is a refund, which the Wallet automation does not run for and this
/// does not guess at.
pub fn read_amount(text: &str, region: &str) -> Option<Paid> {
    let text: String = half_width(text)
        .chars()
        .map(|c| match c {
            // the formatters' own spaces: no-break, narrow no-break, thin
            '\u{00A0}' | '\u{202F}' | '\u{2009}' => ' ',
            '\u{2212}' => '-',
            c => c,
        })
        .collect();
    let chars: Vec<char> = text.chars().collect();
    let start = chars.iter().position(|c| c.is_ascii_digit())?;
    if chars[..start].contains(&'-') {
        return None;
    }
    let amt = clean_amount(number_at(&chars, start)?)?;
    Some(Paid {
        amt,
        cur: currency_in(&text, region),
    })
}

/// The number that starts at `start`, its marks read as [`read_amount`] says.
fn number_at(chars: &[char], start: usize) -> Option<f64> {
    let digits_at = |i: usize| chars[i..].iter().take_while(|c| c.is_ascii_digit()).count();
    // groups of digits, and the mark before each group after the first
    let mut groups = vec![digits_at(start)];
    let mut marks = Vec::new();
    let mut i = start + groups[0];
    while let Some(&m) = chars.get(i) {
        let n = if i + 1 < chars.len() {
            digits_at(i + 1)
        } else {
            0
        };
        let joins = match m {
            '.' | ',' | '\'' | '\u{2019}' => n > 0,
            // a space only ever groups thousands, and only a group of three
            ' ' => n == 3,
            _ => false,
        };
        if !joins {
            break;
        }
        marks.push(m);
        groups.push(n);
        i += 1 + n;
    }
    let all: String = chars[start..i].iter().collect();
    let digits = |s: &str| s.chars().filter(char::is_ascii_digit).collect::<String>();
    let decimal = matches!(marks.last(), Some('.' | ',')) && matches!(groups.last(), Some(1 | 2));
    let n = if decimal {
        let cut = all.rfind(['.', ',']).unwrap_or(all.len());
        format!("{}.{}", digits(&all[..cut]), digits(&all[cut + 1..]))
    } else {
        digits(&all)
    };
    n.parse().ok()
}

/// Codes a payment's words may name outright, and the currency each means.
/// `RMB` is how the yuan is very often written, though it is not its code.
const CODES: &[&str] = &[
    "AED", "AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF",
    "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MOP", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN",
    "RON", "RUB", "SAR", "SEK", "SGD", "THB", "TRY", "TWD", "USD", "VND", "ZAR",
];

/// Marks a currency is written with, longest first where one contains
/// another: `US$` is not the region's `$`, and `美元` is not `元`.
const MARKS: &[(&str, &str)] = &[
    ("MOP$", "MOP"),
    ("US$", "USD"),
    ("HK$", "HKD"),
    ("NT$", "TWD"),
    ("AU$", "AUD"),
    ("CA$", "CAD"),
    ("SG$", "SGD"),
    ("NZ$", "NZD"),
    ("MX$", "MXN"),
    ("CN¥", "CNY"),
    ("CN￥", "CNY"),
    ("JP¥", "JPY"),
    ("JP￥", "JPY"),
    ("A$", "AUD"),
    ("C$", "CAD"),
    ("S$", "SGD"),
    ("€", "EUR"),
    ("£", "GBP"),
    ("₩", "KRW"),
    ("₹", "INR"),
    ("฿", "THB"),
    ("₫", "VND"),
    ("新台币", "TWD"),
    ("人民币", "CNY"),
    ("美元", "USD"),
    ("美金", "USD"),
    ("港币", "HKD"),
    ("港元", "HKD"),
    ("日元", "JPY"),
    ("欧元", "EUR"),
    ("英镑", "GBP"),
    ("韩元", "KRW"),
    ("澳元", "AUD"),
    ("円", "JPY"),
    ("元", "CNY"),
    ("块", "CNY"),
];

/// Regions that write their own currency with a bare `$`, and with a bare `¥`.
const DOLLARS: &[&str] = &["USD", "AUD", "CAD", "HKD", "SGD", "TWD", "NZD", "MXN"];
const YENS: &[&str] = &["CNY", "JPY"];

/// The currency the words name, if they name one.
fn currency_in(text: &str, region: &str) -> Option<String> {
    let code = |c: &str| Some(c.to_string());
    let chars: Vec<char> = text.chars().collect();
    // a code, standing on its own: not the middle of a longer word. Typed
    // into a shortcut it may be in lower case.
    for (i, w) in chars.windows(3).enumerate() {
        let word = w.iter().collect::<String>().to_ascii_uppercase();
        let alone = |j: Option<&char>| !j.is_some_and(|c| c.is_ascii_alphabetic());
        if (i == 0 || alone(chars.get(i - 1))) && alone(chars.get(i + 3)) {
            if word == "RMB" {
                return code("CNY");
            }
            if CODES.contains(&word.as_str()) {
                return code(&word);
            }
        }
    }
    if let Some((_, c)) = MARKS.iter().find(|(m, _)| text.contains(m)) {
        return code(c);
    }
    if text.contains('$') {
        return code(if DOLLARS.contains(&region) {
            region
        } else {
            "USD"
        });
    }
    if text.contains(['¥', '￥']) {
        return code(if YENS.contains(&region) {
            region
        } else {
            "CNY"
        });
    }
    None
}

/* ------------------------------------------------------------ writing ---- */

/// What a draft is written as, money-wise.
#[derive(Debug, Clone, PartialEq)]
pub struct Priced {
    /// In the ledger's currency, always.
    pub amt: f64,
    /// For a foreign payment: its currency, its own amount and the rate.
    pub cur: Option<String>,
    pub orig_amt: Option<f64>,
    pub rate: Option<f64>,
}

/// A draft's money as it is written, at `rate` (one of `cur` in the ledger's
/// currency). `None` for a foreign one with no usable rate: it waits.
///
/// The record sheet's conversion (`record::draft`): the base amount stored,
/// the original and the rate kept beside it, so a ledger in one currency and a
/// statement in another stay addable.
pub fn priced(amt: f64, cur: Option<&str>, rate: Option<f64>) -> Option<Priced> {
    let Some(cur) = cur else {
        return Some(Priced {
            amt,
            cur: None,
            orig_amt: None,
            rate: None,
        });
    };
    let rate = rate.filter(|r| r.is_finite() && *r > 0.0)?;
    Some(Priced {
        amt: amt * rate,
        cur: Some(cur.to_string()),
        orig_amt: Some(amt),
        rate: Some(rate),
    })
}

/// One entry to write: a draft with its moment decided and its money priced.
#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    pub id: String,
    pub io: Io,
    pub cat: String,
    pub note: String,
    pub ts: i64,
    pub src: Option<EntrySource>,
    pub money: Priced,
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

    fn payment(id: &str, amount: &str, merchant: &str) -> Request {
        Request {
            id: id.into(),
            ask: Ask::Payment {
                amount: amount.into(),
                merchant: merchant.into(),
                region: "CNY".into(),
            },
        }
    }

    fn read_now(r: &Request) -> Vec<Draft> {
        read(r, today(), &[], Custom::default(), "CNY")
    }

    fn amount(text: &str, region: &str) -> Option<(f64, Option<String>)> {
        read_amount(text, region).map(|p| (p.amt, p.cur))
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
        let d = read_now(&payment("p1", "¥35.50", "星巴克"));
        assert_eq!(d.len(), 1);
        assert_eq!(
            (d[0].io, d[0].amt, d[0].day, &d[0].cur),
            (Io::Exp, 35.5, None, &None)
        );
        assert_eq!(d[0].note, "星巴克");
        assert_eq!(d[0].src, Some(EntrySource::Notif));
    }

    #[test]
    fn a_payments_category_comes_from_its_merchant() {
        assert_eq!(read_now(&payment("p1", "12", "滴滴出行"))[0].cat, "trans");
        assert_eq!(
            read_now(&payment("p2", "12", "星巴克"))[0].cat,
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
            &payment("p1", "8", "全家便利店"),
            today(),
            &[&past],
            Custom::default(),
            "CNY",
        );
        assert_eq!(d[0].cat, "health");
        // and not what the table alone would have said
        assert_ne!(read_now(&payment("p2", "8", "全家便利店"))[0].cat, "health");
    }

    #[test]
    fn a_payment_of_nothing_or_less_or_an_absurd_amount_asks_for_nothing() {
        for amount in ["¥0.00", "0", "", "免费", "10000000000000"] {
            assert!(read_now(&payment("p", amount, "店")).is_empty(), "{amount}");
        }
    }

    #[test]
    fn a_minus_sign_is_a_refund_and_is_not_guessed_at() {
        for text in ["-¥35.00", "¥-35.00", "\u{2212}35", "-35"] {
            assert_eq!(amount(text, "CNY"), None, "{text}");
        }
    }

    #[test]
    fn wallet_writes_the_amount_with_its_currency_and_both_are_read() {
        assert_eq!(amount("¥35.00", "CNY"), Some((35.0, Some("CNY".into()))));
        assert_eq!(amount("35", ""), Some((35.0, None)));
        assert_eq!(amount("35.5", ""), Some((35.5, None)));
    }

    #[test]
    fn the_last_mark_followed_by_one_or_two_digits_is_the_decimal_one() {
        for (text, n) in [
            ("¥1,234.50", 1234.5),
            ("1.234,50 €", 1234.5),
            ("1\u{202F}234,50\u{00A0}€", 1234.5),
            ("CHF 1'234.50", 1234.5),
            ("100,50 €", 100.5),
            ("12,5", 12.5),
            ("¥1,234", 1234.0),
            ("1.234 €", 1234.0),
            ("₩12,000", 12000.0),
            ("３５．５元", 35.5),
            ("US$1,234,567.89", 1234567.89),
        ] {
            assert_eq!(read_amount(text, "CNY").map(|p| p.amt), Some(n), "{text}");
        }
    }

    #[test]
    fn a_space_groups_only_three_digits_so_a_second_number_is_not_swallowed() {
        assert_eq!(amount("35.00 12", "").map(|p| p.0), Some(35.0));
        assert_eq!(amount("35 120", "").map(|p| p.0), Some(35120.0));
    }

    #[test]
    fn the_currency_is_the_one_the_words_name() {
        for (text, cur) in [
            ("US$5.40", "USD"),
            ("HK$100.00", "HKD"),
            ("NT$300", "TWD"),
            ("A$12.00", "AUD"),
            ("CA$12.00", "CAD"),
            ("JP¥500", "JPY"),
            ("CN¥35.00", "CNY"),
            ("100,50 €", "EUR"),
            ("£3.20", "GBP"),
            ("₩12,000", "KRW"),
            ("5.40 USD", "USD"),
            ("usd 5.40", "USD"),
            ("RMB 35", "CNY"),
            ("35元", "CNY"),
            ("35块", "CNY"),
            ("10美元", "USD"),
            ("100港元", "HKD"),
            ("500円", "JPY"),
        ] {
            assert_eq!(
                read_amount(text, "CNY").and_then(|p| p.cur).as_deref(),
                Some(cur),
                "{text}"
            );
        }
    }

    #[test]
    fn a_code_inside_a_longer_word_is_not_a_code() {
        assert_eq!(amount("USDT 5", "").and_then(|p| p.1), None);
    }

    #[test]
    fn a_bare_dollar_or_yen_is_the_regions_own_when_it_writes_its_own_so() {
        let cur = |text: &str, region: &str| read_amount(text, region).and_then(|p| p.cur);
        // a phone in Australia writes its own dollar as $; one in China
        // writes the American dollar as US$, so a bare $ there is still one
        assert_eq!(cur("$12.00", "AUD").as_deref(), Some("AUD"));
        assert_eq!(cur("$12.00", "USD").as_deref(), Some("USD"));
        assert_eq!(cur("$12.00", "CNY").as_deref(), Some("USD"));
        assert_eq!(cur("$12.00", "").as_deref(), Some("USD"));
        // in Japan ¥ is the yen and the yuan is CN¥
        assert_eq!(cur("¥500", "JPY").as_deref(), Some("JPY"));
        assert_eq!(cur("¥35", "CNY").as_deref(), Some("CNY"));
        assert_eq!(cur("￥35", "EUR").as_deref(), Some("CNY"));
    }

    #[test]
    fn a_payment_in_the_ledgers_own_currency_needs_no_rate() {
        let d = read_now(&payment("p", "CN¥35.00", "店"));
        assert_eq!((d[0].amt, &d[0].cur), (35.0, &None));
        // an empty base is the yuan, as everywhere
        let d = read(
            &payment("p", "35元", "店"),
            today(),
            &[],
            Custom::default(),
            "",
        );
        assert_eq!(d[0].cur, None);
    }

    #[test]
    fn a_foreign_payment_keeps_its_own_amount_and_says_its_currency() {
        let d = read_now(&payment("p", "US$5.40", "Blue Bottle"));
        assert_eq!((d[0].amt, d[0].cur.as_deref()), (5.4, Some("USD")));
        // the same words are no longer foreign to a ledger kept in dollars
        let d = read(
            &payment("p", "US$5.40", "店"),
            today(),
            &[],
            Custom::default(),
            "USD",
        );
        assert_eq!(d[0].cur, None);
    }

    #[test]
    fn a_sentence_is_in_the_ledgers_own_currency() {
        assert!(read_now(&sentence("q", "午饭35 打车12"))
            .iter()
            .all(|d| d.cur.is_none()));
    }

    #[test]
    fn the_ledgers_own_money_is_written_as_it_is() {
        assert_eq!(
            priced(35.0, None, None),
            Some(Priced {
                amt: 35.0,
                cur: None,
                orig_amt: None,
                rate: None
            })
        );
        // a rate handed to a payment that needs none changes nothing
        assert_eq!(priced(35.0, None, Some(7.0)).unwrap().amt, 35.0);
    }

    #[test]
    fn a_foreign_payment_is_written_in_the_base_with_its_own_amount_beside_it() {
        let p = priced(5.4, Some("USD"), Some(7.2)).unwrap();
        assert_eq!(p.amt, 5.4 * 7.2);
        assert_eq!(
            (p.cur.as_deref(), p.orig_amt, p.rate),
            (Some("USD"), Some(5.4), Some(7.2))
        );
    }

    #[test]
    fn a_foreign_payment_with_no_usable_rate_waits() {
        for rate in [
            None,
            Some(0.0),
            Some(-1.0),
            Some(f64::NAN),
            Some(f64::INFINITY),
        ] {
            assert_eq!(priced(5.4, Some("USD"), rate), None, "{rate:?}");
        }
    }

    #[test]
    fn a_payment_with_no_merchant_is_still_a_payment() {
        let d = read_now(&payment("p", "20", "  "));
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
        let drafts = read_now(&payment("p1", "9", "店"));
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
