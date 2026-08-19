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
}
