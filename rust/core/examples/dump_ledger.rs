//! Rust half of the stateful parity harness: replays each corpus scenario
//! against a Ledger and renders the result. Paired with
//! scripts/ledger-parity.harness.ts.

use dahonghua_core::entry::{Entry, Io, Patch};
use dahonghua_core::ledger::{Ledger, RemoveUndo};
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
            format!(
                "{},{},{},{},{},{},{},{},{},{}",
                e.id,
                e.ts,
                e.io.map_or("_".to_string(), |i| i.as_str().to_string()),
                e.cat,
                cell_f64(e.amt),
                e.refund.map_or("_".to_string(), cell_f64),
                e.refund_of.clone().unwrap_or_else(|| "_".into()),
                opt(e.deleted_at),
                opt(e.updated_at),
                ft,
            )
        })
        .collect::<Vec<_>>()
        .join(" | ")
}

fn run(script: &str) -> String {
    let mut l = Ledger::new();
    let mut clock: i64 = 1_000_000;
    let mut seq = 0usize;
    let mut undos: Vec<Option<RemoveUndo>> = Vec::new();

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
                let e = Entry {
                    ts: args[0].parse().unwrap(),
                    io: Io::parse(args[1]),
                    cat: args[2].to_string(),
                    amt: args[3].parse().unwrap(),
                    refund_of: args.get(4).filter(|s| !s.is_empty()).map(|s| s.to_string()),
                    refund: args
                        .get(5)
                        .filter(|s| !s.is_empty())
                        .map(|s| s.parse().unwrap()),
                    ..Default::default()
                };
                let id = format!("e{seq}");
                seq += 1;
                l.add(e, id, clock);
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
                l.update(target, &p, clock);
            }
            "rm" => undos.push(l.remove(args[0], clock)),
            "undo" => {
                let i: usize = args[0].parse().unwrap();
                if let Some(Some(u)) = undos.get(i).cloned() {
                    l.unremove(&u, clock);
                }
            }
            other => panic!("unknown verb {other}"),
        }
    }
    render(&l)
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
