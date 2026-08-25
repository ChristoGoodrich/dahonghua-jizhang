//! Emits the Rust rate decisions for the shared parity corpus.
//! Paired with scripts/rates-parity.ts.
//!
//! Only the decisions cross — no HTTP on either side. The corpus hands over
//! what each source *said* and both halves answer with what they would believe.

use dahonghua_core::civil::{parse_iso_date, Civil};
use dahonghua_core::num::js_num;
use dahonghua_core::rates::{invert, is_recent, resolve, Source};
use std::io::{self, Read};

fn cell<'a>(f: &[&'a str], i: usize) -> Option<&'a str> {
    match f.get(i) {
        None | Some(&"_") | Some(&"") => None,
        Some(v) => Some(*v),
    }
}

/// `_` is "the API said nothing usable", which covers a missing key, a string,
/// a failed request and a timeout alike.
fn raw(f: &[&str], i: usize) -> Option<f64> {
    match cell(f, i) {
        None => None,
        Some("nan") => Some(f64::NAN),
        Some("inf") => Some(f64::INFINITY),
        Some("-inf") => Some(f64::NEG_INFINITY),
        Some(v) => v.parse().ok(),
    }
}

fn src_str(s: Source) -> &'static str {
    match s {
        Source::Identity => "identity",
        Source::Historical => "historical",
        Source::Live => "live",
        Source::Cache => "cache",
        Source::None => "none",
    }
}

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).expect("read corpus");

    let mut out = Vec::new();
    for line in input.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let (kind, arg) = line.split_once('\t').expect("corpus line is kind<TAB>arg");
        let f: Vec<&str> = arg.split('~').collect();

        let value = match kind {
            // raw
            "invert" => match invert(raw(&f, 0)) {
                None => "null".to_string(),
                Some(v) => js_num(v),
            },
            // dateString — the parser's own answer, not just its consequence.
            // Reporting only `is_recent` collapses every parse into a boolean,
            // and a date that rolls out of range lands far from "recent"
            // either way: three parser injections diverged on nothing until
            // this kind existed.
            "parse" => match parse_iso_date(f.first().unwrap_or(&"")) {
                None => "null".to_string(),
                Some(d) => format!("{}-{}-{}", d.y, d.m, d.d),
            },
            // dateString~todayY~todayM~todayD~nowMinutes
            "recent" => {
                let today = Civil::new(
                    cell(&f, 1).and_then(|v| v.parse().ok()).unwrap_or(2026),
                    cell(&f, 2).and_then(|v| v.parse().ok()).unwrap_or(5),
                    cell(&f, 3).and_then(|v| v.parse().ok()).unwrap_or(10),
                );
                let now_minutes: i64 = cell(&f, 4).and_then(|v| v.parse().ok()).unwrap_or(0);
                // an unparseable date string is `Invalid Date`, and every
                // comparison against NaN is false
                match parse_iso_date(f.first().unwrap_or(&"")) {
                    None => "false".to_string(),
                    Some(d) => is_recent(d, today, now_minutes).to_string(),
                }
            }
            // same~historical~liveAllowed~live~cached
            "resolve" => {
                let r = resolve(
                    cell(&f, 0) == Some("1"),
                    raw(&f, 1),
                    cell(&f, 2) == Some("1"),
                    raw(&f, 3),
                    raw(&f, 4),
                );
                format!(
                    "{} {}",
                    r.rate.map(js_num).unwrap_or_else(|| "null".into()),
                    src_str(r.source)
                )
            }
            other => panic!("unknown kind {other}"),
        };
        out.push(format!("{kind}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
