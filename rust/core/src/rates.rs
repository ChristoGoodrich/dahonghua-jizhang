//! Choosing an exchange rate: which source to believe, and what counts as a
//! usable answer.
//!
//! Ported from the decisions in `src/domain/rates.ts`. The **transport** stays
//! on the platform — `fetch`, `AbortController`, a fifteen-second timeout —
//! because an HTTP client is not domain logic and the app already has one. What
//! crosses is everything that decides: whether a response is believable,
//! how it is converted into this app's convention, whether a date is recent
//! enough to justify the second source, and what order the three sources are
//! tried in.
//!
//! The rate convention here is **1 foreign = N base**, matching
//! `store$.currencies.rates`. Both APIs answer "1 base = X target", so every
//! usable answer is inverted.

use crate::civil::Civil;
use crate::num::to_fixed;

/// A rate as it came back from an API, before this crate believes it.
///
/// `null`, a string, a missing key and a failed request are all the same thing
/// to the TypeScript — `j?.rates?.[target]` yields `undefined` and the type
/// check rejects it — so they arrive here as `None`.
pub type RawRate = Option<f64>;

/// Turn an API's "1 base = X target" into this app's "1 target = N base",
/// or reject it.
///
/// The guard is `typeof r === 'number' && Number.isFinite(r) && r <= 0` — so a
/// zero, a negative, an infinity and a `NaN` are all refused rather than
/// producing an infinite or nonsensical rate. Six decimal places, because that
/// is what the TypeScript rounds to before storing.
pub fn invert(raw: RawRate) -> Option<f64> {
    let r = raw?;
    if !r.is_finite() || r <= 0.0 {
        return None;
    }
    // `+(1 / r).toFixed(6)` — round to six places, then back to a number
    Some(to_fixed(1.0 / r, 6))
}

/// Whether a date is close enough to now to try the second, live-only source.
///
/// The TypeScript calls this "today or yesterday in local time" and it is not
/// that. It measures `|now - midnight(date)| < 48h` from the current *instant*,
/// so what counts as recent slides through the day and reaches into the future:
/// read at 14:00, the day before yesterday is out at 62 hours while **two days
/// ahead** is in at 46. Reproduced rather than corrected — the second source
/// only serves live rates anyway, so the worst a generous window does is waste
/// one request that returns nothing useful.
///
/// `now_minutes` is minutes past local midnight on `today`, which is how the
/// caller hands over the part of the clock that matters here.
pub fn is_recent(date: Civil, today: Civil, now_minutes: i64) -> bool {
    let day_diff = date.days_until(today); // positive when `date` is in the past
    let minutes = day_diff * 24 * 60 + now_minutes;
    minutes.abs() < 2 * 24 * 60
}

/// Which source a rate should come from, given what each one said.
///
/// The order is the whole point and it is not negotiable by the caller:
/// the historical source first, the live source only for recent dates, the
/// cache last. Each step is skipped rather than retried when it answers
/// nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// The bases are the same currency; the rate is 1 and nothing was asked.
    Identity,
    /// Frankfurter, for the exact date.
    Historical,
    /// exchangerate-api.com, which only has today's rates.
    Live,
    /// Whatever the store already had.
    Cache,
    /// Nothing usable anywhere.
    None,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Resolved {
    pub rate: Option<f64>,
    pub source: Source,
}

/// Resolve a rate from the three answers, in order.
///
/// `historical` and `live` are raw API numbers; `cached` is what the store
/// holds, already in this app's convention and so **not** inverted. The cache
/// guard is `cached && Number.isFinite(cached) && cached > 0`, whose leading
/// truthiness test is redundant against `> 0` — kept because it costs nothing
/// to be exact, and because a `NaN` cache is rejected either way.
///
/// `live_allowed` is [`is_recent`]; passing it in keeps the clock out of here.
pub fn resolve(
    same_currency: bool,
    historical: RawRate,
    live_allowed: bool,
    live: RawRate,
    cached: Option<f64>,
) -> Resolved {
    if same_currency {
        return Resolved {
            rate: Some(1.0),
            source: Source::Identity,
        };
    }
    if let Some(r) = invert(historical) {
        return Resolved {
            rate: Some(r),
            source: Source::Historical,
        };
    }
    if live_allowed {
        if let Some(r) = invert(live) {
            return Resolved {
                rate: Some(r),
                source: Source::Live,
            };
        }
    }
    match cached {
        Some(c) if c != 0.0 && c.is_finite() && c > 0.0 => Resolved {
            rate: Some(c),
            source: Source::Cache,
        },
        _ => Resolved {
            rate: None,
            source: Source::None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rate_is_inverted_and_rounded_to_six_places() {
        // 1 base = 7.1234567 target  ->  1 target = 0.140381 base
        assert_eq!(invert(Some(7.1234567)), Some(0.140381));
        assert_eq!(invert(Some(1.0)), Some(1.0));
        assert_eq!(invert(Some(2.0)), Some(0.5));
    }

    #[test]
    fn an_unusable_rate_is_refused_rather_than_inverted() {
        assert_eq!(invert(None), None);
        assert_eq!(invert(Some(0.0)), None);
        assert_eq!(invert(Some(-1.0)), None);
        assert_eq!(invert(Some(f64::NAN)), None);
        assert_eq!(invert(Some(f64::INFINITY)), None);
        // a rate so small its inverse overflows is still finite and positive,
        // so it is accepted — the guard is on the input, not the output
        assert!(invert(Some(1e-320)).is_some());
    }

    #[test]
    fn the_same_currency_short_circuits_everything() {
        let r = resolve(true, Some(999.0), true, Some(999.0), Some(999.0));
        assert_eq!(r.rate, Some(1.0));
        assert_eq!(r.source, Source::Identity);
    }

    #[test]
    fn the_historical_source_wins() {
        let r = resolve(false, Some(2.0), true, Some(4.0), Some(9.0));
        assert_eq!(r.source, Source::Historical);
        assert_eq!(r.rate, Some(0.5));
    }

    #[test]
    fn the_live_source_only_runs_when_the_date_is_recent() {
        let r = resolve(false, None, true, Some(4.0), Some(9.0));
        assert_eq!(r.source, Source::Live);
        assert_eq!(r.rate, Some(0.25));
        // the same answers, an old date: the live source is never consulted
        let r = resolve(false, None, false, Some(4.0), Some(9.0));
        assert_eq!(r.source, Source::Cache);
        assert_eq!(r.rate, Some(9.0));
    }

    #[test]
    fn the_cache_is_not_inverted() {
        // it is already in this app's convention
        let r = resolve(false, None, false, None, Some(7.5));
        assert_eq!(r.rate, Some(7.5));
    }

    #[test]
    fn an_unusable_cache_is_no_answer() {
        for c in [
            None,
            Some(0.0),
            Some(-1.0),
            Some(f64::NAN),
            Some(f64::INFINITY),
        ] {
            let r = resolve(false, None, false, None, c);
            assert_eq!(r.rate, None, "{c:?}");
            assert_eq!(r.source, Source::None);
        }
    }

    #[test]
    fn a_live_answer_that_is_junk_falls_through_to_the_cache() {
        let r = resolve(false, None, true, Some(0.0), Some(9.0));
        assert_eq!(r.source, Source::Cache);
    }

    #[test]
    fn recency_is_forty_eight_hours_from_now_not_two_calendar_days() {
        let today = Civil::new(2026, 5, 10);
        let at_2pm = 14 * 60;
        // yesterday, 38 hours ago
        assert!(is_recent(Civil::new(2026, 5, 9), today, at_2pm));
        // the day before that, 62 hours ago — outside
        assert!(!is_recent(Civil::new(2026, 5, 8), today, at_2pm));
        // two days *ahead*, 46 hours away — inside, which the doc comment on
        // the TypeScript does not lead you to expect
        assert!(is_recent(Civil::new(2026, 5, 12), today, at_2pm));
        assert!(!is_recent(Civil::new(2026, 5, 13), today, at_2pm));
    }

    #[test]
    fn the_window_is_asymmetric_because_dates_sit_at_midnight() {
        let today = Civil::new(2026, 5, 10);
        // Every date is measured from *its midnight* to *now*, so the time of
        // day counts against a past date and in favour of a future one. Two
        // days back is exactly 48 hours before today's midnight, so it is
        // outside at every hour — never recent, not even at 00:01. Two days
        // ahead is inside at every hour except midnight itself.
        for m in [0, 1, 12 * 60, 23 * 60 + 59] {
            assert!(!is_recent(Civil::new(2026, 5, 8), today, m), "8th at {m}");
            assert!(is_recent(Civil::new(2026, 5, 9), today, m), "9th at {m}");
            assert!(is_recent(Civil::new(2026, 5, 11), today, m), "11th at {m}");
            assert!(!is_recent(Civil::new(2026, 5, 13), today, m), "13th at {m}");
        }
        assert!(!is_recent(Civil::new(2026, 5, 12), today, 0));
        assert!(is_recent(Civil::new(2026, 5, 12), today, 1));
    }

    #[test]
    fn recency_crosses_a_month_end() {
        let today = Civil::new(2026, 2, 1); // 1 March
        assert!(is_recent(Civil::new(2026, 1, 28), today, 0)); // 28 Feb
        assert!(!is_recent(Civil::new(2026, 1, 26), today, 0));
    }
}
