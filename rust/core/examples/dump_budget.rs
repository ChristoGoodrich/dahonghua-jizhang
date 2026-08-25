//! Emits the Rust budget answers for the shared parity corpus.
//! Paired with scripts/budget-parity.ts.

use dahonghua_core::budget::{
    cat_budget_rows, daily_status, expense_total, monthly_status, tier_status, today_expense,
    DayRow, TierStatus,
};
use dahonghua_core::civil::Civil;
use dahonghua_core::entry::{Entry, Io};
use dahonghua_core::num::js_num;
use std::io::{self, Read};

fn num(s: Option<&&str>) -> Option<f64> {
    match s {
        None | Some(&"_") => None,
        Some(&"nan") => Some(f64::NAN),
        Some(v) => v.parse().ok(),
    }
}

/// io~cat~amt~y~m~d
fn parse_entry(rec: &str, i: usize) -> (Entry, DayRow) {
    let f: Vec<&str> = rec.split('~').collect();
    let io = match f.first() {
        None | Some(&"_") => None,
        Some(v) => Io::parse(v),
    };
    let amt = num(f.get(2)).unwrap_or(0.0);
    let day = Civil::new(
        f.get(3).and_then(|v| v.parse().ok()).unwrap_or(2026),
        f.get(4).and_then(|v| v.parse().ok()).unwrap_or(0),
        f.get(5).and_then(|v| v.parse().ok()).unwrap_or(1),
    );
    (
        Entry {
            id: format!("e{i}"),
            io,
            cat: f.get(1).unwrap_or(&"").to_string(),
            amt,
            ..Default::default()
        },
        DayRow { io, amt, day },
    )
}

fn show(s: &TierStatus) -> String {
    format!(
        "lim={} used={} left={} pct={} over={}",
        js_num(s.limit),
        js_num(s.used),
        js_num(s.left),
        js_num(s.pct),
        s.over
    )
}

/// `a:1;b:2` — an ordered list, because the sort is stable and ties are common.
fn parse_caps(s: &str) -> Vec<(String, f64)> {
    if s.is_empty() {
        return vec![];
    }
    s.split(';')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once(':').unwrap_or((p, "0"));
            let v = if v == "nan" {
                f64::NAN
            } else {
                v.parse().unwrap_or(0.0)
            };
            (k.to_string(), v)
        })
        .collect()
}

fn main() {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).expect("read corpus");

    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let (kind, arg) = line.split_once('\t').expect("corpus line is kind<TAB>arg");
        let mut sec = arg.splitn(2, '|');
        let body = sec.next().unwrap_or("");
        let extra = sec.next().unwrap_or("");

        let parsed: Vec<(Entry, DayRow)> = if body.is_empty() {
            vec![]
        } else {
            body.split('^')
                .enumerate()
                .map(|(i, r)| parse_entry(r, i))
                .collect()
        };
        let entries: Vec<Entry> = parsed.iter().map(|(e, _)| e.clone()).collect();
        let rows: Vec<DayRow> = parsed.iter().map(|(_, r)| *r).collect();

        let f: Vec<&str> = extra.split(',').collect();
        let n0 = || {
            let s = f.first().copied().unwrap_or("0");
            if s == "nan" {
                f64::NAN
            } else {
                s.parse().unwrap_or(0.0)
            }
        };
        let today = |from: usize| {
            Civil::new(
                f.get(from).and_then(|v| v.parse().ok()).unwrap_or(2026),
                f.get(from + 1).and_then(|v| v.parse().ok()).unwrap_or(0),
                f.get(from + 2).and_then(|v| v.parse().ok()).unwrap_or(1),
            )
        };

        let value = match kind {
            "tier" => {
                let used = n0();
                let limit = {
                    let s = f.get(1).copied().unwrap_or("0");
                    if s == "nan" {
                        f64::NAN
                    } else {
                        s.parse().unwrap_or(0.0)
                    }
                };
                show(&tier_status(used, limit))
            }
            "total" => js_num(expense_total(&entries)),
            "today" => js_num(today_expense(&rows, today(0))),
            "monthly" => show(&monthly_status(&entries, n0())),
            "daily" => show(&daily_status(&rows, n0(), today(1))),
            "rows" => cat_budget_rows(&entries, &parse_caps(extra))
                .iter()
                .map(|r| format!("{}:{}", r.cat, js_num(r.status.pct)))
                .collect::<Vec<_>>()
                .join(","),
            other => panic!("unknown kind {other}"),
        };
        out.push(format!("{kind}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
