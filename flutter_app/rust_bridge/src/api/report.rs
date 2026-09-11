//! The report screen's three answers: the cycle's recap, the week against its
//! budget, and the one sentence worth putting at the top.
//!
//! Three core modules behind one bridge, because they answer one question
//! between them and a screen that called three bridges would be free to draw
//! them out of step with each other.
//!
//! Every one of them takes calendar days from Dart. Projecting an instant onto
//! a day needs a timezone and this crate has none — the rule the whole port is
//! built on, and the reason `days_of` is parallel to `ids` in all three calls.

use dahonghua_core::budget::DayRow;
use dahonghua_core::civil::Civil;
use dahonghua_core::entry::Entry;
use dahonghua_core::insight::{self, InsightCopy};
use dahonghua_core::recap;
use dahonghua_core::weekly::{self, WeekRow};
use flutter_rust_bridge::frb;

use super::store::{by_id, settings_of, store};

fn parse_day(s: &str) -> Civil {
    let mut it = s.split('-');
    let y = it.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    Civil::new(y, m - 1, d)
}

/// The entries named by `ids`, paired with the day Dart resolved for each.
fn rows(ids: &[String], days_of: &[String]) -> (Vec<Entry>, Vec<Civil>) {
    let s = store();
    let by = by_id(&s);
    let n = ids.len().min(days_of.len());
    let mut entries = Vec::with_capacity(n);
    let mut days = Vec::with_capacity(n);
    for i in 0..n {
        if let Some(e) = by.get(ids[i].as_str()).copied() {
            entries.push(e.clone());
            days.push(parse_day(&days_of[i]));
        }
    }
    (entries, days)
}

/// What a cycle came to, in six numbers.
#[derive(Debug, Clone, PartialEq)]
pub struct RecapView {
    pub exp: f64,
    pub inc: f64,
    /// Income less expense.
    pub net: f64,
    /// Every entry in the cycle, **transfers included** — "how many rows are in
    /// this cycle", not "how many moved money one way".
    pub count: u32,
    /// Distinct calendar days with an entry on them.
    pub active_days: u32,
    pub top_cat: Option<String>,
    /// Zero for a top category whose key is the empty string, which a malformed
    /// import can produce: `topCatKey ? byCat[topCatKey] : 0` is a truthiness
    /// test, so such a category is still named but reports nothing.
    pub top_cat_amt: f64,
}

#[frb(sync)]
pub fn recap(ids: Vec<String>, days_of: Vec<String>) -> RecapView {
    let (entries, days) = rows(&ids, &days_of);
    let r = recap::month_recap(&entries, &days);
    RecapView {
        exp: r.exp,
        inc: r.inc,
        net: r.net,
        count: r.count as u32,
        active_days: r.active_days as u32,
        top_cat: r.top_cat_key,
        top_cat_amt: r.top_cat_amt,
    }
}

/// Spend against the weekly budget, for the week containing `today`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WeeklyView {
    pub spent: f64,
    /// Budget less spend; negative once over.
    pub remaining: f64,
    pub over: bool,
    /// Days left in the week, today included. Never negative.
    pub days_left: i64,
    /// The weekly budget divided by seven. A plain division, so zero gives zero
    /// and `NaN` gives `NaN` — neither is guarded, on either side.
    pub daily_budget: f64,
}

/// The week is **Sunday to Sunday**, which is what `getDay()` counts from.
#[frb(sync)]
pub fn weekly(
    ids: Vec<String>,
    days_of: Vec<String>,
    weekly_budget: f64,
    today: String,
) -> WeeklyView {
    let (entries, days) = rows(&ids, &days_of);
    let week: Vec<WeekRow> = entries
        .iter()
        .zip(days.iter())
        .map(|(e, d)| WeekRow::of(e, *d))
        .collect();
    let w = weekly::weekly_status(&week, weekly_budget, parse_day(&today));
    WeeklyView {
        spent: w.spent,
        remaining: w.remaining,
        over: w.over,
        days_left: w.days_left,
        daily_budget: w.daily_budget,
    }
}

/// The sentences the banner is built from. Intl, so they come from Dart.
///
/// `%s`, `%d`, `%a`, `%b` and `%w` are each substituted **once**, left to
/// right, because the TypeScript spells it as `String.replace(string, …)` where
/// it uses one at all — and that replaces the first occurrence only.
#[derive(Debug, Clone)]
pub struct InsightCopyView {
    pub over_budget: String,
    pub near_budget: String,
    pub daily_over: String,
    pub cat_over: String,
    pub top_cat: String,
    pub credit_due: String,
    pub days_left: String,
    pub due_today: String,
    /// `%d` days overdue.
    pub overdue: String,
}

/// One sentence, or nothing at all.
#[derive(Debug, Clone, PartialEq)]
pub struct InsightView {
    /// The leading emoji.
    pub icon: String,
    pub text: String,
    /// Set when the insight is about one account, so the banner can link there.
    pub acct_id: Option<String>,
}

/// The banner, or `None`.
///
/// `None` is the common answer and not a failure: fewer than three expenses in
/// the cycle produces nothing, because a sentence about two rows is noise
/// rather than an insight.
#[frb(sync)]
pub fn insight(
    ids: Vec<String>,
    days_of: Vec<String>,
    today: String,
    zh: bool,
    copy: InsightCopyView,
) -> Option<InsightView> {
    let (entries, days) = rows(&ids, &days_of);
    let day_rows: Vec<DayRow> = entries
        .iter()
        .zip(days.iter())
        .map(|(e, d)| DayRow {
            io: e.io,
            amt: e.amt,
            day: *d,
        })
        .collect();
    let set = settings_of();
    let c = InsightCopy {
        over_budget: &copy.over_budget,
        near_budget: &copy.near_budget,
        daily_over: &copy.daily_over,
        cat_over: &copy.cat_over,
        top_cat: &copy.top_cat,
        credit_due: &copy.credit_due,
        days_left: &copy.days_left,
        due_today: &copy.due_today,
        overdue: &copy.overdue,
    };
    insight::compute_insight(
        &entries,
        &day_rows,
        insight::Budgets {
            budget: set.budget,
            cat_budgets: &set.caps,
            daily: set.daily_budget,
        },
        &[],
        parse_day(&today),
        zh,
        &c,
    )
    .map(|i| InsightView {
        icon: i.ic,
        text: i.text,
        acct_id: i.acct_id,
    })
}
