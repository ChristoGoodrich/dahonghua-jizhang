//! Time-dimension windows: day / week / month / half-year / year.
//!
//! `month` is not the calendar month — it defers to the accounting cycle, so a
//! ledger that turns over on the 15th gets the 15th to the 14th here too. The
//! week runs Monday to Sunday.
//!
//! Labels are not here. `period.rs` says why: rendering a month name is ICU
//! text and belongs to the UI, the same reason `curOf` stayed behind in
//! `money.rs`. What crosses is the window and how to step it.

use flutter_rust_bridge::frb;

use dahonghua_core::civil::Civil;
use dahonghua_core::period::{period_range, shift_period, Period};

use super::store::{settings_of, store};

fn parse_day(s: &str) -> Civil {
    let mut it = s.split('-');
    let y = it.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    Civil::new(y, m - 1, d)
}

fn show_day(c: Civil) -> String {
    format!("{}-{}-{}", c.y, c.m + 1, c.d)
}

fn period_of(s: &str) -> Period {
    Period::parse(s).unwrap_or(Period::Month)
}

/// One window. Half-open, as the core builds it: `start` is in, `end` is not.
#[derive(Debug, Clone, PartialEq)]
pub struct WindowView {
    pub start: String,
    /// The first day **after** the window.
    pub end: String,
    /// The last day in it, which is what a screen shows and what a trend
    /// counting backwards has to start from.
    pub last: String,
    /// How many days long, so a daily trend can cover exactly the window.
    pub days: u32,
}

/// The window of `period` containing `anchor`.
///
/// The cycle start comes from the store rather than the caller: it is a setting
/// the user has already made, and a screen passing its own would be a second
/// place for it to be wrong.
#[frb(sync)]
pub fn period_window(anchor: String, period: String) -> WindowView {
    let r = period_range(
        parse_day(&anchor),
        period_of(&period),
        settings_of().cycle_start,
    );
    let last = Civil::from_day_number(r.end.day_number() - 1);
    WindowView {
        start: show_day(r.start),
        end: show_day(r.end),
        last: show_day(last),
        days: (r.end.day_number() - r.start.day_number()).max(0) as u32,
    }
}

/// Move the anchor by whole periods. Negative goes earlier.
#[frb(sync)]
pub fn step_period(anchor: String, period: String, dir: i32) -> String {
    show_day(shift_period(
        parse_day(&anchor),
        period_of(&period),
        dir,
        settings_of().cycle_start,
    ))
}

/// Which of `ids` fall inside the window, in the order given.
///
/// `days_of` is each entry's local calendar day, as everywhere else — the
/// comparison is between calendar days rather than instants, so an entry at
/// 23:50 belongs to the day the phone showed it on.
#[frb(sync)]
pub fn ids_in_period(
    ids: Vec<String>,
    days_of: Vec<String>,
    anchor: String,
    period: String,
) -> Vec<String> {
    let r = period_range(
        parse_day(&anchor),
        period_of(&period),
        settings_of().cycle_start,
    );
    let (lo, hi) = (r.start.day_number(), r.end.day_number());
    let s = store();
    let n = ids.len().min(days_of.len());
    (0..n)
        .filter(|&i| {
            if s.ledger.get(&ids[i]).is_none() {
                return false;
            }
            let d = parse_day(&days_of[i]).day_number();
            d >= lo && d < hi
        })
        .map(|i| ids[i].clone())
        .collect()
}
