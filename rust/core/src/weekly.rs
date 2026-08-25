//! The weekly budget: a Sunday-to-Saturday window and what is left in it.
//!
//! Ported from `src/domain/weekly.ts`.
//!
//! Note the week here starts on **Sunday**, where [`crate::trends`] starts its
//! weeks on Monday. Both are deliberate in the TypeScript and neither is a
//! typo: the trend chart's bars are labelled with a Monday, and the weekly
//! budget follows the convention the budget screen was written against.

use crate::civil::Civil;
use crate::entry::{Entry, Io};

/// A Sunday-to-Saturday window. `end` is the **next** Sunday, exclusive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WeekRange {
    pub start: Civil,
    pub end: Civil,
}

/// The Sunday-to-Sunday range containing `day`.
pub fn week_range(day: Civil) -> WeekRange {
    // `getDay()` is Sunday-based; `weekday_monday_first` is not, so the Sunday
    // offset is `(mon + 1) % 7`
    let dow = (day.weekday_monday_first() + 1) % 7;
    let start = day.day_number() - dow as i64;
    WeekRange {
        start: Civil::from_day_number(start),
        end: Civil::from_day_number(start + 7),
    }
}

/// The daily equivalent of a weekly budget.
///
/// A plain division, so a weekly budget of zero gives zero and a `NaN` one
/// gives `NaN` — neither is guarded in the TypeScript and neither is here.
pub fn daily_equivalent(weekly_budget: f64) -> f64 {
    weekly_budget / 7.0
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WeeklyStatus {
    pub spent: f64,
    /// Budget less spend; negative once over.
    pub remaining: f64,
    pub over: bool,
    /// Days left in the week, today included. Never negative.
    pub days_left: i64,
    pub daily_budget: f64,
}

/// One entry, projected onto its local calendar day.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WeekRow {
    pub io: Option<Io>,
    pub amt: f64,
    pub day: Civil,
    /// `Entry.deletedAt` — a tombstone, absent while the entry lives.
    pub deleted: bool,
}

impl WeekRow {
    /// Project an entry onto a day. `deleted` follows the truthiness test the
    /// TypeScript uses, so a tombstone of zero is not a tombstone.
    pub fn of(e: &Entry, day: Civil) -> Self {
        WeekRow {
            io: e.io,
            amt: e.amt,
            day,
            deleted: e.deleted_at.is_some_and(|v| v != 0),
        }
    }
}

/// Spend against the weekly budget for the week containing `today`.
pub fn weekly_status(rows: &[WeekRow], weekly_budget: f64, today: Civil) -> WeeklyStatus {
    let r = week_range(today);
    let spent: f64 = rows
        .iter()
        .filter(|d| d.io == Some(Io::Exp) && !d.deleted && d.day >= r.start && d.day < r.end)
        .map(|d| d.amt)
        .sum();
    WeeklyStatus {
        spent,
        remaining: weekly_budget - spent,
        // `weeklyBudget > 0 && spent > weeklyBudget` — an unset budget is never
        // "over", however much was spent
        over: weekly_budget > 0.0 && spent > weekly_budget,
        // Counted from local midnight to the exclusive end of the week, so
        // the last day of the week reads one rather than zero.
        //
        // The floor is dead code, and provably so: `end` is `start + 7` and
        // `start` is `today` less its weekday, so the difference is always 1
        // through 7. It is kept because the TypeScript has the same
        // `Math.max(0, …)` and removing it on one side only would be a
        // difference for no reason — but an injection removing it diverges on
        // nothing, and that is the right answer rather than a corpus gap.
        days_left: today.days_until(r.end).max(0),
        daily_budget: daily_equivalent(weekly_budget),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(y: i32, m: i32, d: i32, amt: f64) -> WeekRow {
        WeekRow {
            io: Some(Io::Exp),
            amt,
            day: Civil::new(y, m, d),
            deleted: false,
        }
    }

    #[test]
    fn a_week_runs_sunday_to_sunday() {
        // 2026-06-10 is a Wednesday
        let r = week_range(Civil::new(2026, 5, 10));
        assert_eq!(r.start, Civil::new(2026, 5, 7)); // the Sunday before
        assert_eq!(r.end, Civil::new(2026, 5, 14)); // the Sunday after
    }

    #[test]
    fn a_sunday_starts_its_own_week() {
        let r = week_range(Civil::new(2026, 5, 7));
        assert_eq!(r.start, Civil::new(2026, 5, 7));
        assert_eq!(r.end, Civil::new(2026, 5, 14));
    }

    #[test]
    fn a_saturday_ends_its_week() {
        let r = week_range(Civil::new(2026, 5, 13));
        assert_eq!(r.start, Civil::new(2026, 5, 7));
    }

    #[test]
    fn a_week_crosses_a_month_end() {
        let r = week_range(Civil::new(2026, 6, 1));
        assert_eq!(r.start, Civil::new(2026, 5, 28));
        assert_eq!(r.end, Civil::new(2026, 6, 5));
    }

    #[test]
    fn the_daily_equivalent_is_a_seventh() {
        assert_eq!(daily_equivalent(700.0), 100.0);
        assert_eq!(daily_equivalent(0.0), 0.0);
    }

    #[test]
    fn spend_counts_only_this_weeks_expenses() {
        let rows = vec![
            row(2026, 5, 6, 100.0),  // the Saturday before
            row(2026, 5, 7, 10.0),   // Sunday, in
            row(2026, 5, 13, 20.0),  // Saturday, in
            row(2026, 5, 14, 500.0), // the next Sunday, out
        ];
        let s = weekly_status(&rows, 100.0, Civil::new(2026, 5, 10));
        assert_eq!(s.spent, 30.0);
        assert_eq!(s.remaining, 70.0);
        assert!(!s.over);
    }

    #[test]
    fn income_and_deleted_entries_do_not_count() {
        let mut rows = vec![
            row(2026, 5, 10, 10.0),
            row(2026, 5, 10, 20.0),
            row(2026, 5, 10, 40.0),
        ];
        rows[1].io = Some(Io::Inc);
        rows[2].deleted = true;
        assert_eq!(
            weekly_status(&rows, 100.0, Civil::new(2026, 5, 10)).spent,
            10.0
        );
    }

    #[test]
    fn an_unset_budget_is_never_over() {
        let rows = vec![row(2026, 5, 10, 900.0)];
        let s = weekly_status(&rows, 0.0, Civil::new(2026, 5, 10));
        assert!(!s.over);
        assert_eq!(s.remaining, -900.0);
    }

    #[test]
    fn over_is_strict() {
        let rows = vec![row(2026, 5, 10, 100.0)];
        assert!(!weekly_status(&rows, 100.0, Civil::new(2026, 5, 10)).over);
        let rows = vec![row(2026, 5, 10, 100.01)];
        assert!(weekly_status(&rows, 100.0, Civil::new(2026, 5, 10)).over);
    }

    #[test]
    fn days_left_is_never_negative_for_any_day_of_any_week() {
        // the floor can never fire: every day of a week is 1..=7 days from its
        // exclusive end, so this is a proof rather than a spot check
        let base = Civil::new(2026, 5, 7).day_number();
        for k in 0..28 {
            let d = Civil::from_day_number(base + k);
            let n = weekly_status(&[], 0.0, d).days_left;
            assert!((1..=7).contains(&n), "{d:?} gave {n}");
        }
    }

    #[test]
    fn days_left_includes_today_and_stops_at_zero() {
        // Sunday: the whole week is ahead
        assert_eq!(weekly_status(&[], 0.0, Civil::new(2026, 5, 7)).days_left, 7);
        // Wednesday
        assert_eq!(
            weekly_status(&[], 0.0, Civil::new(2026, 5, 10)).days_left,
            4
        );
        // Saturday, the last day
        assert_eq!(
            weekly_status(&[], 0.0, Civil::new(2026, 5, 13)).days_left,
            1
        );
    }
}
