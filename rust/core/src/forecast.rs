//! 下月预测 — the next cycle's spending, from the three before this one.
//!
//! Ported from `src/ai/forecast.ts`, which the shipping 洞察 screen drew and
//! the port left behind; the README went on saying the app had it. Despite
//! the folder it lived in, it is no model: a least-squares line through the
//! last three cycles' expense totals, read one cycle on, and the same line
//! per category. The corpus never recorded it, so its tests are the shipping
//! file's own, carried across.
//!
//! One thing is added: [`Forecast::enough`]. The shipping screen decided
//! "not enough history" by a confidence of zero, and a history the line
//! explains nothing of — 100, 300, 100 — has exactly that, so a user with
//! three months behind them was told to keep logging.

use crate::civil::Civil;
use crate::cycle::{cycle_range, shift_cycle};
use crate::entry::Io;
use crate::num::js_round;
use crate::statement::DatedEntry;

/// Which way the three cycles are heading.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trend {
    Increasing,
    Decreasing,
    Stable,
}

impl Trend {
    pub fn as_str(self) -> &'static str {
        match self {
            Trend::Increasing => "increasing",
            Trend::Decreasing => "decreasing",
            Trend::Stable => "stable",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CategoryForecast {
    pub cat: String,
    pub predicted: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Forecast {
    /// The next cycle's expense, to the cent, never below zero.
    pub predicted: f64,
    /// R² of the line, to two places: how much of the three cycles it
    /// explains. 0..=1.
    pub confidence: f64,
    pub trend: Trend,
    /// Each category the three cycles spent on, its own line read one on,
    /// largest first; ties keep the order the categories were first seen.
    pub breakdown: Vec<CategoryForecast>,
    /// Any of the three cycles spent anything. What the screen asks before it
    /// shows a forecast — see the module docs.
    pub enough: bool,
}

/// Round to the cent the way the shipping file did: `Math.round(x * 100) / 100`.
fn cents(x: f64) -> f64 {
    js_round(x * 100.0) / 100.0
}

/// A least-squares line through `ys` at x = 0, 1, 2…: `(a, b)` in y = a + b·x.
fn line(ys: &[f64]) -> (f64, f64) {
    let n = ys.len() as f64;
    let sum_x: f64 = (0..ys.len()).map(|i| i as f64).sum();
    let sum_y: f64 = ys.iter().sum();
    let sum_xy: f64 = ys.iter().enumerate().map(|(i, y)| i as f64 * y).sum();
    let sum_x2: f64 = (0..ys.len()).map(|i| (i * i) as f64).sum();
    let denom = n * sum_x2 - sum_x * sum_x;
    let b = if denom == 0.0 {
        0.0
    } else {
        (n * sum_xy - sum_x * sum_y) / denom
    };
    let a = (sum_y - b * sum_x) / n;
    (a, b)
}

/// The cycle after the one `anchor` is in, from the three before it.
///
/// `rows` are live entries with the local day the platform gave each; only
/// expenses count. `cycle_start` is the setting, so a cycle here is the one
/// 明细 and 统计 mean.
pub fn forecast(rows: &[DatedEntry], cycle_start: i32, anchor: Civil) -> Forecast {
    // Per-cycle totals oldest first, and per category in the order first seen.
    let mut totals = [0.0_f64; 3];
    let mut cats: Vec<(String, [f64; 3])> = Vec::new();
    for (slot, back) in (1..=3).rev().enumerate() {
        let r = cycle_range(shift_cycle(anchor, -back, cycle_start), cycle_start);
        for d in rows {
            if d.entry.io != Some(Io::Exp) || d.day < r.start || d.day >= r.end {
                continue;
            }
            totals[slot] += d.entry.amt;
            match cats.iter_mut().find(|(k, _)| *k == d.entry.cat) {
                Some((_, v)) => v[slot] += d.entry.amt,
                None => {
                    let mut v = [0.0; 3];
                    v[slot] = d.entry.amt;
                    cats.push((d.entry.cat.clone(), v));
                }
            }
        }
    }

    let enough = totals.iter().any(|t| *t > 0.0);
    if !enough {
        return Forecast {
            predicted: 0.0,
            confidence: 0.0,
            trend: Trend::Stable,
            breakdown: Vec::new(),
            enough,
        };
    }

    let (a, b) = line(&totals);
    let predicted = cents(a + b * 3.0).max(0.0);

    let mean = totals.iter().sum::<f64>() / 3.0;
    let slope_ratio = if mean == 0.0 { 0.0 } else { b.abs() / mean };
    let trend = if slope_ratio > 0.05 {
        if b > 0.0 {
            Trend::Increasing
        } else {
            Trend::Decreasing
        }
    } else {
        Trend::Stable
    };

    let ss_res: f64 = totals
        .iter()
        .enumerate()
        .map(|(i, y)| (y - (a + b * i as f64)).powi(2))
        .sum();
    let ss_tot: f64 = totals.iter().map(|y| (y - mean).powi(2)).sum();
    let r2 = if ss_tot == 0.0 {
        1.0
    } else {
        (1.0 - ss_res / ss_tot).max(0.0)
    };
    let confidence = js_round(r2 * 100.0) / 100.0;

    let mut breakdown: Vec<CategoryForecast> = cats
        .into_iter()
        .filter(|(_, v)| v.iter().sum::<f64>() != 0.0)
        .map(|(cat, v)| {
            let (ca, cb) = line(&v);
            CategoryForecast {
                cat,
                predicted: cents(ca + cb * 3.0).max(0.0),
            }
        })
        .collect();
    // `sort((a, b) => b.predicted - a.predicted)`, stable
    breakdown.sort_by(|x, y| {
        y.predicted
            .partial_cmp(&x.predicted)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Forecast {
        predicted,
        confidence,
        trend,
        breakdown,
        enough,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::Entry;

    // The shipping tests' anchor: 6 July 2026, cycles on the 1st, so the three
    // before are April, May and June.
    fn anchor() -> Civil {
        Civil::new(2026, 7, 6)
    }

    fn row(y: i32, m: i32, d: i32, amt: f64, cat: &str) -> DatedEntry {
        row_io(y, m, d, amt, cat, Io::Exp)
    }

    fn row_io(y: i32, m: i32, d: i32, amt: f64, cat: &str, io: Io) -> DatedEntry {
        DatedEntry {
            entry: Entry {
                io: Some(io),
                cat: cat.into(),
                amt,
                ..Default::default()
            },
            day: Civil::new(y, m, d),
        }
    }

    #[test]
    fn nothing_behind_it_is_nothing_ahead() {
        let f = forecast(&[], 1, anchor());
        assert_eq!(f.predicted, 0.0);
        assert_eq!(f.trend, Trend::Stable);
        assert_eq!(f.confidence, 0.0);
        assert!(f.breakdown.is_empty());
        assert!(!f.enough);
    }

    #[test]
    fn three_cycles_make_a_forecast() {
        let rows = [
            row(2026, 4, 5, 100.0, "food"),
            row(2026, 4, 15, 200.0, "trans"),
            row(2026, 5, 3, 120.0, "food"),
            row(2026, 5, 20, 180.0, "trans"),
            row(2026, 6, 10, 130.0, "food"),
            row(2026, 6, 22, 170.0, "trans"),
        ];
        let f = forecast(&rows, 1, anchor());
        assert!(f.predicted > 0.0);
        assert!(f.confidence > 0.0);
        assert!(!f.breakdown.is_empty());
        assert!(f.enough);
    }

    #[test]
    fn rising_reads_as_rising_and_runs_on() {
        let rows = [
            row(2026, 4, 5, 200.0, "food"),
            row(2026, 5, 5, 400.0, "food"),
            row(2026, 6, 5, 600.0, "food"),
        ];
        let f = forecast(&rows, 1, anchor());
        assert_eq!(f.trend, Trend::Increasing);
        assert_eq!(f.predicted, 800.0);
        assert_eq!(f.confidence, 1.0);
    }

    #[test]
    fn falling_reads_as_falling() {
        let rows = [
            row(2026, 4, 5, 600.0, "food"),
            row(2026, 5, 5, 400.0, "food"),
            row(2026, 6, 5, 200.0, "food"),
        ];
        let f = forecast(&rows, 1, anchor());
        assert_eq!(f.trend, Trend::Decreasing);
        assert!(f.predicted < 200.0);
    }

    #[test]
    fn a_line_never_forecasts_spending_below_zero() {
        let rows = [
            row(2026, 4, 5, 900.0, "food"),
            row(2026, 5, 5, 300.0, "food"),
            row(2026, 6, 5, 10.0, "food"),
        ];
        assert_eq!(forecast(&rows, 1, anchor()).predicted, 0.0);
    }

    #[test]
    fn flat_is_stable() {
        let rows = [
            row(2026, 4, 5, 200.0, "food"),
            row(2026, 5, 5, 200.0, "food"),
            row(2026, 6, 5, 200.0, "food"),
        ];
        let f = forecast(&rows, 1, anchor());
        assert_eq!(f.trend, Trend::Stable);
        // nothing to explain is explained completely
        assert_eq!(f.confidence, 1.0);
    }

    #[test]
    fn confidence_is_between_zero_and_one() {
        let rows = [
            row(2026, 4, 5, 100.0, "food"),
            row(2026, 5, 5, 150.0, "food"),
            row(2026, 6, 5, 120.0, "food"),
        ];
        let c = forecast(&rows, 1, anchor()).confidence;
        assert!((0.0..=1.0).contains(&c));
    }

    #[test]
    fn a_history_the_line_explains_nothing_of_is_still_enough() {
        // the shipping screen read confidence 0 as "not enough history"
        let rows = [
            row(2026, 4, 5, 100.0, "food"),
            row(2026, 5, 5, 300.0, "food"),
            row(2026, 6, 5, 100.0, "food"),
        ];
        let f = forecast(&rows, 1, anchor());
        assert_eq!(f.confidence, 0.0);
        assert!(f.enough);
        assert!(f.predicted > 0.0);
    }

    #[test]
    fn the_categories_add_up_to_the_whole() {
        let rows = [
            row(2026, 4, 5, 100.0, "food"),
            row(2026, 4, 15, 50.0, "trans"),
            row(2026, 5, 5, 110.0, "food"),
            row(2026, 5, 15, 60.0, "trans"),
            row(2026, 6, 5, 120.0, "food"),
            row(2026, 6, 15, 70.0, "trans"),
        ];
        let f = forecast(&rows, 1, anchor());
        let sum: f64 = f.breakdown.iter().map(|b| b.predicted).sum();
        assert!((sum - f.predicted).abs() < 1.0);
        assert_eq!(f.breakdown[0].cat, "food", "largest first");
    }

    #[test]
    fn income_and_transfers_do_not_count() {
        let rows = [
            row(2026, 4, 5, 100.0, "food"),
            row_io(2026, 4, 10, 5000.0, "salary", Io::Inc),
            row_io(2026, 4, 12, 1000.0, "transfer", Io::Xfer),
            row(2026, 5, 5, 100.0, "food"),
            row(2026, 6, 5, 100.0, "food"),
        ];
        let f = forecast(&rows, 1, anchor());
        assert!(f.predicted > 0.0 && f.predicted < 200.0);
        assert!(f.breakdown.iter().all(|b| b.cat == "food"));
    }

    #[test]
    fn this_cycle_is_not_one_of_the_three() {
        // July is the cycle under way: half a month would drag the line down
        let rows = [
            row(2026, 4, 5, 300.0, "food"),
            row(2026, 5, 5, 300.0, "food"),
            row(2026, 6, 5, 300.0, "food"),
            row(2026, 7, 2, 5.0, "food"),
        ];
        assert_eq!(forecast(&rows, 1, anchor()).predicted, 300.0);
    }

    #[test]
    fn the_cycle_start_is_the_setting() {
        // on the 25th: the three before 6 July are Mar 25–Apr 24, Apr 25–May
        // 24 and May 25–Jun 24
        let rows = [
            row(2026, 3, 28, 100.0, "food"),
            row(2026, 4, 30, 200.0, "food"),
            row(2026, 5, 30, 300.0, "food"),
        ];
        let f = forecast(&rows, 25, anchor());
        assert_eq!(f.predicted, 400.0);
        assert_eq!(f.trend, Trend::Increasing);
    }
}
