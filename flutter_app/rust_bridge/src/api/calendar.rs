//! 明细's calendar, across the boundary: the cycle as a grid of days.
//!
//! Dart sends every live entry and the local day it resolved for each; what
//! comes back is the grid — which days, how many blanks before the first, what
//! each day spent and took in, which is today, which are ahead of it, how deep
//! each is shaded, and whether the next cycle may be paged to.

use dahonghua_core::calendar::{self, CalRow};
use dahonghua_core::civil::Civil;
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

/// One day of the grid.
#[derive(Debug, Clone, PartialEq)]
pub struct CalCellView {
    /// `y-m-d`, the key Dart matches its own entries' days against.
    pub day: String,
    /// The day of the month, for the number in the cell.
    pub dom: u32,
    /// Every entry on the day, transfers included.
    pub count: u32,
    pub exp: f64,
    pub inc: f64,
    pub today: bool,
    pub future: bool,
    /// How deep the cell is shaded, 0..1 — `core::calendar::heat`.
    pub heat: f64,
}

/// A cycle as a grid.
#[derive(Debug, Clone, PartialEq)]
pub struct CalMonthView {
    pub start: String,
    pub last: String,
    /// Blank cells before the first day, Monday-first.
    pub leading: u32,
    pub cells: Vec<CalCellView>,
    pub exp: f64,
    pub inc: f64,
    /// Whether › may page to the next cycle.
    pub can_forward: bool,
}

/// The cycle containing `anchor`, as a grid.
#[frb(sync)]
pub fn calendar_month(
    ids: Vec<String>,
    days_of: Vec<String>,
    anchor: String,
    today: String,
) -> CalMonthView {
    let rows: Vec<CalRow> = {
        let s = store();
        let by = by_id(&s);
        let n = ids.len().min(days_of.len());
        (0..n)
            .filter_map(|i| {
                let e = by.get(ids[i].as_str())?;
                Some(CalRow {
                    io: e.io,
                    amt: e.amt,
                    day: parse_day(&days_of[i]),
                })
            })
            .collect()
    };
    let cycle_start = settings_of().cycle_start;
    let (anchor, today) = (parse_day(&anchor), parse_day(&today));
    let m = calendar::cal_month(&rows, anchor, cycle_start, today);
    CalMonthView {
        start: show_day(m.start),
        last: show_day(m.last),
        leading: m.leading,
        cells: m
            .cells
            .iter()
            .map(|c| CalCellView {
                day: show_day(c.day),
                dom: c.day.d as u32,
                count: c.count as u32,
                exp: c.exp,
                inc: c.inc,
                today: c.today,
                future: c.future,
                heat: c.heat,
            })
            .collect(),
        exp: m.exp,
        inc: m.inc,
        can_forward: calendar::can_page_forward(anchor, cycle_start, today),
    }
}
