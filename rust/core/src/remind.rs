//! Reminders: a daily nudge, a weekly report, a monthly one.
//!
//! Ported from `src/util/reminder.ts` — the deciding half. Asking for
//! permission and handing a schedule to the operating system is the platform's;
//! what is here is the time format, the three schedules, and the ids that keep
//! them apart.
//!
//! ## The ids are the point
//!
//! The TypeScript calls `cancelAllScheduledNotificationsAsync()` before
//! scheduling the daily reminder — and *only* before that one. So turning the
//! daily reminder on silently cancels the weekly and the monthly report, and
//! nothing says so. Whether it happens depends on the order the user toggles
//! three unrelated switches.
//!
//! That is not reproduced. It is not a behaviour anybody chose and there is
//! nothing downstream depending on it: every schedule has a stable id here, so
//! one can be replaced or cancelled without touching the others. The port is
//! allowed to be better than its source when the difference is a defect rather
//! than a decision — and this file says which it thought this was.
//!
//! The **text** of a notification is not here. A title and a body are locale
//! strings, and this crate has said since `money.rs` that ICU text belongs to
//! the UI.

use crate::civil::Civil;

/// Which reminder. Each has an id the platform schedules under, so replacing
/// one leaves the others alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reminder {
    /// A nudge to record something, at a time the user picks.
    Daily,
    /// The week's spending, Sunday evening.
    Weekly,
    /// Last month's spending, on the 1st.
    Monthly,
}

impl Reminder {
    /// Stable, and stable is the whole reason they exist. A changed id would
    /// orphan whatever the OS already has scheduled under the old one, leaving
    /// a notification nothing in the app can cancel.
    pub fn id(self) -> i32 {
        match self {
            Reminder::Daily => 1,
            Reminder::Weekly => 2,
            Reminder::Monthly => 3,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Reminder::Daily => "daily",
            Reminder::Weekly => "weekly",
            Reminder::Monthly => "monthly",
        }
    }

    pub const ALL: [Reminder; 3] = [Reminder::Daily, Reminder::Weekly, Reminder::Monthly];
}

/// When one reminder fires.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Schedule {
    pub id: i32,
    /// `daily`, `weekly` or `monthly`.
    pub kind: &'static str,
    pub hour: u32,
    pub minute: u32,
    /// 1 = Sunday, matching the platform's own numbering. Only for `weekly`.
    pub weekday: Option<u32>,
    /// Day of month. Only for `monthly`.
    pub day: Option<u32>,
}

/// Parse `HH:MM`, or `None`.
///
/// `^([01]?\d|2[0-3]):([0-5]\d)$` on the TypeScript side, reproduced exactly
/// rather than loosened: a single-digit hour is allowed (`9:05`) and a
/// single-digit minute is not (`9:5`), which looks arbitrary until you notice
/// that `9:5` is ambiguous between 9:05 and 9:50 and the stricter half is the
/// one that matters.
pub fn parse_time(s: &str) -> Option<(u32, u32)> {
    let s = s.trim();
    let (h, m) = s.split_once(':')?;

    // One or two digits for the hour, exactly two for the minute.
    if h.is_empty() || h.len() > 2 || m.len() != 2 {
        return None;
    }
    if !h.bytes().all(|b| b.is_ascii_digit()) || !m.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let hour: u32 = h.parse().ok()?;
    let minute: u32 = m.parse().ok()?;
    (hour <= 23 && minute <= 59).then_some((hour, minute))
}

/// The daily nudge, at the time the user chose.
pub fn daily(hour: u32, minute: u32) -> Option<Schedule> {
    (hour <= 23 && minute <= 59).then_some(Schedule {
        id: Reminder::Daily.id(),
        kind: "daily",
        hour,
        minute,
        weekday: None,
        day: None,
    })
}

/// The weekly report: Sunday at 20:00.
///
/// Sunday because a week's spending is worth seeing before the next one starts,
/// and eight because a report nobody is awake for is not a report.
pub fn weekly() -> Schedule {
    Schedule {
        id: Reminder::Weekly.id(),
        kind: "weekly",
        hour: 20,
        minute: 0,
        weekday: Some(1), // the platform numbers Sunday as 1
        day: None,
    }
}

/// The monthly report: the 1st at 09:00.
pub fn monthly() -> Schedule {
    Schedule {
        id: Reminder::Monthly.id(),
        kind: "monthly",
        hour: 9,
        minute: 0,
        weekday: None,
        day: Some(1),
    }
}

/// The next 1st of a month strictly after `today`.
///
/// Used where a platform can only schedule a one-shot date rather than a
/// repeating monthly rule. December rolls the year, which `Civil::new` handles
/// by construction — month 12 is January of the next year.
pub fn next_monthly_after(today: Civil) -> Civil {
    Civil::new(today.y, today.m + 1, 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_time_parses() {
        assert_eq!(parse_time("09:30"), Some((9, 30)));
        assert_eq!(parse_time("23:59"), Some((23, 59)));
        assert_eq!(parse_time("00:00"), Some((0, 0)));
    }

    #[test]
    fn a_single_digit_hour_is_allowed() {
        assert_eq!(parse_time("9:05"), Some((9, 5)));
    }

    /// `9:5` is ambiguous between 9:05 and 9:50, and the pattern refuses it.
    #[test]
    fn a_single_digit_minute_is_not() {
        assert_eq!(parse_time("9:5"), None);
    }

    #[test]
    fn surrounding_space_is_trimmed() {
        assert_eq!(parse_time("  08:15  "), Some((8, 15)));
    }

    #[test]
    fn an_hour_past_the_day_is_refused() {
        assert_eq!(parse_time("24:00"), None);
        assert_eq!(parse_time("99:00"), None);
    }

    #[test]
    fn a_minute_past_the_hour_is_refused() {
        assert_eq!(parse_time("10:60"), None);
        assert_eq!(parse_time("10:99"), None);
    }

    #[test]
    fn nonsense_is_refused_rather_than_guessed_at() {
        for s in ["", ":", "10", "10:", ":30", "ab:cd", "1:2:3", "１０:３０"] {
            assert_eq!(parse_time(s), None, "{s:?} should not parse");
        }
    }

    #[test]
    fn the_three_reminders_have_distinct_ids() {
        let ids: Vec<i32> = Reminder::ALL.iter().map(|r| r.id()).collect();
        assert_eq!(ids, vec![1, 2, 3]);
    }

    /// The bug this port does not reproduce: replacing one must leave the
    /// others alone, and distinct ids are what make that possible.
    #[test]
    fn the_daily_reminder_does_not_share_an_id_with_a_report() {
        assert_ne!(Reminder::Daily.id(), Reminder::Weekly.id());
        assert_ne!(Reminder::Daily.id(), Reminder::Monthly.id());
    }

    #[test]
    fn a_daily_schedule_carries_the_time_it_was_given() {
        let s = daily(7, 45).expect("valid");
        assert_eq!((s.hour, s.minute), (7, 45));
        assert_eq!(s.kind, "daily");
        assert_eq!(s.weekday, None);
    }

    #[test]
    fn a_daily_schedule_refuses_a_time_that_is_not_one() {
        assert!(daily(24, 0).is_none());
        assert!(daily(0, 60).is_none());
    }

    #[test]
    fn the_weekly_report_is_sunday_evening() {
        let s = weekly();
        assert_eq!(s.weekday, Some(1));
        assert_eq!((s.hour, s.minute), (20, 0));
    }

    #[test]
    fn the_monthly_report_is_the_first_at_nine() {
        let s = monthly();
        assert_eq!(s.day, Some(1));
        assert_eq!((s.hour, s.minute), (9, 0));
    }

    #[test]
    fn the_next_first_is_next_month() {
        // month is 0-based: 7 is August.
        assert_eq!(
            next_monthly_after(Civil::new(2026, 7, 15)),
            Civil::new(2026, 8, 1)
        );
    }

    #[test]
    fn the_next_first_from_the_first_is_still_next_month() {
        assert_eq!(
            next_monthly_after(Civil::new(2026, 7, 1)),
            Civil::new(2026, 8, 1)
        );
    }

    #[test]
    fn december_rolls_the_year() {
        assert_eq!(
            next_monthly_after(Civil::new(2026, 11, 20)),
            Civil::new(2027, 0, 1)
        );
    }
}
