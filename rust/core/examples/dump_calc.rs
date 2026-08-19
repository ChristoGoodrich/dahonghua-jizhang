//! Emits the Rust calculator's answers for the shared parity corpus.
//! Paired with scripts/calc-parity.ts, which emits the TypeScript answers.
//! `npm run parity:calc` runs both and diffs them.

use dahonghua_core::calc::{apply_key, eval_expr, has_operator};
use std::io::{self, Read};

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
            "eval" => format!("{}", eval_expr(arg)),
            "hasop" => format!("{}", has_operator(arg)),
            "keys" => {
                // arg is a comma-separated key sequence applied from an empty field
                let mut e = String::new();
                for k in arg.split(',') {
                    e = apply_key(&e, k);
                }
                e
            }
            other => panic!("unknown corpus kind {other}"),
        };
        out.push(format!("{kind}\t{arg}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
