//! Emits the Rust entry-list grouping for the shared parity corpus.
//! Paired with scripts/list-parity.ts.
//!
//! Each corpus entry carries a `day` the generator computed, because projecting
//! an epoch stamp onto a calendar day needs a timezone and this crate does not
//! own one. `today` arrives the same way.

use dahonghua_core::civil::Civil;
use dahonghua_core::entry::Io;
use dahonghua_core::jsval::{parse, Value};
use dahonghua_core::list::{flatten, group_by_day, DayLabel, FlatItem, ListRow};
use dahonghua_core::num::js_num;
use std::io::{self, Read};

fn civil(s: &str) -> Civil {
    let mut it = s.split('-');
    let y: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    Civil::new(y, m - 1, d)
}

fn show_day(d: Civil) -> String {
    format!("{}-{}-{}", d.y, d.m + 1, d.d)
}

fn show_label(l: DayLabel) -> &'static str {
    match l {
        DayLabel::Today => "today",
        DayLabel::Yesterday => "yesterday",
        DayLabel::Date => "date",
    }
}

fn rows(v: &Value) -> Vec<ListRow> {
    match v {
        Value::Arr(items) => items
            .iter()
            .map(|r| ListRow {
                id: match r.get("id") {
                    Some(Value::Str(s)) => s.clone(),
                    _ => String::new(),
                },
                io: match r.get("io") {
                    Some(Value::Str(s)) => Io::parse(s),
                    _ => None,
                },
                amt: r.num("amt").unwrap_or(0.0),
                ts: r.num("ts").unwrap_or(0.0) as i64,
                day: match r.get("day") {
                    Some(Value::Str(s)) => civil(s),
                    _ => Civil::new(1970, 0, 1),
                },
            })
            .collect(),
        _ => vec![],
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
        let bar = arg.rfind('|').expect("a line ends with |today");
        let rs = rows(&parse(&arg[..bar]));
        let rest = &arg[bar + 1..];

        // `nowMs,todayYmd[,columns]` — the epoch half is the TypeScript's,
        // which normalises instants; this half is handed the calendar day
        // because the crate is not given a timezone
        let mut fields = rest.split(',');
        let _now_ms = fields.next();
        let today = civil(fields.next().unwrap_or("1970-1-1"));

        let value = match kind {
            "group" => group_by_day(&rs, today)
                .iter()
                .map(|g| {
                    format!(
                        "{}/{}/{}/{}/[{}]",
                        show_day(g.day),
                        show_label(g.label),
                        js_num(g.exp),
                        js_num(g.inc),
                        g.ids.join(",")
                    )
                })
                .collect::<Vec<_>>()
                .join(" "),
            "flat" => {
                let cols: usize = fields.next().and_then(|c| c.parse().ok()).unwrap_or(1);
                let groups = group_by_day(&rs, today);
                flatten(&groups, cols)
                    .iter()
                    .map(|it| match it {
                        FlatItem::Header {
                            day,
                            label,
                            exp,
                            inc,
                        } => format!(
                            "H:{}/{}/{}/{}",
                            show_day(*day),
                            show_label(*label),
                            js_num(*exp),
                            js_num(*inc)
                        ),
                        FlatItem::Entry { id, group } => format!("E:{id}@{}", show_day(*group)),
                        FlatItem::EntryRow { ids, group } => {
                            format!("R:[{}]@{}", ids.join(","), show_day(*group))
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(" ")
            }
            other => panic!("unknown kind {other}"),
        };
        out.push(format!("{kind}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
