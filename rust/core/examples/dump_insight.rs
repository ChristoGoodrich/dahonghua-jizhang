//! Emits the Rust insight answers for the shared parity corpus.
//! Paired with scripts/insight-parity.ts.
//!
//! The banner's *copy* is the caller's, so the corpus carries it: two `copy`
//! lines up front, one per language, transcribed from `insight.ts` and the
//! phrase table. Transcribing them wrong is not a silent risk — the strings are
//! what the two halves are compared on, so a mistake fails the harness on the
//! first case that uses them.

use dahonghua_core::accounts::{Account, AccountKind};
use dahonghua_core::budget::DayRow;
use dahonghua_core::catalog::Category;
use dahonghua_core::civil::Civil;
use dahonghua_core::entry::{Entry, Io};
use dahonghua_core::insight::{compute_insight, credit_due_insight, Budgets, InsightCopy};
use dahonghua_core::statement::DatedEntry;
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

/// io~cat~amt~y~m~d~acct
fn parse_row(rec: &str, i: usize) -> (Entry, Civil) {
    let f: Vec<&str> = rec.split('~').collect();
    (
        Entry {
            id: format!("e{i}"),
            io: cell(&f, 0).and_then(Io::parse),
            cat: f.get(1).unwrap_or(&"").to_string(),
            amt: num(&f, 2).unwrap_or(0.0),
            acct: cell(&f, 6).map(str::to_string),
            ..Default::default()
        },
        Civil::new(
            cell(&f, 3).and_then(|v| v.parse().ok()).unwrap_or(2026),
            cell(&f, 4).and_then(|v| v.parse().ok()).unwrap_or(5),
            cell(&f, 5).and_then(|v| v.parse().ok()).unwrap_or(10),
        ),
    )
}

/// id~name~nameEn~kind~balance~statementDay~dueDay
fn parse_account(rec: &str) -> Account {
    let f: Vec<&str> = rec.split('~').collect();
    Account {
        id: f.first().unwrap_or(&"").to_string(),
        name: f.get(1).unwrap_or(&"").to_string(),
        // `_` is absent; an *empty* field is a real empty string, which is a
        // different thing here — `nameEn || name` falls back on it
        name_en: match f.get(2) {
            None | Some(&"_") => None,
            Some(v) => Some(v.to_string()),
        },
        kind: cell(&f, 3).and_then(AccountKind::parse),
        balance: num(&f, 4).unwrap_or(0.0),
        statement_day: cell(&f, 5).and_then(|v| v.parse().ok()),
        due_day: cell(&f, 6).and_then(|v| v.parse().ok()),
        ..Default::default()
    }
}

/// k:v;k:v — an ordered cap list
fn parse_caps(s: &str) -> Vec<(String, f64)> {
    s.split(';')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once(':').unwrap_or((p, "0"));
            (
                k.to_string(),
                if v == "nan" {
                    f64::NAN
                } else {
                    v.parse().unwrap_or(0.0)
                },
            )
        })
        .collect()
}

/// k:emoji:zh:en — a custom expense category
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

fn owned_copy(f: &[&str]) -> [String; 9] {
    std::array::from_fn(|i| f.get(i).unwrap_or(&"").to_string())
}

fn main() {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).expect("read corpus");

    // filled by the two `copy` lines at the head of the corpus
    let mut copy_zh: [String; 9] = Default::default();
    let mut copy_en: [String; 9] = Default::default();

    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let (kind, arg) = line.split_once('\t').expect("corpus line is kind<TAB>arg");

        if kind == "copyzh" || kind == "copyen" {
            let f: Vec<&str> = arg.split('|').collect();
            if kind == "copyzh" {
                copy_zh = owned_copy(&f);
            } else {
                copy_en = owned_copy(&f);
            }
            out.push(format!("{kind}\tok"));
            continue;
        }

        let mut sec = arg.splitn(4, '|');
        let body = sec.next().unwrap_or("");
        let accts = sec.next().unwrap_or("");
        let extra = sec.next().unwrap_or("");
        let cats = sec.next().unwrap_or("");

        let rows: Vec<(Entry, Civil)> = if body.is_empty() {
            vec![]
        } else {
            body.split('^')
                .enumerate()
                .map(|(i, r)| parse_row(r, i))
                .collect()
        };
        let entries: Vec<Entry> = rows.iter().map(|(e, _)| e.clone()).collect();
        let days: Vec<DayRow> = rows
            .iter()
            .map(|(e, d)| DayRow {
                io: e.io,
                amt: e.amt,
                day: *d,
            })
            .collect();
        let dated: Vec<DatedEntry> = rows
            .iter()
            .map(|(e, d)| DatedEntry {
                entry: e.clone(),
                day: *d,
            })
            .collect();
        let accounts: Vec<Account> = if accts.is_empty() {
            vec![]
        } else {
            accts.split('^').map(parse_account).collect()
        };

        // budget,dailyBudget,caps,zh,todayY,todayM,todayD
        let f: Vec<&str> = extra.split(',').collect();
        let budget = num(&f, 0).unwrap_or(0.0);
        let daily_budget = num(&f, 1).unwrap_or(0.0);
        let caps = parse_caps(f.get(2).unwrap_or(&""));
        let zh = cell(&f, 3) == Some("zh");
        let today = Civil::new(
            cell(&f, 4).and_then(|v| v.parse().ok()).unwrap_or(2026),
            cell(&f, 5).and_then(|v| v.parse().ok()).unwrap_or(5),
            cell(&f, 6).and_then(|v| v.parse().ok()).unwrap_or(10),
        );
        let t = if zh { &copy_zh } else { &copy_en };
        let copy = InsightCopy {
            over_budget: &t[0],
            near_budget: &t[1],
            daily_over: &t[2],
            cat_over: &t[3],
            top_cat: &t[4],
            credit_due: &t[5],
            days_left: &t[6],
            due_today: &t[7],
            overdue: &t[8],
        };
        // `curOf(lang)` - the fullwidth yen sign for Chinese, a dollar for
        // English. The symbol is the platform's, so it arrives as an argument
        // rather than being decided in the core.
        let symbol = if zh { "￥" } else { "$" };

        let show = |r: Option<dahonghua_core::insight::Insight>| match r {
            None => "null".to_string(),
            Some(i) => format!("{}|{}|{}", i.ic, i.text, i.acct_id.unwrap_or_default()),
        };

        let value = match kind {
            "insight" => show(compute_insight(
                &entries,
                &days,
                Budgets {
                    budget,
                    cat_budgets: &caps,
                    daily: daily_budget,
                },
                &parse_cats(cats),
                today,
                zh,
                &copy,
            )),
            "credit" => show(credit_due_insight(
                &accounts, &dated, today, zh, symbol, &copy,
            )),
            other => panic!("unknown kind {other}"),
        };
        out.push(format!("{kind}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
