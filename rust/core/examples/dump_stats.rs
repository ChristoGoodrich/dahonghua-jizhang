//! Emits the Rust stats answers for the shared parity corpus.
//! Paired with scripts/stats-parity.ts.

use dahonghua_core::entry::{Entry, Io};
use dahonghua_core::num::js_num;
use dahonghua_core::stats::{
    by_category, by_time_of_day, by_weekday, donut_slices, overview, time_bucket_of, top_entries,
    CatTotal, LocalRow,
};
use std::io::{self, Read};

fn cell<'a>(s: Option<&&'a str>) -> Option<&'a str> {
    match s {
        None | Some(&"_") => None,
        Some(v) => Some(*v),
    }
}

/// io~cat~amt[~dow~hour]
fn parse_entry(rec: &str, i: usize) -> (Entry, i32, i32) {
    let f: Vec<&str> = rec.split('~').collect();
    let dow: i32 = f.get(3).and_then(|v| v.parse().ok()).unwrap_or(0);
    let hour: i32 = f.get(4).and_then(|v| v.parse().ok()).unwrap_or(12);
    let e = Entry {
        id: format!("e{i}"),
        io: cell(f.first()).and_then(Io::parse),
        cat: f.get(1).unwrap_or(&"").to_string(),
        amt: f.get(2).and_then(|v| v.parse().ok()).unwrap_or(0.0),
        ..Default::default()
    };
    (e, dow, hour)
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
        let extra = sec.next();

        let parsed: Vec<(Entry, i32, i32)> = if body.is_empty() {
            vec![]
        } else {
            body.split('^')
                .enumerate()
                .map(|(i, r)| parse_entry(r, i))
                .collect()
        };
        let entries: Vec<Entry> = parsed.iter().map(|(e, _, _)| e.clone()).collect();
        let rows: Vec<LocalRow> = parsed
            .iter()
            .map(|(e, dow, hour)| LocalRow {
                io: e.io,
                amt: e.amt,
                dow: *dow,
                hour: *hour,
            })
            .collect();
        let io_of = |s: Option<&str>| Io::parse(s.unwrap_or("exp")).unwrap_or(Io::Exp);

        let value = match kind {
            "cat" => by_category(&entries, io_of(extra))
                .iter()
                .map(|c| format!("{}:{}", c.cat, js_num(c.amt)))
                .collect::<Vec<_>>()
                .join(","),
            "top" => {
                let spec = extra.unwrap_or("exp,5");
                let mut p = spec.split(',');
                let io = io_of(p.next());
                let n: usize = p.next().and_then(|v| v.parse().ok()).unwrap_or(5);
                top_entries(&entries, io, n)
                    .iter()
                    .map(|e| format!("{}:{}", e.id, js_num(e.amt)))
                    .collect::<Vec<_>>()
                    .join(",")
            }
            "over" => {
                let o = overview(&entries);
                format!(
                    "exp={} inc={} bal={} n={}",
                    js_num(o.exp),
                    js_num(o.inc),
                    js_num(o.balance),
                    o.count
                )
            }
            "donut" => {
                let cats: Vec<CatTotal> = if body.is_empty() {
                    vec![]
                } else {
                    body.split('^')
                        .map(|s| {
                            let (cat, amt) = s.split_once(':').unwrap_or((s, "0"));
                            CatTotal {
                                cat: cat.to_string(),
                                amt: amt.parse().unwrap_or(0.0),
                            }
                        })
                        .collect()
                };
                let total: f64 = extra.and_then(|v| v.parse().ok()).unwrap_or(0.0);
                donut_slices(&cats, total)
                    .iter()
                    .map(|s| format!("{}:{}:{}", s.cat, js_num(s.frac), js_num(s.start)))
                    .collect::<Vec<_>>()
                    .join(",")
            }
            "dow" => by_weekday(&rows, io_of(extra))
                .iter()
                .map(|b| format!("{}:{}:{}", b.dow, js_num(b.amt), b.count))
                .collect::<Vec<_>>()
                .join(","),
            "tod" => by_time_of_day(&rows, io_of(extra))
                .iter()
                .map(|b| format!("{}:{}:{}", b.key, js_num(b.amt), b.count))
                .collect::<Vec<_>>()
                .join(","),
            "bucket" => time_bucket_of(arg.parse().expect("corpus hour")).to_string(),
            other => panic!("unknown corpus kind {other}"),
        };
        out.push(format!("{kind}\t{arg}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
