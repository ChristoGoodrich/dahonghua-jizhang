//! Rust half of the stateful parity harness: replays each corpus scenario
//! against a Ledger and renders the result. Paired with
//! scripts/ledger-parity.harness.ts.

use dahonghua_core::accounts::{Account, AccountKind, NewAccountOpts};
use dahonghua_core::currency::{
    add_rate, remove_rate, set_base_currency, set_rate, BaseSwitch, Denominated,
};
use dahonghua_core::entry::{Entry, Io, Patch};
use dahonghua_core::ledger::{Ledger, RemoveUndo};
use dahonghua_core::model::{Asset, AssetKind, Budgets, Loan, LoanKind, Sub, SubFreq, Template};
use dahonghua_core::money::Currencies;
use dahonghua_core::store::Store;
use std::io::{self, Read};

fn cell_f64(v: f64) -> String {
    // JS renders an integral number without a fractional part
    if v == v.trunc() && v.abs() < 1e21 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

fn opt<T: ToString>(v: Option<T>) -> String {
    v.map_or("_".to_string(), |x| x.to_string())
}

fn render_money(
    assets: &[Asset],
    loans: &[Loan],
    subs: &[Sub],
    templates: &[Template],
    b: &Budgets,
    c: &Currencies,
) -> String {
    let mut rates: Vec<String> = c
        .rates
        .iter()
        .map(|(k, v)| format!("{k}={}", cell_f64(*v)))
        .collect();
    rates.sort(); // HashMap order is not stable; the comparison must be
    format!(
        "as[{}] ln[{}] sb[{}] tp[{}] bg[{},{},{},{}] cur[{} {}]",
        assets
            .iter()
            .map(|a| cell_f64(a.val))
            .collect::<Vec<_>>()
            .join(","),
        loans
            .iter()
            .map(|l| format!(
                "{}/{}",
                cell_f64(l.amt),
                l.repaid.map_or("_".into(), cell_f64)
            ))
            .collect::<Vec<_>>()
            .join(","),
        subs.iter()
            .map(|s| cell_f64(s.amt))
            .collect::<Vec<_>>()
            .join(","),
        templates
            .iter()
            .map(|t| cell_f64(t.amt))
            .collect::<Vec<_>>()
            .join(","),
        cell_f64(b.budget),
        b.daily.map_or("_".into(), cell_f64),
        b.weekly.map_or("_".into(), cell_f64),
        b.per_category.as_ref().map_or("_".to_string(), |m| m
            .iter()
            .map(|(k, v)| format!("{k}:{}", cell_f64(*v)))
            .collect::<Vec<_>>()
            .join(";")),
        c.base,
        rates.join(";"),
    )
}

fn render_accounts(accounts: &[Account], current: &str) -> String {
    let list: Vec<String> = accounts
        .iter()
        .map(|a| {
            format!(
                "{}:{}:{}",
                a.id,
                a.kind.map_or("_".to_string(), |k| k.as_str().to_string()),
                a.archived.map_or("_".to_string(), |v| v.to_string()),
            )
        })
        .collect();
    format!("[{}] cur={current}", list.join(" "))
}

fn render(l: &Ledger) -> String {
    l.all()
        .iter()
        .map(|e| {
            let ft: Vec<String> = e.field_ts.iter().map(|(k, v)| format!("{k}={v}")).collect(); // BTreeMap already iterates sorted
            let ft = if ft.is_empty() {
                "_".to_string()
            } else {
                ft.join(";")
            };
            // column order must match FIELDS in scripts/ledger-parity.harness.ts
            format!(
                "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
                e.id,
                e.ts,
                e.io.map_or("_".to_string(), |i| i.as_str().to_string()),
                e.cat,
                cell_f64(e.amt),
                e.refund.map_or("_".to_string(), cell_f64),
                e.refund_of.clone().unwrap_or_else(|| "_".into()),
                e.acct.clone().unwrap_or_else(|| "_".into()),
                e.acct_to.clone().unwrap_or_else(|| "_".into()),
                e.cur.clone().unwrap_or_else(|| "_".into()),
                e.orig_amt.map_or("_".to_string(), cell_f64),
                e.fee.map_or("_".to_string(), cell_f64),
                e.discount.map_or("_".to_string(), cell_f64),
                e.rb_amt.map_or("_".to_string(), cell_f64),
                opt(e.deleted_at),
                opt(e.updated_at),
                ft,
            )
        })
        .collect::<Vec<_>>()
        .join(" | ")
}

fn run(script: &str) -> String {
    let mut st = Store::new();
    let mut clock: i64 = 1_000_000;
    let mut seq = 0usize;
    let mut undos: Vec<Option<RemoveUndo>> = Vec::new();
    let mut base_results: Vec<&str> = Vec::new();
    let mut acct_seq = 0usize;
    let mut assets: Vec<Asset> = Vec::new();
    let mut loans: Vec<Loan> = Vec::new();
    let mut subs: Vec<Sub> = Vec::new();
    let mut templates: Vec<Template> = Vec::new();
    let mut budgets = Budgets::default();
    let mut currencies = Currencies {
        base: "CNY".into(),
        rates: Default::default(),
    };

    for step in script.split('|') {
        let (verb, raw) = step.split_once(':').unwrap_or((step, ""));
        let args: Vec<&str> = if raw.is_empty() {
            vec![]
        } else {
            raw.split(',').collect()
        };
        clock += 10;

        match verb {
            "add" => {
                let ts = args
                    .first()
                    .filter(|s| !s.is_empty())
                    .map(|s| s.parse().unwrap());
                let e = Entry {
                    io: Io::parse(args[1]),
                    cat: args[2].to_string(),
                    amt: args[3].parse().unwrap(),
                    refund_of: args.get(4).filter(|s| !s.is_empty()).map(|s| s.to_string()),
                    refund: args
                        .get(5)
                        .filter(|s| !s.is_empty())
                        .map(|s| s.parse().unwrap()),
                    acct: args.get(6).filter(|s| !s.is_empty()).map(|s| s.to_string()),
                    acct_to: args.get(7).filter(|s| !s.is_empty()).map(|s| s.to_string()),
                    cur: args.get(8).filter(|s| !s.is_empty()).map(|s| s.to_string()),
                    orig_amt: args
                        .get(9)
                        .filter(|s| !s.is_empty())
                        .map(|s| s.parse().unwrap()),
                    ..Default::default()
                };
                let id = format!("e{seq}");
                seq += 1;
                st.add_entry(e, id, ts, clock);
            }
            "upd" => {
                let (target, field, value) = (args[0], args[1], args[2]);
                let mut p = Patch::default();
                match field {
                    "amt" => p.amt = Some(value.parse().unwrap()),
                    "refund" => p.refund = Some(value.parse().unwrap()),
                    "ts" => p.ts = Some(value.parse().unwrap()),
                    "cat" => p.cat = Some(value.to_string()),
                    "note" => p.note = Some(value.to_string()),
                    other => panic!("unknown patch field {other}"),
                }
                st.update_entry(target, &p, clock);
            }
            "rm" => undos.push(st.remove_entry(args[0], clock)),
            "undo" => {
                let i: usize = args[0].parse().unwrap();
                if let Some(Some(u)) = undos.get(i).cloned() {
                    st.unremove_entry(&u, clock);
                }
            }
            "acct" => {
                // acct:<kind>[,statementDay][,dueDay][,fxCode]
                let kind = AccountKind::parse(args[0]).expect("known kind");
                let opts = NewAccountOpts {
                    statement_day: args
                        .get(1)
                        .filter(|s| !s.is_empty())
                        .map(|s| s.parse().unwrap()),
                    due_day: args
                        .get(2)
                        .filter(|s| !s.is_empty())
                        .map(|s| s.parse().unwrap()),
                    fx_code: args.get(3).filter(|s| !s.is_empty()).map(|s| s.to_string()),
                };
                let id = format!("a{acct_seq}");
                acct_seq += 1;
                st.add_account(id, format!("户{acct_seq}"), 0.0, kind, &opts);
            }
            "rmacct" => {
                st.remove_account(args[0], clock);
            }
            "arch" => {
                st.archive_account(args[0], args[1] == "1");
            }
            "sel" => st.current_account = args[0].to_string(),
            // --- currency ---
            "rate" => set_rate(&mut currencies, args[0], args[1].parse().unwrap()),
            "addrate" => add_rate(&mut currencies, args[0]),
            "rmrate" => remove_rate(&mut currencies, args[0]),
            "base" => {
                let r = set_base_currency(
                    Denominated {
                        ledger: &mut st.ledger,
                        accounts: &mut st.accounts,
                        assets: &mut assets,
                        loans: &mut loans,
                        subs: &mut subs,
                        templates: &mut templates,
                        budgets: &mut budgets,
                        currencies: &mut currencies,
                    },
                    args[0],
                    clock,
                );
                base_results.push(match r {
                    BaseSwitch::Ok => "ok",
                    BaseSwitch::Same => "same",
                    BaseSwitch::NoRate => "no-rate",
                });
            }
            // --- the other denominated collections ---
            "asset" => assets.push(Asset {
                id: format!("as{}", assets.len()),
                name: "x".into(),
                kind: if args[0] == "liab" {
                    AssetKind::Liab
                } else {
                    AssetKind::Asset
                },
                val: args[1].parse().unwrap(),
                no_count: None,
            }),
            "loan" => loans.push(Loan {
                id: format!("l{}", loans.len()),
                who: "x".into(),
                kind: if args[0] == "borrow" {
                    LoanKind::Borrow
                } else {
                    LoanKind::Lend
                },
                amt: args[1].parse().unwrap(),
                repaid: args
                    .get(2)
                    .filter(|s| !s.is_empty())
                    .map(|s| s.parse().unwrap()),
                ts: 0,
            }),
            "sub" => subs.push(Sub {
                id: format!("s{}", subs.len()),
                name: "x".into(),
                emoji: "x".into(),
                amt: args[0].parse().unwrap(),
                freq: SubFreq::Monthly,
                day: 1,
                month: None,
                cat: "misc".into(),
                created: 0,
                last_charged: None,
                is_transfer: None,
                from: None,
                to: None,
                periods: None,
                charged: None,
            }),
            "tpl" => templates.push(Template {
                id: format!("t{}", templates.len()),
                io: Io::Exp,
                cat: "food".into(),
                amt: args[0].parse().unwrap(),
                note: None,
                name: "x".into(),
            }),
            "budget" => {
                budgets.budget = args[0].parse().unwrap();
                budgets.daily = args
                    .get(1)
                    .filter(|s| !s.is_empty())
                    .map(|s| s.parse().unwrap());
                budgets.weekly = args
                    .get(2)
                    .filter(|s| !s.is_empty())
                    .map(|s| s.parse().unwrap());
                budgets.per_category = args.get(3).filter(|s| !s.is_empty()).map(|s| {
                    let mut m = std::collections::BTreeMap::new();
                    m.insert("food".to_string(), s.parse().unwrap());
                    m
                });
            }
            other => panic!("unknown verb {other}"),
        }
    }
    format!(
        "{}  ||  {}  ||  {}  ||  {}",
        render(&st.ledger),
        render_accounts(&st.accounts, &st.current_account),
        render_money(&assets, &loans, &subs, &templates, &budgets, &currencies),
        base_results.join(",")
    )
}

fn main() {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).expect("read corpus");
    let out: Vec<String> = raw
        .lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.is_empty())
        .map(|script| format!("{script}\t{}", run(script)))
        .collect();
    println!("{}", out.join("\n"));
}
