//! The insight banner: one line telling the user the most useful thing about
//! their spending right now.
//!
//! Ported from `src/domain/insight.ts`.
//!
//! **The copy is the caller's.** Everything that decides *which* line to show —
//! the priority order, the thresholds, the rounding, which category counts as
//! the biggest — is here and is checked against the shipping code case by case.
//! The words themselves are UI text and arrive as [`InsightCopy`], because a
//! table of Chinese and English marketing sentences is not domain logic and
//! putting one in the core would make every copy tweak a Rust change.
//!
//! Category *names* are a different thing and do live in [`crate::catalog`]:
//! they are data the ledger is keyed by, not phrasing.

use crate::budget::{daily_status, DayRow};
use crate::catalog::{cat_name, cat_of, Category};
use crate::civil::Civil;
use crate::entry::{Entry, Io};
use crate::jsobj::object_keys;
use crate::money::fmt_short;
use crate::num::{desc_by_amt, js_round};
use crate::statement::{due_soon, DatedEntry};

#[derive(Debug, Clone, PartialEq)]
pub struct Insight {
    /// The leading emoji.
    pub ic: String,
    pub text: String,
    /// Set when the insight is about one account, so the banner can link there.
    pub acct_id: Option<String>,
}

/// The sentences the banner is built from.
///
/// `%s` and `%d` are substituted **once each**, left to right, because the
/// TypeScript spells the substitution as `String.prototype.replace(string, …)`
/// where it uses one at all — and that replaces the first occurrence only. The
/// rest are template literals with one site per value, which comes to the same
/// thing. Every substituted value is a number or a name; none can contain a
/// marker itself.
#[derive(Debug, Clone, Copy)]
pub struct InsightCopy<'a> {
    /// Budget fully spent. No markers.
    pub over_budget: &'a str,
    /// Budget 80% spent. `%d` is the whole-number percentage.
    pub near_budget: &'a str,
    /// Over today's budget. `%s` is the whole-number amount over.
    pub daily_over: &'a str,
    /// A category over its cap. `%s` name, `%a` spent, `%b` cap.
    pub cat_over: &'a str,
    /// The biggest category. `%s` name, `%d` percentage.
    pub top_cat: &'a str,
    /// A card's repayment. `%s` account name, `%w` the timing phrase, `%a` amount.
    pub credit_due: &'a str,
    /// `%d` days until due.
    pub days_left: &'a str,
    /// Due today. No markers.
    pub due_today: &'a str,
    /// `%d` days overdue.
    pub overdue: &'a str,
}

/// Fill a template's markers in **one left-to-right pass**, each marker
/// consumed at most once.
///
/// One pass rather than a chain of replacements, because a value can contain
/// another marker: a user's own category name of `%a` would be rewritten again
/// by the next step, where the template literal it stands in for could not
/// possibly do that. Consuming each marker once also reproduces
/// `String.prototype.replace(string, …)`, which the TypeScript uses for the
/// three sentences that come from the phrase table and which replaces the first
/// occurrence only.
fn fill(template: &str, pairs: &[(&str, &str)]) -> String {
    let mut used = vec![false; pairs.len()];
    let mut out = String::with_capacity(template.len());
    let b = template.as_bytes();
    let mut i = 0;
    'outer: while i < b.len() {
        for (n, (marker, value)) in pairs.iter().enumerate() {
            if !used[n] && template[i..].starts_with(marker) {
                out.push_str(value);
                used[n] = true;
                i += marker.len();
                continue 'outer;
            }
        }
        // advance one whole character, not one byte
        let step = template[i..]
            .chars()
            .next()
            .map(char::len_utf8)
            .unwrap_or(1);
        out.push_str(&template[i..i + step]);
        i += step;
    }
    out
}

/// `Math.round`, then rendered the way JavaScript renders a number.
fn r(x: f64) -> String {
    crate::num::js_num(js_round(x))
}

/// A repayment reminder for the card whose statement is due soonest.
///
/// `None` when nothing is due inside a week. Past-due cards count, and count
/// first — their day number is negative. Higher priority than any spending
/// insight because it is money with a deadline.
pub fn credit_due_insight(
    accounts: &[crate::accounts::Account],
    rows: &[DatedEntry],
    today: Civil,
    zh: bool,
    symbol: &str,
    copy: &InsightCopy,
) -> Option<Insight> {
    let due = due_soon(accounts, rows, today, 7);
    let r0 = due.first()?;
    // `r.account.nameEn || r.account.name` — an empty English name falls back
    // rather than showing blank
    let name = if zh {
        r0.account.name.clone()
    } else {
        r0.account
            .name_en
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(&r0.account.name)
            .to_string()
    };
    let when = match r0.days_to_due {
        d if d > 0 => fill(copy.days_left, &[("%d", &d.to_string())]),
        0 => copy.due_today.to_string(),
        d => fill(copy.overdue, &[("%d", &(-d).to_string())]),
    };
    let text = fill(
        copy.credit_due,
        &[
            ("%s", &name),
            ("%w", &when),
            ("%a", &fmt_short(r0.billed_due, symbol)),
        ],
    );
    Some(Insight {
        ic: "💳".to_string(),
        text,
        acct_id: Some(r0.account.id.clone()),
    })
}

/// The spending insight for the current cycle.
///
/// Priority, in order: the whole-cycle budget, then today's budget, then the
/// first category over its cap, then the biggest category. `None` until there
/// are three expenses to talk about — a banner drawn from one lunch says
/// nothing.
/// The three budget tiers, as `Settings` holds them.
#[derive(Debug, Clone, Copy)]
pub struct Budgets<'a> {
    /// The whole-cycle pot.
    pub budget: f64,
    /// Per-category caps, in `Object.keys` order.
    pub cat_budgets: &'a [(String, f64)],
    pub daily: f64,
}

pub fn compute_insight(
    cycle_entries: &[Entry],
    days: &[DayRow],
    budgets: Budgets,
    custom_exp: &[Category],
    today: Civil,
    zh: bool,
    copy: &InsightCopy,
) -> Option<Insight> {
    let Budgets {
        budget,
        cat_budgets,
        daily: daily_budget,
    } = budgets;
    let md: Vec<&Entry> = cycle_entries
        .iter()
        .filter(|d| d.io == Some(Io::Exp))
        .collect();
    if md.len() < 3 {
        return None;
    }

    // `settings.budget && settings.budget > 0` — the truthiness test in front
    // is redundant against the comparison, and reproduced because it costs
    // nothing to be exact about it
    if budget != 0.0 && !budget.is_nan() && budget > 0.0 {
        let exp: f64 = md.iter().map(|d| d.amt).sum();
        let pct = (exp / budget) * 100.0;
        if pct >= 100.0 {
            return Some(Insight {
                ic: "🥀".into(),
                text: copy.over_budget.to_string(),
                acct_id: None,
            });
        }
        if pct >= 80.0 {
            return Some(Insight {
                ic: "🌼".into(),
                text: fill(copy.near_budget, &[("%d", &r(pct))]),
                acct_id: None,
            });
        }
    }

    // `dailyStatus(md, settings)` — note it is handed the *expense-only* list,
    // and reads today's date off the clock
    let daily = daily_status(days, daily_budget, today);
    if daily.over {
        return Some(Insight {
            ic: "⏳".into(),
            text: fill(copy.daily_over, &[("%s", &r(daily.used - daily.limit))]),
            acct_id: None,
        });
    }

    // totals per category, in the order the categories were first seen
    let mut by_cat: Vec<(&str, f64)> = Vec::new();
    for d in &md {
        match by_cat.iter_mut().find(|(k, _)| *k == d.cat) {
            Some((_, v)) => *v += d.amt,
            None => by_cat.push((&d.cat, d.amt)),
        }
    }

    // the *first* category over its cap, and first means first in `Object.keys`
    // order — which is not insertion order when a key looks like an integer
    for (k, cap) in object_keys(cat_budgets) {
        let spent = by_cat
            .iter()
            .find(|(c, _)| c == k)
            .map(|(_, v)| *v)
            .unwrap_or(0.0);
        if spent > *cap {
            let c = cat_of(Io::Exp, k, custom_exp);
            return Some(Insight {
                ic: "🪻".into(),
                text: fill(
                    copy.cat_over,
                    &[
                        ("%s", &cat_name(&c, zh)),
                        ("%a", &r(spent)),
                        ("%b", &r(*cap)),
                    ],
                ),
                acct_id: None,
            });
        }
    }

    // Biggest first, unusable last, stable — so a genuine tie is won by the
    // category seen first
    let mut sorted = by_cat.clone();
    sorted.sort_by(|a, b| desc_by_amt(a.1, b.1));
    // `sorted[0]` cannot be missing: three expenses make at least one category
    let (top_k, top_amt) = sorted[0];
    let total: f64 = md.iter().map(|d| d.amt).sum();
    let c = cat_of(Io::Exp, top_k, custom_exp);
    Some(Insight {
        ic: "🔍".into(),
        text: fill(
            copy.top_cat,
            &[
                ("%s", &cat_name(&c, zh)),
                ("%d", &r((top_amt / total) * 100.0)),
            ],
        ),
        acct_id: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const COPY: InsightCopy = InsightCopy {
        over_budget: "over",
        near_budget: "near %d",
        daily_over: "daily %s",
        cat_over: "cat %s %a/%b",
        top_cat: "top %s %d",
        credit_due: "%s %w %a",
        days_left: "in %d days",
        due_today: "today",
        overdue: "%d days late",
    };

    fn exp(cat: &str, amt: f64) -> Entry {
        Entry {
            io: Some(Io::Exp),
            cat: cat.into(),
            amt,
            ..Default::default()
        }
    }

    fn day(amt: f64, d: Civil) -> DayRow {
        DayRow {
            io: Some(Io::Exp),
            amt,
            day: d,
        }
    }

    const TODAY: Civil = Civil {
        y: 2026,
        m: 5,
        d: 10,
    };

    fn insight(
        entries: &[Entry],
        budget: f64,
        caps: &[(String, f64)],
        daily: f64,
    ) -> Option<Insight> {
        let b = Budgets {
            budget,
            cat_budgets: caps,
            daily,
        };
        compute_insight(entries, &[], b, &[], TODAY, false, &COPY)
    }

    #[test]
    fn fewer_than_three_expenses_says_nothing() {
        let e = vec![exp("food", 10.0), exp("food", 10.0)];
        assert!(insight(&e, 100.0, &[], 0.0).is_none());
        // income does not count toward the three
        let e = vec![
            exp("food", 10.0),
            exp("food", 10.0),
            Entry {
                io: Some(Io::Inc),
                amt: 500.0,
                ..Default::default()
            },
        ];
        assert!(insight(&e, 100.0, &[], 0.0).is_none());
    }

    #[test]
    fn a_spent_budget_outranks_everything() {
        let e = vec![exp("food", 40.0), exp("food", 40.0), exp("food", 40.0)];
        let r = insight(&e, 100.0, &[("food".into(), 1.0)], 1.0).unwrap();
        assert_eq!(r.ic, "🥀");
        assert_eq!(r.text, "over");
    }

    #[test]
    fn eighty_percent_warns_with_a_rounded_percentage() {
        let e = vec![exp("food", 30.0), exp("food", 30.0), exp("food", 25.5)];
        // 85.5% — Math.round breaks the .5 tie toward +infinity
        let r = insight(&e, 100.0, &[], 0.0).unwrap();
        assert_eq!(r.ic, "🌼");
        assert_eq!(r.text, "near 86");
    }

    #[test]
    fn the_threshold_is_inclusive() {
        let e = vec![exp("food", 40.0), exp("food", 20.0), exp("food", 20.0)];
        assert_eq!(insight(&e, 100.0, &[], 0.0).unwrap().ic, "🌼");
    }

    #[test]
    fn todays_budget_comes_next() {
        let e = vec![exp("food", 1.0), exp("food", 1.0), exp("food", 1.0)];
        let days = vec![day(50.0, TODAY)];
        let b = Budgets {
            budget: 0.0,
            cat_budgets: &[],
            daily: 20.0,
        };
        let r = compute_insight(&e, &days, b, &[], TODAY, false, &COPY).unwrap();
        assert_eq!(r.ic, "⏳");
        assert_eq!(r.text, "daily 30");
    }

    #[test]
    fn then_the_first_category_over_its_cap() {
        let e = vec![exp("food", 50.0), exp("trans", 5.0), exp("trans", 5.0)];
        let caps = vec![("trans".into(), 100.0), ("food".into(), 10.0)];
        let r = insight(&e, 0.0, &caps, 0.0).unwrap();
        assert_eq!(r.ic, "🪻");
        assert_eq!(r.text, "cat Food 50/10");
    }

    #[test]
    fn the_first_breach_follows_object_key_order() {
        // `2` is an array index and so is walked before `food`, whatever order
        // the caps were inserted in
        let e = vec![exp("food", 50.0), exp("2", 50.0), exp("food", 1.0)];
        let caps = vec![("food".into(), 10.0), ("2".into(), 10.0)];
        let r = insight(&e, 0.0, &caps, 0.0).unwrap();
        assert!(r.text.starts_with("cat "), "{}", r.text);
        assert!(r.text.ends_with(" 50/10"));
        // the `2` category is unknown, so cat_of falls back to its key
        assert_ne!(r.text, "cat Food 51/10");
    }

    #[test]
    fn otherwise_the_biggest_category() {
        let e = vec![exp("food", 60.0), exp("trans", 30.0), exp("food", 10.0)];
        let r = insight(&e, 0.0, &[], 0.0).unwrap();
        assert_eq!(r.ic, "🔍");
        // food is 70 of 100
        assert_eq!(r.text, "top Food 70");
    }

    #[test]
    fn a_tie_for_biggest_keeps_the_one_seen_first() {
        let e = vec![exp("trans", 50.0), exp("food", 50.0), exp("trans", 0.0)];
        let r = insight(&e, 0.0, &[], 0.0).unwrap();
        assert_eq!(r.text, "top Transit 50");
    }

    #[test]
    fn a_cap_is_breached_strictly() {
        let e = vec![exp("food", 5.0), exp("food", 5.0), exp("food", 0.0)];
        let caps = vec![("food".into(), 10.0)];
        // exactly at the cap is not over it
        assert_eq!(insight(&e, 0.0, &caps, 0.0).unwrap().ic, "🔍");
    }

    #[test]
    fn a_marker_is_filled_once() {
        // `String.prototype.replace(string, …)` replaces the first only
        assert_eq!(fill("a %d b %d", &[("%d", "1")]), "a 1 b %d");
        assert_eq!(fill("none", &[("%d", "1")]), "none");
    }

    #[test]
    fn a_value_containing_a_marker_is_not_filled_again() {
        // the one-pass rule: a category literally named `%a` must survive
        assert_eq!(
            fill("%s spent %a", &[("%s", "%a"), ("%a", "9")]),
            "%a spent 9"
        );
    }

    #[test]
    fn a_multibyte_template_is_walked_by_character() {
        assert_eq!(
            fill("这个月 %s 花得最多", &[("%s", "餐饮")]),
            "这个月 餐饮 花得最多"
        );
    }
}
