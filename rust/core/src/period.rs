//! Time-dimension windows: day / week / month / half-year / year.
//!
//! Ported from the window half of `src/domain/period.ts`. `month` defers to the
//! custom accounting cycle; the rest use calendar boundaries, and the week runs
//! Monday to Sunday.
//!
//! Two parts of that file are deliberately left behind:
//!
//! * `entriesInPeriod` and `periodTrend` compare entry timestamps against the
//!   window, which needs both an entry model and the epoch-to-local conversion
//!   that `civil.rs` keeps outside the crate. They arrive with the store port.
//! * `periodLabel` and `bucketLabel` render month names through
//!   `toLocaleDateString`, which is ICU text for the UI to produce — the same
//!   reason `curOf`/`setDisplaySymbol` stayed behind in `money.rs`. They already
//!   pass an explicit locale, so unlike `fmtNum` they carry no device-locale
//!   bug to fix first.

use crate::civil::Civil;
use crate::cycle::{cycle_range, shift_cycle, CycleRange};
use crate::entry::Io;
use crate::stats::DatedRow;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Period {
    Day,
    Week,
    Month,
    HalfYear,
    Year,
}

impl Period {
    /// Order shown in the stats picker.
    pub const ALL: [Period; 5] = [
        Period::Day,
        Period::Week,
        Period::Month,
        Period::HalfYear,
        Period::Year,
    ];

    /// The wire name, matching the TypeScript union.
    pub fn as_str(self) -> &'static str {
        match self {
            Period::Day => "day",
            Period::Week => "week",
            Period::Month => "month",
            Period::HalfYear => "halfyear",
            Period::Year => "year",
        }
    }

    pub fn parse(s: &str) -> Option<Period> {
        Some(match s {
            "day" => Period::Day,
            "week" => Period::Week,
            "month" => Period::Month,
            "halfyear" => Period::HalfYear,
            "year" => Period::Year,
            _ => return None,
        })
    }
}

/// The window of `period` containing `anchor`. Half-open: start inclusive,
/// end exclusive.
pub fn period_range(anchor: Civil, period: Period, cycle_start: i32) -> CycleRange {
    match period {
        Period::Day => {
            let start = anchor;
            CycleRange {
                start,
                end: Civil::new(start.y, start.m, start.d + 1),
            }
        }
        Period::Week => {
            // Monday-first, matching `(getDay() + 6) % 7` on the TS side
            let dow = anchor.weekday_monday_first();
            let start = Civil::new(anchor.y, anchor.m, anchor.d - dow);
            CycleRange {
                start,
                end: Civil::new(start.y, start.m, start.d + 7),
            }
        }
        Period::Month => cycle_range(anchor, cycle_start),
        Period::HalfYear => {
            let h = if anchor.m < 6 { 0 } else { 6 };
            CycleRange {
                start: Civil::new(anchor.y, h, 1),
                end: Civil::new(anchor.y, h + 6, 1),
            }
        }
        Period::Year => CycleRange {
            start: Civil::new(anchor.y, 0, 1),
            end: Civil::new(anchor.y + 1, 0, 1),
        },
    }
}

/// Move `anchor` by `dir` whole periods; negative goes earlier.
///
/// `Month` passes the **anchor** to `shift_cycle` while the other arms work
/// from the window start. That asymmetry mirrors the TypeScript and looks like
/// something to tidy up, but the two are equivalent: `shift_cycle` re-derives
/// the window itself, and the start always lies inside the anchor's own window,
/// so it derives the same one. Swapping `anchor` for `start` here produces
/// identical output across all 12,108 corpus cases, overflowing cycle starts
/// included — checked, rather than assumed.
pub fn shift_period(anchor: Civil, period: Period, dir: i32, cycle_start: i32) -> Civil {
    let start = period_range(anchor, period, cycle_start).start;
    match period {
        Period::Day => Civil::new(start.y, start.m, start.d + dir),
        Period::Week => Civil::new(start.y, start.m, start.d + dir * 7),
        Period::Month => shift_cycle(anchor, dir, cycle_start),
        Period::HalfYear => Civil::new(start.y, start.m + dir * 6, 1),
        Period::Year => Civil::new(start.y + dir, 0, 1),
    }
}

// ---------------------------------------------------------------------------
// What the stats screen draws across a window.
// ---------------------------------------------------------------------------

/// One window of [`period_trend`]: where it starts, and what it came to.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PeriodBucket {
    pub start: Civil,
    pub total: f64,
}

/// The six windows ending with `anchor`'s, oldest first, and what `io` came
/// to in each — 近6期.
///
/// `periodTrend` from `src/domain/period.ts`. The header of this module said
/// it would arrive with the store port; the store port came and it did not,
/// and the Flutter stats screen went without the chart it fed. The shape is
/// the TypeScript's: step the anchor back `i` windows, take that window, sum
/// what falls in it. The comparison is between calendar days rather than
/// epoch stamps, for the reason every other window in this crate is — a
/// midnight compared as an instant is an hour out twice a year.
pub fn period_trend(
    rows: &[DatedRow],
    anchor: Civil,
    period: Period,
    cycle_start: i32,
    io: Io,
) -> Vec<PeriodBucket> {
    (0..6)
        .rev()
        .map(|i| {
            let a = shift_period(anchor, period, -i, cycle_start);
            let r = period_range(a, period, cycle_start);
            let total = rows
                .iter()
                .filter(|x| x.io == Some(io) && x.day >= r.start && x.day < r.end)
                .map(|x| x.amt)
                .sum();
            PeriodBucket {
                start: r.start,
                total,
            }
        })
        .collect()
}

/// Whether a trend is drawn a point per day or a point per week.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Grain {
    Daily,
    Weekly,
}

/// The span a window's trend chart covers, and at what grain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrendAxis {
    /// The first day a row may be counted from.
    pub from: Civil,
    /// The last day drawn.
    pub end: Civil,
    /// How many points.
    pub len: i64,
    pub grain: Grain,
}

/// What a window's trend chart covers.
///
/// Three decisions, each of which the screen used to make for itself or not
/// at all:
///
/// * **A window still under way stops at today.** A chart that ran to the end
///   of the month would end in a flat tail of days that have not happened,
///   and a flat tail reads as spending having stopped. A window entirely past
///   or entirely ahead is drawn whole — there is nothing to stop at.
/// * **A day is not a trend.** One point draws nothing, so the day window is
///   charted as the week leading up to it, which is what the shipping app's
///   近7天 chart was.
/// * **Half a year of days is noise.** 180 daily points on a phone-width
///   chart are a hairbrush, so the long windows go weekly. The weeks are
///   Monday-based, and the first can start before the window does — `from`
///   is the window's own start so that week counts only the days inside it,
///   and the chart agrees with the totals above it.
pub fn trend_axis(anchor: Civil, period: Period, cycle_start: i32, today: Civil) -> TrendAxis {
    let r = period_range(anchor, period, cycle_start);
    if period == Period::Day {
        return TrendAxis {
            from: Civil::from_day_number(r.start.day_number() - 6),
            end: r.start,
            len: 7,
            grain: Grain::Daily,
        };
    }
    let last = Civil::from_day_number(r.end.day_number() - 1);
    let end = if today >= r.start && today <= last {
        today
    } else {
        last
    };
    match period {
        Period::HalfYear | Period::Year => {
            let monday = |d: Civil| d.day_number() - d.weekday_monday_first() as i64;
            TrendAxis {
                from: r.start,
                end,
                len: (monday(end) - monday(r.start)) / 7 + 1,
                grain: Grain::Weekly,
            }
        }
        _ => TrendAxis {
            from: r.start,
            end,
            len: r.start.days_until(end) + 1,
            grain: Grain::Daily,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(y: i32, m: i32, d: i32) -> Civil {
        Civil::new(y, m, d)
    }

    #[test]
    fn a_day_window_is_one_day() {
        let r = period_range(c(2026, 7, 19), Period::Day, 1);
        assert_eq!(r.start, c(2026, 7, 19));
        assert_eq!(r.end, c(2026, 7, 20));
    }

    #[test]
    fn a_day_window_at_a_month_end_rolls_over() {
        let r = period_range(c(2026, 0, 31), Period::Day, 1);
        assert_eq!(r.end, c(2026, 1, 1));
    }

    #[test]
    fn a_week_runs_monday_to_sunday() {
        // 2026-08-19 is a Wednesday
        let r = period_range(c(2026, 7, 19), Period::Week, 1);
        assert_eq!(r.start, c(2026, 7, 17)); // Monday
        assert_eq!(r.end, c(2026, 7, 24)); // the next Monday
    }

    #[test]
    fn a_sunday_belongs_to_the_week_that_started_six_days_earlier() {
        // 2026-08-23 is a Sunday
        let r = period_range(c(2026, 7, 23), Period::Week, 1);
        assert_eq!(r.start, c(2026, 7, 17));
        assert_eq!(r.end, c(2026, 7, 24));
    }

    #[test]
    fn a_week_spanning_a_year_end_walks_back_into_december() {
        // 2027-01-01 is a Friday
        let r = period_range(c(2027, 0, 1), Period::Week, 1);
        assert_eq!(r.start, c(2026, 11, 28));
        assert_eq!(r.end, c(2027, 0, 4));
    }

    #[test]
    fn a_month_window_defers_to_the_accounting_cycle() {
        assert_eq!(
            period_range(c(2026, 7, 19), Period::Month, 25),
            cycle_range(c(2026, 7, 19), 25)
        );
    }

    #[test]
    fn half_years_split_at_july() {
        let first = period_range(c(2026, 2, 15), Period::HalfYear, 1);
        assert_eq!(first.start, c(2026, 0, 1));
        assert_eq!(first.end, c(2026, 6, 1));

        let second = period_range(c(2026, 8, 15), Period::HalfYear, 1);
        assert_eq!(second.start, c(2026, 6, 1));
        assert_eq!(second.end, c(2027, 0, 1));
    }

    #[test]
    fn june_is_the_first_half_and_july_the_second() {
        assert_eq!(
            period_range(c(2026, 5, 30), Period::HalfYear, 1).start,
            c(2026, 0, 1)
        );
        assert_eq!(
            period_range(c(2026, 6, 1), Period::HalfYear, 1).start,
            c(2026, 6, 1)
        );
    }

    #[test]
    fn a_year_window_is_january_to_january() {
        let r = period_range(c(2026, 7, 19), Period::Year, 1);
        assert_eq!(r.start, c(2026, 0, 1));
        assert_eq!(r.end, c(2027, 0, 1));
    }

    #[test]
    fn shifting_days() {
        assert_eq!(
            shift_period(c(2026, 7, 19), Period::Day, -1, 1),
            c(2026, 7, 18)
        );
        assert_eq!(
            shift_period(c(2026, 7, 19), Period::Day, 1, 1),
            c(2026, 7, 20)
        );
        assert_eq!(
            shift_period(c(2026, 0, 1), Period::Day, -1, 1),
            c(2025, 11, 31)
        );
    }

    #[test]
    fn shifting_weeks_moves_whole_weeks_from_the_monday() {
        assert_eq!(
            shift_period(c(2026, 7, 19), Period::Week, -1, 1),
            c(2026, 7, 10)
        );
        assert_eq!(
            shift_period(c(2026, 7, 19), Period::Week, 1, 1),
            c(2026, 7, 24)
        );
        assert_eq!(
            shift_period(c(2026, 7, 19), Period::Week, 0, 1),
            c(2026, 7, 17)
        );
    }

    #[test]
    fn shifting_a_month_goes_through_the_cycle_from_the_anchor() {
        assert_eq!(
            shift_period(c(2026, 7, 19), Period::Month, -1, 25),
            shift_cycle(c(2026, 7, 19), -1, 25)
        );
    }

    #[test]
    fn shifting_half_years() {
        assert_eq!(
            shift_period(c(2026, 2, 15), Period::HalfYear, 1, 1),
            c(2026, 6, 1)
        );
        assert_eq!(
            shift_period(c(2026, 2, 15), Period::HalfYear, -1, 1),
            c(2025, 6, 1)
        );
        assert_eq!(
            shift_period(c(2026, 8, 15), Period::HalfYear, 1, 1),
            c(2027, 0, 1)
        );
    }

    #[test]
    fn shifting_years() {
        assert_eq!(
            shift_period(c(2026, 7, 19), Period::Year, -2, 1),
            c(2024, 0, 1)
        );
        assert_eq!(
            shift_period(c(2026, 7, 19), Period::Year, 3, 1),
            c(2029, 0, 1)
        );
    }

    #[test]
    fn period_names_round_trip() {
        for p in Period::ALL {
            assert_eq!(Period::parse(p.as_str()), Some(p));
        }
        assert_eq!(Period::parse("fortnight"), None);
    }

    // ---- what the stats screen draws across a window ----

    fn dated(y: i32, m: i32, d: i32, io: Io, amt: f64) -> DatedRow {
        DatedRow {
            io: Some(io),
            amt,
            day: c(y, m, d),
        }
    }

    #[test]
    fn six_windows_oldest_first_ending_with_the_anchors() {
        let rows = vec![
            dated(2026, 8, 3, Io::Exp, 10.0),
            dated(2026, 8, 30, Io::Exp, 5.0),
            dated(2026, 7, 15, Io::Exp, 20.0),
            dated(2026, 3, 1, Io::Exp, 7.0),
            // outside all six, and the wrong direction
            dated(2026, 2, 28, Io::Exp, 1000.0),
            dated(2026, 8, 4, Io::Inc, 1000.0),
        ];
        let t = period_trend(&rows, c(2026, 8, 20), Period::Month, 1, Io::Exp);
        assert_eq!(t.len(), 6);
        assert_eq!(t[0].start, c(2026, 3, 1));
        assert_eq!(t[5].start, c(2026, 8, 1));
        let totals: Vec<f64> = t.iter().map(|b| b.total).collect();
        assert_eq!(totals, vec![7.0, 0.0, 0.0, 0.0, 20.0, 15.0]);
    }

    /// A month is the accounting cycle here as everywhere, so a ledger that
    /// turns over on the 15th buckets from the 15th.
    #[test]
    fn a_months_windows_follow_the_cycle() {
        let rows = vec![
            dated(2026, 8, 14, Io::Exp, 1.0),
            dated(2026, 8, 15, Io::Exp, 2.0),
        ];
        let t = period_trend(&rows, c(2026, 8, 20), Period::Month, 15, Io::Exp);
        assert_eq!(t[5].start, c(2026, 8, 15));
        assert_eq!((t[4].total, t[5].total), (1.0, 2.0));
    }

    #[test]
    fn weeks_step_back_seven_days_at_a_time() {
        let t = period_trend(&[], c(2026, 8, 23), Period::Week, 1, Io::Exp);
        for w in t.windows(2) {
            assert_eq!(w[0].start.days_until(w[1].start), 7);
        }
        assert_eq!(t[5].start.weekday_monday_first(), 0, "a Monday");
    }

    #[test]
    fn a_month_under_way_is_charted_to_today() {
        let a = trend_axis(c(2026, 8, 20), Period::Month, 1, c(2026, 8, 20));
        assert_eq!((a.from, a.end, a.len), (c(2026, 8, 1), c(2026, 8, 20), 20));
        assert_eq!(a.grain, Grain::Daily);
    }

    #[test]
    fn a_month_past_or_ahead_is_charted_whole() {
        let past = trend_axis(c(2026, 7, 10), Period::Month, 1, c(2026, 8, 20));
        assert_eq!((past.end, past.len), (c(2026, 7, 31), 31));
        let ahead = trend_axis(c(2026, 10, 10), Period::Month, 1, c(2026, 8, 20));
        assert_eq!((ahead.end, ahead.len), (c(2026, 10, 30), 30));
        // and the last day itself is "under way" and whole at once
        let last = trend_axis(c(2026, 7, 10), Period::Month, 1, c(2026, 7, 31));
        assert_eq!(last.len, 31);
    }

    #[test]
    fn a_day_is_charted_as_the_week_up_to_it() {
        let a = trend_axis(c(2026, 8, 20), Period::Day, 1, c(2026, 8, 20));
        assert_eq!((a.from, a.end, a.len), (c(2026, 8, 14), c(2026, 8, 20), 7));
        assert_eq!(a.from.days_until(a.end) + 1, a.len);
    }

    /// 2026-01-01 is a Thursday, so the year's first week starts in 2025 —
    /// and `from` holds it to the year, so those three days are not counted.
    #[test]
    fn a_year_goes_weekly_and_starts_where_the_year_does() {
        let a = trend_axis(c(2026, 8, 20), Period::Year, 1, c(2026, 8, 20));
        assert_eq!(a.grain, Grain::Weekly);
        assert_eq!(a.from, c(2026, 0, 1));
        assert_eq!(a.end, c(2026, 8, 20));
        // Monday 2025-12-29 to Monday 2026-09-14 is 37 weeks apart
        assert_eq!(a.len, 38);
        let whole = trend_axis(c(2025, 5, 1), Period::Year, 1, c(2026, 8, 20));
        assert_eq!(whole.end, c(2025, 11, 31));
        assert!(whole.len == 53 || whole.len == 52, "{}", whole.len);
    }

    #[test]
    fn a_half_year_goes_weekly_too() {
        let a = trend_axis(c(2026, 2, 5), Period::HalfYear, 1, c(2026, 8, 20));
        assert_eq!(a.grain, Grain::Weekly);
        assert_eq!((a.from, a.end), (c(2026, 0, 1), c(2026, 5, 30)));
    }
}
