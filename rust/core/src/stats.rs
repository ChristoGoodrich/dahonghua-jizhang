//! Aggregating a set of entries: by category, by weekday, by time of day.
//!
//! Ported from the self-contained half of `src/domain/stats.ts`. The three
//! functions that remain there — `statTotals`, `sixMonthTrend` and `comparison`
//! — need a cycle *and* a clock, and count elapsed days by dividing epoch
//! milliseconds by 864e5. That is twenty-four hours rather than a calendar day,
//! which is the exact shape of the bug `subscriptions.rs` documents, so they get
//! their own increment rather than being rushed in behind these.
//!
//! [`by_weekday`] and [`by_time_of_day`] read a *local* weekday and hour off
//! each entry, which an epoch stamp does not yield without a timezone. The
//! caller projects; [`LocalRow`] is what it projects to.

use crate::entry::{Entry, Io};

#[derive(Debug, Clone, PartialEq)]
pub struct CatTotal {
    pub cat: String,
    pub amt: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DonutSlice {
    pub cat: String,
    /// Share of the total, 0..1.
    pub frac: f64,
    /// Cumulative start fraction, 0..1.
    pub start: f64,
}

/// Cumulative slices for a donut chart. Empty when the total is zero or less.
///
/// The running start is accumulated in order rather than recomputed per slice,
/// so the floating-point result depends on the order the categories arrive in.
/// That is worth keeping identical rather than "improving".
pub fn donut_slices(cats: &[CatTotal], total: f64) -> Vec<DonutSlice> {
    if total <= 0.0 {
        return vec![];
    }
    let mut acc = 0.0;
    cats.iter()
        .map(|c| {
            let frac = c.amt / total;
            let slice = DonutSlice {
                cat: c.cat.clone(),
                frac,
                start: acc,
            };
            acc += frac;
            slice
        })
        .collect()
}

/// `Array.prototype.sort` treats a comparator returning `NaN` as zero, so a
/// non-comparable pair keeps its relative order. Both sorts here are stable, so
/// this reproduces that exactly.
fn desc_by_amt(a: f64, b: f64) -> std::cmp::Ordering {
    b.partial_cmp(&a).unwrap_or(std::cmp::Ordering::Equal)
}

/// Totals per category for one direction, largest first.
///
/// Ties keep the order the categories were first seen in: a JavaScript `Map`
/// iterates by insertion and `sort` is stable, and so are the `Vec` and
/// `sort_by` used here. `sort_unstable_by` would not be.
pub fn by_category(entries: &[Entry], io: Io) -> Vec<CatTotal> {
    let mut totals: Vec<CatTotal> = Vec::new();
    for d in entries {
        if d.io != Some(io) {
            continue;
        }
        match totals.iter_mut().find(|t| t.cat == d.cat) {
            Some(t) => t.amt += d.amt,
            None => totals.push(CatTotal {
                cat: d.cat.clone(),
                amt: d.amt,
            }),
        }
    }
    totals.sort_by(|a, b| desc_by_amt(a.amt, b.amt));
    totals
}

/// The `n` largest single entries for one direction, descending.
pub fn top_entries(entries: &[Entry], io: Io, n: usize) -> Vec<&Entry> {
    let mut out: Vec<&Entry> = entries.iter().filter(|d| d.io == Some(io)).collect();
    out.sort_by(|a, b| desc_by_amt(a.amt, b.amt));
    out.truncate(n);
    out
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Overview {
    pub exp: f64,
    pub inc: f64,
    /// Income less expense.
    pub balance: f64,
    /// Every entry in range, transfers included.
    pub count: usize,
}

/// Expense, income, balance and entry count over a set of entries.
///
/// `count` counts transfers even though neither total does — it is "how many
/// rows are in this range", not "how many rows moved money one way".
pub fn overview(entries: &[Entry]) -> Overview {
    let mut exp = 0.0;
    let mut inc = 0.0;
    for d in entries {
        match d.io {
            Some(Io::Exp) => exp += d.amt,
            Some(Io::Inc) => inc += d.amt,
            _ => {}
        }
    }
    Overview {
        exp,
        inc,
        balance: inc - exp,
        count: entries.len(),
    }
}

/* ------------------------------------------------ weekday and time of day */

/// One entry, projected into the local calendar by the platform.
///
/// `dow` is `Date.prototype.getDay`: 0 = Sunday … 6 = Saturday. Note that this
/// is *not* [`crate::civil::Civil::weekday_monday_first`], which is Monday-based
/// — `stats.ts` labels its buckets Sunday-first so the UI can localise them.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LocalRow {
    pub io: Option<Io>,
    pub amt: f64,
    pub dow: i32,
    pub hour: i32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WeekdayTotal {
    pub dow: i32,
    pub amt: f64,
    pub count: usize,
}

/// Totals by day of week, always seven buckets, Sunday first.
///
/// A `dow` outside 0..=6 is dropped rather than panicking. The TypeScript would
/// index past the end of its array and throw on the assignment; nothing can
/// produce such a value from a real `getDay()`, so the difference is
/// unreachable and being unreachable *and safe* is better than unreachable and
/// not.
pub fn by_weekday(rows: &[LocalRow], io: Io) -> Vec<WeekdayTotal> {
    let mut buckets: Vec<WeekdayTotal> = (0..7)
        .map(|dow| WeekdayTotal {
            dow,
            amt: 0.0,
            count: 0,
        })
        .collect();
    for r in rows {
        if r.io != Some(io) {
            continue;
        }
        if let Some(b) = usize::try_from(r.dow).ok().and_then(|i| buckets.get_mut(i)) {
            b.amt += r.amt;
            b.count += 1;
        }
    }
    buckets
}

/// Named time-of-day periods (凌晨/清晨/上午/中午/下午/傍晚/晚上), matching the
/// buckets Cookie 记账 uses. Ranges are `[from, to)` in local hours.
pub const TIME_RANGES: &[(&str, i32, i32)] = &[
    ("dawn", 0, 5),
    ("earlyMorning", 5, 8),
    ("morning", 8, 11),
    ("noon", 11, 13),
    ("afternoon", 13, 17),
    ("dusk", 17, 19),
    ("night", 19, 24),
];

/// The period an hour falls in.
///
/// Anything outside 0..=23 falls through the loop and lands on `night`, which
/// is the TypeScript's default rather than a considered answer — but it is the
/// answer, so it is reproduced.
///
/// Two consequences of the shape, both established by injection rather than by
/// reading, and both meaning a range edit can be entirely invisible:
///
/// * **First match wins**, so widening a later range *backwards* changes
///   nothing. Starting `noon` at 10 differs on no hour at all, because
///   `morning` is tested first and already covers 10.
/// * **The fallback is the last bucket.** Starting `night` at 20 also differs
///   on no hour: 19 then matches no range and falls through to `night` anyway.
///
/// Edits that *are* observable move a boundary forward into the next range, or
/// narrow one that is not last.
pub fn time_bucket_of(hour: i32) -> &'static str {
    for (key, from, to) in TIME_RANGES {
        if hour >= *from && hour < *to {
            return key;
        }
    }
    "night"
}

#[derive(Debug, Clone, PartialEq)]
pub struct TimeBucket {
    pub key: &'static str,
    pub amt: f64,
    pub count: usize,
}

/// Totals by time-of-day period, always the seven periods in order.
pub fn by_time_of_day(rows: &[LocalRow], io: Io) -> Vec<TimeBucket> {
    let mut buckets: Vec<TimeBucket> = TIME_RANGES
        .iter()
        .map(|(key, _, _)| TimeBucket {
            key,
            amt: 0.0,
            count: 0,
        })
        .collect();
    for r in rows {
        if r.io != Some(io) {
            continue;
        }
        let key = time_bucket_of(r.hour);
        let i = TIME_RANGES
            .iter()
            .position(|(k, _, _)| *k == key)
            .expect("time_bucket_of returns a key from TIME_RANGES");
        buckets[i].amt += r.amt;
        buckets[i].count += 1;
    }
    buckets
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(io: Io, cat: &str, amt: f64) -> Entry {
        Entry {
            io: Some(io),
            cat: cat.into(),
            amt,
            ..Default::default()
        }
    }

    fn row(io: Io, amt: f64, dow: i32, hour: i32) -> LocalRow {
        LocalRow {
            io: Some(io),
            amt,
            dow,
            hour,
        }
    }

    #[test]
    fn categories_total_and_sort_descending() {
        let entries = vec![
            e(Io::Exp, "food", 10.0),
            e(Io::Exp, "trans", 30.0),
            e(Io::Exp, "food", 5.0),
            e(Io::Inc, "salary", 900.0),
        ];
        let out = by_category(&entries, Io::Exp);
        assert_eq!(out.len(), 2);
        assert_eq!((out[0].cat.as_str(), out[0].amt), ("trans", 30.0));
        assert_eq!((out[1].cat.as_str(), out[1].amt), ("food", 15.0));
    }

    #[test]
    fn a_tie_keeps_the_order_the_categories_first_appeared_in() {
        let entries = vec![
            e(Io::Exp, "b", 10.0),
            e(Io::Exp, "a", 10.0),
            e(Io::Exp, "c", 10.0),
        ];
        let out = by_category(&entries, Io::Exp);
        let cats: Vec<&str> = out.iter().map(|t| t.cat.as_str()).collect();
        // insertion order, not alphabetical — a stable sort over a Map
        assert_eq!(cats, vec!["b", "a", "c"]);
    }

    #[test]
    fn a_direction_with_nothing_in_it_totals_nothing() {
        let entries = vec![e(Io::Exp, "food", 10.0)];
        assert!(by_category(&entries, Io::Inc).is_empty());
        assert!(by_category(&[], Io::Exp).is_empty());
    }

    #[test]
    fn the_top_entries_are_the_largest_and_are_capped() {
        let entries = vec![
            e(Io::Exp, "a", 1.0),
            e(Io::Exp, "b", 50.0),
            e(Io::Exp, "c", 20.0),
            e(Io::Inc, "d", 900.0),
        ];
        let top = top_entries(&entries, Io::Exp, 2);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].amt, 50.0);
        assert_eq!(top[1].amt, 20.0);

        // asking for more than exist yields what exists
        assert_eq!(top_entries(&entries, Io::Exp, 99).len(), 3);
        assert_eq!(top_entries(&entries, Io::Exp, 0).len(), 0);
    }

    #[test]
    fn an_overview_counts_transfers_but_does_not_total_them() {
        let mut xfer = e(Io::Exp, "transfer", 500.0);
        xfer.io = Some(Io::Xfer);
        let entries = vec![e(Io::Exp, "food", 35.0), e(Io::Inc, "salary", 100.0), xfer];
        let o = overview(&entries);
        assert_eq!(o.exp, 35.0);
        assert_eq!(o.inc, 100.0);
        assert_eq!(o.balance, 65.0);
        assert_eq!(o.count, 3);
    }

    #[test]
    fn an_entry_with_no_direction_counts_but_totals_nothing() {
        let mut bare = e(Io::Exp, "food", 10.0);
        bare.io = None;
        let o = overview(&[bare]);
        assert_eq!((o.exp, o.inc, o.count), (0.0, 0.0, 1));
    }

    #[test]
    fn donut_slices_accumulate_to_one() {
        let cats = vec![
            CatTotal {
                cat: "a".into(),
                amt: 50.0,
            },
            CatTotal {
                cat: "b".into(),
                amt: 30.0,
            },
            CatTotal {
                cat: "c".into(),
                amt: 20.0,
            },
        ];
        let out = donut_slices(&cats, 100.0);
        assert_eq!(out[0].start, 0.0);
        assert_eq!(out[1].start, 0.5);
        assert_eq!(out[2].start, 0.8);
        assert!((out.iter().map(|s| s.frac).sum::<f64>() - 1.0).abs() < 1e-12);
    }

    #[test]
    fn a_donut_of_nothing_has_no_slices() {
        let cats = vec![CatTotal {
            cat: "a".into(),
            amt: 1.0,
        }];
        assert!(donut_slices(&cats, 0.0).is_empty());
        assert!(donut_slices(&cats, -5.0).is_empty());
        assert!(donut_slices(&[], 100.0).is_empty());
    }

    #[test]
    fn weekday_buckets_are_always_seven_sunday_first() {
        let rows = vec![
            row(Io::Exp, 10.0, 0, 12), // Sunday
            row(Io::Exp, 5.0, 0, 12),
            row(Io::Exp, 7.0, 6, 12), // Saturday
            row(Io::Inc, 900.0, 3, 12),
        ];
        let out = by_weekday(&rows, Io::Exp);
        assert_eq!(out.len(), 7);
        assert_eq!((out[0].amt, out[0].count), (15.0, 2));
        assert_eq!((out[6].amt, out[6].count), (7.0, 1));
        assert_eq!((out[3].amt, out[3].count), (0.0, 0));
    }

    #[test]
    fn the_time_buckets_cover_the_whole_day_without_overlapping() {
        let mut seen = Vec::new();
        for h in 0..24 {
            seen.push(time_bucket_of(h));
        }
        assert_eq!(seen[0], "dawn");
        assert_eq!(seen[4], "dawn");
        assert_eq!(seen[5], "earlyMorning");
        assert_eq!(seen[11], "noon");
        assert_eq!(seen[12], "noon");
        assert_eq!(seen[13], "afternoon");
        assert_eq!(seen[19], "night");
        assert_eq!(seen[23], "night");
    }

    #[test]
    fn an_hour_outside_the_day_lands_on_night() {
        // the TypeScript's fall-through default, reproduced rather than fixed
        assert_eq!(time_bucket_of(24), "night");
        assert_eq!(time_bucket_of(-1), "night");
        assert_eq!(time_bucket_of(99), "night");
    }

    #[test]
    fn time_of_day_buckets_stay_in_chronological_order() {
        let rows = vec![
            row(Io::Exp, 10.0, 1, 2),  // dawn
            row(Io::Exp, 20.0, 1, 20), // night
            row(Io::Exp, 5.0, 1, 12),  // noon
            row(Io::Inc, 900.0, 1, 9),
        ];
        let out = by_time_of_day(&rows, Io::Exp);
        let keys: Vec<&str> = out.iter().map(|b| b.key).collect();
        assert_eq!(
            keys,
            vec![
                "dawn",
                "earlyMorning",
                "morning",
                "noon",
                "afternoon",
                "dusk",
                "night"
            ]
        );
        assert_eq!(out[0].amt, 10.0);
        assert_eq!(out[3].amt, 5.0);
        assert_eq!(out[6].amt, 20.0);
        assert_eq!(out[2].count, 0); // the income was filtered out
    }

    #[test]
    fn empty_input_still_yields_the_full_bucket_set() {
        assert_eq!(by_weekday(&[], Io::Exp).len(), 7);
        assert_eq!(by_time_of_day(&[], Io::Exp).len(), 7);
    }
}
