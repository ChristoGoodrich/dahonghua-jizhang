//! Rust half of the backup-naming parity harness. See `scripts/backup-parity.ts`.

use dahonghua_core::backup::{backup_name, list_backups, parse_backup_name, prune};
use std::io::Read;

/// `NaN` renders as `_`; everything else through `String(n)`, so the two sides
/// spell `1e+21` and `12.5` the same way.
fn show_time(t: f64) -> String {
    if t.is_nan() {
        "_".to_string()
    } else {
        dahonghua_core::num::js_num(t)
    }
}

fn names_of(cell: &str) -> Vec<String> {
    if cell.is_empty() {
        Vec::new()
    } else {
        cell.split(',').map(str::to_string).collect()
    }
}

fn main() {
    let mut raw = String::new();
    std::io::stdin()
        .read_to_string(&mut raw)
        .expect("corpus on stdin");
    let mut out = String::new();
    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let (kind, rest) = line.split_once('\t').expect("kind and args");
        let parts: Vec<&str> = rest.split('|').collect();

        let value = match kind {
            "name" => backup_name(dahonghua_core::num::js_number(parts[0]), parts[1] == "1"),
            "parse" => match parse_backup_name(parts[0]) {
                None => "none".to_string(),
                Some(b) => format!(
                    "{},{}",
                    show_time(b.time),
                    if b.encrypted { "1" } else { "0" }
                ),
            },
            "list" => list_backups(&names_of(parts[0]))
                .iter()
                .map(|b| {
                    format!(
                        "{}@{}{}",
                        b.name,
                        show_time(b.time),
                        if b.encrypted { "E" } else { "" }
                    )
                })
                .collect::<Vec<_>>()
                .join(" "),
            "prune" => {
                let list = list_backups(&names_of(parts[0]));
                let keep: usize = parts[1].parse().unwrap_or(0);
                prune(&list, keep)
                    .iter()
                    .map(|b| b.name.clone())
                    .collect::<Vec<_>>()
                    .join(" ")
            }
            other => panic!("unknown kind {other:?}"),
        };
        out.push_str(&value);
        out.push('\n');
    }
    print!("{out}");
}
