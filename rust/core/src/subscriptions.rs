//! The subscription auto-charge engine: when is a recurring charge due, and
//! which ones were missed while the app was closed.
//!
//! Ported from `src/domain/subscriptions.ts`, onto [`Civil`] rather than epoch
//! milliseconds. That is the same boundary `civil.rs` draws everywhere else —
//! but here it was not merely tidier, it fixed a bug.
//!
//! The TypeScript advanced its cursor with `cursor.getTime() + 864e5`: twenty-
//! four hours, not a calendar day. On a spring-forward day those differ, and
//! the result landed at 01:00 rather than midnight. `nextDueDate` then read the
//! following day as already begun, so a subscription due the day after the
//! transition lost the comparison against its own due date and was pushed a
//! whole month — one charge silently never recorded. In Sydney 2026 a
//! subscription due on the 5th skipped October.
//!
//! The TypeScript now advances by a calendar day too, and carries a regression
//! test that fails against the old arithmetic. Both sides mean the same thing,
//! which is why they can be compared at all.
//!
//! Charges come back as civil dates. Turning one into the epoch millisecond an
//! entry is stamped with needs a timezone, which stays outside this crate.

use crate::civil::Civil;
use crate::model::{Sub, SubFreq};

/// The next charge date at or after `from`.
///
/// Day-of-month overflow is inherited from `new Date(y, m, d)`: a subscription
/// set to the 31st rolls into the following month wherever the month is
/// shorter, rather than clamping to the 30th. See [`Civil::new`].
pub fn next_due_date(sub: &Sub, from: Civil) -> Civil {
    if sub.freq == SubFreq::Yearly {
        // `(sub.month || 1) - 1` — month is 1-based on the Sub and 0-based in
        // the calendar, and an unset or zero month means January
        let mo = sub.month.filter(|m| *m != 0).unwrap_or(1) as i32 - 1;
        let d = Civil::new(from.y, mo, sub.day as i32);
        return if d < from {
            Civil::new(from.y + 1, mo, sub.day as i32)
        } else {
            d
        };
    }
    let d = Civil::new(from.y, from.m, sub.day as i32);
    if d < from {
        Civil::new(from.y, from.m + 1, sub.day as i32)
    } else {
        d
    }
}

/// v7's cursor encoding: `YYYY-M-D` with a **0-indexed** month.
///
/// Kept exactly, because it is written into stored subscriptions and read back
/// on the next launch. A tidier format would orphan every existing cursor.
pub fn encode_cursor(d: Civil) -> String {
    format!("{}-{}-{}", d.y, d.m, d.d)
}

/// Parse a stored cursor. `None` for anything that is not three numbers.
pub fn decode_cursor(s: &str) -> Option<Civil> {
    let mut parts = s.split('-');
    let y = parts.next()?.parse().ok()?;
    let m = parts.next()?.parse().ok()?;
    let d = parts.next()?.parse().ok()?;
    Some(Civil::new(y, m, d))
}

#[derive(Debug, Clone, PartialEq)]
pub struct DueResult {
    /// Charge dates to log, oldest first.
    pub charges: Vec<Civil>,
    /// The updated cursor for the subscription.
    pub last_charged: String,
}

/// The guard on the catch-up loop. A subscription untouched for a decade would
/// otherwise walk a hundred and twenty months one at a time; past that the
/// remaining history is not worth reconstructing.
const MAX_CATCH_UP: usize = 120;

/// Every charge from the subscription's cursor up to and including `today`.
///
/// `created_fallback` is where to start when the subscription has no cursor
/// yet — the TypeScript uses `sub.created`, falling back to the current time,
/// and both of those are clocks.
pub fn due_charges(sub: &Sub, today: Civil, created_fallback: Civil) -> DueResult {
    let mut cursor = sub
        .last_charged
        .as_deref()
        .filter(|s| !s.is_empty())
        .and_then(decode_cursor)
        .unwrap_or(created_fallback);

    let mut charges = Vec::new();
    // `sub.lastCharged ?? encode(cursor)` — nullish, not truthy. The cursor
    // above uses `if (sub.lastCharged)` and so treats an empty string as
    // missing, but this one keeps it. Two different truthiness tests on the
    // same field, three lines apart; conflating them is what the corpus caught.
    let mut last_charged = sub
        .last_charged
        .clone()
        .unwrap_or_else(|| encode_cursor(cursor));

    for _ in 0..MAX_CATCH_UP {
        // strictly after the cursor, by a calendar day
        let day = Civil::new(cursor.y, cursor.m, cursor.d + 1);
        let due = next_due_date(sub, day);
        if due > today {
            break;
        }
        charges.push(due);
        last_charged = encode_cursor(due);
        cursor = due;
    }

    DueResult {
        charges,
        last_charged,
    }
}

/// How many of `charges` may actually fire, given an instalment cap.
///
/// `periods` absent or zero means an open-ended subscription and everything
/// fires. Otherwise the total number of charges over the subscription's life is
/// capped, and a plan that has already run its course fires nothing — while
/// still advancing its cursor, so the catch-up is not recomputed on every boot.
pub fn allowed_charges(sub: &Sub, charges: usize) -> usize {
    match sub.periods.filter(|p| *p > 0) {
        None => charges,
        Some(periods) => {
            let remaining = periods.saturating_sub(sub.charged.unwrap_or(0)) as usize;
            charges.min(remaining)
        }
    }
}

/// The deterministic id a charge posts under: `sub_<subscription>_<epoch ms>`.
///
/// Deliberately derived rather than random. Boot runs the catch-up before the
/// first cloud pull completes, so a second device charges from its own stale
/// cursor without knowing the first already did. Random ids would leave both
/// rows alive through the merge and bill the user twice; a derived id makes
/// them the same row, which collapses.
pub fn charge_id(sub_id: &str, ts_ms: i64) -> String {
    format!("sub_{sub_id}_{ts_ms}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monthly(day: u32, last: &str) -> Sub {
        Sub {
            id: "s0".into(),
            name: "音乐".into(),
            emoji: "🎵".into(),
            amt: 15.0,
            freq: SubFreq::Monthly,
            day,
            month: None,
            cat: "fun".into(),
            created: 0,
            last_charged: Some(last.to_string()),
            is_transfer: None,
            from: None,
            to: None,
            periods: None,
            charged: None,
        }
    }

    fn yearly(day: u32, month: u32, last: &str) -> Sub {
        Sub {
            freq: SubFreq::Yearly,
            month: Some(month),
            ..monthly(day, last)
        }
    }

    fn c(y: i32, m: i32, d: i32) -> Civil {
        Civil::new(y, m, d)
    }

    #[test]
    fn the_next_charge_is_this_month_when_the_day_has_not_passed() {
        assert_eq!(
            next_due_date(&monthly(15, ""), c(2026, 7, 1)),
            c(2026, 7, 15)
        );
        assert_eq!(
            next_due_date(&monthly(15, ""), c(2026, 7, 15)),
            c(2026, 7, 15)
        );
    }

    #[test]
    fn it_rolls_to_next_month_once_the_day_has_passed() {
        assert_eq!(
            next_due_date(&monthly(15, ""), c(2026, 7, 16)),
            c(2026, 8, 15)
        );
        assert_eq!(
            next_due_date(&monthly(15, ""), c(2026, 11, 16)),
            c(2027, 0, 15)
        );
    }

    #[test]
    fn a_day_past_the_end_of_the_month_overflows_rather_than_clamping() {
        // inherited from new Date(y, m, 31) — February has no 31st
        assert_eq!(
            next_due_date(&monthly(31, ""), c(2026, 1, 1)),
            c(2026, 2, 3)
        );
    }

    #[test]
    fn a_yearly_charge_honours_its_month() {
        // `month` on a Sub is 1-based; the calendar is 0-based, so 6 is June
        assert_eq!(
            next_due_date(&yearly(10, 6, ""), c(2026, 0, 1)),
            c(2026, 5, 10)
        );
        assert_eq!(
            next_due_date(&yearly(10, 6, ""), c(2026, 8, 1)),
            c(2027, 5, 10)
        );
    }

    #[test]
    fn a_yearly_charge_without_a_month_falls_back_to_january() {
        let mut s = yearly(10, 1, "");
        s.month = None;
        assert_eq!(next_due_date(&s, c(2026, 5, 1)), c(2027, 0, 10));
        s.month = Some(0); // `sub.month || 1` treats zero as unset
        assert_eq!(next_due_date(&s, c(2026, 5, 1)), c(2027, 0, 10));
    }

    #[test]
    fn nothing_is_due_before_the_first_charge_date() {
        let r = due_charges(&monthly(15, "2026-7-15"), c(2026, 7, 20), c(2026, 0, 1));
        assert!(r.charges.is_empty());
        assert_eq!(r.last_charged, "2026-7-15");
    }

    #[test]
    fn one_charge_fires_on_the_day() {
        let r = due_charges(&monthly(15, "2026-6-15"), c(2026, 7, 15), c(2026, 0, 1));
        assert_eq!(r.charges, vec![c(2026, 7, 15)]);
        assert_eq!(r.last_charged, "2026-7-15");
    }

    #[test]
    fn missed_months_are_caught_up_in_order() {
        // cursor in May, today in August
        let r = due_charges(&monthly(15, "2026-4-15"), c(2026, 7, 20), c(2026, 0, 1));
        assert_eq!(
            r.charges,
            vec![c(2026, 5, 15), c(2026, 6, 15), c(2026, 7, 15)]
        );
        assert_eq!(r.last_charged, "2026-7-15");
    }

    #[test]
    fn a_subscription_with_no_cursor_starts_from_its_creation_date() {
        let mut s = monthly(15, "");
        s.last_charged = None;
        let r = due_charges(&s, c(2026, 7, 20), c(2026, 5, 1));
        assert_eq!(
            r.charges,
            vec![c(2026, 5, 15), c(2026, 6, 15), c(2026, 7, 15)]
        );
    }

    #[test]
    fn the_catch_up_is_bounded() {
        // a cursor from 1990 must not walk four hundred months
        let r = due_charges(&monthly(1, "1990-0-1"), c(2026, 7, 20), c(1990, 0, 1));
        assert_eq!(r.charges.len(), MAX_CATCH_UP);
    }

    #[test]
    fn the_cursor_round_trips_through_its_v7_encoding() {
        // month is 0-indexed in the stored form
        assert_eq!(encode_cursor(c(2026, 7, 5)), "2026-7-5");
        assert_eq!(decode_cursor("2026-7-5"), Some(c(2026, 7, 5)));
        assert_eq!(decode_cursor("2026-11-31"), Some(c(2026, 11, 31)));
        assert_eq!(decode_cursor("garbage"), None);
        assert_eq!(decode_cursor("2026-7"), None);
    }

    #[test]
    fn an_open_ended_subscription_fires_every_caught_up_charge() {
        assert_eq!(allowed_charges(&monthly(1, ""), 3), 3);
    }

    #[test]
    fn an_instalment_plan_is_capped_at_its_remaining_periods() {
        let mut s = monthly(1, "");
        s.periods = Some(12);
        s.charged = Some(10);
        assert_eq!(allowed_charges(&s, 3), 2);

        s.charged = Some(12);
        assert_eq!(allowed_charges(&s, 3), 0);

        // already over-charged: saturating, not negative
        s.charged = Some(20);
        assert_eq!(allowed_charges(&s, 3), 0);
    }

    #[test]
    fn a_zero_period_count_means_open_ended() {
        // `sub.periods && sub.periods > 0` in the TypeScript
        let mut s = monthly(1, "");
        s.periods = Some(0);
        s.charged = Some(5);
        assert_eq!(allowed_charges(&s, 3), 3);
    }

    #[test]
    fn charge_ids_are_derived_so_two_devices_collapse_to_one_row() {
        assert_eq!(charge_id("s0", 1_700_000_000_000), "sub_s0_1700000000000");
    }
}
