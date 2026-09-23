//! The month as a grid — 明细's calendar.
//!
//! The shipping list had a second face: a toggle in its header turned the
//! rows into a month (`CalendarView.tsx`), each day showing how many entries
//! it held and what was spent, and a tapped day listing its rows with
//! 补记这天 under them. The port kept the rows. The grid's arithmetic lived in
//! that component; it is here, because it is arithmetic — which days the
//! cycle holds, which of them are ahead of today, how deep each is shaded.
//!
//! The month is the accounting cycle, as it is on every other screen: a
//! ledger that turns over on the 15th sees the 15th to the 14th. The caller
//! projects each row onto its local day, as everywhere.

use crate::civil::Civil;
use crate::cycle::cycle_range;
use crate::entry::Io;

/// One entry, projected onto the local calendar day the platform resolved.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CalRow {
    pub io: Option<Io>,
    pub amt: f64,
    pub day: Civil,
}

/// One day of the grid.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CalCell {
    pub day: Civil,
    /// Every entry on the day, transfers included — the shipping grid's
    /// flowers counted rows, not money.
    pub count: usize,
    pub exp: f64,
    pub inc: f64,
    pub today: bool,
    /// After today. Drawn, but nothing can be recorded there.
    pub future: bool,
    /// How deep the day is shaded, 0..1. See [`heat`].
    pub heat: f64,
}

/// A cycle, as a grid.
#[derive(Debug, Clone, PartialEq)]
pub struct CalMonth {
    pub start: Civil,
    /// The last day in the cycle.
    pub last: Civil,
    /// Blank cells before the first day, in a week that starts on Monday —
    /// the week the rest of this app draws.
    pub leading: u32,
    pub cells: Vec<CalCell>,
    pub exp: f64,
    pub inc: f64,
}

/// How deep a day's shade is, for a day that spent `exp` in a cycle whose
/// biggest day spent `max`.
///
/// The square root of the share, not the share. A cycle has a rent day, and
/// shaded in proportion the rent is the only day that shows: ¥2,800 against
/// ¥40 lunches leaves every ordinary day at a seventieth of full, which on a
/// phone is white. The root keeps the order — a bigger day is always deeper —
/// and lifts the ordinary days to where they can be told apart, which is what
/// a heat map is for. Nothing spent is no shade at all, however small `max`.
pub fn heat(exp: f64, max: f64) -> f64 {
    // NaN in either is no shade, which the `<=` alone would not say
    if exp.is_nan() || max.is_nan() || exp <= 0.0 || max <= 0.0 {
        return 0.0;
    }
    (exp / max).clamp(0.0, 1.0).sqrt()
}

/// The cycle containing `anchor`, day by day.
pub fn cal_month(rows: &[CalRow], anchor: Civil, cycle_start: i32, today: Civil) -> CalMonth {
    let r = cycle_range(anchor, cycle_start);
    let (lo, hi) = (r.start.day_number(), r.end.day_number());
    let len = (hi - lo).max(0) as usize;

    let mut cells: Vec<CalCell> = (0..len)
        .map(|i| {
            let day = Civil::from_day_number(lo + i as i64);
            CalCell {
                day,
                count: 0,
                exp: 0.0,
                inc: 0.0,
                today: day == today,
                future: day.day_number() > today.day_number(),
                heat: 0.0,
            }
        })
        .collect();

    for row in rows {
        let n = row.day.day_number();
        if n < lo || n >= hi {
            continue;
        }
        let c = &mut cells[(n - lo) as usize];
        c.count += 1;
        match row.io {
            Some(Io::Exp) => c.exp += row.amt,
            Some(Io::Inc) => c.inc += row.amt,
            _ => {}
        }
    }

    let max = cells.iter().map(|c| c.exp).fold(0.0_f64, f64::max);
    for c in &mut cells {
        c.heat = heat(c.exp, max);
    }

    CalMonth {
        start: r.start,
        last: Civil::from_day_number(hi - 1),
        leading: r.start.weekday_monday_first() as u32,
        exp: cells.iter().map(|c| c.exp).sum(),
        inc: cells.iter().map(|c| c.inc).sum(),
        cells,
    }
}

/// Whether the grid may page to the next cycle: only while that cycle has
/// begun. A month that has not started has nothing in it to look at.
pub fn can_page_forward(anchor: Civil, cycle_start: i32, today: Civil) -> bool {
    cycle_range(anchor, cycle_start).end.day_number() <= today.day_number()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(y: i32, m1: i32, d: i32) -> Civil {
        Civil::new(y, m1 - 1, d)
    }

    fn exp(day: Civil, amt: f64) -> CalRow {
        CalRow {
            io: Some(Io::Exp),
            amt,
            day,
        }
    }

    #[test]
    fn a_cell_for_every_day_of_the_cycle() {
        let m = cal_month(&[], c(2026, 9, 20), 1, c(2026, 9, 20));
        assert_eq!(m.cells.len(), 30);
        assert_eq!(m.start, c(2026, 9, 1));
        assert_eq!(m.last, c(2026, 9, 30));
        // 2026-09-01 is a Tuesday: one blank, for Monday
        assert_eq!(m.leading, 1);
    }

    /// A cycle that starts on the 15th is the 15th to the 14th, as 统计's is.
    #[test]
    fn the_month_is_the_accounting_cycle() {
        let m = cal_month(&[], c(2026, 9, 20), 15, c(2026, 9, 20));
        assert_eq!((m.start, m.last), (c(2026, 9, 15), c(2026, 10, 14)));
        assert_eq!(m.cells.len(), 30);
    }

    #[test]
    fn rows_land_on_their_day_and_outside_rows_do_not() {
        let rows = [
            exp(c(2026, 9, 3), 20.0),
            exp(c(2026, 9, 3), 5.0),
            CalRow {
                io: Some(Io::Inc),
                amt: 100.0,
                day: c(2026, 9, 3),
            },
            CalRow {
                io: Some(Io::Xfer),
                amt: 999.0,
                day: c(2026, 9, 3),
            },
            exp(c(2026, 8, 31), 1000.0),
            exp(c(2026, 10, 1), 1000.0),
        ];
        let m = cal_month(&rows, c(2026, 9, 20), 1, c(2026, 9, 20));
        let d3 = m.cells[2];
        assert_eq!(d3.day, c(2026, 9, 3));
        assert_eq!((d3.count, d3.exp, d3.inc), (4, 25.0, 100.0));
        assert_eq!((m.exp, m.inc), (25.0, 100.0));
    }

    #[test]
    fn today_and_what_is_ahead_of_it() {
        let m = cal_month(&[], c(2026, 9, 20), 1, c(2026, 9, 20));
        assert!(m.cells[19].today);
        assert!(!m.cells[19].future);
        assert!(m.cells[20].future);
        assert!(!m.cells[18].future);
        assert_eq!(m.cells.iter().filter(|c| c.today).count(), 1);
    }

    /// The rent day does not wash out every other day.
    #[test]
    fn the_shade_is_the_root_of_the_share() {
        assert_eq!(heat(2800.0, 2800.0), 1.0);
        assert_eq!(heat(700.0, 2800.0), 0.5);
        assert!(heat(40.0, 2800.0) > 0.1, "a lunch is still visible");
        assert_eq!(heat(0.0, 2800.0), 0.0);
        assert_eq!(heat(10.0, 0.0), 0.0);
        assert_eq!(heat(f64::NAN, 10.0), 0.0);
        // the order holds
        assert!(heat(41.0, 2800.0) > heat(40.0, 2800.0));
    }

    #[test]
    fn the_grid_shades_by_its_own_biggest_day() {
        let rows = [exp(c(2026, 9, 1), 100.0), exp(c(2026, 9, 2), 25.0)];
        let m = cal_month(&rows, c(2026, 9, 20), 1, c(2026, 9, 20));
        assert_eq!(m.cells[0].heat, 1.0);
        assert_eq!(m.cells[1].heat, 0.5);
        assert_eq!(m.cells[2].heat, 0.0);
    }

    #[test]
    fn it_pages_forward_only_into_a_cycle_that_has_begun() {
        assert!(!can_page_forward(c(2026, 9, 20), 1, c(2026, 9, 20)));
        assert!(can_page_forward(c(2026, 8, 20), 1, c(2026, 9, 20)));
        // the last day of a cycle is still inside it
        assert!(!can_page_forward(c(2026, 9, 5), 1, c(2026, 9, 30)));
        assert!(can_page_forward(c(2026, 9, 5), 1, c(2026, 10, 1)));
    }
}
