//! Three-tier budget status: the cycle pot, today's pot, and per-category caps.
//!
//! Ported from `src/domain/budget.ts`.
//!
//! [`cat_budget_rows`] takes its caps as an **ordered slice** rather than a map,
//! and that is not a stylistic choice. It sorts by percentage and the sort is
//! stable, so every tie is resolved by the order the caps arrived in — and ties
//! are the common case, not the edge one: every category with a cap and no
//! spending yet sits at exactly zero percent. A `BTreeMap` would order those
//! lexicographically where JavaScript orders them by insertion, and the
//! difference is visible in the app on the first day of every cycle. See
//! `MIGRATION.md`.

use crate::civil::Civil;
use crate::entry::{Entry, Io};
use crate::jsobj::object_keys;
use crate::num::desc_by_amt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TierStatus {
    /// The cap, or zero when unset. Never negative.
    pub limit: f64,
    pub used: f64,
    /// `limit - used`, so negative once over.
    pub left: f64,
    /// `used / limit * 100`, or zero when there is no limit.
    pub pct: f64,
    pub over: bool,
}

/// Status of a spend total against a cap. A cap of zero or less means "unset".
///
/// `limit > 0 ? limit : 0` is a comparison, not a clamp, so a `NaN` cap reads
/// as unset — every comparison against `NaN` is false. That falls out of the
/// TypeScript rather than being intended by it, but it is what ships: an
/// unparseable budget disables the tier instead of poisoning it.
pub fn tier_status(used: f64, limit: f64) -> TierStatus {
    let lim = if limit > 0.0 { limit } else { 0.0 };
    TierStatus {
        limit: lim,
        used,
        left: lim - used,
        pct: if lim > 0.0 { (used / lim) * 100.0 } else { 0.0 },
        over: lim > 0.0 && used > lim,
    }
}

/// Total expense across the given entries. Income and transfers are excluded.
pub fn expense_total(entries: &[Entry]) -> f64 {
    entries
        .iter()
        .filter(|d| d.io == Some(Io::Exp))
        .map(|d| d.amt)
        .sum()
}

/// One entry's direction, amount and calendar day.
///
/// `todayExpense` compares `new Date(d.ts).toDateString()` against the same for
/// `now`, which is a *local* calendar day and so needs the platform's zone.
/// The caller projects, as everywhere else in this crate.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DayRow {
    pub io: Option<Io>,
    pub amt: f64,
    pub day: Civil,
}

/// Expense booked on the same calendar day as `today`.
pub fn today_expense(rows: &[DayRow], today: Civil) -> f64 {
    rows.iter()
        .filter(|d| d.io == Some(Io::Exp) && d.day == today)
        .map(|d| d.amt)
        .sum()
}

/// The cycle pot: total expense against `settings.budget`.
pub fn monthly_status(cycle_entries: &[Entry], budget: f64) -> TierStatus {
    tier_status(expense_total(cycle_entries), budget)
}

/// Today's pot: today's expense against `settings.dailyBudget`.
pub fn daily_status(rows: &[DayRow], daily_budget: f64, today: Civil) -> TierStatus {
    tier_status(today_expense(rows, today), daily_budget)
}

#[derive(Debug, Clone, PartialEq)]
pub struct CatBudgetRow {
    pub cat: String,
    pub status: TierStatus,
}

/// One row per category that has a cap set, closest to its cap first.
///
/// `caps` is a map's entries **in insertion order**; [`object_keys`] applies
/// the one reordering JavaScript does to that. Caps of zero or less are dropped rather
/// than shown at zero percent — the filter is `cb[k] > 0`, so a `NaN` cap is
/// dropped too.
///
/// Spending is totalled over every entry first, including categories with no
/// cap, because the TypeScript builds its map before consulting the caps. The
/// wasted work is not worth diverging over.
pub fn cat_budget_rows(cycle_entries: &[Entry], caps: &[(String, f64)]) -> Vec<CatBudgetRow> {
    let mut spent: Vec<(&str, f64)> = Vec::new();
    for d in cycle_entries.iter().filter(|d| d.io == Some(Io::Exp)) {
        match spent.iter_mut().find(|(k, _)| *k == d.cat) {
            Some((_, v)) => *v += d.amt,
            None => spent.push((&d.cat, d.amt)),
        }
    }
    let mut rows: Vec<CatBudgetRow> = object_keys(caps)
        .into_iter()
        .filter(|(_, cap)| *cap > 0.0)
        .map(|(k, cap)| {
            let used = spent
                .iter()
                .find(|(c, _)| c == k)
                .map(|(_, v)| *v)
                .unwrap_or(0.0);
            CatBudgetRow {
                cat: k.clone(),
                status: tier_status(used, *cap),
            }
        })
        .collect();
    // Closest to the cap first, with an unusable percentage last. `sort_by` is
    // stable, so a genuine tie keeps `Object.keys` order — which is the case
    // that decides the screen on the first day of a cycle.
    rows.sort_by(|a, b| desc_by_amt(a.status.pct, b.status.pct));
    rows
}

/// How the budget's flower looks on 明细: fresh, wary, or wilted.
///
/// `BudgetPot.tsx` coloured the flower by how much of the cap was gone — its
/// own colours until four-fifths, the stamen's from there, a dry brown once
/// it was all spent — and the judgement lived in the view, where the corpus
/// never saw it. It is the one picture on the home screen that says "slow
/// down", so it is here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PotMood {
    Fresh,
    Wary,
    Wilted,
}

/// The mood for a tier. A cap that is not set has no mood: there is nothing
/// to be wary of.
pub fn pot_mood(status: &TierStatus) -> Option<PotMood> {
    if status.limit <= 0.0 {
        return None;
    }
    Some(if status.pct >= 100.0 {
        PotMood::Wilted
    } else if status.pct >= 80.0 {
        PotMood::Wary
    } else {
        PotMood::Fresh
    })
}

/// Which tier the flower follows: the cycle's pot when there is one, today's
/// when that is the only one set, and neither when neither is.
pub fn lead_tier<'a>(monthly: &'a TierStatus, daily: &'a TierStatus) -> Option<&'a TierStatus> {
    if monthly.limit > 0.0 {
        Some(monthly)
    } else if daily.limit > 0.0 {
        Some(daily)
    } else {
        None
    }
}

/// How full the bar is: the share of the cap used, held at a full bar once
/// over — `Math.min(pct, 100)` — and empty for a cap that is not a number.
pub fn pot_fill(status: &TierStatus) -> f64 {
    let f = status.pct / 100.0;
    if f.is_nan() {
        0.0
    } else {
        f.clamp(0.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exp(cat: &str, amt: f64) -> Entry {
        Entry {
            io: Some(Io::Exp),
            cat: cat.into(),
            amt,
            ..Default::default()
        }
    }

    fn cap(k: &str, v: f64) -> (String, f64) {
        (k.to_string(), v)
    }

    #[test]
    fn an_unset_cap_reports_zero_rather_than_a_percentage() {
        let s = tier_status(50.0, 0.0);
        assert_eq!(s.limit, 0.0);
        assert_eq!(s.left, -50.0);
        assert_eq!(s.pct, 0.0);
        assert!(!s.over);
    }

    #[test]
    fn a_negative_cap_is_unset_too() {
        assert_eq!(tier_status(10.0, -100.0).limit, 0.0);
    }

    #[test]
    fn a_nan_cap_reads_as_unset() {
        // `limit > 0` is false for NaN, so the tier switches off rather than
        // reporting NaN percent
        let s = tier_status(10.0, f64::NAN);
        assert_eq!(s.limit, 0.0);
        assert_eq!(s.pct, 0.0);
        assert!(!s.over);
    }

    #[test]
    fn over_is_strict() {
        assert!(!tier_status(100.0, 100.0).over);
        assert!(tier_status(100.01, 100.0).over);
    }

    #[test]
    fn totals_exclude_income_and_transfers() {
        let entries = vec![
            exp("food", 10.0),
            Entry {
                io: Some(Io::Inc),
                amt: 500.0,
                ..Default::default()
            },
            Entry {
                io: Some(Io::Xfer),
                amt: 50.0,
                ..Default::default()
            },
            exp("rent", 20.0),
        ];
        assert_eq!(expense_total(&entries), 30.0);
    }

    #[test]
    fn today_is_a_calendar_day() {
        let rows = vec![
            DayRow {
                io: Some(Io::Exp),
                amt: 10.0,
                day: Civil::new(2026, 5, 10),
            },
            DayRow {
                io: Some(Io::Exp),
                amt: 20.0,
                day: Civil::new(2026, 5, 11),
            },
            DayRow {
                io: Some(Io::Inc),
                amt: 99.0,
                day: Civil::new(2026, 5, 10),
            },
        ];
        assert_eq!(today_expense(&rows, Civil::new(2026, 5, 10)), 10.0);
    }

    #[test]
    fn rows_are_closest_to_the_cap_first() {
        let entries = vec![exp("food", 90.0), exp("rent", 10.0)];
        let caps = vec![cap("food", 100.0), cap("rent", 100.0)];
        let rows = cat_budget_rows(&entries, &caps);
        assert_eq!(rows[0].cat, "food");
        assert_eq!(rows[0].status.pct, 90.0);
        assert_eq!(rows[1].cat, "rent");
    }

    #[test]
    fn an_unspent_tie_keeps_the_order_the_caps_arrived_in() {
        // the common case, not the edge one: on the first day of a cycle every
        // capped category sits at exactly zero percent, and the only thing
        // deciding the order on screen is this
        let caps = vec![cap("zed", 100.0), cap("alpha", 100.0), cap("mid", 100.0)];
        let rows = cat_budget_rows(&[], &caps);
        let order: Vec<&str> = rows.iter().map(|r| r.cat.as_str()).collect();
        assert_eq!(order, vec!["zed", "alpha", "mid"]);
    }

    #[test]
    fn a_cap_of_zero_or_less_is_not_a_row() {
        let caps = vec![
            cap("a", 0.0),
            cap("b", -1.0),
            cap("c", f64::NAN),
            cap("d", 5.0),
        ];
        let rows = cat_budget_rows(&[], &caps);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].cat, "d");
    }

    #[test]
    fn integer_like_keys_come_first_in_numeric_order() {
        // `Object.keys({b, 10, a, 2})` is `['2', '10', 'b', 'a']` — the array
        // indices ascend numerically ahead of everything, and only the rest
        // keep insertion order
        let caps = vec![cap("b", 1.0), cap("10", 1.0), cap("a", 1.0), cap("2", 1.0)];
        let rows = cat_budget_rows(&[], &caps);
        let order: Vec<&str> = rows.iter().map(|r| r.cat.as_str()).collect();
        assert_eq!(order, vec!["2", "10", "b", "a"]);
    }

    #[test]
    fn an_unusable_percentage_sorts_last() {
        // `b.pct - a.pct` used to be the comparator, and a NaN result made the
        // whole order implementation-defined. Now NaN ranks last, everywhere.
        let entries = vec![exp("a", f64::NAN)];
        let caps = vec![cap("a", 10.0), cap("b", 10.0)];
        let rows = cat_budget_rows(&entries, &caps);
        assert_eq!(rows[0].cat, "b");
        assert_eq!(rows[1].cat, "a");
    }

    // ---- the flower on 明细 ----

    #[test]
    fn the_flower_wilts_as_the_budget_goes() {
        let mood = |used: f64| pot_mood(&tier_status(used, 1000.0));
        assert_eq!(mood(0.0), Some(PotMood::Fresh));
        assert_eq!(mood(799.0), Some(PotMood::Fresh));
        assert_eq!(mood(800.0), Some(PotMood::Wary));
        assert_eq!(mood(999.0), Some(PotMood::Wary));
        assert_eq!(mood(1000.0), Some(PotMood::Wilted));
        assert_eq!(mood(5000.0), Some(PotMood::Wilted));
    }

    #[test]
    fn a_cap_that_is_not_set_has_no_mood() {
        assert_eq!(pot_mood(&tier_status(50.0, 0.0)), None);
        assert_eq!(pot_mood(&tier_status(50.0, f64::NAN)), None);
    }

    #[test]
    fn the_cycle_leads_and_today_stands_in() {
        let m = tier_status(10.0, 100.0);
        let d = tier_status(5.0, 20.0);
        let none = tier_status(5.0, 0.0);
        assert_eq!(lead_tier(&m, &d), Some(&m));
        assert_eq!(lead_tier(&none, &d), Some(&d));
        assert_eq!(lead_tier(&none, &none), None);
    }

    #[test]
    fn the_bar_stops_at_full() {
        assert_eq!(pot_fill(&tier_status(250.0, 1000.0)), 0.25);
        assert_eq!(pot_fill(&tier_status(3000.0, 1000.0)), 1.0);
        assert_eq!(pot_fill(&tier_status(10.0, 0.0)), 0.0);
    }
}
