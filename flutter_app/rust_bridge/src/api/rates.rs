//! Choosing an exchange rate: which source to believe.
//!
//! The transport stays on the platform — `fetch`, a timeout, a cancel — because
//! an HTTP client is not domain logic. What crosses is every decision:
//! whether an answer is believable, how it is converted into this app's
//! convention, whether a date is recent enough to justify the live source, and
//! what order the three sources are tried in.
//!
//! The order is not negotiable by the caller. Historical first, live only for a
//! recent date, cache last — a screen that could reorder them would be a second
//! place for the policy to live.
//!
//! The convention is **1 foreign = N base**, matching the store. Both APIs
//! answer "1 base = X target", so every usable answer is inverted here rather
//! than at the call site.

use flutter_rust_bridge::frb;

use dahonghua_core::civil::Civil;
use dahonghua_core::rates::{invert, is_recent, resolve, Source};

fn parse_day(s: &str) -> Civil {
    let mut it = s.split('-');
    let y = it.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    Civil::new(y, m - 1, d)
}

fn source_str(s: Source) -> &'static str {
    match s {
        Source::Identity => "identity",
        Source::Historical => "historical",
        Source::Live => "live",
        Source::Cache => "cache",
        Source::None => "none",
    }
}

/// Where a rate came from, and what it is.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedRate {
    /// Absent when nothing usable was found anywhere.
    pub rate: Option<f64>,
    /// `identity`, `historical`, `live`, `cache` or `none` — worth surfacing,
    /// because a rate from the cache is a different claim from a rate fetched
    /// for the entry's own date.
    pub source: String,
}

/// Whether a date is close enough to now to bother asking the live-only source.
///
/// `now_minutes` is minutes past local midnight, which is how the platform
/// hands over the part of the clock that matters. Deliberately not "today or
/// yesterday": the shipping app measures 48 hours from the current instant, so
/// the window slides through the day and reaches into the future. Reproduced
/// rather than corrected — the worst a generous window costs is one request
/// that returns nothing useful.
#[frb(sync)]
pub fn rate_date_is_recent(date: String, today: String, now_minutes: i64) -> bool {
    is_recent(parse_day(&date), parse_day(&today), now_minutes)
}

/// Turn one API answer into this app's convention, or reject it.
///
/// Exposed on its own so a caller can see what a single source was worth. A
/// zero, a negative, an infinity and a `NaN` are all refused rather than
/// producing a nonsensical rate.
#[frb(sync)]
pub fn invert_rate(raw: Option<f64>) -> Option<f64> {
    invert(raw)
}

/// Pick a rate from what the three sources said.
///
/// `historical` and `live` are raw API numbers, still in "1 base = X target".
/// `cached` is what the store holds and is already in this app's convention, so
/// it is not inverted.
#[frb(sync)]
pub fn resolve_rate(
    same_currency: bool,
    historical: Option<f64>,
    live_allowed: bool,
    live: Option<f64>,
    cached: Option<f64>,
) -> ResolvedRate {
    let r = resolve(same_currency, historical, live_allowed, live, cached);
    ResolvedRate {
        rate: r.rate,
        source: source_str(r.source).to_string(),
    }
}
