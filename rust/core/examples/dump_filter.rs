//! Emits the Rust filter's answers for the shared parity corpus.
//! Paired with scripts/filter-parity.ts.

use dahonghua_core::civil::Civil;
use dahonghua_core::entry::{Entry, Io};
use dahonghua_core::filter::{
    matches_filter, parse_date_range, parse_search_query, DateRange, FilterState,
};
use std::io::{self, Read};

/// `_` is absent, `~` is the empty string.
fn cell(s: Option<&&str>) -> Option<String> {
    match s {
        None | Some(&"_") => None,
        Some(&"~") => Some(String::new()),
        Some(v) => Some((*v).to_string()),
    }
}

fn num(s: Option<&&str>) -> Option<i64> {
    cell(s).and_then(|v| v.parse().ok())
}

fn show(r: &DateRange) -> String {
    let f = |t: &dahonghua_core::bills::CivilTime| {
        format!(
            "{}-{}-{} {}:{}:{}",
            t.date.y, t.date.m, t.date.d, t.h, t.mi, t.s
        )
    };
    format!("{} .. {}", f(&r.from), f(&r.to))
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
        let f: Vec<&str> = arg.split('^').collect();

        let value = match kind {
            "range" => {
                let today = Civil::new(
                    f[1].parse().expect("year"),
                    f[2].parse().expect("month"),
                    f[3].parse().expect("day"),
                );
                parse_date_range(f[0], today).map_or("null".to_string(), |r| show(&r))
            }
            "query" => {
                let today = Civil::new(
                    f[1].parse().expect("year"),
                    f[2].parse().expect("month"),
                    f[3].parse().expect("day"),
                );
                let r = parse_search_query(f[0], today);
                format!(
                    "text={:?} io={} range={}",
                    r.text,
                    r.filter.io.map_or("_", |i| i.as_str()),
                    r.range.map_or("null".to_string(), |g| show(&g))
                )
            }
            "match" => {
                let e = Entry {
                    id: "e1".into(),
                    ts: f[3].parse().expect("ts"),
                    io: cell(f.first()).and_then(|s| Io::parse(&s)),
                    cat: cell(f.get(1)).unwrap_or_default(),
                    amt: 10.0,
                    acct: cell(f.get(2)),
                    ..Default::default()
                };
                let filter = FilterState {
                    io: cell(f.get(4)).and_then(|s| Io::parse(&s)),
                    cat: cell(f.get(5)),
                    acct: cell(f.get(6)),
                    date_from: num(f.get(7)),
                    date_to: num(f.get(8)),
                };
                matches_filter(&e, &filter).to_string()
            }
            other => panic!("unknown corpus kind {other}"),
        };
        out.push(format!("{kind}\t{arg}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
