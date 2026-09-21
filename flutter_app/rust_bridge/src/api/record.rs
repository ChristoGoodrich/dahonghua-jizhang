//! The record sheet's judgement, across the boundary.
//!
//! Dart holds the fields — a text controller and a keypad are its job — and
//! asks this what they mean. Whether the form can be saved, what a fresh one
//! starts as, what switching direction does to the other fields, what shape
//! reaches the ledger: all of it is `dahonghua_core::record`, pinned by 3,987
//! parity cases against the TypeScript still in users' hands.
//!
//! The one thing that does *not* cross is a message. [`validate_form`] answers
//! which refusal applies and Dart spells it, the same line the entry list draws
//! for a day's name — a rejection is logic, a sentence is Intl.

use dahonghua_core::catalog;
use dahonghua_core::civil::{month_grid, Civil};
use dahonghua_core::entry::Io;
use dahonghua_core::money::Currencies;
use dahonghua_core::record::{self as core, Draft, FormDefaults, FormFields};
use dahonghua_core::store::TransferOpts;
use flutter_rust_bridge::frb;

use super::store::{currencies_of, set_currencies_inner, store, store_mut};

/// The record sheet's fields, as Dart holds them.
///
/// Strings where the user types strings — `amt` is a calculator *expression*,
/// not a number, and `fee` is free text whose leading number is what counts.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct FormView {
    pub io: String,
    pub cat: String,
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
    /// When it happened. `None` is "now", resolved at save time.
    pub ts: Option<i64>,
}

impl From<FormView> for FormFields {
    fn from(v: FormView) -> Self {
        FormFields {
            io: Io::parse(&v.io),
            cat: v.cat,
            amt: v.amt,
            note: v.note,
            acct: v.acct,
            acct_to: v.acct_to,
            fee: v.fee,
            discount: v.discount,
            tags: v.tags,
            ledger: v.ledger,
            cur: v.cur,
            subcat: v.subcat,
            ts: v.ts,
        }
    }
}

impl From<FormFields> for FormView {
    fn from(f: FormFields) -> Self {
        FormView {
            io: f.io.map(|i| i.as_str().to_string()).unwrap_or_default(),
            cat: f.cat,
            amt: f.amt,
            note: f.note,
            acct: f.acct,
            acct_to: f.acct_to,
            fee: f.fee,
            discount: f.discount,
            tags: f.tags,
            ledger: f.ledger,
            cur: f.cur,
            subcat: f.subcat,
            ts: f.ts,
        }
    }
}

/// Why a form cannot be saved: `"amount"`, `"xferTo"`, `"xferSame"`, or
/// `"noRate:USD"`. `None` means it can.
///
/// A tagged string rather than a Dart enum with a payload, because only one
/// rejection carries anything and a `switch` on a prefix is less machinery than
/// a sealed class for it.
#[frb(sync)]
pub fn validate_form(form: FormView) -> Option<String> {
    let c = currencies_of();
    core::validate(&form.into(), &c.base, &c.rates).map(|r| match r {
        core::Rejection::Amount => "amount".to_string(),
        core::Rejection::XferTo => "xferTo".to_string(),
        core::Rejection::XferSame => "xferSame".to_string(),
        core::Rejection::NoRate(cur) => format!("noRate:{cur}"),
    })
}

/// What a save did.
#[derive(Debug, Clone, PartialEq)]
pub struct SaveResult {
    /// The rejection kind, when the form could not be saved.
    pub rejected: Option<String>,
    /// The id written, when it could.
    pub id: Option<String>,
    /// True when a stale cached rate was used — a notice about a **saved**
    /// entry, not a failure. Keeping the two apart is what stopped the
    /// TypeScript from writing the entry twice.
    pub stale_rate: bool,
}

/// Validate, shape and write, in one call.
///
/// Deliberately one call: the TypeScript's `save()` split validation from
/// writing and had a path where the write happened and the caller was told
/// something that read like a failure. Here a caller cannot write without
/// validating, and cannot be told "rejected" about a row that exists.
///
/// `edit_id` empty means a new entry. `rate_override` is a rate fetched for the
/// entry's own date, which the platform's HTTP goes and gets.
#[frb(sync)]
pub fn save_form(
    form: FormView,
    edit_id: String,
    id: String,
    now: i64,
    rate_override: Option<f64>,
    rate_was_cached: bool,
) -> SaveResult {
    let f: FormFields = form.into();
    let c = currencies_of();
    if let Some(r) = core::validate(&f, &c.base, &c.rates) {
        return SaveResult {
            rejected: Some(match r {
                core::Rejection::Amount => "amount".to_string(),
                core::Rejection::XferTo => "xferTo".to_string(),
                core::Rejection::XferSame => "xferSame".to_string(),
                core::Rejection::NoRate(cur) => format!("noRate:{cur}"),
            }),
            id: None,
            stale_rate: false,
        };
    }
    let Some(d) = core::draft(&f, &c.base, &c, rate_override) else {
        // validate passed, so this is unreachable; answering rather than
        // panicking keeps one impossible case from taking the app with it
        return SaveResult {
            rejected: Some("amount".to_string()),
            id: None,
            stale_rate: false,
        };
    };

    let editing = !edit_id.is_empty();
    // `store_mut`, and this line is the defect that lost every entry the app
    // recorded: it wrote through a plain `store()` and marked nothing, so the
    // rows lived in memory and never reached the database. Six mutators in
    // `store.rs` were audited when the dirty set was written and nobody
    // checked whether other modules reached past them. Five did.
    let mut s = store_mut();
    let written = match d {
        Draft::Xfer {
            from,
            to,
            amt,
            fee,
            discount,
            note,
            ledger,
            ts,
        } => {
            if editing {
                // an entry converted into a transfer clears the fields only an
                // expense or income has
                let mut p = dahonghua_core::entry::Patch {
                    io: Some(Io::Xfer),
                    cat: Some("transfer".into()),
                    amt: Some(amt),
                    acct: Some(from),
                    acct_to: Some(to),
                    fee: (fee != 0.0).then_some(fee),
                    discount: (discount != 0.0).then_some(discount),
                    note: (!note.is_empty()).then_some(note),
                    ledger: (!ledger.is_empty()).then_some(ledger),
                    ..Default::default()
                };
                p.ts = core::should_patch_ts(s.ledger.get(&edit_id).map(|e| e.ts), f.ts)
                    .then_some(f.ts)
                    .flatten();
                s.update_entry(&edit_id, &p, now);
                edit_id
            } else {
                s.add_transfer(
                    TransferOpts {
                        from,
                        to,
                        amt,
                        fee: Some(fee),
                        discount: Some(discount),
                        note: Some(note),
                        ledger: Some(ledger),
                        ts,
                    },
                    id,
                    now,
                )
            }
        }
        Draft::Entry {
            io,
            cat,
            amt,
            note,
            acct,
            tags,
            ledger,
            subcat,
            cur,
            orig_amt,
            rate,
            ts,
        } => {
            if editing {
                let mut p = dahonghua_core::entry::Patch {
                    io,
                    cat: Some(cat),
                    amt: Some(amt),
                    note: Some(note),
                    acct: Some(acct),
                    tags,
                    ledger,
                    subcat,
                    cur,
                    orig_amt,
                    rate,
                    ..Default::default()
                };
                p.ts = core::should_patch_ts(s.ledger.get(&edit_id).map(|e| e.ts), f.ts)
                    .then_some(f.ts)
                    .flatten();
                s.update_entry(&edit_id, &p, now);
                edit_id
            } else {
                s.add_entry(
                    dahonghua_core::entry::Entry {
                        io,
                        cat,
                        amt,
                        note: (!note.is_empty()).then_some(note),
                        acct: (!acct.is_empty()).then_some(acct),
                        tags,
                        ledger,
                        subcat,
                        cur,
                        orig_amt,
                        rate,
                        ..Default::default()
                    },
                    id,
                    ts,
                    now,
                )
            }
        }
    };

    SaveResult {
        rejected: None,
        id: Some(written),
        stale_rate: rate_was_cached && f.cur != c.base,
    }
}

/// The cached rate for a code, which the platform's fetcher compares against.
#[frb(sync)]
pub fn cached_rate(code: String) -> Option<f64> {
    currencies_of().rates.get(&code).copied()
}

/// The fields a sheet opens with.
///
/// `source_id` empty means a fresh entry. `editing` distinguishes an edit from
/// a duplicate, and the difference is one field: a duplicate keeps the source's
/// values but not its date, so 再记一笔 lands today.
#[frb(sync)]
pub fn initial_form(
    source_id: String,
    editing: bool,
    initial_ts: Option<i64>,
    ledger: String,
) -> FormView {
    let s = store();
    let c = currencies_of();
    let source = (!source_id.is_empty())
        .then(|| s.ledger.get(&source_id))
        .flatten()
        .cloned();
    let first_exp = catalog::all_cats(Io::Exp, &[])
        .first()
        .map(|c| c.k.clone())
        .unwrap_or_default();
    core::initial_fields(
        source.as_ref(),
        editing,
        &FormDefaults {
            base: c.base.clone(),
            acct: s.current_account.clone(),
            ledger,
            first_exp_cat: first_exp,
            initial_ts,
        },
    )
    .into()
}

/// What changes when a direction is picked.
///
/// The visible accounts come from the store rather than from Dart: a transfer
/// needs a *second* account, and which accounts exist is state this side owns.
#[frb(sync)]
pub fn pick_direction(next: String, form: FormView) -> FormView {
    let s = store();
    let ids: Vec<String> = s
        .accounts
        .iter()
        .filter(|a| a.archived != Some(true))
        .map(|a| a.id.clone())
        .collect();
    let current = s.current_account.clone();
    let io = Io::parse(&next).unwrap_or(Io::Exp);
    drop(s);
    core::pick_io(io, &form.into(), &ids, &current, |i| {
        catalog::all_cats(i, &[])
            .first()
            .map(|c| c.k.clone())
            .unwrap_or_default()
    })
    .into()
}

/// What clears after 再记, so the next entry of the same kind can be typed.
#[frb(sync)]
pub fn clear_for_next(form: FormView) -> FormView {
    core::after_save_next(&form.into()).into()
}

/// The currency settings the record sheet's decisions read.
///
/// Held here rather than in Dart for the same reason the ledger is: two copies
/// of one table is one too many, and `validate` refuses a save on this.
#[frb(sync)]
pub fn set_currencies(base: String, codes: Vec<String>, rates: Vec<f64>) {
    let n = codes.len().min(rates.len());
    set_currencies_inner(Currencies {
        base,
        rates: (0..n).map(|i| (codes[i].clone(), rates[i])).collect(),
    });
}

#[frb(sync)]
pub fn base_currency() -> String {
    currencies_of().base
}

// ---------- the date an entry is on ----------

/// `y-m-d`, month 1-based — the form `localDay` writes on the Dart side,
/// where the timezone lives. A string that does not parse is the epoch
/// rather than a panic: a picker that crashed on a bad date would lose the
/// whole sheet over it.
fn civil(s: &str) -> Civil {
    let mut it = s.split('-').map(|p| p.parse::<i32>().ok());
    let y = it.next().flatten().unwrap_or(1970);
    let m = it.next().flatten().unwrap_or(1);
    let d = it.next().flatten().unwrap_or(1);
    Civil::new(y, m - 1, d)
}

/// What the sheet calls `day`: `today`, `yesterday`, `day_before`, or `date`
/// when it is further away — in either direction. Dart spells it; this
/// decides which of the four it is.
#[frb(sync)]
pub fn day_name(day: String, today: String) -> String {
    match core::day_name(civil(&day), civil(&today)) {
        core::DayName::Today => "today",
        core::DayName::Yesterday => "yesterday",
        core::DayName::DayBefore => "day_before",
        core::DayName::Date => "date",
    }
    .to_string()
}

/// One cell of the picker's month: a blank before the 1st, or a day.
#[derive(Debug, Clone, PartialEq)]
pub struct DayCell {
    /// `None` for the blanks that put the 1st under its weekday.
    pub day: Option<i32>,
    /// False after today. See `core::record::pickable`.
    pub pickable: bool,
    pub today: bool,
}

/// A month for the picker, Monday first. `m` is 1-based.
#[frb(sync)]
pub fn date_grid(y: i32, m: i32, today: String) -> Vec<DayCell> {
    let today = civil(&today);
    month_grid(y, m - 1)
        .into_iter()
        .map(|d| match d {
            None => DayCell {
                day: None,
                pickable: false,
                today: false,
            },
            Some(d) => {
                let c = Civil::new(y, m - 1, d);
                DayCell {
                    day: Some(d),
                    pickable: core::pickable(c, today),
                    today: c == today,
                }
            }
        })
        .collect()
}

/// Whether the picker may page forward from `y`/`m`. Not past the month
/// today is in: every day after it would be greyed out, and a page of
/// nothing but greyed-out days is a page with nothing to do on it.
#[frb(sync)]
pub fn can_page_forward(y: i32, m: i32, today: String) -> bool {
    let today = civil(&today);
    (y, m - 1) < (today.y, today.m)
}
