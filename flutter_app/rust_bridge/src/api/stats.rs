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
use dahonghua_core::period::{period_range, period_trend, trend_axis, Grain, Period};
use dahonghua_core::stats;
use dahonghua_core::trends::{self, TrendRow};
use flutter_rust_bridge::frb;

use super::store::{by_id, settings_of, store};

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
///
/// Through the id map, not a scan per id: this was `s.iter().find` inside a
/// loop over ids that were themselves the whole ledger — the O(n²) shape
/// `by_id` was written to remove from twelve other call sites, still here.
fn rows_of<'a>(
    by: &std::collections::HashMap<&str, &'a Entry>,
    ids: &[String],
    days: &[String],
) -> Vec<(&'a Entry, Civil)> {
    let n = ids.len().min(days.len());
    (0..n)
        .filter_map(|i| {
            let e = *by.get(ids[i].as_str())?;
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
    slices_of(&rows, Io::parse(&io).unwrap_or(Io::Exp), zh)
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
    let by = by_id(&s);
    let rows: Vec<TrendRow> = rows_of(&by, &ids, &days_of)
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
    let by = by_id(&s);
    let rows: Vec<TrendRow> = rows_of(&by, &ids, &days_of)
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

// ---------------------------------------------------------------------------
// The whole screen in one crossing.
// ---------------------------------------------------------------------------

/// One Bézier segment of a smooth curve, in the chart's own box.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CubicView {
    pub c1x: f64,
    pub c1y: f64,
    pub c2x: f64,
    pub c2y: f64,
    pub x: f64,
    pub y: f64,
}

/// A gridline: the value it marks, and where it sits in the box.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TickView {
    pub value: f64,
    pub y: f64,
}

/// The window's trend, for one direction.
#[derive(Debug, Clone, PartialEq)]
pub struct TrendView {
    /// One per bucket: `day` is the bucket's first day, for the axis and the
    /// readout under a finger.
    pub points: Vec<TrendPointView>,
    /// A point per week rather than per day.
    pub weekly: bool,
    /// The first and last day the chart covers, `y-m-d`, for its axis. Not
    /// the first and last point: a weekly point is dated to its Monday, and
    /// the first Monday of a year can be in the year before.
    pub from: String,
    pub end: String,
    /// The drawn series' values, parallel to `points`.
    pub values: Vec<f64>,
    /// Those values as coordinates in the box, and the curve through them.
    pub line: Vec<ChartPoint>,
    pub curve: Vec<CubicView>,
    pub ticks: Vec<TickView>,
    /// Where zero sits in the box — what an area under the curve fills to.
    pub zero: f64,
    /// The highest point, if anything is above zero.
    pub peak: Option<u32>,
    pub width: f64,
    pub height: f64,
}

/// One of the six windows ending with this one.
#[derive(Debug, Clone, PartialEq)]
pub struct PeriodBarView {
    /// The window's first day, `y-m-d`, for the label Dart writes.
    pub start: String,
    pub total: f64,
    /// Share of the tallest of the six.
    pub frac: f64,
}

/// One of the largest single entries.
#[derive(Debug, Clone, PartialEq)]
pub struct TopView {
    pub id: String,
    pub emoji: String,
    pub color: String,
    pub cat_name: String,
    pub note: String,
    /// `y-m-d`, the local day Dart said it fell on.
    pub day: String,
    pub amt: f64,
}

/// A bar in the weekday or time-of-day breakdown.
#[derive(Debug, Clone, PartialEq)]
pub struct BarView {
    /// `0`–`6` from Sunday for a weekday; `dawn` … `night` for a time.
    pub key: String,
    pub amt: f64,
    pub count: u32,
    pub frac: f64,
}

/// This cycle's cumulative spend against the same days of the last.
#[derive(Debug, Clone, PartialEq)]
pub struct CompareView {
    pub this_line: Vec<ChartPoint>,
    pub last_line: Vec<ChartPoint>,
    pub this_curve: Vec<CubicView>,
    pub last_curve: Vec<CubicView>,
    pub this_total: f64,
    pub last_total: f64,
    /// Where zero sits in the box.
    pub zero: f64,
    /// `none`, `same`, `more` or `less`: see `core::stats::verdict`.
    pub verdict: String,
    /// How much more or less, as a positive amount.
    pub diff: f64,
    pub width: f64,
    pub height: f64,
}

/// Everything the stats screen draws, for one window and one direction.
#[derive(Debug, Clone, PartialEq)]
pub struct StatsPage {
    pub overview: OverviewView,
    pub trend: TrendView,
    pub slices: Vec<SliceView>,
    pub periods: Vec<PeriodBarView>,
    pub top: Vec<TopView>,
    pub weekday: Vec<BarView>,
    pub hours: Vec<BarView>,
    /// Only for a month — the comparison the shipping app drew, which is of
    /// spending whichever direction the rest of the screen is showing.
    pub compare: Option<CompareView>,
}

fn cubic_views(line: &[ChartPoint]) -> Vec<CubicView> {
    let pts: Vec<chart::Point> = line
        .iter()
        .map(|p| chart::Point { x: p.x, y: p.y })
        .collect();
    chart::smooth(&pts)
        .into_iter()
        .map(|c| CubicView {
            c1x: c.c1.x,
            c1y: c.c1.y,
            c2x: c.c2.x,
            c2y: c.c2.y,
            x: c.to.x,
            y: c.to.y,
        })
        .collect()
}

fn polyline_view(values: &[f64], max: f64) -> Vec<ChartPoint> {
    chart::polyline(values, max, values.len())
        .into_iter()
        .map(|p| ChartPoint { x: p.x, y: p.y })
        .collect()
}

fn slices_of(rows: &[Entry], direction: Io, zh: bool) -> Vec<SliceView> {
    let cats = stats::by_category(rows, direction);
    let total: f64 = cats.iter().map(|c| c.amt).sum();
    stats::donut_slices(&cats, total)
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

/// The stats screen, whole.
///
/// One call rather than eight: the screen redraws on every window and every
/// direction, and each of the eight would carry the same ledger across the
/// boundary to answer one question about it.
///
/// What Dart supplies is what only Dart knows — for each live entry, the
/// local calendar day, the weekday (`0` is Sunday) and the hour it fell in —
/// plus today. Everything else is decided here or in the core: which rows are
/// in the window, what the trend covers and at what grain, where the curve
/// goes, where the gridlines fall, which six windows the bars are, which
/// entries are the largest, and whether this month is more than the last.
#[frb(sync)]
#[allow(clippy::too_many_arguments)]
pub fn stats_page(
    ids: Vec<String>,
    days_of: Vec<String>,
    dows: Vec<i32>,
    hours: Vec<i32>,
    anchor: String,
    period: String,
    io: String,
    today: String,
    zh: bool,
) -> StatsPage {
    let s = store();
    let by = by_id(&s);
    let cycle_start = settings_of().cycle_start;
    let anchor = parse_day(&anchor);
    let today = parse_day(&today);
    let period = Period::parse(&period).unwrap_or(Period::Month);
    let direction = Io::parse(&io).unwrap_or(Io::Exp);

    // every live row, with what the platform said about where it fell
    let n = ids
        .len()
        .min(days_of.len())
        .min(dows.len())
        .min(hours.len());
    let all: Vec<(&Entry, Civil, i32, i32)> = (0..n)
        .filter_map(|i| {
            let e = *by.get(ids[i].as_str())?;
            Some((e, parse_day(&days_of[i]), dows[i], hours[i]))
        })
        .collect();

    let win = period_range(anchor, period, cycle_start);
    let in_win: Vec<&(&Entry, Civil, i32, i32)> = all
        .iter()
        .filter(|r| r.1 >= win.start && r.1 < win.end)
        .collect();
    let win_entries: Vec<Entry> = in_win.iter().map(|r| r.0.clone()).collect();
    let local: Vec<stats::LocalRow> = in_win
        .iter()
        .map(|r| stats::LocalRow {
            io: r.0.io,
            amt: r.0.amt,
            dow: r.2,
            hour: r.3,
        })
        .collect();
    let dated: Vec<stats::DatedRow> = all
        .iter()
        .map(|r| stats::DatedRow {
            io: r.0.io,
            amt: r.0.amt,
            day: r.1,
        })
        .collect();

    // the trend, over whatever span the core says this window is drawn as
    let axis = trend_axis(anchor, period, cycle_start, today);
    let trend_rows: Vec<TrendRow> = all
        .iter()
        .filter(|r| r.1 >= axis.from && r.1 <= axis.end)
        .map(|r| TrendRow {
            io: r.0.io,
            amt: r.0.amt,
            cat: r.0.cat.clone(),
            day: r.1,
            deleted_at: r.0.deleted_at.map(|v| v as f64),
        })
        .collect();
    let weekly = axis.grain == Grain::Weekly;
    let pts = if weekly {
        trends::weekly_trend(&trend_rows, axis.len, axis.end)
    } else {
        trends::daily_trend(&trend_rows, axis.len, axis.end)
    };
    let values: Vec<f64> = pts
        .iter()
        .map(|p| if direction == Io::Inc { p.inc } else { p.exp })
        .collect();
    let series = if direction == Io::Inc {
        SeriesType::Inc
    } else {
        SeriesType::Exp
    };
    let (exp, inc): (Vec<f64>, Vec<f64>) = pts.iter().map(|p| (p.exp, p.inc)).unzip();
    let max = chart::chart_max(&exp, &inc, series);
    let line = polyline_view(&values, max);
    let trend = TrendView {
        points: pts
            .iter()
            .map(|p| TrendPointView {
                day: show_day(p.date),
                exp: p.exp,
                inc: p.inc,
            })
            .collect(),
        weekly,
        from: show_day(axis.from),
        end: show_day(axis.end),
        curve: cubic_views(&line),
        ticks: chart::gridlines(&values, 3)
            .into_iter()
            .map(|v| TickView {
                value: v,
                y: chart::y_of(v, max),
            })
            .collect(),
        zero: chart::y_of(0.0, max),
        peak: chart::peak(&values).map(|i| i as u32),
        values,
        line,
        width: chart::CHART_W,
        height: chart::CHART_H,
    };

    let buckets = period_trend(&dated, anchor, period, cycle_start, direction);
    let fracs = chart::bar_fracs(&buckets.iter().map(|b| b.total).collect::<Vec<_>>());
    let periods = buckets
        .iter()
        .zip(fracs)
        .map(|(b, frac)| PeriodBarView {
            start: show_day(b.start),
            total: b.total,
            frac,
        })
        .collect();

    let day_of: std::collections::HashMap<&str, Civil> =
        in_win.iter().map(|r| (r.0.id.as_str(), r.1)).collect();
    let top = stats::top_entries(&win_entries, direction, 5)
        .into_iter()
        .map(|e| {
            let c = dahonghua_core::catalog::cat_of(direction, &e.cat, &[]);
            TopView {
                id: e.id.clone(),
                emoji: c.e.clone(),
                color: c.c.clone(),
                cat_name: dahonghua_core::catalog::cat_name(&c, zh),
                note: e.note.clone().unwrap_or_default(),
                day: day_of
                    .get(e.id.as_str())
                    .map(|d| show_day(*d))
                    .unwrap_or_default(),
                amt: e.amt,
            }
        })
        .collect();

    let wd = stats::by_weekday(&local, direction);
    let wd_fracs = chart::bar_fracs(&wd.iter().map(|w| w.amt).collect::<Vec<_>>());
    let weekday = wd
        .iter()
        .zip(wd_fracs)
        .map(|(w, frac)| BarView {
            key: w.dow.to_string(),
            amt: w.amt,
            count: w.count as u32,
            frac,
        })
        .collect();
    let tod = stats::by_time_of_day(&local, direction);
    let tod_fracs = chart::bar_fracs(&tod.iter().map(|t| t.amt).collect::<Vec<_>>());
    let hours = tod
        .iter()
        .zip(tod_fracs)
        .map(|(t, frac)| BarView {
            key: t.key.to_string(),
            amt: t.amt,
            count: t.count as u32,
            frac,
        })
        .collect();

    let compare = (period == Period::Month).then(|| {
        let c = stats::comparison(&dated, anchor, cycle_start, today);
        let max = chart::chart_max(&c.this_cum, &c.last_cum, SeriesType::Both);
        let this_line = polyline_view(&c.this_cum, max);
        let last_line = polyline_view(&c.last_cum, max);
        let (verdict, diff) = match stats::verdict(c.this_total, c.last_total) {
            stats::Verdict::NoBase => ("none", 0.0),
            stats::Verdict::Same => ("same", 0.0),
            stats::Verdict::More(d) => ("more", d),
            stats::Verdict::Less(d) => ("less", d),
        };
        CompareView {
            this_curve: cubic_views(&this_line),
            last_curve: cubic_views(&last_line),
            this_line,
            last_line,
            this_total: c.this_total,
            last_total: c.last_total,
            zero: chart::y_of(0.0, max),
            verdict: verdict.into(),
            diff,
            width: chart::CHART_W,
            height: chart::CHART_H,
        }
    });

    let o = stats::overview(&win_entries);
    StatsPage {
        overview: OverviewView {
            exp: o.exp,
            inc: o.inc,
            balance: o.balance,
            count: o.count as u32,
        },
        trend,
        slices: slices_of(&win_entries, direction, zh),
        periods,
        top,
        weekday,
        hours,
        compare,
    }
}

/// Which of `n` points a finger at `x` means, `x` in the chart's own box.
#[frb(sync)]
pub fn index_at(x: f64, n: u32) -> Option<u32> {
    chart::index_at(x, n as usize).map(|i| i as u32)
}
