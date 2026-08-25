//! Emits the Rust CSV export for the shared parity corpus.
//! Paired with scripts/export-parity.ts.
//!
//! Only the CSV crosses. The XLSX half is the same rows through a ZIP writer,
//! and a ZIP is a serialisation rather than a decision — see `export.rs`.

use dahonghua_core::catalog::Category;
use dahonghua_core::civil::Civil;
use dahonghua_core::entry::{Entry, Io};
use dahonghua_core::export::{to_csv, CustomCats, ExportRow};
use std::io::{self, Read};

fn cell<'a>(f: &[&'a str], i: usize) -> Option<&'a str> {
    match f.get(i) {
        None | Some(&"_") => None,
        Some(v) => Some(*v),
    }
}

/// `_LF_`, `_CR_` and `_TAB_` are tokens in the corpus because it is one case
/// per line — expanded here so the port sees the character the app would.
fn expand(s: &str) -> String {
    s.replace("_LF_", "\n")
        .replace("_CR_", "\r")
        .replace("_TAB_", "\t")
}

fn num(f: &[&str], i: usize) -> Option<f64> {
    match cell(f, i) {
        None | Some("") => None,
        Some("nan") => Some(f64::NAN),
        Some(v) => v.parse().ok(),
    }
}

/// io~cat~amt~note~acct~acctTo~ts~y~m~d~del
fn parse_row(rec: &str, i: usize) -> ExportRow {
    let f: Vec<&str> = rec.split('~').collect();
    ExportRow {
        entry: Entry {
            id: format!("e{i}"),
            io: cell(&f, 0).and_then(Io::parse),
            cat: f.get(1).unwrap_or(&"").to_string(),
            amt: num(&f, 2).unwrap_or(0.0),
            note: cell(&f, 3).map(expand),
            acct: cell(&f, 4).map(str::to_string),
            acct_to: cell(&f, 5).map(str::to_string),
            ts: cell(&f, 6).and_then(|v| v.parse().ok()).unwrap_or(0),
            deleted_at: cell(&f, 10).and_then(|v| v.parse().ok()),
            ..Default::default()
        },
        day: Civil::new(
            cell(&f, 7).and_then(|v| v.parse().ok()).unwrap_or(2026),
            cell(&f, 8).and_then(|v| v.parse().ok()).unwrap_or(5),
            cell(&f, 9).and_then(|v| v.parse().ok()).unwrap_or(10),
        ),
    }
}

/// id:name
fn parse_accounts(s: &str) -> Vec<(String, String)> {
    s.split(';')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (id, name) = p.split_once(':').unwrap_or((p, ""));
            (id.to_string(), name.to_string())
        })
        .collect()
}

/// k:zh:en
fn parse_cats(s: &str) -> Vec<Category> {
    s.split(';')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let f: Vec<&str> = p.split(':').collect();
            Category {
                k: f.first().unwrap_or(&"").to_string(),
                e: String::new(),
                zh: f.get(1).unwrap_or(&"").to_string(),
                en: f.get(2).unwrap_or(&"").to_string(),
                c: String::new(),
                custom: Some(true),
            }
        })
        .collect()
}

/// Both halves spell an awkward character the same way, so a formatting
/// difference in the harness cannot be reported as one in the code.
fn show(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        let n = c as u32;
        let odd =
            n < 0x20 || (0x7f..=0xa0).contains(&n) || n == 0xfeff || n == 0x2028 || n == 0x2029;
        if odd {
            out.push_str(&format!("<U+{n:04X}>"));
        } else {
            out.push(c);
        }
    }
    out
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
        let mut sec = arg.splitn(3, '|');
        let body = sec.next().unwrap_or("");
        let accts = sec.next().unwrap_or("");
        let cats = sec.next().unwrap_or("");

        let rows: Vec<ExportRow> = if body.is_empty() {
            vec![]
        } else {
            body.split('^')
                .enumerate()
                .map(|(i, r)| parse_row(r, i))
                .collect()
        };

        let value = match kind {
            // the corpus states an expense list only, which is what the
            // TypeScript harness builds — inc and xfer stay empty
            "csv" => {
                let exp = parse_cats(cats);
                let custom = CustomCats {
                    exp: &exp,
                    inc: &[],
                    xfer: &[],
                };
                show(&to_csv(&rows, &parse_accounts(accts), custom))
            }
            other => panic!("unknown kind {other}"),
        };
        out.push(format!("{kind}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
