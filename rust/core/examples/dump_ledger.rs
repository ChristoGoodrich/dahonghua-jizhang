//! Rust half of the stateful parity harness: replays each corpus scenario
//! against a Ledger and renders the result. Paired with
//! scripts/ledger-parity.harness.ts.

use dahonghua_core::accounts::{Account, AccountKind, NewAccountOpts};
use dahonghua_core::catalog::{
    add_custom_cat, add_subcat, add_tag, add_template, archive_ledger, remove_subcat, remove_tag,
    remove_template, template_draft, Category, Subcats, TagKind, Tags,
};
use dahonghua_core::civil::Civil;
use dahonghua_core::currency::{
    add_rate, remove_rate, set_base_currency, set_rate, BaseSwitch, Denominated,
};
use dahonghua_core::entry::{Entry, Io, Patch};
use dahonghua_core::ledger::{Ledger, RemoveUndo};
use dahonghua_core::model::{Asset, AssetKind, Budgets, Loan, LoanKind, Sub, SubFreq, Template};
use dahonghua_core::money::Currencies;
use dahonghua_core::networth::{add_asset, add_loan, remove_asset, remove_loan, repay_loan};
use dahonghua_core::reimburse::{
    confirm_reimburse, refund_entry, toggle_reimburse, unmark_reimburse,
};
use dahonghua_core::store::Store;
use dahonghua_core::subs::{decode, run_subscriptions};
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

fn render_catalog(
    tags: &Tags,
    archived: &Option<Vec<String>>,
    current_ledger: &str,
    cats: &[Category],
    subcats: &Subcats,
    templates: &[Template],
) -> String {
    format!(
        "tg[{}|{}] arch[{}] led={} ct[{}] sc[{}] tpl[{}]",
        tags.normal.join(","),
        tags.ledger.join(","),
        archived.as_ref().map_or("_".to_string(), |v| v.join(",")),
        if current_ledger.is_empty() {
            "_"
        } else {
            current_ledger
        },
        cats.iter()
            .map(|c| format!("{}:{}:{}", c.k, c.e, c.c))
            .collect::<Vec<_>>()
            .join(","),
        subcats
            .iter()
            // by position, not by id: the TypeScript generates subcat ids and
            // this side numbers them, so only the order is comparable
            .map(|(k, v)| {
                let items: Vec<String> = v
                    .iter()
                    .enumerate()
                    .map(|(i, s)| format!("sc{i}:{}", s.name))
                    .collect();
                format!("{k}={}", items.join("+"))
            })
            .collect::<Vec<_>>()
            .join(";"),
        templates
            .iter()
            .map(|t| format!("{}:{}", t.id, cell_f64(t.amt)))
            .collect::<Vec<_>>()
            .join(","),
    )
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
            .map(|s| {
                format!(
                    "{}/{}/{}/{}",
                    cell_f64(s.amt),
                    s.last_charged.clone().unwrap_or_else(|| "_".into()),
                    s.charged.map_or("_".to_string(), |c| c.to_string()),
                    s.periods.map_or("_".to_string(), |p| p.to_string()),
                )
            })
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
            // A subscription charge is rendered by the civil date it was
            // derived from rather than by its epoch value: the core decides
            // which dates, the platform decides what they map to, so comparing
            // the epoch would be comparing the harness's own conversion.
            let (ts_cell, id_cell) = if let Some(rest) = e.id.strip_prefix("sub_") {
                let day = Civil::from_day_number(e.ts.div_euclid(86_400_000));
                let date = format!("{}-{}-{}", day.y, day.m, day.d);
                let sub_id = rest.rsplit_once('_').map_or(rest, |(a, _)| a);
                (date.clone(), format!("sub_{sub_id}_{date}"))
            } else {
                (e.ts.to_string(), e.id.clone())
            };
            format!(
                "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
                id_cell,
                ts_cell,
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
                e.rb.map_or("_".to_string(), |r| r.as_str().to_string()),
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
    let mut refunds: Vec<String> = Vec::new();
    let mut sweeps: Vec<String> = Vec::new();
    let mut sub_seq = 0usize;
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
    let mut tags = Tags::default();
    let mut archived_ledgers: Option<Vec<String>> = None;
    let mut current_ledger = String::new();
    let mut custom_cats: Vec<Category> = Vec::new();
    let mut subcats = Subcats::new();
    let mut tpl_seq = 0usize;
    // monotonic, not list length: a removal must not let the next id reuse a
    // name the corpus already spent
    let mut asset_seq = 0usize;
    let mut loan_seq = 0usize;
    let mut sc_seq = 0usize;

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
            // --- net worth ---
            "asset2" => {
                let id = format!("as{asset_seq}");
                asset_seq += 1;
                add_asset(
                    &mut assets,
                    id,
                    "x".into(),
                    if args[0] == "liab" {
                        AssetKind::Liab
                    } else {
                        AssetKind::Asset
                    },
                    args[1].parse().unwrap(),
                );
            }
            "rmasset" => remove_asset(&mut assets, args[0]),
            "loan2" => {
                let id = format!("l{loan_seq}");
                loan_seq += 1;
                add_loan(
                    &mut loans,
                    id,
                    "x".into(),
                    if args[0] == "borrow" {
                        LoanKind::Borrow
                    } else {
                        LoanKind::Lend
                    },
                    args[1].parse().unwrap(),
                    clock,
                );
            }
            "repay" => repay_loan(&mut loans, args[0], args[1].parse().unwrap()),
            "rmloan" => remove_loan(&mut loans, args[0]),

            // --- reimbursement ---
            "rbtog" => {
                toggle_reimburse(&mut st.ledger, args[0], clock);
            }
            "rbdone" => {
                confirm_reimburse(&mut st.ledger, args[0], clock);
            }
            "rbclear" => {
                unmark_reimburse(&mut st.ledger, args[0], clock);
            }
            "refund" => {
                let id = format!("e{seq}");
                let got = refund_entry(
                    &mut st.ledger,
                    args[0],
                    args[1].parse().unwrap(),
                    args.get(2).copied().unwrap_or("zh") == "zh",
                    &custom_cats,
                    &st.current_account,
                    id,
                    clock,
                );
                if got > 0.0 {
                    seq += 1;
                }
                refunds.push(cell_f64(got));
            }

            // --- subscriptions ---
            // sub2:<freq>,<day>,<amt>[,month][,cat][,periods][,charged][,lastCharged][,from,to]
            "sub2" => {
                let id = format!("s{sub_seq}");
                sub_seq += 1;
                let from = args.get(8).filter(|s| !s.is_empty()).map(|s| s.to_string());
                let to = args.get(9).filter(|s| !s.is_empty()).map(|s| s.to_string());
                subs.push(Sub {
                    id,
                    name: "订阅".into(),
                    emoji: "🎵".into(),
                    amt: args[2].parse().unwrap(),
                    freq: if args[0] == "yearly" {
                        SubFreq::Yearly
                    } else {
                        SubFreq::Monthly
                    },
                    day: args[1].parse().unwrap(),
                    month: args
                        .get(3)
                        .filter(|s| !s.is_empty())
                        .map(|s| s.parse().unwrap()),
                    cat: args.get(4).map_or("fun".to_string(), |s| s.to_string()),
                    // the corpus supplies `created` as a civil date, encoded
                    created: 0,
                    last_charged: args.get(7).filter(|s| !s.is_empty()).map(|s| s.to_string()),
                    is_transfer: (from.is_some() && to.is_some()).then_some(true),
                    from,
                    to,
                    periods: args
                        .get(5)
                        .filter(|s| !s.is_empty())
                        .map(|s| s.parse().unwrap()),
                    charged: args
                        .get(6)
                        .filter(|s| !s.is_empty())
                        .map(|s| s.parse().unwrap()),
                });
            }
            // Rewind a subscription's cursor, which is how a second device
            // arrives at a sweep it has already been billed for. Without this
            // the dedup on the derived charge id is never exercised.
            "setlc" => {
                let idx: usize = args[0].parse().unwrap();
                if let Some(sub) = subs.get_mut(idx) {
                    sub.last_charged = args.get(1).filter(|s| !s.is_empty()).map(|s| s.to_string());
                    sub.charged = args
                        .get(2)
                        .filter(|s| !s.is_empty())
                        .map(|s| s.parse().unwrap());
                }
            }
            // run:<y>,<m>,<d>,<createdY>,<createdM>,<createdD>
            "run" => {
                let today = Civil::new(
                    args[0].parse().unwrap(),
                    args[1].parse().unwrap(),
                    args[2].parse().unwrap(),
                );
                let created = Civil::new(
                    args[3].parse().unwrap(),
                    args[4].parse().unwrap(),
                    args[5].parse().unwrap(),
                );
                let r = run_subscriptions(
                    &mut subs,
                    &mut st.ledger,
                    |s| {
                        s.last_charged
                            .as_deref()
                            .filter(|c| !c.is_empty())
                            .and_then(decode)
                            .unwrap_or(created)
                    },
                    today,
                    // the harness pins itself to UTC in-process, so local
                    // midnight is the day number outright
                    |d| d.day_number() * 86_400_000,
                    clock,
                );
                // only the fired names are compared — see the note in
                // scripts/ledger-parity.harness.ts
                sweeps.push(r.fired.len().to_string());
            }

            // --- catalogue ---
            "tag" => add_tag(
                &mut tags,
                if args[0] == "ledger" {
                    TagKind::Ledger
                } else {
                    TagKind::Normal
                },
                args[1],
            ),
            "rmtag" => remove_tag(
                &mut tags,
                if args[0] == "ledger" {
                    TagKind::Ledger
                } else {
                    TagKind::Normal
                },
                args[1],
                &mut current_ledger,
            ),
            // `curled:` with nothing after it is setCurLedger('') — clear the filter
            "curled" => current_ledger = args.first().copied().unwrap_or("").to_string(),
            "archled" => archive_ledger(
                &mut archived_ledgers,
                args[0],
                args[1] == "1",
                &mut current_ledger,
            ),
            "addtpl" => {
                let t = Template {
                    id: String::new(),
                    io: Io::parse(args[0]).unwrap_or(Io::Exp),
                    cat: args[1].to_string(),
                    amt: args[2].parse().unwrap(),
                    note: args.get(3).filter(|s| !s.is_empty()).map(|s| s.to_string()),
                    name: "x".into(),
                };
                let id = format!("t{tpl_seq}");
                tpl_seq += 1;
                add_template(&mut templates, t, id);
            }
            "rmtpl" => remove_template(&mut templates, args[0]),
            "logtpl" => {
                if let Some(d) =
                    template_draft(&templates, args[0], &st.current_account, &current_ledger)
                {
                    let e = Entry {
                        io: Some(d.io),
                        cat: d.cat,
                        amt: d.amt,
                        note: Some(d.note),
                        acct: Some(d.acct),
                        ledger: d.ledger,
                        ..Default::default()
                    };
                    let id = format!("e{seq}");
                    seq += 1;
                    st.add_entry(e, id, None, clock);
                }
            }
            "cat" => {
                add_custom_cat(&mut custom_cats, format!("c{clock}"), args[0], args[1]);
            }
            "addsc" => {
                add_subcat(&mut subcats, args[0], format!("sc{sc_seq}"), args[1]);
                sc_seq += 1;
            }
            "rmsc" => remove_subcat(&mut subcats, args[0], args[1]),
            other => panic!("unknown verb {other}"),
        }
    }
    let results = format!(
        "{}/{}/{}",
        base_results.join(","),
        refunds.join(","),
        sweeps.join(",")
    );
    format!(
        "{}  ||  {}  ||  {}  ||  {}  ||  {}",
        render(&st.ledger),
        render_accounts(&st.accounts, &st.current_account),
        render_money(&assets, &loans, &subs, &templates, &budgets, &currencies),
        render_catalog(
            &tags,
            &archived_ledgers,
            &current_ledger,
            &custom_cats,
            &subcats,
            &templates
        ),
        results
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
