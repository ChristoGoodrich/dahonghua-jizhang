//! Emits the Rust statement and net-worth answers for the shared parity corpus.
//! Paired with scripts/statement-parity.ts.
//!
//! A corpus line is `kind<TAB>accounts|entries|extra`.

use dahonghua_core::accounts::{Account, AccountKind};
use dahonghua_core::civil::Civil;
use dahonghua_core::entry::{Entry, Io};
use dahonghua_core::model::{Asset, AssetKind, Loan, LoanKind};
use dahonghua_core::networth::{
    acct_balances, acct_balances_with, net_worth_parts, total_account_balance,
};
use dahonghua_core::num::js_num;
use dahonghua_core::statement::{
    due_date_for, due_soon, last_statement_close, statement_summary, DatedEntry,
};
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

/// id~kind~balance~statementDay~dueDay
fn parse_account(rec: &str) -> Account {
    let f: Vec<&str> = rec.split('~').collect();
    Account {
        id: f.first().unwrap_or(&"").to_string(),
        name: f.first().unwrap_or(&"").to_string(),
        kind: cell(&f, 1).and_then(AccountKind::parse),
        balance: num(&f, 2).unwrap_or(0.0),
        statement_day: cell(&f, 3).and_then(|v| v.parse().ok()),
        due_day: cell(&f, 4).and_then(|v| v.parse().ok()),
        ..Default::default()
    }
}

/// io~acct~acctTo~amt~fee~discount~y~m~d~del
fn parse_entry(rec: &str, i: usize) -> DatedEntry {
    let f: Vec<&str> = rec.split('~').collect();
    DatedEntry {
        entry: Entry {
            id: format!("e{i}"),
            io: cell(&f, 0).and_then(Io::parse),
            acct: cell(&f, 1).map(str::to_string),
            acct_to: cell(&f, 2).map(str::to_string),
            amt: num(&f, 3).unwrap_or(0.0),
            fee: num(&f, 4),
            discount: num(&f, 5),
            deleted_at: cell(&f, 9).and_then(|v| v.parse().ok()),
            // an opaque integer, used only by the epoch-cutoff kinds — see the
            // `#` branch below
            ts: cell(&f, 10).and_then(|v| v.parse().ok()).unwrap_or(0),
            ..Default::default()
        },
        day: Civil::new(
            cell(&f, 6).and_then(|v| v.parse().ok()).unwrap_or(2026),
            cell(&f, 7).and_then(|v| v.parse().ok()).unwrap_or(0),
            cell(&f, 8).and_then(|v| v.parse().ok()).unwrap_or(1),
        ),
    }
}

fn day_str(c: Civil) -> String {
    format!("{}-{:02}-{:02}", c.y, c.m + 1, c.d)
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
        let accounts: Vec<Account> = split(sec.next().unwrap_or(""), '^')
            .into_iter()
            .map(parse_account)
            .collect();
        let rows: Vec<DatedEntry> = split(sec.next().unwrap_or(""), '^')
            .into_iter()
            .enumerate()
            .map(|(i, r)| parse_entry(r, i))
            .collect();
        let extra = sec.next().unwrap_or("");
        let f: Vec<&str> = extra.split(',').collect();

        let entries: Vec<Entry> = rows.iter().map(|r| r.entry.clone()).collect();
        let day_of = |e: &Entry| {
            rows.iter()
                .find(|r| r.entry.id == e.id)
                .map(|r| r.day)
                .expect("every entry came from rows")
        };
        // an `as_of` in this corpus always means "the end of that day", which
        // is the only shape the app ever passes — `statementSummary` is the
        // sole caller that passes one at all
        let upto = |from: usize| -> Option<Civil> {
            let y = cell(&f, from)?.parse().ok()?;
            Some(Civil::new(
                y,
                cell(&f, from + 1).and_then(|v| v.parse().ok()).unwrap_or(0),
                cell(&f, from + 2).and_then(|v| v.parse().ok()).unwrap_or(1),
            ))
        };
        let today = |from: usize| upto(from).unwrap_or(Civil::new(2026, 0, 1));
        // `#n` means an epoch cutoff rather than a calendar one: both halves
        // then compare `d.ts <= n` over opaque integers, with no timezone
        // anywhere near it. Without this the epoch form of `acct_balances` was
        // never executed by the corpus at all — an injection flipping its `<=`
        // to `<` diverged on nothing, which looked like coverage and was not.
        let epoch_cut = extra
            .split_once('#')
            .and_then(|(_, v)| v.parse::<i64>().ok());
        let balances = |cut: Option<Civil>| {
            if let Some(n) = epoch_cut {
                return acct_balances(&accounts, &entries, Some(n));
            }
            acct_balances_with(&accounts, &entries, |e| cut.is_none_or(|c| day_of(e) <= c))
        };

        let value = match kind {
            "bal" => balances(upto(0))
                .iter()
                .map(|(k, v)| format!("{k}:{}", js_num(*v)))
                .collect::<Vec<_>>()
                .join(","),
            "one" => {
                let id = match extra.split_once('#') {
                    Some((id, _)) => id.trim_end_matches(','),
                    None => cell(&f, 0).unwrap_or(""),
                };
                if !accounts.iter().any(|a| a.id == id) {
                    js_num(0.0)
                } else {
                    js_num(
                        balances(upto(1))
                            .iter()
                            .find(|(k, _)| k == id)
                            .map(|(_, v)| *v)
                            .unwrap_or(0.0),
                    )
                }
            }
            "total" => js_num(total_account_balance(&accounts, &entries)),
            "net" => {
                // extra is `assets;loans`, an asset being kind:val:noCount and
                // a loan kind:amt:repaid
                let mut parts = extra.splitn(2, ';');
                let assets: Vec<Asset> = split(parts.next().unwrap_or(""), '+')
                    .into_iter()
                    .enumerate()
                    .map(|(i, a)| {
                        let p: Vec<&str> = a.split(':').collect();
                        Asset {
                            id: format!("a{i}"),
                            name: format!("a{i}"),
                            kind: if p.first() == Some(&"liab") {
                                AssetKind::Liab
                            } else {
                                AssetKind::Asset
                            },
                            val: num(&p, 1).unwrap_or(0.0),
                            no_count: cell(&p, 2).map(|v| v == "1"),
                        }
                    })
                    .collect();
                let loans: Vec<Loan> = split(parts.next().unwrap_or(""), '+')
                    .into_iter()
                    .enumerate()
                    .map(|(i, l)| {
                        let p: Vec<&str> = l.split(':').collect();
                        Loan {
                            id: format!("l{i}"),
                            who: format!("l{i}"),
                            kind: if p.first() == Some(&"lend") {
                                LoanKind::Lend
                            } else {
                                LoanKind::Borrow
                            },
                            amt: num(&p, 1).unwrap_or(0.0),
                            repaid: num(&p, 2),
                            ts: 0,
                        }
                    })
                    .collect();
                let n = net_worth_parts(&accounts, &entries, &assets, &loans);
                format!(
                    "asset={} liab={} net={}",
                    js_num(n.asset),
                    js_num(n.liab),
                    js_num(n.net)
                )
            }
            "close" => {
                let sd: u32 = cell(&f, 0).and_then(|v| v.parse().ok()).unwrap_or(1);
                day_str(last_statement_close(sd, today(1)))
            }
            "due" => {
                let close = today(0);
                let sd: u32 = cell(&f, 3).and_then(|v| v.parse().ok()).unwrap_or(1);
                let dd: u32 = cell(&f, 4).and_then(|v| v.parse().ok()).unwrap_or(1);
                day_str(due_date_for(close, sd, dd))
            }
            "summary" => {
                let id = cell(&f, 0).unwrap_or("");
                match accounts.iter().find(|a| a.id == id) {
                    None => "none".to_string(),
                    Some(a) => match statement_summary(a, &accounts, &rows, today(1)) {
                        None => "none".to_string(),
                        Some(s) => format!(
                            "close={} billed={} over={} unbilled={} debt={} due={} days={}",
                            day_str(s.statement_close),
                            js_num(s.billed_due),
                            js_num(s.overpay),
                            js_num(s.unbilled),
                            js_num(s.current_debt),
                            s.due_date.map(day_str).unwrap_or_else(|| "-".into()),
                            s.days_to_due
                                .map(|d| d.to_string())
                                .unwrap_or_else(|| "-".into()),
                        ),
                    },
                }
            }
            "soon" => {
                let within: i64 = cell(&f, 3).and_then(|v| v.parse().ok()).unwrap_or(7);
                due_soon(&accounts, &rows, today(0), within)
                    .iter()
                    .map(|r| {
                        format!(
                            "{}:{}:{}",
                            r.account.id,
                            js_num(r.billed_due),
                            r.days_to_due
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(",")
            }
            other => panic!("unknown kind {other}"),
        };
        out.push(format!("{kind}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
