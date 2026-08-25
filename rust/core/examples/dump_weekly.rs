//! Emits the Rust recap / streak / weekly answers for the shared parity corpus.
//! Paired with scripts/weekly-parity.ts.
//!
//! Three small modules in one corpus: they are each a few dozen lines and they
//! share an entry shape, so splitting them into three would be three times the
//! harness for the same coverage.

use dahonghua_core::civil::Civil;
use dahonghua_core::entry::{Entry, Io};
use dahonghua_core::num::js_num;
use dahonghua_core::recap::month_recap;
use dahonghua_core::streak::streak_days;
use dahonghua_core::weekly::{daily_equivalent, week_range, weekly_status, WeekRow};
use std::io::{self, Read};

fn cell<'a>(f: &[&'a str], i: usize) -> Option<&'a str> {
    match f.get(i) {
        None | Some(&"_") | Some(&"") => None,
        Some(v) => Some(*v),
    }
}

fn num(f: &[&str], i: usize) -> Option<f64> {
    match cell(f, i) {
        None => None,
        Some("nan") => Some(f64::NAN),
        Some(v) => v.parse().ok(),
    }
}

/// io~cat~amt~y~m~d~del
fn parse_row(rec: &str, i: usize) -> (Entry, Civil) {
    let f: Vec<&str> = rec.split('~').collect();
    (
        Entry {
            id: format!("e{i}"),
            io: cell(&f, 0).and_then(Io::parse),
            cat: f.get(1).unwrap_or(&"").to_string(),
            amt: num(&f, 2).unwrap_or(0.0),
            deleted_at: cell(&f, 6).and_then(|v| v.parse().ok()),
            ..Default::default()
        },
        Civil::new(
            cell(&f, 3).and_then(|v| v.parse().ok()).unwrap_or(2026),
            cell(&f, 4).and_then(|v| v.parse().ok()).unwrap_or(5),
            cell(&f, 5).and_then(|v| v.parse().ok()).unwrap_or(10),
        ),
    )
}

fn day_str(c: Civil) -> String {
    format!("{}-{:02}-{:02}", c.y, c.m + 1, c.d)
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

        let rows: Vec<(Entry, Civil)> = if body.is_empty() {
            vec![]
        } else {
            body.split('^')
                .enumerate()
                .map(|(i, r)| parse_row(r, i))
                .collect()
        };
        let entries: Vec<Entry> = rows.iter().map(|(e, _)| e.clone()).collect();
        let days: Vec<Civil> = rows.iter().map(|(_, d)| *d).collect();

        let f: Vec<&str> = extra.split(',').collect();
        let at = |from: usize| {
            Civil::new(
                cell(&f, from).and_then(|v| v.parse().ok()).unwrap_or(2026),
                cell(&f, from + 1).and_then(|v| v.parse().ok()).unwrap_or(5),
                cell(&f, from + 2)
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(10),
            )
        };

        let value = match kind {
            "recap" => {
                let r = month_recap(&entries, &days);
                format!(
                    "exp={} inc={} net={} n={} active={} top={} topAmt={}",
                    js_num(r.exp),
                    js_num(r.inc),
                    js_num(r.net),
                    r.count,
                    r.active_days,
                    r.top_cat_key.unwrap_or_else(|| "-".into()),
                    js_num(r.top_cat_amt)
                )
            }
            // the streak counts logged days, deleted or not — the TypeScript is
            // handed a bare list of timestamps and never sees a tombstone
            "streak" => streak_days(&days, at(0)).to_string(),
            "weekrange" => {
                let r = week_range(at(0));
                format!("{}..{}", day_str(r.start), day_str(r.end))
            }
            "dailyeq" => js_num(daily_equivalent(num(&f, 0).unwrap_or(0.0))),
            "weekly" => {
                let wr: Vec<WeekRow> = rows.iter().map(|(e, d)| WeekRow::of(e, *d)).collect();
                let s = weekly_status(&wr, num(&f, 0).unwrap_or(0.0), at(1));
                format!(
                    "spent={} left={} over={} days={} daily={}",
                    js_num(s.spent),
                    js_num(s.remaining),
                    s.over,
                    s.days_left,
                    js_num(s.daily_budget)
                )
            }
            other => panic!("unknown kind {other}"),
        };
        out.push(format!("{kind}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
