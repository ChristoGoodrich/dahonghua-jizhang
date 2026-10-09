//! A calendar day as Dart spells it.
//!
//! `'${d.year}-${d.month}-${d.day}'` is what every screen passes: `DateTime`
//! months are **1-based**, `Civil`'s are 0. That one subtraction used to be
//! copy-pasted into fifteen bridge modules — and one of the copies
//! (`subscriptions`) skipped it on purpose, because the subscription cursor
//! is `YYYY-M-D` with a **0-indexed** month (`core::subs::encode`). Two
//! formats, one spelling, and no way to tell which a given function meant
//! without reading it twice.
//!
//! This module is the 1-based one. The cursor keeps using `subs::decode`.

use dahonghua_core::civil::Civil;
use flutter_rust_bridge::frb;

/// `YYYY-M-D` from a Dart `DateTime`, months 1-based. Unparsable fields fall
/// back to 1970-1-1 rather than failing: every caller treats a day as a
/// point on the line, and a far-past default says "nothing is in range"
/// instead of taking the whole ledger.
#[frb(ignore)]
pub fn parse_day(s: &str) -> Civil {
    let mut it = s.split('-');
    let y = it.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    Civil::new(y, m - 1, d)
}

/// The inverse of [`parse_day`]: a `Civil` back to Dart's 1-based spelling.
#[frb(ignore)]
pub fn show_day(d: Civil) -> String {
    format!("{}-{}-{}", d.y, d.m + 1, d.d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dart_month_is_one_based_and_a_civil_month_is_not() {
        let c = parse_day("2026-9-21");
        assert_eq!((c.y, c.m, c.d), (2026, 8, 21));
        assert_eq!(show_day(c), "2026-9-21");
    }

    #[test]
    fn junk_reads_as_the_epoch_rather_than_panicking() {
        let c = parse_day("not-a-date");
        assert_eq!((c.y, c.m, c.d), (1970, 0, 1));
        assert_eq!(parse_day("").d, 1);
    }
}
