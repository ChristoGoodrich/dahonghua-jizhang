//! Emits the Rust notification parser's answers for the shared corpus.
//! Paired with scripts/notif-parity.ts.

use dahonghua_core::notif::{
    classify_source, full_text, parse_amount, parse_batch, parse_io, parse_merchant,
    parse_notification, to_entry_draft, RawNotif,
};
use std::io::{self, Read};

/// `pkg|title|text|bigText|postedAt` — the corpus never generates a `|`.
fn parse_raw(arg: &str, id: &str) -> RawNotif {
    let f: Vec<&str> = arg.split('|').collect();
    let opt = |i: usize| f.get(i).filter(|s| !s.is_empty()).map(|s| s.to_string());
    RawNotif {
        id: id.to_string(),
        pkg: f.first().copied().unwrap_or("").to_string(),
        title: opt(1),
        text: opt(2),
        big_text: opt(3),
        posted_at: f.get(4).and_then(|s| s.parse().ok()).unwrap_or(0),
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
        let value = match kind {
            "amount" => parse_amount(arg).map_or("_".to_string(), |v| format!("{v}")),
            "io" => parse_io(arg).map_or("_".to_string(), |v| v.as_str().to_string()),
            "merchant" => parse_merchant(arg).unwrap_or_else(|| "_".into()),
            "text" => full_text(&parse_raw(arg, "n0")),
            "source" => classify_source(&parse_raw(arg, "n0"))
                .map_or("_".to_string(), |s| s.as_str().to_string()),
            "parse" => match parse_notification(&parse_raw(arg, "n0")) {
                None => "_".to_string(),
                Some(c) => {
                    let d = to_entry_draft(&c, &[]);
                    format!(
                        "{}|{}|{}|{}|{}|{}|{}",
                        c.io.as_str(),
                        c.amt,
                        c.merchant.clone().unwrap_or_else(|| "_".into()),
                        c.source.as_str(),
                        c.confident,
                        d.cat,
                        d.note,
                    )
                }
            },
            // several notifications, separated by `;;`
            "batch" => {
                let raws: Vec<RawNotif> = arg
                    .split(";;")
                    .enumerate()
                    .map(|(i, a)| parse_raw(a, &format!("n{i}")))
                    .collect();
                parse_batch(&raws)
                    .iter()
                    .map(|c| {
                        format!(
                            "{}:{}:{}",
                            c.io.as_str(),
                            c.amt,
                            c.merchant.clone().unwrap_or_else(|| "_".into())
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(",")
            }
            other => panic!("unknown corpus kind {other}"),
        };
        out.push(format!("{kind}\t{arg}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
