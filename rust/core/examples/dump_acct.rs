//! Emits the Rust account-detail rows for the shared parity corpus.
//! Paired with scripts/acct-parity.ts.
//!
//! A corpus line is `rows<TAB>entriesJson|accountId`. Each row is printed as
//! `id:delta`, in order — the order is part of the answer, because two entries
//! sharing a timestamp must come back in their input order on both sides.

use dahonghua_core::acct::acct_rows;
use dahonghua_core::jsval::{parse, Value};
use dahonghua_core::num::js_num;
use dahonghua_core::rows::entry_from_value;
use std::io::{self, Read};

fn main() {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw).unwrap();

    let mut out: Vec<String> = Vec::new();
    for line in raw.split('\n') {
        let l = line.strip_suffix('\r').unwrap_or(line);
        if l.is_empty() {
            continue;
        }
        let tab = l.find('\t').unwrap();
        let kind = &l[..tab];
        let arg = &l[tab + 1..];
        let bar = arg.rfind('|').unwrap();
        let entries = match parse(&arg[..bar]) {
            Value::Arr(items) => items.iter().map(entry_from_value).collect::<Vec<_>>(),
            _ => Vec::new(),
        };
        let id = &arg[bar + 1..];

        assert_eq!(kind, "rows", "unknown kind {kind}");
        let value = acct_rows(id, &entries)
            .iter()
            .map(|r| format!("{}:{}", r.entry.id, js_num(r.delta)))
            .collect::<Vec<_>>()
            .join(" ");
        out.push(format!("{kind}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
