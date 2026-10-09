//! 明细's head: what this cycle came to, how the budget is holding, and the one
//! sentence worth saying about it.
//!
//! The shipping list opened on `SummaryCard`, `BudgetPot` and `InsightBanner`
//! above the rows; the port kept the rows and none of the three. One call for
//! all of it, like `stats_page`, because the list redraws on every record and
//! each would otherwise carry the ledger across to answer one question.

use dahonghua_core::budget::{self, DayRow, PotMood, TierStatus};
use super::day::{parse_day, show_day};
use dahonghua_core::civil::Civil;
use dahonghua_core::cycle::cycle_range;
use dahonghua_core::entry::Entry;
use dahonghua_core::stats;
use flutter_rust_bridge::frb;

use super::report::{insight_of, InsightCopyView, InsightView};
use super::store::{by_id, settings_of, store};

/// One of the two budget pots.
#[derive(Debug, Clone, PartialEq)]
pub struct PotView {
    pub limit: f64,
    pub used: f64,
    /// Negative once over.
    pub left: f64,
    pub over: bool,
    /// The bar, 0..1 — full once over.
    pub fill: f64,
}

/// The head of 明细.
#[derive(Debug, Clone, PartialEq)]
pub struct HomeView {
    /// The current accounting cycle, `y-m-d`.
    pub start: String,
    pub last: String,
    pub exp: f64,
    pub inc: f64,
    /// Income less expense — 本月攒下的.
    pub net: f64,
    /// Spending's share of what moved, for the bar; `None` when nothing did.
    pub exp_share: Option<f64>,
    /// The cycle's pot and today's, each `None` when its cap is not set.
    pub monthly: Option<PotView>,
    pub daily: Option<PotView>,
    /// `fresh`, `wary` or `wilted` — the flower beside the pots, following the
    /// cycle's pot when there is one. `None` when no cap is set.
    pub mood: Option<String>,
    pub insight: Option<InsightView>,
}

fn pot(s: &TierStatus) -> Option<PotView> {
    (s.limit > 0.0).then(|| PotView {
        limit: s.limit,
        used: s.used,
        left: s.left,
        over: s.over,
        fill: budget::pot_fill(s),
    })
}

/// 明细's head, for the cycle `today` is in.
///
/// `ids` and `days_of` are every live entry and the local day Dart resolved
/// for each; the cycle is chosen here, from the setting, so the head and 统计
/// cannot disagree about where this month began.
#[frb(sync)]
pub fn home(
    ids: Vec<String>,
    days_of: Vec<String>,
    today: String,
    zh: bool,
    copy: InsightCopyView,
) -> HomeView {
    let today = parse_day(&today);
    let set = settings_of();
    let cycle = cycle_range(today, set.cycle_start);

    let (entries, days): (Vec<Entry>, Vec<Civil>) = {
        let s = store();
        let by = by_id(&s);
        let n = ids.len().min(days_of.len());
        (0..n)
            .filter_map(|i| {
                let e = by.get(ids[i].as_str())?;
                let day = parse_day(&days_of[i]);
                (day >= cycle.start && day < cycle.end).then(|| ((*e).clone(), day))
            })
            .unzip()
    };
    let day_rows: Vec<DayRow> = entries
        .iter()
        .zip(&days)
        .map(|(e, d)| DayRow {
            io: e.io,
            amt: e.amt,
            day: *d,
        })
        .collect();

    let o = stats::overview(&entries);
    let monthly = budget::monthly_status(&entries, set.budget);
    let daily = budget::daily_status(&day_rows, set.daily_budget, today);
    let mood = budget::lead_tier(&monthly, &daily)
        .and_then(budget::pot_mood)
        .map(|m| {
            match m {
                PotMood::Fresh => "fresh",
                PotMood::Wary => "wary",
                PotMood::Wilted => "wilted",
            }
            .to_string()
        });
    let insight = insight_of(&entries, &day_rows, today, zh, &copy);

    HomeView {
        start: show_day(cycle.start),
        last: show_day(Civil::from_day_number(cycle.end.day_number() - 1)),
        exp: o.exp,
        inc: o.inc,
        net: o.balance,
        exp_share: stats::exp_share(o.exp, o.inc),
        monthly: pot(&monthly),
        daily: pot(&daily),
        mood,
        insight,
    }
}
