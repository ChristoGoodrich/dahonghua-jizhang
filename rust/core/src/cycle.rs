//! Custom accounting-cycle maths — a month-long window that can start on any
//! day, so somebody paid on the 25th can budget from the 25th.
//!
//! Ported from `src/domain/cycle.ts`. Every operation there reads and writes
//! only y/m/d, so this is a faithful port onto `Civil` with no timezone in
//! sight — see `civil.rs` for where that line is drawn and why.
//!
//! Two behaviours are inherited rather than designed, and both are load-bearing:
//!
//! * A cycle start of 0 means 1. The TypeScript writes `cycleStart || 1`, and
//!   an unset setting arrives as 0.
//! * A start day past the end of a month **overflows** instead of clamping,
//!   because `new Date(y, m, 31)` does. A cycle starting on the 31st runs from
//!   1 March in a non-leap year, not from 28 February.

use crate::civil::Civil;

/// Half-open window: `start` inclusive, `end` exclusive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CycleRange {
    pub start: Civil,
    pub end: Civil,
}

fn start_day(cycle_start: i32) -> i32 {
    if cycle_start == 0 {
        1
    } else {
        cycle_start
    }
}

/// The cycle window containing `anchor`.
pub fn cycle_range(anchor: Civil, cycle_start: i32) -> CycleRange {
    let cs = start_day(cycle_start);
    let mut start = Civil::new(anchor.y, anchor.m, cs);
    if anchor.d < cs {
        start = Civil::new(anchor.y, anchor.m - 1, cs);
    }
    // built from the *normalised* start, exactly as the TypeScript does — the
    // overflow above can have moved it into the following month, and the end
    // has to follow it there
    let end = Civil::new(start.y, start.m + 1, cs);
    CycleRange { start, end }
}

/// Does `date` fall inside the cycle containing `anchor`?
pub fn in_cycle(date: Civil, anchor: Civil, cycle_start: i32) -> bool {
    let r = cycle_range(anchor, cycle_start);
    date >= r.start && date < r.end
}

/// Move `anchor` by `dir` whole cycles.
pub fn shift_cycle(anchor: Civil, dir: i32, cycle_start: i32) -> Civil {
    let r = cycle_range(anchor, cycle_start);
    Civil::new(r.start.y, r.start.m + dir, start_day(cycle_start))
}

/// Whole days in the cycle containing `anchor` (28..=31).
pub fn cycle_days(anchor: Civil, cycle_start: i32) -> i64 {
    let r = cycle_range(anchor, cycle_start);
    r.start.days_until(r.end)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(y: i32, m: i32, d: i32) -> Civil {
        Civil::new(y, m, d)
    }

    #[test]
    fn a_calendar_month_is_the_default() {
        let r = cycle_range(c(2026, 7, 19), 1);
        assert_eq!(r.start, c(2026, 7, 1));
        assert_eq!(r.end, c(2026, 8, 1));
    }

    #[test]
    fn an_unset_start_day_means_the_first() {
        assert_eq!(
            cycle_range(c(2026, 7, 19), 0),
            cycle_range(c(2026, 7, 19), 1)
        );
    }

    #[test]
    fn a_payday_cycle_runs_from_the_previous_month_before_the_start_day() {
        // the 19th is before payday on the 25th, so we are still in the window
        // that opened last month
        let r = cycle_range(c(2026, 7, 19), 25);
        assert_eq!(r.start, c(2026, 6, 25));
        assert_eq!(r.end, c(2026, 7, 25));
    }

    #[test]
    fn on_the_start_day_the_new_cycle_has_already_opened() {
        let r = cycle_range(c(2026, 7, 25), 25);
        assert_eq!(r.start, c(2026, 7, 25));
        assert_eq!(r.end, c(2026, 8, 25));
    }

    #[test]
    fn a_cycle_spanning_new_year_walks_back_into_december() {
        let r = cycle_range(c(2026, 0, 10), 25);
        assert_eq!(r.start, c(2025, 11, 25));
        assert_eq!(r.end, c(2026, 0, 25));
    }

    #[test]
    fn a_start_day_past_the_end_of_the_month_overflows_like_new_date() {
        // 31 February 2026 is 3 March; inherited from `new Date(y, 1, 31)`
        let r = cycle_range(c(2026, 1, 15), 31);
        assert_eq!(r.start, c(2026, 0, 31));
        assert_eq!(r.end, c(2026, 1, 31)); // = 3 March
        assert_eq!(r.end, c(2026, 2, 3));
    }

    #[test]
    fn membership_is_half_open() {
        let anchor = c(2026, 7, 10);
        assert!(in_cycle(c(2026, 7, 1), anchor, 1)); // first day, in
        assert!(in_cycle(c(2026, 7, 31), anchor, 1)); // last day, in
        assert!(!in_cycle(c(2026, 8, 1), anchor, 1)); // next start, out
        assert!(!in_cycle(c(2026, 6, 31), anchor, 1)); // day before, out
    }

    #[test]
    fn shifting_moves_whole_cycles_in_both_directions() {
        assert_eq!(shift_cycle(c(2026, 7, 19), -1, 1), c(2026, 6, 1));
        assert_eq!(shift_cycle(c(2026, 7, 19), 1, 1), c(2026, 8, 1));
        assert_eq!(shift_cycle(c(2026, 7, 19), 0, 1), c(2026, 7, 1));
        assert_eq!(shift_cycle(c(2026, 0, 5), -1, 1), c(2025, 11, 1));
    }

    #[test]
    fn shifting_a_payday_cycle_keeps_the_start_day() {
        assert_eq!(shift_cycle(c(2026, 7, 19), 1, 25), c(2026, 7, 25));
        assert_eq!(shift_cycle(c(2026, 7, 26), -1, 25), c(2026, 6, 25));
    }

    #[test]
    fn cycle_length_follows_the_month_it_opens_in() {
        assert_eq!(cycle_days(c(2026, 0, 5), 1), 31); // January
        assert_eq!(cycle_days(c(2026, 1, 5), 1), 28); // February
        assert_eq!(cycle_days(c(2024, 1, 5), 1), 29); // February, leap
        assert_eq!(cycle_days(c(2026, 3, 5), 1), 30); // April
    }

    #[test]
    fn a_payday_cycle_spans_two_months_worth_of_days() {
        // 25 Jan to 25 Feb is 31 days
        assert_eq!(cycle_days(c(2026, 1, 10), 25), 31);
        // 25 Feb to 25 Mar is 28 days
        assert_eq!(cycle_days(c(2026, 2, 10), 25), 28);
    }
}
