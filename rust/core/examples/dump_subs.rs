//! Emits the Rust subscription engine's answers for the shared corpus.
//! Paired with scripts/subs-parity.ts.

use dahonghua_core::civil::Civil;
use dahonghua_core::model::{Sub, SubFreq};
// The corpus tests the module the APP runs. It used to test `subscriptions`,
// a second port of the same TypeScript that nothing shipped — so the parity
// guarantee covered a file no user could reach.
use dahonghua_core::subs::{allowed_charges, due_charges, next_due_date};
use std::io::{self, Read};

fn show(c: Civil) -> String {
    format!("{}-{}-{}", c.y, c.m, c.d)
}

/// freq|day|month|lastCharged|periods|charged
fn parse_sub(f: &[&str]) -> Sub {
    Sub {
        id: "s0".into(),
        name: "x".into(),
        emoji: "x".into(),
        amt: 10.0,
        freq: if f[0] == "yearly" {
            SubFreq::Yearly
        } else {
            SubFreq::Monthly
        },
        day: f[1].parse().unwrap(),
        month: f
            .get(2)
            .filter(|s| !s.is_empty())
            .map(|s| s.parse().unwrap()),
        cat: "fun".into(),
        created: 0,
        last_charged: f.get(3).map(|s| s.to_string()),
        is_transfer: None,
        from: None,
        to: None,
        periods: f
            .get(4)
            .filter(|s| !s.is_empty())
            .map(|s| s.parse().unwrap()),
        charged: f
            .get(5)
            .filter(|s| !s.is_empty())
            .map(|s| s.parse().unwrap()),
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
        let f: Vec<&str> = arg.split('|').collect();
        let n = |i: usize| f[i].parse::<i32>().expect("numeric field");

        let value = match kind {
            // sub…|fromY|fromM|fromD
            "next" => {
                let sub = parse_sub(&f);
                show(next_due_date(&sub, Civil::new(n(6), n(7), n(8))))
            }
            // sub…|todayY|todayM|todayD|createdY|createdM|createdD
            "due" => {
                let sub = parse_sub(&f);
                let r = due_charges(
                    &sub,
                    Civil::new(n(6), n(7), n(8)),
                    Civil::new(n(9), n(10), n(11)),
                );
                let allowed = allowed_charges(&sub, r.charges.len());
                format!(
                    "{}|{}|{}",
                    r.charges
                        .iter()
                        .map(|c| show(*c))
                        .collect::<Vec<_>>()
                        .join(","),
                    r.last_charged,
                    allowed,
                )
            }
            other => panic!("unknown corpus kind {other}"),
        };
        out.push(format!("{kind}\t{arg}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
