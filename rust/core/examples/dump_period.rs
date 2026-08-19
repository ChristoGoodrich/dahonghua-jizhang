//! Emits the Rust period-window answers for the shared parity corpus.
//! Paired with scripts/period-parity.ts.

use dahonghua_core::civil::Civil;
use dahonghua_core::period::{period_range, shift_period, Period};
use std::io::{self, Read};

fn show(c: Civil) -> String {
    format!("{}-{}-{}", c.y, c.m, c.d)
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
        let p = Period::parse(f[3]).expect("known period");
        let anchor = Civil::new(n(0), n(1), n(2));

        let value = match kind {
            "range" => {
                let r = period_range(anchor, p, n(4));
                format!("{} {}", show(r.start), show(r.end))
            }
            "shift" => show(shift_period(anchor, p, n(4), n(5))),
            other => panic!("unknown corpus kind {other}"),
        };
        out.push(format!("{kind}\t{arg}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
