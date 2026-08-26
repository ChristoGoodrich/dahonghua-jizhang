//! What the record sheet decides, without the sheet.
//!
//! Ported from `src/features/record/form.ts`, itself lifted out of a 368-line
//! hook for this port — the same extraction the entry list took, and for the
//! same reason: state, effects and animation stay in the widget tree, and what
//! comes here is the deciding.
//!
//! Five decisions, and each has a way of going quietly wrong:
//!
//! * **[`validate`]** — why a form cannot be saved. It answers *which* refusal
//!   applies, not what to say about it; wording is Intl and belongs to the
//!   platform, exactly as [`crate::list::DayLabel`] does for a day's name.
//! * **[`initial_fields`]** — editing loads a source entry whole, duplicating
//!   copies its fields but not its date.
//! * **[`pick_io`]** — switching direction, which has to find a *second*
//!   account for a transfer.
//! * **[`draft`]** — the shape that reaches the store, where the amount is
//!   always converted to the base currency and every optional number is
//!   truthy-tested rather than nullish.
//! * **[`should_patch_ts`]** — whether an edit writes the date at all.

use crate::calc::eval_expr;
use crate::entry::{Entry, Io};
use crate::money::{to_base, Currencies};
use std::collections::HashMap;

/// The fields a record sheet holds, as strings where the user types strings.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct FormFields {
    pub io: Option<Io>,
    pub cat: String,
    /// The calculator expression, not a number.
    pub amt: String,
    pub note: String,
    pub acct: String,
    pub acct_to: String,
    pub fee: String,
    pub discount: String,
    pub tags: Vec<String>,
    pub ledger: String,
    pub cur: String,
    pub subcat: String,
    /// When the entry happened. `None` means "now, whenever that turns out to
    /// be" — which the store resolves, because the clock is the platform's.
    pub ts: Option<i64>,
}

/// Why a form cannot be saved. Not a message — see the module note.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rejection {
    Amount,
    XferTo,
    XferSame,
    /// The currency that has no rate, so the caller can name it.
    NoRate(String),
}

/// The reason this form cannot be saved, or `None` when it can.
///
/// The amount is checked first, deliberately: a form that is wrong in two ways
/// names the amount, because that is the field the user is looking at.
///
/// `!value || value <= 0` — the first half catches an empty expression, a zero
/// and a `NaN`; the second catches the negatives an expression like `5-9`
/// produces. Both halves are needed and neither is redundant.
pub fn validate(f: &FormFields, base: &str, rates: &HashMap<String, f64>) -> Option<Rejection> {
    let value = eval_expr(&f.amt);
    if !truthy(value) || value <= 0.0 {
        return Some(Rejection::Amount);
    }
    if f.io == Some(Io::Xfer) {
        if f.acct_to.is_empty() {
            return Some(Rejection::XferTo);
        }
        if f.acct == f.acct_to {
            return Some(Rejection::XferSame);
        }
    }
    // `!rates[cur]` is a truthiness test, so a rate of zero reads as no rate —
    // which it is
    if f.cur != base && !rates.get(&f.cur).copied().is_some_and(truthy) {
        return Some(Rejection::NoRate(f.cur.clone()));
    }
    None
}

/// `!!x` for a float: JavaScript counts `NaN` as falsy, and so does this.
fn truthy(x: f64) -> bool {
    x != 0.0 && !x.is_nan()
}

/// Where a rate came from, which decides whether the user is warned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RateSource {
    Api,
    Cached,
}

/// Whether a freshly fetched rate is really the cached one.
///
/// Compared with a tolerance rather than for equality: the same rate arriving
/// from the network and from storage has been through a JSON round trip, and
/// `7.2` is not obliged to come back as the same double it went out as.
pub fn rate_source(fetched: Option<f64>, cached: Option<f64>) -> Option<RateSource> {
    let fetched = fetched?;
    Some(match cached {
        Some(c) if (fetched - c).abs() < 0.000001 => RateSource::Cached,
        _ => RateSource::Api,
    })
}

/// What the fields start as, for a form with no source entry.
#[derive(Debug, Clone, Default)]
pub struct FormDefaults {
    pub base: String,
    pub acct: String,
    pub ledger: String,
    /// The first category of the `exp` direction, which a fresh form opens on.
    pub first_exp_cat: String,
    /// A pre-picked date for a new entry (calendar 补记这天), else `None`.
    pub initial_ts: Option<i64>,
}

/// The initial fields for a fresh, edited, or duplicated entry.
///
/// `editing` distinguishes the two ways a source entry is used, and the
/// difference is one field. Editing loads it whole, date included. Duplicating
/// copies its *fields* into a new entry and leaves the date alone, so 再记一笔
/// lands today rather than re-dating itself to whenever the original was.
pub fn initial_fields(source: Option<&Entry>, editing: bool, d: &FormDefaults) -> FormFields {
    let Some(s) = source else {
        return FormFields {
            io: Some(Io::Exp),
            cat: d.first_exp_cat.clone(),
            acct: d.acct.clone(),
            ledger: d.ledger.clone(),
            cur: d.base.clone(),
            ts: d.initial_ts,
            ..Default::default()
        };
    };
    FormFields {
        io: s.io,
        cat: s.cat.clone(),
        // the ORIGINAL foreign amount, not the converted one — an entry
        // recorded as $10 shows 10, not 72
        amt: crate::num::js_num(s.orig_amt.unwrap_or(s.amt)),
        note: s.note.clone().unwrap_or_default(),
        acct: s.acct.clone().unwrap_or_else(|| "default".into()),
        acct_to: s.acct_to.clone().unwrap_or_default(),
        // truthy, not nullish: a fee of zero is no fee, and shows as an empty
        // field rather than as "0"
        fee: s
            .fee
            .filter(|v| truthy(*v))
            .map(crate::num::js_num)
            .unwrap_or_default(),
        discount: s
            .discount
            .filter(|v| truthy(*v))
            .map(crate::num::js_num)
            .unwrap_or_default(),
        tags: s.tags.clone().unwrap_or_default(),
        ledger: s.ledger.clone().unwrap_or_default(),
        cur: s.cur.clone().unwrap_or_else(|| d.base.clone()),
        subcat: s.subcat.clone().unwrap_or_default(),
        ts: if editing { Some(s.ts) } else { d.initial_ts },
    }
}

/// What changes when a direction is picked.
///
/// A transfer needs two accounts, so it takes the current one as `from` and the
/// first *other* visible account as `to` — leaving `to` empty when there is no
/// other, which [`validate`] then refuses rather than transferring to nowhere.
/// The subcategory clears either way: it belongs to a category about to change.
pub fn pick_io(
    next: Io,
    f: &FormFields,
    visible_accounts: &[String],
    current_account: &str,
    first_cat_of: impl Fn(Io) -> String,
) -> FormFields {
    let mut out = f.clone();
    out.io = Some(next);
    out.subcat = String::new();
    if next == Io::Xfer {
        let from = if f.acct.is_empty() {
            current_account.to_string()
        } else {
            f.acct.clone()
        };
        out.acct_to = visible_accounts
            .iter()
            .find(|id| **id != from)
            .cloned()
            .unwrap_or_default();
        out.acct = from;
    } else {
        out.cat = first_cat_of(next);
    }
    out
}

/// Whether an edit should write the date at all.
///
/// Only when the user actually re-dated the entry. Patching an untouched date
/// stamps `fieldTs.ts` for a field nobody edited — and that stamp is what the
/// sync merge uses to decide whose version of the date wins, so an edit to the
/// note alone would start overruling another device's genuine re-dating.
pub fn should_patch_ts(original_ts: Option<i64>, form_ts: Option<i64>) -> bool {
    match (original_ts, form_ts) {
        (Some(o), Some(f)) => o != f,
        _ => false,
    }
}

/// The entry fields a save writes.
#[derive(Debug, Clone, PartialEq)]
pub enum Draft {
    Xfer {
        from: String,
        to: String,
        amt: f64,
        fee: f64,
        discount: f64,
        note: String,
        ledger: String,
        ts: Option<i64>,
    },
    Entry {
        io: Option<Io>,
        cat: String,
        /// Always in the base currency.
        amt: f64,
        note: String,
        acct: String,
        tags: Option<Vec<String>>,
        ledger: Option<String>,
        subcat: Option<String>,
        cur: Option<String>,
        orig_amt: Option<f64>,
        rate: Option<f64>,
        ts: Option<i64>,
    },
}

/// The shape that reaches the store, or `None` when the form is not saveable.
///
/// Two things a second implementation would get subtly wrong. The amount is
/// **always persisted in the base currency**, with the original kept alongside,
/// so a ledger in one currency and a statement in another stay addable. And
/// every optional is truthy-tested rather than nullish, so an empty tag list is
/// absent and a fee of zero is no fee — which is what the sync merge and every
/// reader already assume.
pub fn draft(
    f: &FormFields,
    base: &str,
    currencies: &Currencies,
    rate_override: Option<f64>,
) -> Option<Draft> {
    let value = eval_expr(&f.amt);
    if !truthy(value) || value <= 0.0 {
        return None;
    }
    let note = crate::jsstr::js_trim(&f.note).to_string();

    if f.io == Some(Io::Xfer) {
        if f.acct_to.is_empty() || f.acct == f.acct_to {
            return None;
        }
        return Some(Draft::Xfer {
            from: f.acct.clone(),
            to: f.acct_to.clone(),
            amt: value,
            // `parseFloat(x) || 0` — an empty or unparseable field is zero,
            // never a NaN that would poison a balance
            fee: parse_float(&f.fee),
            discount: parse_float(&f.discount),
            note,
            ledger: f.ledger.clone(),
            ts: f.ts,
        });
    }

    let foreign = !f.cur.is_empty() && f.cur != base;
    // `??`, so an override of zero would be used — but `to_base` treats a zero
    // rate as no rate, which is the same answer
    let rate = match rate_override {
        Some(r) => Some(r),
        None if foreign => currencies.rates.get(&f.cur).copied(),
        None => None,
    };
    Some(Draft::Entry {
        io: f.io,
        cat: f.cat.clone(),
        // an empty code is no currency, which is what a falsy `cur` means
        // on the other side
        amt: to_base(
            value,
            (!f.cur.is_empty()).then_some(f.cur.as_str()),
            currencies,
            rate,
        ),
        note,
        acct: f.acct.clone(),
        tags: (!f.tags.is_empty()).then(|| f.tags.clone()),
        ledger: (!f.ledger.is_empty()).then(|| f.ledger.clone()),
        subcat: (!f.subcat.is_empty()).then(|| f.subcat.clone()),
        cur: foreign.then(|| f.cur.clone()),
        orig_amt: foreign.then_some(value),
        rate: if foreign { rate } else { None },
        ts: f.ts,
    })
}

/// `parseFloat(s) || 0`.
///
/// Not `s.parse::<f64>()`, in two ways. `parseFloat` reads a *leading* number
/// and stops, so `"1.5kg"` is `1.5` where Rust's parser refuses the whole
/// string. And it accepts the literal `Infinity`, which Rust's parser also
/// takes but which the scanner below would otherwise never reach — a corpus
/// case caught exactly that.
///
/// Reproduced because the field is free text: the difference is a fee of 1.5
/// against a fee of 0.
fn parse_float(s: &str) -> f64 {
    let t = s.trim_start();
    // the literal, with an optional sign, before any digit scanning
    let (sign, rest) = match t.as_bytes().first() {
        Some(b'-') => (-1.0, &t[1..]),
        Some(b'+') => (1.0, &t[1..]),
        _ => (1.0, t),
    };
    if rest.starts_with("Infinity") {
        return sign * f64::INFINITY;
    }
    let mut end = 0;
    let b = t.as_bytes();
    let mut seen_digit = false;
    let mut seen_dot = false;
    let mut seen_e = false;
    while end < b.len() {
        let c = b[end] as char;
        let ok = match c {
            '+' | '-' => end == 0 || (seen_e && matches!(b[end - 1] as char, 'e' | 'E')),
            '.' => !seen_dot && !seen_e,
            'e' | 'E' => seen_digit && !seen_e,
            '0'..='9' => true,
            _ => false,
        };
        if !ok {
            break;
        }
        if c.is_ascii_digit() {
            seen_digit = true;
        }
        if c == '.' {
            seen_dot = true;
        }
        if c == 'e' || c == 'E' {
            seen_e = true;
        }
        end += 1;
    }
    let v: f64 = t[..end].parse().unwrap_or(f64::NAN);
    if truthy(v) {
        v
    } else {
        0.0
    }
}

/// What clears after 再记, so the next entry of the same kind can be typed.
///
/// Direction, category, account, currency, date, tags and ledger stay — they
/// are what "the same kind" means. The amount, the note and the subcategory are
/// the entry itself, and they go.
pub fn after_save_next(f: &FormFields) -> FormFields {
    FormFields {
        amt: String::new(),
        note: String::new(),
        subcat: String::new(),
        fee: String::new(),
        discount: String::new(),
        ..f.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rates() -> HashMap<String, f64> {
        HashMap::from([("USD".to_string(), 7.2), ("JPY".to_string(), 0.048)])
    }

    fn currencies() -> Currencies {
        Currencies {
            base: "CNY".into(),
            rates: rates(),
        }
    }

    fn form() -> FormFields {
        FormFields {
            io: Some(Io::Exp),
            cat: "food".into(),
            amt: "30".into(),
            acct: "default".into(),
            cur: "CNY".into(),
            ..Default::default()
        }
    }

    // ---------- validate ----------

    #[test]
    fn a_plain_expense_is_accepted() {
        assert_eq!(validate(&form(), "CNY", &rates()), None);
    }

    #[test]
    fn an_empty_zero_or_negative_amount_is_refused() {
        for amt in ["", "0", "0.00", "5-9", "5-5"] {
            let f = FormFields {
                amt: amt.into(),
                ..form()
            };
            assert_eq!(
                validate(&f, "CNY", &rates()),
                Some(Rejection::Amount),
                "{amt}"
            );
        }
    }

    #[test]
    fn a_transfer_needs_two_different_accounts() {
        let x = FormFields {
            io: Some(Io::Xfer),
            ..form()
        };
        assert_eq!(validate(&x, "CNY", &rates()), Some(Rejection::XferTo));
        let same = FormFields {
            acct_to: "default".into(),
            ..x.clone()
        };
        assert_eq!(validate(&same, "CNY", &rates()), Some(Rejection::XferSame));
        let ok = FormFields {
            acct_to: "cash".into(),
            ..x
        };
        assert_eq!(validate(&ok, "CNY", &rates()), None);
    }

    #[test]
    fn a_currency_with_no_rate_is_refused_and_named() {
        let f = FormFields {
            cur: "EUR".into(),
            ..form()
        };
        assert_eq!(
            validate(&f, "CNY", &rates()),
            Some(Rejection::NoRate("EUR".into()))
        );
    }

    #[test]
    fn the_amount_is_checked_before_anything_else() {
        // a form wrong in two ways names the amount, which is the field the
        // user is looking at
        let f = FormFields {
            amt: String::new(),
            io: Some(Io::Xfer),
            ..form()
        };
        assert_eq!(validate(&f, "CNY", &rates()), Some(Rejection::Amount));
    }

    // ---------- rate_source ----------

    #[test]
    fn a_rate_that_was_never_fetched_has_no_source() {
        assert_eq!(rate_source(None, Some(7.2)), None);
    }

    #[test]
    fn a_fetched_rate_reads_as_cached_within_a_tolerance() {
        assert_eq!(rate_source(Some(7.2), Some(7.2)), Some(RateSource::Cached));
        assert_eq!(
            rate_source(Some(7.2000001), Some(7.2)),
            Some(RateSource::Cached)
        );
        assert_eq!(rate_source(Some(7.21), Some(7.2)), Some(RateSource::Api));
        assert_eq!(rate_source(Some(7.2), None), Some(RateSource::Api));
    }

    // ---------- initial_fields ----------

    fn defaults() -> FormDefaults {
        FormDefaults {
            base: "CNY".into(),
            acct: "card-a".into(),
            ledger: "home".into(),
            first_exp_cat: "food".into(),
            initial_ts: None,
        }
    }

    fn source() -> Entry {
        Entry {
            id: "s".into(),
            ts: 1000,
            io: Some(Io::Inc),
            cat: "salary".into(),
            amt: 72.0,
            cur: Some("USD".into()),
            orig_amt: Some(10.0),
            note: Some("pay".into()),
            acct: Some("bank".into()),
            fee: Some(0.0),
            tags: Some(vec!["work".into()]),
            ..Default::default()
        }
    }

    #[test]
    fn a_fresh_form_opens_on_the_defaults() {
        let f = initial_fields(None, false, &defaults());
        assert_eq!(f.io, Some(Io::Exp));
        assert_eq!(f.cat, "food");
        assert_eq!(f.amt, "");
        assert_eq!(f.acct, "card-a");
        assert_eq!(f.ledger, "home");
        assert_eq!(f.cur, "CNY");
    }

    #[test]
    fn a_new_entry_takes_a_pre_picked_date() {
        let d = FormDefaults {
            initial_ts: Some(5000),
            ..defaults()
        };
        assert_eq!(initial_fields(None, false, &d).ts, Some(5000));
    }

    #[test]
    fn editing_shows_the_original_foreign_amount() {
        assert_eq!(initial_fields(Some(&source()), true, &defaults()).amt, "10");
    }

    #[test]
    fn editing_keeps_the_date_and_duplicating_drops_it() {
        assert_eq!(
            initial_fields(Some(&source()), true, &defaults()).ts,
            Some(1000)
        );
        // 再记一笔 lands today rather than re-dating itself
        assert_eq!(initial_fields(Some(&source()), false, &defaults()).ts, None);
    }

    #[test]
    fn a_zero_fee_shows_as_an_empty_field() {
        assert_eq!(initial_fields(Some(&source()), true, &defaults()).fee, "");
        let with_fee = Entry {
            fee: Some(2.0),
            ..source()
        };
        assert_eq!(initial_fields(Some(&with_fee), true, &defaults()).fee, "2");
    }

    #[test]
    fn a_source_naming_no_currency_falls_back_to_base() {
        let e = Entry {
            cur: None,
            ..source()
        };
        assert_eq!(initial_fields(Some(&e), true, &defaults()).cur, "CNY");
    }

    // ---------- pick_io ----------

    #[test]
    fn picking_a_direction_clears_the_subcategory() {
        let f = FormFields {
            subcat: "x".into(),
            ..form()
        };
        assert_eq!(
            pick_io(Io::Inc, &f, &[], "default", |_| "salary".into()).subcat,
            ""
        );
        assert_eq!(
            pick_io(Io::Xfer, &f, &[], "default", |_| String::new()).subcat,
            ""
        );
    }

    #[test]
    fn picking_a_direction_resets_the_category() {
        let p = pick_io(Io::Inc, &form(), &["default".into()], "default", |io| {
            format!("first-{}", io.as_str())
        });
        assert_eq!(p.cat, "first-inc");
    }

    #[test]
    fn a_transfer_picks_a_different_account_as_its_destination() {
        let f = FormFields {
            acct: "a".into(),
            ..form()
        };
        let accounts: Vec<String> = vec!["a".into(), "b".into(), "c".into()];
        let p = pick_io(Io::Xfer, &f, &accounts, "a", |_| String::new());
        assert_eq!(p.acct, "a");
        assert_eq!(p.acct_to, "b");
    }

    #[test]
    fn with_no_other_account_the_destination_is_left_empty() {
        // which validate then refuses, rather than transferring to nowhere
        let f = FormFields {
            acct: "a".into(),
            ..form()
        };
        let p = pick_io(Io::Xfer, &f, &["a".to_string()], "a", |_| String::new());
        assert_eq!(p.acct_to, "");
        assert_eq!(validate(&p, "CNY", &rates()), Some(Rejection::XferTo));
    }

    #[test]
    fn a_form_naming_no_account_falls_back_to_the_current_one() {
        let f = FormFields {
            acct: String::new(),
            ..form()
        };
        let accounts: Vec<String> = vec!["cur".into(), "b".into()];
        assert_eq!(
            pick_io(Io::Xfer, &f, &accounts, "cur", |_| String::new()).acct,
            "cur"
        );
    }

    // ---------- should_patch_ts ----------

    #[test]
    fn the_date_is_written_only_when_it_changed() {
        assert!(should_patch_ts(Some(1000), Some(2000)));
        assert!(!should_patch_ts(Some(1000), Some(1000)));
        assert!(!should_patch_ts(None, Some(2000))); // nothing to compare against
        assert!(!should_patch_ts(Some(1000), None)); // the form never set one
    }

    // ---------- draft ----------

    fn entry_draft(d: Draft) -> (f64, Option<f64>, Option<String>, Option<f64>) {
        match d {
            Draft::Entry {
                amt,
                orig_amt,
                cur,
                rate,
                ..
            } => (amt, orig_amt, cur, rate),
            other => panic!("expected an entry, got {other:?}"),
        }
    }

    #[test]
    fn the_amount_is_an_expression_not_a_number() {
        let f = FormFields {
            amt: "12+8".into(),
            ..form()
        };
        assert_eq!(
            entry_draft(draft(&f, "CNY", &currencies(), None).unwrap()).0,
            20.0
        );
    }

    #[test]
    fn a_draft_refuses_what_validate_refuses() {
        let zero = FormFields {
            amt: "0".into(),
            ..form()
        };
        assert!(draft(&zero, "CNY", &currencies(), None).is_none());
        let no_to = FormFields {
            io: Some(Io::Xfer),
            ..form()
        };
        assert!(draft(&no_to, "CNY", &currencies(), None).is_none());
        let same = FormFields {
            io: Some(Io::Xfer),
            acct: "a".into(),
            acct_to: "a".into(),
            ..form()
        };
        assert!(draft(&same, "CNY", &currencies(), None).is_none());
    }

    #[test]
    fn a_foreign_amount_is_persisted_in_base_with_the_original_kept() {
        let f = FormFields {
            cur: "USD".into(),
            amt: "10".into(),
            ..form()
        };
        let (amt, orig, cur, rate) = entry_draft(draft(&f, "CNY", &currencies(), None).unwrap());
        assert_eq!(amt, 72.0);
        assert_eq!(orig, Some(10.0));
        assert_eq!(cur, Some("USD".into()));
        assert_eq!(rate, Some(7.2));
    }

    #[test]
    fn an_entry_in_the_base_currency_carries_none_of_those_fields() {
        let (_, orig, cur, rate) = entry_draft(draft(&form(), "CNY", &currencies(), None).unwrap());
        assert_eq!((orig, cur, rate), (None, None, None));
    }

    #[test]
    fn an_override_rate_beats_the_cached_one() {
        let f = FormFields {
            cur: "USD".into(),
            amt: "10".into(),
            ..form()
        };
        let (amt, _, _, rate) = entry_draft(draft(&f, "CNY", &currencies(), Some(7.5)).unwrap());
        assert_eq!(rate, Some(7.5));
        assert_eq!(amt, 75.0);
    }

    #[test]
    fn the_note_is_trimmed_and_the_empty_optionals_dropped() {
        let f = FormFields {
            note: "  午饭  ".into(),
            ..form()
        };
        match draft(&f, "CNY", &currencies(), None).unwrap() {
            Draft::Entry {
                note,
                tags,
                ledger,
                subcat,
                ..
            } => {
                assert_eq!(note, "午饭");
                assert_eq!((tags, ledger, subcat), (None, None, None));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_note_is_trimmed_the_way_javascript_trims() {
        // a BOM pasted in with the text goes; a NEL does not
        let f = FormFields {
            note: "\u{feff}午饭\u{85}".into(),
            ..form()
        };
        match draft(&f, "CNY", &currencies(), None).unwrap() {
            Draft::Entry { note, .. } => assert_eq!(note, "午饭\u{85}"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn an_unparseable_fee_is_zero_rather_than_nan() {
        let f = FormFields {
            io: Some(Io::Xfer),
            acct_to: "b".into(),
            discount: "abc".into(),
            ..form()
        };
        match draft(&f, "CNY", &currencies(), None).unwrap() {
            Draft::Xfer { fee, discount, .. } => assert_eq!((fee, discount), (0.0, 0.0)),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_fee_reads_the_leading_number_the_way_parse_float_does() {
        // `parseFloat("1.5kg")` is 1.5, where Rust's own parser refuses the
        // whole string — and the field is free text
        assert_eq!(parse_float("1.5kg"), 1.5);
        assert_eq!(parse_float("  2.5  "), 2.5);
        assert_eq!(parse_float("1e2"), 100.0);
        assert_eq!(parse_float("-3"), -3.0);
        assert_eq!(parse_float(".5"), 0.5);
        assert_eq!(parse_float("abc"), 0.0);
        assert_eq!(parse_float(""), 0.0);
        assert_eq!(parse_float("0"), 0.0);
        // `parseFloat` takes the literal, and `|| 0` keeps it because an
        // infinity is truthy
        assert_eq!(parse_float("Infinity"), f64::INFINITY);
        assert_eq!(parse_float("-Infinity"), f64::NEG_INFINITY);
        assert_eq!(parse_float("Inf"), 0.0); // not the literal
                                             // a hex literal is not one either: parseFloat reads the leading 0
        assert_eq!(parse_float("0x10"), 0.0);
    }

    // ---------- after_save_next ----------

    #[test]
    fn re_recording_keeps_the_kind_and_clears_the_entry() {
        let f = FormFields {
            io: Some(Io::Inc),
            cat: "salary".into(),
            acct: "bank".into(),
            acct_to: String::new(),
            cur: "USD".into(),
            ts: Some(5000),
            tags: vec!["work".into()],
            ledger: "home".into(),
            amt: "45".into(),
            note: "a".into(),
            subcat: "b".into(),
            fee: "1".into(),
            discount: "2".into(),
        };
        let n = after_save_next(&f);
        assert_eq!(n.io, Some(Io::Inc));
        assert_eq!(n.cat, "salary");
        assert_eq!(n.acct, "bank");
        assert_eq!(n.cur, "USD");
        assert_eq!(n.ts, Some(5000));
        assert_eq!(n.tags, vec!["work".to_string()]);
        assert_eq!(n.ledger, "home");
        assert_eq!(
            (n.amt, n.note, n.subcat, n.fee, n.discount),
            (
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                String::new()
            )
        );
    }
}
