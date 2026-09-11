//! Budgets across the boundary.
//!
//! Every number a budget screen draws is a comparison against a cap, and the
//! comparisons have edges the screen must not be allowed to redraw: a cap of
//! zero means *unset* rather than *zero spending allowed*, a `NaN` cap reads as
//! unset too, and a percentage over 100 is not clamped because being 140% of
//! the way through a budget is the thing worth saying.
//!
//! All of that is `dahonghua_core::budget`, pinned by a 4,210-case corpus. What
//! crosses is the answer.

use dahonghua_core::budget::{self as core, TierStatus};
use dahonghua_core::catalog;
use dahonghua_core::civil::Civil;
use dahonghua_core::entry::{Entry, Io};
use flutter_rust_bridge::frb;

use super::store::{by_id, set_settings_inner, settings_of, store, BudgetSettings};

/// The budget settings, as Dart holds them.
///
/// Held on this side for the same reason the ledger is: `tier_status` decides
/// what a cap of zero means, and a second copy of these numbers is a second
/// chance to disagree with it.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SettingsView {
    /// The cycle's cap. Zero or less is *unset*, not "nothing allowed".
    pub budget: f64,
    pub daily_budget: f64,
    /// Day of month the cycle turns over, 1..28.
    pub cycle_start: i32,
    /// Parallel to `cap_amounts`, and the order matters — see
    /// [`cat_budget_rows`].
    pub cap_cats: Vec<String>,
    pub cap_amounts: Vec<f64>,
}

#[frb(sync)]
pub fn settings() -> SettingsView {
    let s = settings_of();
    SettingsView {
        budget: s.budget,
        daily_budget: s.daily_budget,
        cycle_start: s.cycle_start,
        cap_cats: s.caps.iter().map(|(k, _)| k.clone()).collect(),
        cap_amounts: s.caps.iter().map(|(_, v)| *v).collect(),
    }
}

#[frb(sync)]
pub fn set_settings(view: SettingsView) {
    let n = view.cap_cats.len().min(view.cap_amounts.len());
    set_settings_inner(BudgetSettings {
        budget: view.budget,
        daily_budget: view.daily_budget,
        // 1..28 is what the settings screen offers, and a cycle that started on
        // the 31st would skip the months that do not have one
        cycle_start: view.cycle_start.clamp(1, 28),
        caps: (0..n)
            .map(|i| (view.cap_cats[i].clone(), view.cap_amounts[i]))
            .collect(),
    });
}

/// The ids that fall inside the cycle containing `today`.
///
/// The cycle is not the calendar month: it turns over on `cycle_start`, so a
/// cycle starting on the 15th runs the 15th to the 14th. Dart supplies each
/// entry's calendar day, as everywhere else.
#[frb(sync)]
pub fn cycle_ids(ids: Vec<String>, days_of: Vec<String>, today: String) -> Vec<String> {
    let start = settings_of().cycle_start;
    let anchor = parse_day(&today);
    let n = ids.len().min(days_of.len());
    (0..n)
        .filter(|i| dahonghua_core::cycle::in_cycle(parse_day(&days_of[*i]), anchor, start))
        .map(|i| ids[i].clone())
        .collect()
}

fn parse_day(s: &str) -> Civil {
    let mut it = s.split('-');
    let y = it.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    Civil::new(y, m - 1, d)
}

/// A spend total against a cap.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TierView {
    /// The cap, or zero when unset. Never negative.
    pub limit: f64,
    pub used: f64,
    /// `limit - used`, so negative once over.
    pub left: f64,
    /// `used / limit * 100`, or zero when there is no limit. **Not clamped** —
    /// 140% is the number worth showing.
    pub pct: f64,
    pub over: bool,
    /// True when there is no cap set, which is a different screen from a cap
    /// with nothing spent against it.
    pub unset: bool,
}

impl From<TierStatus> for TierView {
    fn from(t: TierStatus) -> Self {
        TierView {
            limit: t.limit,
            used: t.used,
            left: t.left,
            pct: t.pct,
            over: t.over,
            unset: t.limit <= 0.0,
        }
    }
}

/// One category with a cap, and how it is doing against it.
#[derive(Debug, Clone, PartialEq)]
pub struct CatBudgetView {
    pub cat: String,
    pub name: String,
    pub emoji: String,
    /// `#RRGGBB`.
    pub color: String,
    pub status: TierView,
}

fn entries_of(ids: &[String]) -> Vec<Entry> {
    let s = store();
    let by = by_id(&s);
    ids.iter()
        .filter_map(|id| by.get(id.as_str()).map(|e| (*e).clone()))
        .collect()
}

/// The cycle's expense against the cycle's cap.
#[frb(sync)]
pub fn monthly_status(ids: Vec<String>, budget: f64) -> TierView {
    core::monthly_status(&entries_of(&ids), budget).into()
}

/// Today's expense against the daily cap.
///
/// `days_of` is parallel to `ids` — each entry's local calendar day, computed
/// by Dart, because projecting an instant onto a day needs a timezone.
#[frb(sync)]
pub fn daily_status(
    ids: Vec<String>,
    days_of: Vec<String>,
    daily_budget: f64,
    today: String,
) -> TierView {
    let s = store();
    let by = by_id(&s);
    let n = ids.len().min(days_of.len());
    let rows: Vec<core::DayRow> = (0..n)
        .filter_map(|i| {
            let e = *by.get(ids[i].as_str())?;
            Some(core::DayRow {
                io: e.io,
                amt: e.amt,
                day: parse_day(&days_of[i]),
            })
        })
        .collect();
    drop(s);
    core::daily_status(&rows, daily_budget, parse_day(&today)).into()
}

/// One row per category that has a cap, closest to its cap first.
///
/// `caps` arrives as two parallel lists because a map has no order across the
/// boundary and this one's order matters: the core applies JavaScript's own key
/// reordering to it, and a cap of zero or less is dropped rather than drawn at
/// zero percent.
#[frb(sync)]
pub fn cat_budget_rows(
    ids: Vec<String>,
    cap_cats: Vec<String>,
    cap_amounts: Vec<f64>,
    zh: bool,
) -> Vec<CatBudgetView> {
    let n = cap_cats.len().min(cap_amounts.len());
    let caps: Vec<(String, f64)> = (0..n)
        .map(|i| (cap_cats[i].clone(), cap_amounts[i]))
        .collect();
    core::cat_budget_rows(&entries_of(&ids), &caps)
        .into_iter()
        .map(|r| {
            let c = catalog::cat_of(Io::Exp, &r.cat, &[]);
            CatBudgetView {
                cat: r.cat,
                name: catalog::cat_name(&c, zh),
                emoji: c.e.clone(),
                color: c.c.clone(),
                status: r.status.into(),
            }
        })
        .collect()
}

/// Total expense over the given entries. Income and transfers excluded.
#[frb(sync)]
pub fn expense_total(ids: Vec<String>) -> f64 {
    core::expense_total(&entries_of(&ids))
}
