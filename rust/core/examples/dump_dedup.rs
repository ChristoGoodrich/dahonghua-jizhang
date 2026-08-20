//! Emits the Rust bill-dedup's answers for the shared parity corpus.
//! Paired with scripts/dedup-parity.ts.

use dahonghua_core::bills::{CivilTime, RawBill};
use dahonghua_core::catalog::Category;
use dahonghua_core::civil::Civil;
use dahonghua_core::dedup::{compose_note, existing_row, map_category, to_candidates, ExistingRow};
use dahonghua_core::entry::{Entry, EntrySource, Io};
use std::io::{self, Read};

/// `JSON.stringify` for a string.
fn jstr(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// `String(n)` from JavaScript.
///
/// Rust's `{}` is always fixed-point and `{:e}` always exponential; JavaScript
/// switches between them at 1e21 and 1e-7. Only the harness needs this, but it
/// needs it — otherwise a formatting difference reads as a port divergence.
fn jnum(x: f64) -> String {
    if !x.is_finite() {
        return "null".to_string(); // JSON.stringify(NaN) and (Infinity)
    }
    if x == 0.0 {
        return "0".to_string(); // including negative zero
    }
    let e = format!("{x:e}");
    let (mant, exp) = e.split_once('e').expect("{:e} always emits an exponent");
    let exp: i32 = exp.parse().expect("exponent is an integer");
    if exp >= 21 || exp <= -7 {
        let sign = if exp < 0 { "-" } else { "+" };
        format!("{mant}e{sign}{}", exp.abs())
    } else {
        format!("{x}")
    }
}

/// Day `n` of the scenario calendar.
fn day(n: i32) -> Civil {
    Civil::new(2026, 0, 1 + n)
}

fn cat(k: &str, zh: &str, en: &str, c: &str, e: &str) -> Category {
    Category {
        k: k.into(),
        e: e.into(),
        zh: zh.into(),
        en: en.into(),
        c: c.into(),
        custom: Some(true),
    }
}

/// The three custom-category sets the corpus draws from, as (exp, inc).
fn custom_set(name: &str) -> (Vec<Category>, Vec<Category>) {
    match name {
        "coffee" => (vec![cat("c1", "咖啡", "Coffee", "#000", "☕")], vec![]),
        "both" => (
            vec![cat("c1", "咖啡", "Coffee", "#000", "☕")],
            vec![cat("c2", "工资", "Salary", "#111", "💰")],
        ),
        _ => (vec![], vec![]),
    }
}

fn opt(s: &str) -> Option<String> {
    (!s.is_empty()).then(|| s.to_string())
}

/// io^amt^day^srcCat^party^desc
fn parse_bill(rec: &str) -> RawBill {
    let f: Vec<&str> = rec.split('^').collect();
    RawBill {
        io: Io::parse(f[0]).expect("corpus io"),
        amt: f[1].parse().expect("corpus amount"),
        at: CivilTime {
            date: day(f[2].parse().expect("corpus day")),
            h: 12,
            mi: 0,
            s: 0,
        },
        src_cat: opt(f[3]),
        party: opt(f[4]),
        desc: opt(f[5]),
        method: None,
        status: None,
    }
}

/// io^amt^day^note^src^deleted — projected through `existing_row`, so the
/// filtering rules are exercised rather than duplicated here.
fn parse_entry(rec: &str, i: usize) -> Option<ExistingRow> {
    let f: Vec<&str> = rec.split('^').collect();
    let e = Entry {
        id: format!("e{i}"),
        io: Io::parse(f[0]),
        cat: "other".into(),
        amt: f[1].parse().expect("corpus amount"),
        note: opt(f[3]),
        src: EntrySource::parse(f[4]),
        deleted_at: (f[5] == "1").then_some(1),
        ..Default::default()
    };
    existing_row(&e, day(f[2].parse().expect("corpus day")))
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
            "cat" => {
                let io = Io::parse(f[0]).expect("corpus io");
                let (exp, inc) = custom_set(f[3]);
                let custom = if io == Io::Exp { &exp } else { &inc };
                jstr(&map_category(
                    io,
                    (!f[1].is_empty()).then_some(f[1]),
                    (!f[2].is_empty()).then_some(f[2]),
                    custom,
                ))
            }
            "note" => {
                let b = RawBill {
                    io: Io::Exp,
                    amt: 1.0,
                    at: CivilTime {
                        date: day(0),
                        h: 0,
                        mi: 0,
                        s: 0,
                    },
                    src_cat: None,
                    party: opt(f[0]),
                    desc: opt(f[1]),
                    method: None,
                    status: None,
                };
                jstr(&compose_note(&b))
            }
            "cand" => {
                let sec: Vec<&str> = arg.split('|').collect();
                let (exp, inc) = custom_set(sec[0]);
                let bills: Vec<RawBill> = if sec[1].is_empty() {
                    vec![]
                } else {
                    sec[1].split('~').map(parse_bill).collect()
                };
                let existing: Vec<ExistingRow> = if sec.len() < 3 || sec[2].is_empty() {
                    vec![]
                } else {
                    sec[2]
                        .split('~')
                        .enumerate()
                        .filter_map(|(i, r)| parse_entry(r, i))
                        .collect()
                };
                let body = to_candidates(&bills, &existing, &exp, &inc)
                    .iter()
                    .map(|c| {
                        format!(
                            "{{\"io\":{},\"cat\":{},\"amt\":{},\"note\":{},\"y\":{},\"m\":{},\"d\":{},\"dup\":{}}}",
                            jstr(c.io.as_str()),
                            jstr(&c.cat),
                            jnum(c.amt),
                            jstr(&c.note),
                            c.at.date.y,
                            c.at.date.m,
                            c.at.date.d,
                            c.dup,
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                format!("[{body}]")
            }
            other => panic!("unknown corpus kind {other}"),
        };
        out.push(format!("{kind}\t{arg}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
