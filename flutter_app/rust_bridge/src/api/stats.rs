//! Statistics and the geometry that draws them, across the boundary.
//!
//! Dart gets points and slices, not data. The totals, the ordering, the day
//! bucketing and the coordinates all happen on this side — a `CustomPainter`
//! that receives `[(7, 89), (150, 48), (293, 7)]` cannot get the arithmetic
//! wrong, because there is none left in it.
//!
//! The one thing Dart supplies is each entry's **local calendar day**, as
//! everywhere else: projecting an instant onto a day needs a timezone, and this
//! crate does not own one.

use dahonghua_core::chart::{self, SeriesType};
use dahonghua_core::civil::Civil;
use dahonghua_core::entry::{Entry, Io};
use dahonghua_core::stats;
use dahonghua_core::trends::{self, TrendRow};
use flutter_rust_bridge::frb;

use super::store::{by_id, store};

fn parse_day(s: &str) -> Civil {
    let mut it = s.split('-');
    let y = it.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    Civil::new(y, m - 1, d)
}

fn show_day(d: Civil) -> String {
    format!("{}-{}-{}", d.y, d.m + 1, d.d)
}

/// Expense, income, balance and how many rows are in range.
#[derive(Debug, Clone, PartialEq)]
pub struct OverviewView {
    pub exp: f64,
    pub inc: f64,
    pub balance: f64,
    /// Every entry in range, **transfers included** — it answers "how many rows
    /// are here", not "how many moved money one way".
    pub count: u32,
}

/// One point of a trend line.
#[derive(Debug, Clone, PartialEq)]
pub struct TrendPointView {
    /// `y-m-d`, for the axis label Dart writes.
    pub day: String,
    pub exp: f64,
    pub inc: f64,
}

/// One slice of the category donut, with everything needed to draw it.
#[derive(Debug, Clone, PartialEq)]
pub struct SliceView {
    pub cat: String,
    /// The category's own name, in the caller's language.
    pub name: String,
    pub emoji: String,
    /// `#RRGGBB`.
    pub color: String,
    pub amt: f64,
    /// Share of the total, 0..1.
    pub frac: f64,
    /// Cumulative start fraction, 0..1 — where the arc begins.
    pub start: f64,
}

/// A point in the chart's own coordinate box, which a painter scales.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChartPoint {
    pub x: f64,
    pub y: f64,
}

/// The line chart, ready to draw.
#[derive(Debug, Clone, PartialEq)]
pub struct ChartView {
    pub exp: Vec<ChartPoint>,
    pub inc: Vec<ChartPoint>,
    /// The tallest drawn value, never below 1. Exposed because a caller may
    /// want to label the axis with it.
    pub max: f64,
    /// The box these coordinates live in.
    pub width: f64,
    pub height: f64,
}

/// The live rows the caller named, paired with the day it says each falls on.
fn rows_of<'a>(s: &'a [Entry], ids: &[String], days: &[String]) -> Vec<(&'a Entry, Civil)> {
    let n = ids.len().min(days.len());
    (0..n)
        .filter_map(|i| {
            let e = s.iter().find(|e| e.id == ids[i])?;
            Some((e, parse_day(&days[i])))
        })
        .collect()
}

#[frb(sync)]
pub fn overview(ids: Vec<String>) -> OverviewView {
    let s = store();
    let by = by_id(&s);
    let rows: Vec<Entry> = ids
        .iter()
        .filter_map(|id| by.get(id.as_str()).map(|e| (*e).clone()))
        .collect();
    let o = stats::overview(&rows);
    OverviewView {
        exp: o.exp,
        inc: o.inc,
        balance: o.balance,
        count: o.count as u32,
    }
}

/// Totals by category, largest first, with the naming and colour the row needs.
///
/// One call rather than a lookup per slice: the donut draws ten arcs and would
/// otherwise cross the boundary thirty times to label them.
#[frb(sync)]
pub fn category_slices(ids: Vec<String>, io: String, zh: bool) -> Vec<SliceView> {
    let s = store();
    let by = by_id(&s);
    let rows: Vec<Entry> = ids
        .iter()
        .filter_map(|id| by.get(id.as_str()).map(|e| (*e).clone()))
        .collect();
    let direction = Io::parse(&io).unwrap_or(Io::Exp);
    let cats = stats::by_category(&rows, direction);
    let total: f64 = cats.iter().map(|c| c.amt).sum();
    let slices = stats::donut_slices(&cats, total);
    slices
        .iter()
        .map(|sl| {
            let c = dahonghua_core::catalog::cat_of(direction, &sl.cat, &[]);
            SliceView {
                cat: sl.cat.clone(),
                name: dahonghua_core::catalog::cat_name(&c, zh),
                emoji: c.e.clone(),
                color: c.c.clone(),
                amt: cats
                    .iter()
                    .find(|t| t.cat == sl.cat)
                    .map(|t| t.amt)
                    .unwrap_or(0.0),
                frac: sl.frac,
                start: sl.start,
            }
        })
        .collect()
}

/// The daily trend over the last `days`, one point per day including empty ones.
///
/// `days_of` is parallel to `ids`: each entry's local calendar day, computed by
/// Dart. `today` likewise. Counting in day numbers rather than in milliseconds
/// is what keeps a daylight-saving transition from dropping a day off the axis
/// — which it did, in the shipping TypeScript, until this migration found it.
#[frb(sync)]
pub fn daily_trend(
    ids: Vec<String>,
    days_of: Vec<String>,
    days: i64,
    today: String,
) -> Vec<TrendPointView> {
    let s = store();
    let all: Vec<Entry> = s.ledger.all().to_vec();
    let rows: Vec<TrendRow> = rows_of(&all, &ids, &days_of)
        .into_iter()
        .map(|(e, day)| TrendRow {
            io: e.io,
            amt: e.amt,
            cat: e.cat.clone(),
            day,
            deleted_at: e.deleted_at.map(|v| v as f64),
        })
        .collect();
    trends::daily_trend(&rows, days, parse_day(&today))
        .into_iter()
        .map(|p| TrendPointView {
            day: show_day(p.date),
            exp: p.exp,
            inc: p.inc,
        })
        .collect()
}

/// The weekly trend over the last `weeks`, each point dated to its Monday.
#[frb(sync)]
pub fn weekly_trend(
    ids: Vec<String>,
    days_of: Vec<String>,
    weeks: i64,
    today: String,
) -> Vec<TrendPointView> {
    let s = store();
    let all: Vec<Entry> = s.ledger.all().to_vec();
    let rows: Vec<TrendRow> = rows_of(&all, &ids, &days_of)
        .into_iter()
        .map(|(e, day)| TrendRow {
            io: e.io,
            amt: e.amt,
            cat: e.cat.clone(),
            day,
            deleted_at: e.deleted_at.map(|v| v as f64),
        })
        .collect();
    trends::weekly_trend(&rows, weeks, parse_day(&today))
        .into_iter()
        .map(|p| TrendPointView {
            day: show_day(p.date),
            exp: p.exp,
            inc: p.inc,
        })
        .collect()
}

/// Trend points as coordinates a painter can draw without arithmetic.
///
/// `series` is `"exp"`, `"inc"` or `"both"`, and it decides the maximum — a
/// series nobody is drawing does not get to set the scale.
#[frb(sync)]
pub fn chart_points(points: Vec<TrendPointView>, series: String) -> ChartView {
    let exp: Vec<f64> = points.iter().map(|p| p.exp).collect();
    let inc: Vec<f64> = points.iter().map(|p| p.inc).collect();
    let kind = SeriesType::parse(&series);
    let max = chart::chart_max(&exp, &inc, kind);
    let n = points.len();
    let map = |v: &[f64]| {
        chart::polyline(v, max, n)
            .into_iter()
            .map(|p| ChartPoint { x: p.x, y: p.y })
            .collect::<Vec<_>>()
    };
    ChartView {
        exp: map(&exp),
        inc: map(&inc),
        max,
        width: chart::CHART_W,
        height: chart::CHART_H,
    }
}
