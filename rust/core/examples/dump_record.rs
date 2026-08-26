//! Emits the Rust record-form answers for the shared parity corpus.
//! Paired with scripts/record-parity.ts.

use dahonghua_core::entry::{Entry, Io};
use dahonghua_core::jsval::{parse, Value};
use dahonghua_core::money::Currencies;
use dahonghua_core::num::js_num;
use dahonghua_core::record::{
    after_save_next, draft, initial_fields, pick_io, rate_source, should_patch_ts, validate, Draft,
    FormDefaults, FormFields, RateSource, Rejection,
};
use dahonghua_core::rows::entry_from_value;
use std::collections::HashMap;
use std::io::{self, Read};

fn s_of(v: Option<&Value>) -> String {
    match v {
        Some(Value::Str(s)) => s.clone(),
        _ => String::new(),
    }
}

fn n_of(v: Option<&Value>) -> Option<f64> {
    match v {
        Some(Value::Num(n)) => Some(*n),
        _ => None,
    }
}

fn strs(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::Arr(items)) => items
            .iter()
            .map(|i| match i {
                Value::Str(s) => s.clone(),
                _ => String::new(),
            })
            .collect(),
        _ => vec![],
    }
}

fn rates(v: Option<&Value>) -> HashMap<String, f64> {
    match v {
        Some(Value::Obj(entries)) => entries
            .iter()
            .filter_map(|(k, val)| match val {
                Value::Num(n) => Some((k.clone(), *n)),
                _ => None,
            })
            .collect(),
        _ => HashMap::new(),
    }
}

fn fields(v: Option<&Value>) -> FormFields {
    let Some(o) = v else {
        return FormFields::default();
    };
    FormFields {
        io: Io::parse(&s_of(o.get("io"))),
        cat: s_of(o.get("cat")),
        amt: s_of(o.get("amt")),
        note: s_of(o.get("note")),
        acct: s_of(o.get("acct")),
        acct_to: s_of(o.get("acctTo")),
        fee: s_of(o.get("fee")),
        discount: s_of(o.get("discount")),
        tags: strs(o.get("tags")),
        ledger: s_of(o.get("ledger")),
        cur: s_of(o.get("cur")),
        subcat: s_of(o.get("subcat")),
        ts: n_of(o.get("ts")).map(|n| n as i64),
    }
}

fn defaults(v: Option<&Value>) -> FormDefaults {
    let Some(o) = v else {
        return FormDefaults::default();
    };
    FormDefaults {
        base: s_of(o.get("base")),
        acct: s_of(o.get("acct")),
        ledger: s_of(o.get("ledger")),
        first_exp_cat: s_of(o.get("firstExpCat")),
        initial_ts: n_of(o.get("initialTs")).map(|n| n as i64),
    }
}

fn show_str(s: &str) -> String {
    if s.is_empty() {
        "_".to_string()
    } else {
        s.to_string()
    }
}

/// Absent and empty are different answers — see scripts/record-parity.ts.
fn show_opt(v: &Option<String>) -> String {
    match v {
        None => "_".to_string(),
        Some(x) => format!("'{x}'"),
    }
}

fn show_opt_list(v: &Option<Vec<String>>) -> String {
    match v {
        None => "_".to_string(),
        Some(x) => format!("[{}]", x.join(",")),
    }
}

fn show_num(n: Option<f64>) -> String {
    n.map(js_num).unwrap_or_else(|| "_".to_string())
}

fn show_fields(f: &FormFields) -> String {
    [
        f.io.map(|i| i.as_str().to_string()).unwrap_or_default(),
        show_str(&f.cat),
        show_str(&f.amt),
        show_str(&f.note),
        show_str(&f.acct),
        show_str(&f.acct_to),
        show_str(&f.fee),
        show_str(&f.discount),
        format!("[{}]", f.tags.join(",")),
        show_str(&f.ledger),
        show_str(&f.cur),
        show_str(&f.subcat),
        f.ts.map(|t| t.to_string())
            .unwrap_or_else(|| "_".to_string()),
    ]
    .join("|")
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
        let (kind, arg) = line.split_once('\t').expect("corpus line is kind<TAB>json");
        let a = parse(arg);

        let value = match kind {
            "validate" => match validate(
                &fields(a.get("f")),
                &s_of(a.get("base")),
                &rates(a.get("rates")),
            ) {
                None => "ok".to_string(),
                Some(Rejection::Amount) => "amount".to_string(),
                Some(Rejection::XferTo) => "xferTo".to_string(),
                Some(Rejection::XferSame) => "xferSame".to_string(),
                Some(Rejection::NoRate(c)) => format!("noRate:{c}"),
            },
            "rateSource" => match rate_source(n_of(a.get("fetched")), n_of(a.get("cached"))) {
                None => "null".to_string(),
                Some(RateSource::Api) => "api".to_string(),
                Some(RateSource::Cached) => "cached".to_string(),
            },
            "initial" => {
                let src: Option<Entry> = match a.get("source") {
                    Some(v @ Value::Obj(_)) => Some(entry_from_value(v)),
                    _ => None,
                };
                let editing = matches!(a.get("editing"), Some(Value::Bool(true)));
                show_fields(&initial_fields(
                    src.as_ref(),
                    editing,
                    &defaults(a.get("d")),
                ))
            }
            "pickIo" => {
                let next = Io::parse(&s_of(a.get("next"))).unwrap_or(Io::Exp);
                let f = fields(a.get("f"));
                let p = pick_io(
                    next,
                    &f,
                    &strs(a.get("accounts")),
                    &s_of(a.get("current")),
                    |io| format!("first-{}", io.as_str()),
                );
                // only the keys the TypeScript's partial names, in its order —
                // a key it leaves out reads as `_` on both sides
                let cat = if next == Io::Xfer {
                    "_".to_string()
                } else {
                    p.cat.clone()
                };
                // NOT show_str: the TypeScript renders these with `?? '_'`,
                // which replaces null and undefined and leaves an empty string
                // alone. Mapping empty to `_` here reported 85 divergences that
                // were this line rather than the code under test.
                let (acct, acct_to) = if next == Io::Xfer {
                    (p.acct.clone(), p.acct_to.clone())
                } else {
                    ("_".to_string(), "_".to_string())
                };
                format!(
                    "io={} subcat={} cat={} acct={} acctTo={}",
                    next.as_str(),
                    // an empty string is what the TypeScript writes, and `?? '_'`
                    // does not replace it
                    p.subcat,
                    cat,
                    acct,
                    acct_to
                )
            }
            "patchTs" => should_patch_ts(
                n_of(a.get("orig")).map(|n| n as i64),
                n_of(a.get("form")).map(|n| n as i64),
            )
            .to_string(),
            "draft" => {
                let cur = a.get("currencies");
                let currencies = Currencies {
                    base: s_of(cur.and_then(|c| c.get("base"))),
                    rates: rates(cur.and_then(|c| c.get("rates"))),
                };
                match draft(
                    &fields(a.get("f")),
                    &s_of(a.get("base")),
                    &currencies,
                    n_of(a.get("rate")),
                ) {
                    None => "none".to_string(),
                    Some(Draft::Xfer {
                        from,
                        to,
                        amt,
                        fee,
                        discount,
                        note,
                        ledger,
                        ts,
                    }) => format!(
                        "xfer {from}>{to} {} fee={} disc={} note={} ledger={} ts={}",
                        js_num(amt),
                        js_num(fee),
                        js_num(discount),
                        show_str(&note),
                        show_str(&ledger),
                        ts.map(|t| t.to_string()).unwrap_or_else(|| "_".into())
                    ),
                    Some(Draft::Entry {
                        io,
                        cat,
                        amt,
                        note,
                        acct,
                        tags,
                        ledger,
                        subcat,
                        cur,
                        orig_amt,
                        rate,
                        ts,
                    }) => format!(
                        "entry {} {cat} {} note={} acct={} tags={} ledger={} subcat={} cur={} orig={} rate={} ts={}",
                        io.map(|i| i.as_str().to_string()).unwrap_or_default(),
                        js_num(amt),
                        show_str(&note),
                        show_str(&acct),
                        show_opt_list(&tags),
                        show_opt(&ledger),
                        show_opt(&subcat),
                        show_opt(&cur),
                        show_num(orig_amt),
                        show_num(rate),
                        ts.map(|t| t.to_string()).unwrap_or_else(|| "_".into())
                    ),
                }
            }
            "afterNext" => show_fields(&after_save_next(&fields(a.get("f")))),
            other => panic!("unknown kind {other}"),
        };
        out.push(format!("{kind}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
