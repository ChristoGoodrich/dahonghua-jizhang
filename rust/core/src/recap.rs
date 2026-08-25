//! The month-recap card: what a cycle came to, in six numbers.
//!
//! Ported from `src/domain/recap.ts`.

use crate::entry::{Entry, Io};
use crate::jsobj::object_keys;
use crate::num::desc_by_amt;

#[derive(Debug, Clone, PartialEq)]
pub struct Recap {
    pub exp: f64,
    pub inc: f64,
    /// Income less expense.
    pub net: f64,
    /// Every entry in the cycle, transfers included.
    pub count: usize,
    /// Distinct calendar days with an entry on them.
    pub active_days: usize,
    pub top_cat_key: Option<String>,
    pub top_cat_amt: f64,
}

/// Summarise a cycle's entries.
///
/// `days` is each entry's local calendar day, in the same order — the day is
/// the platform's to resolve, as everywhere else here.
///
/// Two shapes worth naming, both reproduced rather than tidied:
///
/// * `count` counts transfers, though neither total does. It is "how many rows
///   are in this cycle", not "how many moved money one way".
/// * `topCatKey ? byCat[topCatKey] : 0` is a truthiness test, so a category
///   whose key is the **empty string** reports an amount of zero while still
///   being named as the top category. An empty key is reachable through a
///   malformed import.
pub fn month_recap(entries: &[Entry], days: &[crate::civil::Civil]) -> Recap {
    let exp: f64 = entries
        .iter()
        .filter(|d| d.io == Some(Io::Exp))
        .map(|d| d.amt)
        .sum();
    let inc: f64 = entries
        .iter()
        .filter(|d| d.io == Some(Io::Inc))
        .map(|d| d.amt)
        .sum();

    // `byCat[d.cat] = (byCat[d.cat] || 0) + d.amt` — an object, so the keys
    // come back in `Object.keys` order rather than insertion order
    let mut by_cat: Vec<(String, f64)> = Vec::new();
    for d in entries.iter().filter(|d| d.io == Some(Io::Exp)) {
        match by_cat.iter_mut().find(|(k, _)| *k == d.cat) {
            // `|| 0` — a running total of NaN restarts from zero
            Some((_, v)) => *v = if v.is_nan() { 0.0 } else { *v } + d.amt,
            None => by_cat.push((d.cat.clone(), d.amt)),
        }
    }
    let mut keys = object_keys(&by_cat);
    keys.sort_by(|a, b| desc_by_amt(a.1, b.1));
    let top = keys.first();

    let mut seen: Vec<crate::civil::Civil> = Vec::new();
    for d in days {
        if !seen.contains(d) {
            seen.push(*d);
        }
    }

    Recap {
        exp,
        inc,
        net: inc - exp,
        count: entries.len(),
        active_days: seen.len(),
        top_cat_key: top.map(|(k, _)| k.clone()),
        // the truthiness test: an empty key reports zero
        top_cat_amt: match top {
            Some((k, v)) if !k.is_empty() => *v,
            _ => 0.0,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::civil::Civil;

    fn e(io: Io, cat: &str, amt: f64) -> Entry {
        Entry {
            io: Some(io),
            cat: cat.into(),
            amt,
            ..Default::default()
        }
    }

    const D1: Civil = Civil {
        y: 2026,
        m: 5,
        d: 10,
    };
    const D2: Civil = Civil {
        y: 2026,
        m: 5,
        d: 11,
    };

    #[test]
    fn totals_split_by_direction_and_count_everything() {
        let entries = vec![
            e(Io::Exp, "food", 30.0),
            e(Io::Inc, "pay", 500.0),
            e(Io::Xfer, "", 100.0),
        ];
        let r = month_recap(&entries, &[D1, D1, D2]);
        assert_eq!(r.exp, 30.0);
        assert_eq!(r.inc, 500.0);
        assert_eq!(r.net, 470.0);
        assert_eq!(r.count, 3); // the transfer counts here and in neither total
        assert_eq!(r.active_days, 2);
    }

    #[test]
    fn the_top_category_is_the_biggest_expense() {
        let entries = vec![
            e(Io::Exp, "food", 30.0),
            e(Io::Exp, "rent", 900.0),
            e(Io::Exp, "food", 20.0),
        ];
        let r = month_recap(&entries, &[D1, D1, D1]);
        assert_eq!(r.top_cat_key.as_deref(), Some("rent"));
        assert_eq!(r.top_cat_amt, 900.0);
    }

    #[test]
    fn an_unusable_amount_does_not_win() {
        let entries = vec![
            e(Io::Exp, "bad", f64::NAN),
            e(Io::Exp, "food", 10.0),
            e(Io::Exp, "rent", 5.0),
        ];
        let r = month_recap(&entries, &[D1, D1, D1]);
        assert_eq!(r.top_cat_key.as_deref(), Some("food"));
    }

    #[test]
    fn an_empty_category_key_reports_no_amount() {
        // `topCatKey ? byCat[topCatKey] : 0` — falsy means absent, again
        let entries = vec![e(Io::Exp, "", 900.0), e(Io::Exp, "food", 10.0)];
        let r = month_recap(&entries, &[D1, D1]);
        assert_eq!(r.top_cat_key.as_deref(), Some(""));
        assert_eq!(r.top_cat_amt, 0.0);
    }

    #[test]
    fn no_expenses_means_no_top_category() {
        let entries = vec![e(Io::Inc, "pay", 500.0)];
        let r = month_recap(&entries, &[D1]);
        assert_eq!(r.top_cat_key, None);
        assert_eq!(r.top_cat_amt, 0.0);
    }

    #[test]
    fn an_empty_cycle_is_all_zeroes() {
        let r = month_recap(&[], &[]);
        assert_eq!(r.exp, 0.0);
        assert_eq!(r.count, 0);
        assert_eq!(r.active_days, 0);
        assert_eq!(r.top_cat_key, None);
    }

    #[test]
    fn a_tie_is_won_by_object_key_order() {
        // `2` is an array index and so is walked ahead of `food`, whatever
        // order the entries arrived in; the sort is stable, so it wins the tie
        let entries = vec![e(Io::Exp, "food", 10.0), e(Io::Exp, "2", 10.0)];
        let r = month_recap(&entries, &[D1, D1]);
        assert_eq!(r.top_cat_key.as_deref(), Some("2"));
    }
}
