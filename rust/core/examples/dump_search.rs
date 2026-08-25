//! Emits the Rust search / notes / archive answers for the shared parity corpus.
//! Paired with scripts/search-parity.ts.
//!
//! A line is `kind<TAB>a|b|c`, and the three sections mean different things per
//! kind — these are three small modules sharing one harness.

use dahonghua_core::accounts::Account;
use dahonghua_core::archive::{
    archived_accounts, archived_ledgers, picker_accounts, picker_ledgers,
};
use dahonghua_core::catalog::Category;
use dahonghua_core::entry::{Entry, Io};
use dahonghua_core::notes::note_suggestions;
use dahonghua_core::search::matches_search;
use std::io::{self, Read};

fn cell<'a>(f: &[&'a str], i: usize) -> Option<&'a str> {
    match f.get(i) {
        None | Some(&"_") => None,
        Some(v) => Some(*v),
    }
}

fn num(f: &[&str], i: usize) -> Option<f64> {
    match cell(f, i) {
        None | Some("") => None,
        Some("nan") => Some(f64::NAN),
        Some(v) => v.parse().ok(),
    }
}

/// io~cat~amt~note~tag;tag~ledger
fn parse_search_entry(rec: &str, i: usize) -> Entry {
    let f: Vec<&str> = rec.split('~').collect();
    Entry {
        id: format!("e{i}"),
        io: cell(&f, 0).and_then(Io::parse),
        cat: f.get(1).unwrap_or(&"").to_string(),
        amt: num(&f, 2).unwrap_or(0.0),
        note: cell(&f, 3).map(str::to_string),
        tags: cell(&f, 4).map(|t| t.split(';').map(str::to_string).collect()),
        ledger: cell(&f, 5).map(str::to_string),
        ..Default::default()
    }
}

/// io~cat~note~ts~del
fn parse_note_entry(rec: &str, i: usize) -> Entry {
    let f: Vec<&str> = rec.split('~').collect();
    Entry {
        id: format!("e{i}"),
        io: cell(&f, 0).and_then(Io::parse),
        cat: f.get(1).unwrap_or(&"").to_string(),
        note: cell(&f, 2).map(str::to_string),
        ts: cell(&f, 3).and_then(|v| v.parse().ok()).unwrap_or(0),
        deleted_at: cell(&f, 4).and_then(|v| v.parse().ok()),
        ..Default::default()
    }
}

/// id~archived  — `1` archived, `0` explicitly not, `_` absent
fn parse_account(rec: &str) -> Account {
    let f: Vec<&str> = rec.split('~').collect();
    Account {
        id: f.first().unwrap_or(&"").to_string(),
        name: f.first().unwrap_or(&"").to_string(),
        archived: cell(&f, 1).map(|v| v == "1"),
        ..Default::default()
    }
}

/// k:emoji:zh:en
fn parse_cats(s: &str) -> Vec<Category> {
    s.split(';')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let f: Vec<&str> = p.split(':').collect();
            Category {
                k: f.first().unwrap_or(&"").to_string(),
                e: f.get(1).unwrap_or(&"").to_string(),
                zh: f.get(2).unwrap_or(&"").to_string(),
                en: f.get(3).unwrap_or(&"").to_string(),
                c: String::new(),
                custom: Some(true),
            }
        })
        .collect()
}

fn split(s: &str, sep: char) -> Vec<&str> {
    if s.is_empty() {
        vec![]
    } else {
        s.split(sep).collect()
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
        let mut sec = arg.splitn(3, '|');
        let a = sec.next().unwrap_or("");
        let b = sec.next().unwrap_or("");
        let c = sec.next().unwrap_or("");

        let value = match kind {
            // entries | query | lang;customCats
            "search" => {
                let entries: Vec<Entry> = split(a, '^')
                    .into_iter()
                    .enumerate()
                    .map(|(i, r)| parse_search_entry(r, i))
                    .collect();
                let mut opts = c.splitn(2, ';');
                let zh = opts.next() == Some("zh");
                let custom = parse_cats(opts.next().unwrap_or(""));
                entries
                    .iter()
                    .map(|d| {
                        if matches_search(d, b, &custom, zh) {
                            '1'
                        } else {
                            '0'
                        }
                    })
                    .collect::<String>()
            }
            // entries | io,cat,limit |
            "notes" => {
                let entries: Vec<Entry> = split(a, '^')
                    .into_iter()
                    .enumerate()
                    .map(|(i, r)| parse_note_entry(r, i))
                    .collect();
                let f: Vec<&str> = b.split(',').collect();
                let io = cell(&f, 0).and_then(Io::parse).unwrap_or(Io::Exp);
                let cat = f.get(1).unwrap_or(&"");
                let limit: usize = cell(&f, 2).and_then(|v| v.parse().ok()).unwrap_or(6);
                note_suggestions(&entries, io, cat, limit).join(",")
            }
            // accounts | keepIds |
            "pickacct" | "archacct" => {
                let accounts: Vec<Account> = split(a, '^').into_iter().map(parse_account).collect();
                let keep: Vec<&str> = split(b, '^');
                let picked = if kind == "pickacct" {
                    picker_accounts(&accounts, &keep)
                } else {
                    archived_accounts(&accounts)
                };
                picked
                    .iter()
                    .map(|x| x.id.clone())
                    .collect::<Vec<_>>()
                    .join(",")
            }
            // ledgers | archived | keep
            "pickledger" | "archledger" => {
                let ledgers: Vec<String> = split(a, '^').into_iter().map(str::to_string).collect();
                let archived: Vec<String> = split(b, '^').into_iter().map(str::to_string).collect();
                let picked = if kind == "pickledger" {
                    picker_ledgers(&ledgers, &archived, c)
                } else {
                    archived_ledgers(&ledgers, &archived)
                };
                picked.join(",")
            }
            other => panic!("unknown kind {other}"),
        };
        out.push(format!("{kind}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
