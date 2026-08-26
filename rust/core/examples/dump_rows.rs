//! Emits the Rust sync-row answers for the shared parity corpus.
//! Paired with scripts/rows-parity.ts.
//!
//! A corpus line is `kind<TAB>json`, where kind is `torow` (an entry, plus a
//! trailing `|userId`), `toentry` (a server row), or `roundtrip`.
//!
//! Unlike the other examples this one carries no JSON reader of its own —
//! `jsval::parse` is core code now, because the sync boundary is JSON in both
//! directions and reading it is the port's job rather than the fixture's.

use dahonghua_core::jsval::{parse, stable};
use dahonghua_core::rows::{entry_from_value, entry_to_row, entry_to_value, row_to_entry, DbEntry};
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
            "torow" => {
                let bar = arg.rfind('|').expect("torow needs a |userId");
                let e = entry_from_value(&parse(&arg[..bar]));
                stable(&entry_to_row(&e, &arg[bar + 1..]).to_value())
            }
            "toentry" => {
                let row = DbEntry::from_value(&parse(arg));
                stable(&entry_to_value(&row_to_entry(&row)))
            }
            "roundtrip" => {
                let bar = arg.rfind('|').expect("roundtrip needs a |userId");
                let e = entry_from_value(&parse(&arg[..bar]));
                let back = row_to_entry(&entry_to_row(&e, &arg[bar + 1..]));
                stable(&entry_to_value(&back))
            }
            other => panic!("unknown kind {other}"),
        };
        out.push(format!("{kind}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
