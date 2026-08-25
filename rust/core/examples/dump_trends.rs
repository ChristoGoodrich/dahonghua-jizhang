//! Emits the Rust trend series for the shared parity corpus.
//! Paired with scripts/trends-parity.ts.

use dahonghua_core::civil::Civil;
use dahonghua_core::entry::Io;
use dahonghua_core::num::js_num;
use dahonghua_core::trends::{category_trend, daily_trend, weekly_trend, TrendRow};
use std::io::{self, Read};

/// `toDateStr`: the year as-is, the month and day padded to two.
///
/// Months are stored zero-based, as in `new Date(y, m, d)`, so the label adds
/// the one back on.
fn date_str(c: Civil) -> String {
    format!("{}-{:02}-{:02}", c.y, c.m + 1, c.d)
}

/// io~cat~amt~y~m~d~deletedAt
///
/// `_` is an absent field; `nan` is a literal NaN, which both `amt` and the
/// tombstone need to carry — a NaN tombstone is falsy and so is not a
/// tombstone at all.
fn parse_row(rec: &str) -> TrendRow {
    let f: Vec<&str> = rec.split('~').collect();
    let num = |s: Option<&&str>| -> Option<f64> {
        match s {
            None | Some(&"_") => None,
            Some(&"nan") => Some(f64::NAN),
            Some(v) => v.parse().ok(),
        }
    };
    TrendRow {
        io: match f.first() {
            None | Some(&"_") => None,
            Some(v) => Io::parse(v),
        },
        amt: num(f.get(2)).unwrap_or(0.0),
        cat: f.get(1).unwrap_or(&"").to_string(),
        day: Civil::new(
            f.get(3).and_then(|v| v.parse().ok()).unwrap_or(2026),
            f.get(4).and_then(|v| v.parse().ok()).unwrap_or(0),
            f.get(5).and_then(|v| v.parse().ok()).unwrap_or(1),
        ),
        deleted_at: num(f.get(6)),
    }
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

        let rows: Vec<TrendRow> = if body.is_empty() {
            vec![]
        } else {
            body.split('^').map(parse_row).collect()
        };

        // n,todayY,todayM,todayD[,category]
        let f: Vec<&str> = extra.split(',').collect();
        let n: i64 = f.first().and_then(|v| v.parse().ok()).unwrap_or(7);
        let today = Civil::new(
            f.get(1).and_then(|v| v.parse().ok()).unwrap_or(2026),
            f.get(2).and_then(|v| v.parse().ok()).unwrap_or(0),
            f.get(3).and_then(|v| v.parse().ok()).unwrap_or(1),
        );

        let value = match kind {
            "daily" => daily_trend(&rows, n, today)
                .iter()
                .map(|p| format!("{}:{}:{}", date_str(p.date), js_num(p.exp), js_num(p.inc)))
                .collect::<Vec<_>>()
                .join(","),
            "weekly" => weekly_trend(&rows, n, today)
                .iter()
                .map(|p| format!("{}:{}:{}", date_str(p.date), js_num(p.exp), js_num(p.inc)))
                .collect::<Vec<_>>()
                .join(","),
            "cat" => category_trend(&rows, f.get(4).unwrap_or(&""), n, today)
                .iter()
                .map(|p| format!("{}:{}", date_str(p.date), js_num(p.amt)))
                .collect::<Vec<_>>()
                .join(","),
            other => panic!("unknown kind {other}"),
        };
        out.push(format!("{kind}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
