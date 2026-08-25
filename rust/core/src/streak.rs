//! The consecutive-day logging streak.
//!
//! Ported from `src/domain/streak.ts`.
//!
//! The TypeScript walks backwards with `d.setDate(d.getDate() - 1)`, which is
//! calendar arithmetic and so already survives a daylight-saving transition —
//! unlike the four places that were subtracting `864e5`. Day numbers here mean
//! the same thing.

use crate::civil::Civil;

/// How many days in a row have an entry, counting back from `today`.
///
/// Today not being logged yet does **not** break the streak: the count starts
/// from yesterday instead, so opening the app in the morning does not show a
/// zero. Nothing yesterday either and the streak really is over.
pub fn streak_days(days: &[Civil], today: Civil) -> usize {
    let has = |d: Civil| days.contains(&d);
    let mut cursor = today.day_number();
    if !has(Civil::from_day_number(cursor)) {
        cursor -= 1;
        if !has(Civil::from_day_number(cursor)) {
            return 0;
        }
    }
    let mut n = 0;
    while has(Civil::from_day_number(cursor)) {
        n += 1;
        cursor -= 1;
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: i32, day: i32) -> Civil {
        Civil::new(y, m, day)
    }

    #[test]
    fn nothing_logged_is_no_streak() {
        assert_eq!(streak_days(&[], d(2026, 5, 10)), 0);
    }

    #[test]
    fn today_alone_is_one() {
        assert_eq!(streak_days(&[d(2026, 5, 10)], d(2026, 5, 10)), 1);
    }

    #[test]
    fn a_run_ending_today_counts_every_day() {
        let days = vec![d(2026, 5, 8), d(2026, 5, 9), d(2026, 5, 10)];
        assert_eq!(streak_days(&days, d(2026, 5, 10)), 3);
    }

    #[test]
    fn a_gap_ends_the_run() {
        let days = vec![d(2026, 5, 6), d(2026, 5, 8), d(2026, 5, 9), d(2026, 5, 10)];
        assert_eq!(streak_days(&days, d(2026, 5, 10)), 3);
    }

    #[test]
    fn nothing_today_falls_back_to_yesterday() {
        // the morning case: the streak is intact until yesterday lapses too
        let days = vec![d(2026, 5, 8), d(2026, 5, 9)];
        assert_eq!(streak_days(&days, d(2026, 5, 10)), 2);
    }

    #[test]
    fn nothing_today_or_yesterday_is_over() {
        let days = vec![d(2026, 5, 7), d(2026, 5, 8)];
        assert_eq!(streak_days(&days, d(2026, 5, 10)), 0);
    }

    #[test]
    fn a_run_crosses_a_month_end() {
        let days = vec![d(2026, 1, 27), d(2026, 1, 28), d(2026, 2, 1)];
        // February 2026 has 28 days, so the 28th and March 1st are consecutive
        assert_eq!(streak_days(&days, d(2026, 2, 1)), 3);
    }

    #[test]
    fn a_run_crosses_a_year_end() {
        let days = vec![d(2025, 11, 31), d(2026, 0, 1)];
        assert_eq!(streak_days(&days, d(2026, 0, 1)), 2);
    }

    #[test]
    fn future_days_do_not_extend_it() {
        let days = vec![d(2026, 5, 10), d(2026, 5, 11), d(2026, 5, 12)];
        assert_eq!(streak_days(&days, d(2026, 5, 10)), 1);
    }

    #[test]
    fn duplicate_days_count_once() {
        let days = vec![d(2026, 5, 10), d(2026, 5, 10), d(2026, 5, 9)];
        assert_eq!(streak_days(&days, d(2026, 5, 10)), 2);
    }
}
