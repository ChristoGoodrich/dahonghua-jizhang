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

use crate::civil::Civil;
use crate::cycle::cycle_range;
use crate::entry::{Entry, Io};
use crate::num::desc_by_amt;

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

/* --------------------------------------------------- cycle-shaped totals -- */

/// One entry, projected onto the calendar day the platform resolved it to.
///
/// These three functions compare entries against *cycle boundaries*, which are
/// calendar dates. Comparing epoch stamps against them was how the day counting
/// went wrong in the first place — see [`elapsed_days`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DatedRow {
    pub io: Option<Io>,
    pub amt: f64,
    pub day: Civil,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StatTotals {
    pub today_exp: f64,
    /// Spend per elapsed day of the cycle.
    pub avg: f64,
    /// The largest single expense.
    pub top: f64,
    pub count: usize,
}

/// How many days of a cycle have elapsed, counted in calendar days.
///
/// The TypeScript measured this as `ceil((min(now, end) - start) / 864e5)` until
/// the port went looking. 864e5 is twenty-four hours, which is not a calendar
/// day whenever the clocks move: in Sydney it read 4 on the 5th of October and
/// 7 on the 6th of April. `elapsed` divides the daily average, so being one out
/// early in a cycle changes it by a third or a half.
///
/// Capped at the cycle's own length, because `today` can be past the end — the
/// TypeScript spelled that as `Math.min(now, end)` before subtracting.
///
/// The floor of one is load-bearing rather than defensive. `today` can be
/// *before* the cycle start, which makes the difference negative, and
/// [`comparison`] sizes an array with it — removing the floor does not produce
/// a wrong answer, it aborts the process on a capacity overflow.
pub fn elapsed_days(start: Civil, end: Civil, today: Civil) -> i64 {
    let cycle_len = start.days_until(end);
    (start.days_until(today) + 1).clamp(1, cycle_len.max(1))
}

/// Today's spend, the cycle's daily average, its largest expense and its size.
///
/// `rows` is the cycle's entries — the caller has already narrowed them, which
/// is what the TypeScript's `cycleEntries` argument means.
pub fn stat_totals(rows: &[DatedRow], anchor: Civil, cycle_start: i32, today: Civil) -> StatTotals {
    let exp: Vec<&DatedRow> = rows.iter().filter(|d| d.io == Some(Io::Exp)).collect();
    let total: f64 = exp.iter().map(|d| d.amt).sum();
    let today_exp: f64 = exp.iter().filter(|d| d.day == today).map(|d| d.amt).sum();
    let r = cycle_range(anchor, cycle_start);
    let elapsed = elapsed_days(r.start, r.end, today);
    StatTotals {
        today_exp,
        avg: total / elapsed as f64,
        top: max_amt(&exp),
        count: rows.len(),
    }
}

/// `exp.length ? Math.max(...exp.map(d => d.amt)) : 0`.
///
/// Two details the obvious `fold(NEG_INFINITY, f64::max)` gets wrong. An empty
/// list answers zero rather than negative infinity, which is what the length
/// guard in the TypeScript is for. And `Math.max` propagates `NaN` where
/// `f64::max` ignores it, so a single unparseable amount poisons the answer in
/// JavaScript and would not here.
fn max_amt(exp: &[&DatedRow]) -> f64 {
    if exp.is_empty() {
        return 0.0;
    }
    exp.iter().map(|d| d.amt).fold(f64::NEG_INFINITY, |a, b| {
        if a.is_nan() || b.is_nan() {
            f64::NAN
        } else {
            a.max(b)
        }
    })
}

/// Expense totals for the six cycles ending at `anchor`'s, oldest first.
///
/// The TypeScript takes an optional month index to avoid scanning every entry.
/// That is a lookup table the store owns, and narrowing the input is the
/// caller's job either way — the answer is the same, so it does not cross.
pub fn six_month_trend(rows: &[DatedRow], anchor: Civil, cycle_start: i32) -> Vec<(Civil, f64)> {
    let base = cycle_range(anchor, cycle_start).start;
    (0..6)
        .rev()
        .map(|i| {
            // `d.setMonth(d.getMonth() - i)` on the cycle start, then re-ranged
            let shifted = Civil::new(base.y, base.m - i, base.d);
            let r = cycle_range(shifted, cycle_start);
            let total = rows
                .iter()
                .filter(|x| x.io == Some(Io::Exp) && x.day >= r.start && x.day < r.end)
                .map(|x| x.amt)
                .sum();
            (r.start, total)
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct Comparison {
    pub this_cum: Vec<f64>,
    pub last_cum: Vec<f64>,
    pub this_total: f64,
    pub last_total: f64,
    pub elapsed_days: i64,
}

/// Cumulative daily spend this cycle against the same elapsed days of the last.
///
/// The day an entry lands in is a calendar-day difference. Dividing raw epoch
/// stamps put every entry in the first hour of a day into the *previous* day's
/// column for the rest of a cycle that contained a spring-forward — not an edge
/// case at the transition, but a lasting offset.
pub fn comparison(rows: &[DatedRow], anchor: Civil, cycle_start: i32, today: Civil) -> Comparison {
    let r = cycle_range(anchor, cycle_start);
    let elapsed = elapsed_days(r.start, r.end, today);

    let daily = |from: Civil, to: Civil| {
        let mut arr = vec![0.0; elapsed as usize];
        for d in rows {
            if d.io != Some(Io::Exp) || d.day < from || d.day >= to {
                continue;
            }
            let day = from.days_until(d.day);
            if day >= 0 && day < elapsed {
                arr[day as usize] += d.amt;
            }
        }
        arr
    };

    let cum = |a: Vec<f64>| {
        let mut s = 0.0;
        a.into_iter()
            .map(|x| {
                s += x;
                s
            })
            .collect::<Vec<f64>>()
    };

    let last = cycle_range(Civil::new(r.start.y, r.start.m - 1, r.start.d), cycle_start);
    let this_cum = cum(daily(r.start, r.end));
    let last_cum = cum(daily(last.start, last.end));
    Comparison {
        this_total: this_cum.last().copied().unwrap_or(0.0),
        last_total: last_cum.last().copied().unwrap_or(0.0),
        this_cum,
        last_cum,
        elapsed_days: elapsed,
    }
}

/// What [`comparison`] adds up to, in a word.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Verdict {
    /// Nothing last cycle to measure against — a first month, or one where
    /// nothing was spent. Saying "¥300 more than last month" over a last
    /// month of zero is true and useless.
    NoBase,
    /// Within five per cent either way.
    Same,
    /// This much more than the same days last cycle.
    More(f64),
    /// This much less.
    Less(f64),
}

/// The headline over the this-cycle-against-last chart: 比上月同期多 ¥x.
///
/// The judgement was in the shipping view — `Math.abs(diff) / lastTotal <
/// 0.05` reads as the same — and nothing pinned it, because only the domain
/// was recorded for the corpus. It is here so the one number that decides
/// whether the screen says "more" is not decided by the screen.
pub fn verdict(this_total: f64, last_total: f64) -> Verdict {
    // `lastTotal > 0` is false for NaN as well as for nothing
    if last_total.is_nan() || last_total <= 0.0 {
        return Verdict::NoBase;
    }
    let diff = this_total - last_total;
    if diff.abs() / last_total < 0.05 {
        Verdict::Same
    } else if diff > 0.0 {
        Verdict::More(diff)
    } else {
        Verdict::Less(-diff)
    }
}

/// Spending's share of everything that moved, for the bar under 本月攒下的.
///
/// `exp / (exp + inc)`, from `SummaryCard.tsx`, and `None` when nothing
/// moved — the shipping card drew no bar at all then, rather than an empty
/// one that reads as "you spent nothing" when it means "there is nothing".
pub fn exp_share(exp: f64, inc: f64) -> Option<f64> {
    let flow = exp + inc;
    if flow > 0.0 {
        Some((exp / flow).clamp(0.0, 1.0))
    } else {
        None
    }
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

    fn c(y: i32, m: i32, d: i32) -> Civil {
        Civil::new(y, m, d)
    }

    fn dr(io: Io, amt: f64, day: Civil) -> DatedRow {
        DatedRow {
            io: Some(io),
            amt,
            day,
        }
    }

    #[test]
    fn the_first_day_of_a_cycle_has_one_day_elapsed() {
        let r = crate::cycle::cycle_range(c(2026, 5, 1), 1);
        assert_eq!(elapsed_days(r.start, r.end, c(2026, 5, 1)), 1);
        assert_eq!(elapsed_days(r.start, r.end, c(2026, 5, 10)), 10);
        assert_eq!(elapsed_days(r.start, r.end, c(2026, 5, 30)), 30);
    }

    #[test]
    fn elapsed_never_exceeds_the_cycle_and_never_falls_below_one() {
        let r = crate::cycle::cycle_range(c(2026, 5, 1), 1);
        // June has 30 days
        assert_eq!(elapsed_days(r.start, r.end, c(2026, 6, 15)), 30);
        // before the cycle even started
        assert_eq!(elapsed_days(r.start, r.end, c(2026, 4, 20)), 1);
    }

    #[test]
    fn elapsed_follows_a_cycle_that_does_not_start_on_the_first() {
        // payday on the 25th: the cycle containing June 3rd runs May 25 – Jun 25
        let r = crate::cycle::cycle_range(c(2026, 5, 3), 25);
        assert_eq!(r.start, c(2026, 4, 25));
        assert_eq!(elapsed_days(r.start, r.end, c(2026, 4, 25)), 1);
        assert_eq!(elapsed_days(r.start, r.end, c(2026, 5, 3)), 10);
    }

    #[test]
    fn stat_totals_reports_today_the_average_and_the_largest() {
        let rows = vec![
            dr(Io::Exp, 10.0, c(2026, 5, 1)),
            dr(Io::Exp, 30.0, c(2026, 5, 5)),
            dr(Io::Exp, 5.0, c(2026, 5, 5)),
            dr(Io::Inc, 900.0, c(2026, 5, 5)),
        ];
        let t = stat_totals(&rows, c(2026, 5, 5), 1, c(2026, 5, 5));
        assert_eq!(t.today_exp, 35.0);
        assert_eq!(t.top, 30.0);
        assert_eq!(t.count, 4); // every row, income included
        assert_eq!(t.avg, 45.0 / 5.0);
    }

    #[test]
    fn an_empty_cycle_has_no_largest_expense_rather_than_negative_infinity() {
        let t = stat_totals(&[], c(2026, 5, 5), 1, c(2026, 5, 5));
        assert_eq!(t.top, 0.0);
        assert_eq!(t.today_exp, 0.0);
        assert_eq!(t.avg, 0.0);
        assert_eq!(t.count, 0);
    }

    #[test]
    fn the_largest_expense_can_be_negative() {
        // `Math.max` of all-negative amounts is the least negative, not zero
        let rows = vec![
            dr(Io::Exp, -5.0, c(2026, 5, 1)),
            dr(Io::Exp, -2.0, c(2026, 5, 1)),
        ];
        assert_eq!(
            stat_totals(&rows, c(2026, 5, 1), 1, c(2026, 5, 1)).top,
            -2.0
        );
    }

    #[test]
    fn one_unparseable_amount_poisons_the_largest_the_way_math_max_does() {
        let rows = vec![
            dr(Io::Exp, 10.0, c(2026, 5, 1)),
            dr(Io::Exp, f64::NAN, c(2026, 5, 1)),
        ];
        assert!(stat_totals(&rows, c(2026, 5, 1), 1, c(2026, 5, 1))
            .top
            .is_nan());
    }

    #[test]
    fn the_six_month_trend_is_oldest_first_and_six_long() {
        let rows = vec![
            dr(Io::Exp, 10.0, c(2026, 5, 3)),  // June
            dr(Io::Exp, 20.0, c(2026, 4, 3)),  // May
            dr(Io::Exp, 30.0, c(2026, 0, 3)),  // January
            dr(Io::Inc, 900.0, c(2026, 5, 3)), // ignored
        ];
        let out = six_month_trend(&rows, c(2026, 5, 10), 1);
        assert_eq!(out.len(), 6);
        assert_eq!(out[0].0, c(2026, 0, 1)); // January, six cycles back
        assert_eq!(out[5].0, c(2026, 5, 1)); // June, the anchor's own
        assert_eq!(out[0].1, 30.0);
        assert_eq!(out[4].1, 20.0);
        assert_eq!(out[5].1, 10.0);
        assert_eq!(out[1].1, 0.0);
    }

    #[test]
    fn the_trend_crosses_a_year_boundary() {
        let out = six_month_trend(&[], c(2026, 1, 10), 1);
        assert_eq!(out[0].0, c(2025, 8, 1)); // September of the previous year
        assert_eq!(out[5].0, c(2026, 1, 1));
    }

    #[test]
    fn comparison_accumulates_day_by_day() {
        let rows = vec![
            dr(Io::Exp, 10.0, c(2026, 5, 1)),
            dr(Io::Exp, 20.0, c(2026, 5, 3)),
            dr(Io::Exp, 5.0, c(2026, 5, 3)),
        ];
        let cmp = comparison(&rows, c(2026, 5, 3), 1, c(2026, 5, 3));
        assert_eq!(cmp.elapsed_days, 3);
        assert_eq!(cmp.this_cum, vec![10.0, 10.0, 35.0]);
        assert_eq!(cmp.this_total, 35.0);
        assert_eq!(cmp.last_cum, vec![0.0, 0.0, 0.0]);
        assert_eq!(cmp.last_total, 0.0);
    }

    #[test]
    fn comparison_reads_the_previous_cycle_over_the_same_elapsed_days() {
        let rows = vec![
            dr(Io::Exp, 7.0, c(2026, 4, 2)),  // May, the previous cycle
            dr(Io::Exp, 1.0, c(2026, 4, 20)), // past the elapsed window
            dr(Io::Exp, 3.0, c(2026, 5, 1)),  // June
        ];
        let cmp = comparison(&rows, c(2026, 5, 2), 1, c(2026, 5, 2));
        assert_eq!(cmp.elapsed_days, 2);
        assert_eq!(cmp.this_cum, vec![3.0, 3.0]);
        // the May 20th row falls outside the two elapsed days and is dropped
        assert_eq!(cmp.last_cum, vec![0.0, 7.0]);
        assert_eq!(cmp.last_total, 7.0);
    }

    #[test]
    fn comparison_ignores_everything_that_is_not_an_expense() {
        let rows = vec![
            dr(Io::Inc, 900.0, c(2026, 5, 1)),
            dr(Io::Xfer, 500.0, c(2026, 5, 1)),
        ];
        let cmp = comparison(&rows, c(2026, 5, 1), 1, c(2026, 5, 1));
        assert_eq!(cmp.this_cum, vec![0.0]);
    }

    // ---- the verdict over the comparison ----

    #[test]
    fn five_per_cent_either_way_is_the_same() {
        assert_eq!(verdict(100.0, 100.0), Verdict::Same);
        assert_eq!(verdict(104.9, 100.0), Verdict::Same);
        assert_eq!(verdict(95.1, 100.0), Verdict::Same);
        // five per cent exactly is not under five per cent
        assert_eq!(verdict(105.0, 100.0), Verdict::More(5.0));
        assert_eq!(verdict(95.0, 100.0), Verdict::Less(5.0));
    }

    #[test]
    fn the_difference_is_said_as_a_positive_amount() {
        assert_eq!(verdict(300.0, 100.0), Verdict::More(200.0));
        assert_eq!(verdict(0.0, 100.0), Verdict::Less(100.0));
    }

    #[test]
    fn nothing_last_time_is_nothing_to_compare_with() {
        assert_eq!(verdict(50.0, 0.0), Verdict::NoBase);
        assert_eq!(verdict(50.0, -1.0), Verdict::NoBase);
        assert_eq!(verdict(50.0, f64::NAN), Verdict::NoBase);
    }

    #[test]
    fn spending_is_a_share_of_what_moved() {
        assert_eq!(exp_share(25.0, 75.0), Some(0.25));
        assert_eq!(exp_share(40.0, 0.0), Some(1.0));
        assert_eq!(exp_share(0.0, 0.0), None);
    }
}
