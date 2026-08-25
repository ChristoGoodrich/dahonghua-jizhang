//! Daily, weekly and per-category trend series for the charts.
//!
//! Ported from `src/domain/trends.ts`.
//!
//! Every bucket edge here is a calendar day, which is the whole reason this
//! module took a fix before it took a port. The TypeScript built its edges as
//! `today - i * 864e5`, and twenty-four hours is not a day whenever the clocks
//! move — see [`day_series`] for the three separate faults that produced.
//!
//! Like [`crate::stats`], the caller projects each entry onto the local
//! calendar day the platform resolved it to; [`TrendRow`] is what it projects
//! to. Comparing an epoch stamp against a midnight boundary is the mistake this
//! crate keeps finding, so the boundary never appears as an epoch stamp at all.

use crate::civil::Civil;
use crate::entry::Io;

/// One entry, projected onto its local calendar day.
#[derive(Debug, Clone, PartialEq)]
pub struct TrendRow {
    pub io: Option<Io>,
    pub amt: f64,
    pub cat: String,
    pub day: Civil,
    /// `Entry.deletedAt` — a tombstone timestamp, absent while the entry lives.
    pub deleted_at: Option<f64>,
}

/// `entries.filter(d => !d.deletedAt)`.
///
/// A truthiness test, so a tombstone of `0` — or of `NaN` — reads as *not
/// deleted*. The same "falsy means absent" idiom [`crate::store`] reproduces:
/// worth keeping identical rather than tidying into `is_some()`, which would
/// quietly start hiding entries.
fn is_deleted(x: Option<f64>) -> bool {
    matches!(x, Some(v) if v != 0.0 && !v.is_nan())
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrendPoint {
    pub date: Civil,
    pub exp: f64,
    pub inc: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CategoryTrendPoint {
    pub date: Civil,
    pub amt: f64,
}

/// The `n` calendar days ending on `today`, oldest first.
///
/// The TypeScript stepped back through `today - i * 864e5`, which around a
/// daylight-saving transition is wrong in three visibly different ways:
///
/// * Stepping back over a **23-hour day overshoots its midnight**, so that day
///   is skipped outright. A seven-day chart ending the 8th of October in Sydney
///   drew the 1st, 2nd, 3rd, 5th, 6th, 7th and 8th — seven buckets spanning
///   eight days, with the 4th missing from the axis entirely.
/// * Stepping back over a **25-hour day lands an hour late**, so every earlier
///   bucket runs 01:00 to 01:00 and each day's first hour is counted under the
///   day before it — for the whole rest of the window, not just the one day.
/// * A week is not `7 * 864e5` either, so after a transition every historical
///   week began at 23:00 on the Sunday while its label still read Monday.
///
/// Counting in day numbers cannot express any of those.
fn day_series(today: Civil, n: i64) -> impl Iterator<Item = Civil> {
    let base = today.day_number();
    (0..n).rev().map(move |i| Civil::from_day_number(base - i))
}

fn live(rows: &[TrendRow]) -> impl Iterator<Item = &TrendRow> {
    rows.iter().filter(|d| !is_deleted(d.deleted_at))
}

/// Expense and income per day for the `days` days ending on `today`.
pub fn daily_trend(rows: &[TrendRow], days: i64, today: Civil) -> Vec<TrendPoint> {
    day_series(today, days)
        .map(|date| {
            let mut exp = 0.0;
            let mut inc = 0.0;
            for d in live(rows).filter(|d| d.day == date) {
                match d.io {
                    Some(Io::Exp) => exp += d.amt,
                    Some(Io::Inc) => inc += d.amt,
                    _ => {}
                }
            }
            TrendPoint { date, exp, inc }
        })
        .collect()
}

/// The Monday of the week containing `d`.
///
/// The TypeScript spells this `getDay()`, then `day === 0 ? 6 : day - 1` to
/// shift Sunday to the end — which is exactly
/// [`Civil::weekday_monday_first`], so it is that rather than a second copy of
/// the same conditional.
fn start_of_week(d: Civil) -> Civil {
    Civil::from_day_number(d.day_number() - d.weekday_monday_first() as i64)
}

/// Expense and income per week for the `weeks` weeks ending in `today`'s week.
///
/// Each point is labelled with its Monday. Weeks are seven calendar days, not
/// `7 * 864e5`; the difference is a whole hour and it moved the label onto the
/// wrong weekday for every week before a transition.
pub fn weekly_trend(rows: &[TrendRow], weeks: i64, today: Civil) -> Vec<TrendPoint> {
    let this_monday = start_of_week(today).day_number();
    (0..weeks)
        .rev()
        .map(|i| {
            let start = this_monday - i * 7;
            let date = Civil::from_day_number(start);
            let mut exp = 0.0;
            let mut inc = 0.0;
            for d in live(rows) {
                let n = d.day.day_number();
                if n >= start && n < start + 7 {
                    match d.io {
                        Some(Io::Exp) => exp += d.amt,
                        Some(Io::Inc) => inc += d.amt,
                        _ => {}
                    }
                }
            }
            TrendPoint { date, exp, inc }
        })
        .collect()
}

/// One category's daily total for the `days` days ending on `today`.
///
/// Note this sums every direction, income included — the TypeScript filters on
/// `cat` alone. A category used for both is added up rather than netted, which
/// is a real difference from [`daily_trend`] and not an oversight to fix here.
pub fn category_trend(
    rows: &[TrendRow],
    category: &str,
    days: i64,
    today: Civil,
) -> Vec<CategoryTrendPoint> {
    day_series(today, days)
        .map(|date| CategoryTrendPoint {
            date,
            amt: live(rows)
                .filter(|d| d.cat == category && d.day == date)
                .map(|d| d.amt)
                .sum(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(y: i32, m: i32, d: i32, io: Io, amt: f64) -> TrendRow {
        TrendRow {
            io: Some(io),
            amt,
            cat: "food".into(),
            day: Civil::new(y, m, d),
            deleted_at: None,
        }
    }

    #[test]
    fn daily_splits_direction_and_keeps_empty_days() {
        let rows = vec![
            row(2026, 5, 10, Io::Exp, 20.0),
            row(2026, 5, 10, Io::Exp, 30.0),
            row(2026, 5, 11, Io::Inc, 100.0),
            row(2026, 5, 11, Io::Exp, 50.0),
        ];
        let got = daily_trend(&rows, 3, Civil::new(2026, 5, 12));
        assert_eq!(got.len(), 3);
        assert_eq!(
            got[0],
            TrendPoint {
                date: Civil::new(2026, 5, 10),
                exp: 50.0,
                inc: 0.0
            }
        );
        assert_eq!(
            got[1],
            TrendPoint {
                date: Civil::new(2026, 5, 11),
                exp: 50.0,
                inc: 100.0
            }
        );
        assert_eq!(
            got[2],
            TrendPoint {
                date: Civil::new(2026, 5, 12),
                exp: 0.0,
                inc: 0.0
            }
        );
    }

    #[test]
    fn a_series_is_consecutive_across_a_month_end() {
        // the calendar rollover the epoch arithmetic used to get right by luck
        // and the day-number arithmetic gets right by construction. Months are
        // zero-based, as in `new Date(y, m, d)` — so this is the four days
        // ending 2026-03-02, and February 2026 has 28 of them.
        let got = daily_trend(&[], 4, Civil::new(2026, 2, 2));
        let dates: Vec<Civil> = got.iter().map(|p| p.date).collect();
        assert_eq!(
            dates,
            vec![
                Civil::new(2026, 1, 27),
                Civil::new(2026, 1, 28),
                Civil::new(2026, 2, 1),
                Civil::new(2026, 2, 2),
            ]
        );
    }

    #[test]
    fn a_zero_tombstone_is_not_a_tombstone() {
        // `!d.deletedAt` — falsy means absent
        let mut rows = vec![
            row(2026, 5, 10, Io::Exp, 20.0),
            row(2026, 5, 10, Io::Exp, 30.0),
        ];
        rows[0].deleted_at = Some(0.0);
        rows[1].deleted_at = Some(1.0);
        let got = daily_trend(&rows, 1, Civil::new(2026, 5, 10));
        assert_eq!(got[0].exp, 20.0);
    }

    #[test]
    fn a_nan_tombstone_is_not_a_tombstone_either() {
        let mut rows = vec![row(2026, 5, 10, Io::Exp, 20.0)];
        rows[0].deleted_at = Some(f64::NAN);
        assert_eq!(daily_trend(&rows, 1, Civil::new(2026, 5, 10))[0].exp, 20.0);
    }

    #[test]
    fn weeks_are_labelled_with_their_monday() {
        // 2026-06-10 is a Wednesday
        let got = weekly_trend(&[], 3, Civil::new(2026, 5, 10));
        let dates: Vec<Civil> = got.iter().map(|p| p.date).collect();
        assert_eq!(
            dates,
            vec![
                Civil::new(2026, 4, 25),
                Civil::new(2026, 5, 1),
                Civil::new(2026, 5, 8)
            ]
        );
        for d in dates {
            assert_eq!(d.weekday_monday_first(), 0, "{d:?} is not a Monday");
        }
    }

    #[test]
    fn a_sunday_belongs_to_the_week_that_started_six_days_earlier() {
        // the `day === 0 ? 6 : day - 1` branch, which is the one an off-by-one
        // in the weekday helper would land on
        let sunday = Civil::new(2026, 5, 14);
        assert_eq!(sunday.weekday_monday_first(), 6);
        assert_eq!(start_of_week(sunday), Civil::new(2026, 5, 8));
    }

    #[test]
    fn weekly_totals_span_seven_days() {
        let rows = vec![
            row(2026, 5, 8, Io::Exp, 10.0),  // Monday
            row(2026, 5, 14, Io::Inc, 20.0), // the following Sunday
            row(2026, 5, 15, Io::Exp, 99.0), // the next Monday — a different week
        ];
        let got = weekly_trend(&rows, 2, Civil::new(2026, 5, 16));
        assert_eq!(
            got[0],
            TrendPoint {
                date: Civil::new(2026, 5, 8),
                exp: 10.0,
                inc: 20.0
            }
        );
        assert_eq!(
            got[1],
            TrendPoint {
                date: Civil::new(2026, 5, 15),
                exp: 99.0,
                inc: 0.0
            }
        );
    }

    #[test]
    fn category_sums_every_direction() {
        let rows = vec![
            row(2026, 5, 10, Io::Exp, 20.0),
            TrendRow {
                cat: "rent".into(),
                ..row(2026, 5, 10, Io::Exp, 900.0)
            },
            row(2026, 5, 10, Io::Inc, 5.0),
        ];
        let got = category_trend(&rows, "food", 1, Civil::new(2026, 5, 10));
        assert_eq!(got[0].amt, 25.0);
    }

    #[test]
    fn a_non_positive_length_is_an_empty_series() {
        // `for (let i = days - 1; i >= 0; i--)` never runs
        assert!(daily_trend(&[], 0, Civil::new(2026, 5, 10)).is_empty());
        assert!(daily_trend(&[], -3, Civil::new(2026, 5, 10)).is_empty());
        assert!(weekly_trend(&[], 0, Civil::new(2026, 5, 10)).is_empty());
    }
}
