//! Emits the Rust money module's answers for the shared parity corpus.
//! Paired with scripts/money-parity.ts. `npm run parity` runs both and diffs.

use dahonghua_core::money::{cur_symbol, fmt, fmt_num, fmt_short, to_base, Currencies};
use std::collections::HashMap;
use std::io::{self, Read};

fn currencies() -> Currencies {
    let mut rates = HashMap::new();
    rates.insert("USD".to_string(), 7.2);
    rates.insert("JPY".to_string(), 0.048);
    rates.insert("EUR".to_string(), 7.85);
    rates.insert("ZERO".to_string(), 0.0);
    Currencies {
        base: "CNY".into(),
        rates,
    }
}

/// Render an f64 the way JavaScript's `String(n)` does.
///
/// The harness compares strings, so it has to stringify identically or it
/// manufactures divergences that are not there: both sides compute -25 * 0 as
/// negative zero, but JS prints "0" and Rust's Display prints "-0".
fn js_string(n: f64) -> String {
    if n == 0.0 {
        return "0".to_string();
    }
    format!("{n}")
}

fn main() {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).expect("read corpus");
    let c = currencies();

    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let (kind, arg) = line.split_once('\t').expect("corpus line is kind<TAB>arg");
        let value = match kind {
            "fmtnum" => fmt_num(arg.parse().unwrap()),
            "fmt" => {
                let (n, sym) = arg.split_once('|').unwrap();
                fmt(n.parse().unwrap(), sym)
            }
            "fmtshort" => {
                let (n, sym) = arg.split_once('|').unwrap();
                fmt_short(n.parse().unwrap(), sym)
            }
            "cursym" => cur_symbol(arg),
            "tobase" => {
                // amt|code|override   (code and override may be empty)
                let mut parts = arg.split('|');
                let amt: f64 = parts.next().unwrap().parse().unwrap();
                let code = parts.next().unwrap();
                let ov = parts.next().unwrap_or("");
                let code = if code.is_empty() { None } else { Some(code) };
                let ov = if ov.is_empty() {
                    None
                } else {
                    Some(ov.parse().unwrap())
                };
                js_string(to_base(amt, code, &c, ov))
            }
            other => panic!("unknown corpus kind {other}"),
        };
        out.push(format!("{kind}\t{arg}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
