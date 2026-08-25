//! Civil (wall-clock) calendar arithmetic.
//!
//! This is where the port draws the line between pure logic and the platform.
//!
//! `src/domain/dates.ts` and `cycle.ts` do their maths on JavaScript `Date`
//! objects in **local time** — `new Date(y, m, d)` builds a local midnight,
//! `getMonth()` reads a local month. "Local time" is a question only the device
//! can answer, and it answers differently in October than in June wherever
//! daylight saving applies. A pure core cannot own that.
//!
//! So it is split. Everything that is genuinely calendar arithmetic — which is
//! all of `cycle.ts` and most of `dates.ts` — lives here and operates on civil
//! y/m/d triples. Converting an epoch timestamp to and from those components is
//! the platform's job, and stays outside the crate.
//!
//! Months are **0-based**, matching JavaScript rather than the calendar, so a
//! reader comparing the two files does not have to hold an offset in their head.
//!
//! Out-of-range components overflow the way `new Date` does rather than
//! clamping or erroring: month -1 is December of the previous year, day 0 is the
//! last day of the previous month, and day 31 of a 30-day month is the 1st of
//! the next. `cycle.ts` leans on all three.

/// A wall-clock date with no timezone attached. Month is 0-based.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Civil {
    pub y: i32,
    pub m: i32,
    pub d: i32,
}

pub fn is_leap(y: i32) -> bool {
    (y.rem_euclid(4) == 0 && y.rem_euclid(100) != 0) || y.rem_euclid(400) == 0
}

/// Days in a 0-based month, normalising the month into its year first.
pub fn days_in_month(y: i32, m: i32) -> i32 {
    let (y, m) = normalize_month(y, m);
    match m {
        0 | 2 | 4 | 6 | 7 | 9 | 11 => 31,
        3 | 5 | 8 | 10 => 30,
        _ => {
            if is_leap(y) {
                29
            } else {
                28
            }
        }
    }
}

/// Roll an out-of-range 0-based month into its year, like `new Date(y, m, 1)`.
fn normalize_month(y: i32, m: i32) -> (i32, i32) {
    (y + m.div_euclid(12), m.rem_euclid(12))
}

impl Civil {
    /// Build a date the way `new Date(y, m, d)` does: components out of range
    /// roll over rather than failing.
    pub fn new(y: i32, m: i32, d: i32) -> Self {
        let (mut y, mut m) = normalize_month(y, m);
        let mut d = d;
        // day 0 or negative walks backwards a month at a time
        while d < 1 {
            m -= 1;
            let (ny, nm) = normalize_month(y, m);
            y = ny;
            m = nm;
            d += days_in_month(y, m);
        }
        // day past the end walks forwards
        loop {
            let len = days_in_month(y, m);
            if d <= len {
                break;
            }
            d -= len;
            m += 1;
            let (ny, nm) = normalize_month(y, m);
            y = ny;
            m = nm;
        }
        Civil { y, m, d }
    }

    /// Days since 1970-01-01, for differences and ordering.
    pub fn day_number(self) -> i64 {
        // Howard Hinnant's days_from_civil, with the month shifted to 1-based
        let m = self.m + 1;
        let y = self.y - i32::from(m <= 2);
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = (y - era * 400) as i64;
        let mp = ((m + 9) % 12) as i64;
        let doy = (153 * mp + 2) / 5 + self.d as i64 - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era as i64 * 146097 + doe - 719468
    }

    /// The inverse of [`Civil::day_number`].
    pub fn from_day_number(z: i64) -> Civil {
        // Howard Hinnant's civil_from_days
        let z = z + 719_468;
        let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let y = yoe + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = (doy - (153 * mp + 2) / 5 + 1) as i32;
        let m = if mp < 10 { mp + 3 } else { mp - 9 } as i32;
        Civil {
            y: (y + i64::from(m <= 2)) as i32,
            m: m - 1, // back to 0-based
            d,
        }
    }

    /// Whole days from `self` to `other`, positive when `other` is later.
    pub fn days_until(self, other: Civil) -> i64 {
        other.day_number() - self.day_number()
    }

    /// 0 = Monday … 6 = Sunday. JavaScript's `getDay()` is Sunday-first; the
    /// month grid wants Monday-first, so that shift lives here rather than
    /// being re-derived at each call site.
    pub fn weekday_monday_first(self) -> i32 {
        (self.day_number().rem_euclid(7) as i32 + 3) % 7
    }
}

/// Monday-first month grid: leading `None`s to align day 1, then 1..=last.
pub fn month_grid(y: i32, m: i32) -> Vec<Option<i32>> {
    let lead = Civil::new(y, m, 1).weekday_monday_first();
    let days = days_in_month(y, m);
    let mut cells: Vec<Option<i32>> = vec![None; lead as usize];
    for d in 1..=days {
        cells.push(Some(d));
    }
    cells
}

/// `new Date('YYYY-MM-DDT…')`, which is a different parser from the component
/// constructor and disagrees with it twice.
///
/// * A datetime string with no offset is parsed as **local** time, not UTC.
/// * The date-time grammar bounds MM to 01–12 and DD to 01–31, and anything
///   outside those is `Invalid Date` — `None` here. Anything *inside* them
///   still rolls, so `2025-02-29` is March 1st rather than a rejection.
/// * The year is taken literally. `0001-01-15` is year 1, where the component
///   form would have made it 1901.
///
/// Two callers need it: the search box's date ranges, and the exchange-rate
/// cache deciding whether a stored date is recent.
///
/// The asymmetry is the point: `new Date('2024-01-32')` is invalid while
/// `new Date(2024, 0, 32)` is quietly February.
pub fn parse_iso_date(s: &str) -> Option<Civil> {
    // The grammar is `YYYY-MM-DD` and the digit counts are part of it: V8 reads
    // `2026-06-01` and calls `2026-6-1`, `2026-06-1` and `02026-06-01` Invalid
    // Date alike. Splitting on `-` and parsing whatever falls out accepts all
    // of them — a gap that stayed hidden while the only caller was a search box
    // whose regex had already required `[0-9]{4}-[0-9]{2}-[0-9]{2}`.
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    if !b
        .iter()
        .enumerate()
        .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return None;
    }
    let y: i32 = s[0..4].parse().ok()?;
    let m: i32 = s[5..7].parse().ok()?;
    let d: i32 = s[8..10].parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None; // outside the grammar, so Invalid Date
    }
    Some(Civil::new(y, m - 1, d))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_iso_parser_demands_exactly_four_two_two_digits() {
        assert!(parse_iso_date("2026-06-01").is_some());
        // V8 calls every one of these Invalid Date
        for s in [
            "2026-6-1",
            "2026-06-1",
            "2026-6-01",
            "226-06-01",
            "02026-06-01",
            "2026-06-01 ",
            " 2026-06-01",
            "2026/06/01",
            "2026-06",
            "2026-06-01-02",
            "20260601",
            "",
            "nonsense",
            "abcd-ef-gh",
        ] {
            assert!(parse_iso_date(s).is_none(), "{s}");
        }
    }

    #[test]
    fn the_iso_parser_bounds_the_month_and_day_then_lets_them_roll() {
        assert!(parse_iso_date("2026-00-10").is_none());
        assert!(parse_iso_date("2026-13-01").is_none());
        assert!(parse_iso_date("2026-06-00").is_none());
        assert!(parse_iso_date("2026-01-32").is_none());
        // inside the grammar but not a real day: rolls rather than rejecting
        assert_eq!(parse_iso_date("2025-02-29"), Some(Civil::new(2025, 2, 1)));
    }

    #[test]
    fn the_iso_parser_takes_the_year_literally() {
        // the component constructor would make this 1901; the string form does
        // not remap two-digit years
        assert_eq!(parse_iso_date("0001-01-15"), Some(Civil::new(1, 0, 15)));
    }

    #[test]
    fn leap_years_follow_the_gregorian_rule() {
        assert!(is_leap(2024));
        assert!(!is_leap(2025));
        assert!(!is_leap(1900));
        assert!(is_leap(2000));
    }

    #[test]
    fn month_lengths() {
        assert_eq!(days_in_month(2025, 0), 31); // January
        assert_eq!(days_in_month(2025, 1), 28); // February
        assert_eq!(days_in_month(2024, 1), 29); // February, leap
        assert_eq!(days_in_month(2025, 3), 30); // April
    }

    #[test]
    fn a_month_out_of_range_rolls_into_its_year() {
        assert_eq!(
            Civil::new(2026, -1, 15),
            Civil {
                y: 2025,
                m: 11,
                d: 15
            }
        );
        assert_eq!(
            Civil::new(2026, 12, 15),
            Civil {
                y: 2027,
                m: 0,
                d: 15
            }
        );
        assert_eq!(
            Civil::new(2026, 24, 1),
            Civil {
                y: 2028,
                m: 0,
                d: 1
            }
        );
    }

    #[test]
    fn day_zero_is_the_end_of_the_previous_month() {
        assert_eq!(
            Civil::new(2026, 2, 0),
            Civil {
                y: 2026,
                m: 1,
                d: 28
            }
        );
        assert_eq!(
            Civil::new(2024, 2, 0),
            Civil {
                y: 2024,
                m: 1,
                d: 29
            }
        );
        assert_eq!(
            Civil::new(2026, 0, 0),
            Civil {
                y: 2025,
                m: 11,
                d: 31
            }
        );
    }

    #[test]
    fn a_day_past_the_end_rolls_forward() {
        // the cycle code relies on this: start day 31 in a 30-day month
        assert_eq!(
            Civil::new(2026, 3, 31),
            Civil {
                y: 2026,
                m: 4,
                d: 1
            }
        );
        assert_eq!(
            Civil::new(2026, 1, 30),
            Civil {
                y: 2026,
                m: 2,
                d: 2
            }
        );
        assert_eq!(
            Civil::new(2026, 11, 32),
            Civil {
                y: 2027,
                m: 0,
                d: 1
            }
        );
    }

    #[test]
    fn day_numbers_round_trip() {
        for d in [
            Civil::new(1970, 0, 1),
            Civil::new(2026, 7, 19),
            Civil::new(1969, 11, 31),
            Civil::new(2024, 1, 29),
            Civil::new(2100, 11, 31),
        ] {
            assert_eq!(Civil::from_day_number(d.day_number()), d, "{d:?}");
        }
    }

    #[test]
    fn day_numbers_anchor_on_the_epoch() {
        assert_eq!(Civil::new(1970, 0, 1).day_number(), 0);
        assert_eq!(Civil::new(1970, 0, 2).day_number(), 1);
        assert_eq!(Civil::new(1969, 11, 31).day_number(), -1);
        assert_eq!(Civil::new(2000, 0, 1).day_number(), 10957);
    }

    #[test]
    fn differences_count_whole_days_across_month_and_year_ends() {
        assert_eq!(
            Civil::new(2026, 0, 1).days_until(Civil::new(2026, 0, 31)),
            30
        );
        assert_eq!(
            Civil::new(2026, 1, 28).days_until(Civil::new(2026, 2, 1)),
            1
        );
        assert_eq!(
            Civil::new(2024, 1, 28).days_until(Civil::new(2024, 2, 1)),
            2
        ); // leap
        assert_eq!(
            Civil::new(2026, 11, 31).days_until(Civil::new(2027, 0, 1)),
            1
        );
    }

    #[test]
    fn weekdays_are_monday_first() {
        // 1970-01-01 was a Thursday
        assert_eq!(Civil::new(1970, 0, 1).weekday_monday_first(), 3);
        // 2026-08-19 is a Wednesday
        assert_eq!(Civil::new(2026, 7, 19).weekday_monday_first(), 2);
        // 2026-08-17 is a Monday
        assert_eq!(Civil::new(2026, 7, 17).weekday_monday_first(), 0);
        // 2026-08-23 is a Sunday
        assert_eq!(Civil::new(2026, 7, 23).weekday_monday_first(), 6);
    }

    #[test]
    fn the_month_grid_pads_to_the_first_monday() {
        // August 2026 starts on a Saturday → five leading blanks
        let grid = month_grid(2026, 7);
        assert_eq!(grid.iter().take_while(|c| c.is_none()).count(), 5);
        assert_eq!(grid.len(), 5 + 31);
        assert_eq!(grid[5], Some(1));
        assert_eq!(grid[grid.len() - 1], Some(31));
    }

    #[test]
    fn a_month_starting_on_monday_has_no_padding() {
        // June 2026 starts on a Monday
        assert_eq!(month_grid(2026, 5)[0], Some(1));
    }
}
