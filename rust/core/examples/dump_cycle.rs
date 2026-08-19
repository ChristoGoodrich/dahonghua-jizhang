//! Emits the Rust calendar/cycle answers for the shared parity corpus.
//! Paired with scripts/cycle-parity.ts. `npm run parity` runs both and diffs.

use dahonghua_core::civil::{days_in_month, month_grid, Civil};
use dahonghua_core::cycle::{cycle_days, cycle_range, in_cycle, shift_cycle};
use std::io::{self, Read};

fn nums(arg: &str) -> Vec<i32> {
    arg.split('|')
        .map(|p| p.parse().expect("numeric field"))
        .collect()
}

/// `y-m-d`, 0-based month, matching the corpus and the TypeScript side.
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
        let v = nums(arg);
        let value = match kind {
            "dim" => days_in_month(v[0], v[1]).to_string(),
            "grid" => month_grid(v[0], v[1])
                .iter()
                .map(|c| c.map_or("_".to_string(), |d| d.to_string()))
                .collect::<Vec<_>>()
                .join(","),
            "mk" => show(Civil::new(v[0], v[1], v[2])),
            "range" => {
                let r = cycle_range(Civil::new(v[0], v[1], v[2]), v[3]);
                format!("{} {}", show(r.start), show(r.end))
            }
            "incycle" => in_cycle(
                Civil::new(v[0], v[1], v[2]),
                Civil::new(v[3], v[4], v[5]),
                v[6],
            )
            .to_string(),
            "shift" => show(shift_cycle(Civil::new(v[0], v[1], v[2]), v[3], v[4])),
            "days" => cycle_days(Civil::new(v[0], v[1], v[2]), v[3]).to_string(),
            other => panic!("unknown corpus kind {other}"),
        };
        out.push(format!("{kind}\t{arg}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
