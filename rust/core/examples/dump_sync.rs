//! Emits the Rust sync-decision answers for the shared parity corpus.
//! Paired with scripts/sync-parity.ts.

use dahonghua_core::entry::Entry;
use dahonghua_core::jsval::{parse, Value};
use dahonghua_core::sync::{
    adopt_sections, advance, bump, dirty_since, local_newer_than, log_conflict, next_delay,
    LoggedConflict, Stamps, CONFIG_SECTIONS,
};
use std::io::{self, Read};

fn rows(v: &Value) -> Vec<Entry> {
    match v {
        Value::Arr(items) => items
            .iter()
            .map(|r| Entry {
                id: match r.get("id") {
                    Some(Value::Str(s)) => s.clone(),
                    _ => String::new(),
                },
                updated_at: r.num("updatedAt").map(|n| n as i64),
                ..Default::default()
            })
            .collect(),
        _ => vec![],
    }
}

fn stamps(v: &Value) -> Stamps {
    match v {
        Value::Obj(entries) => entries
            .iter()
            .filter_map(|(k, val)| match val {
                Value::Num(n) => Some((k.clone(), *n as i64)),
                _ => None,
            })
            .collect(),
        _ => Stamps::new(),
    }
}

/// Key-sorted, so the comparison does not depend on either side's key order.
fn show(s: &Stamps) -> String {
    let mut keys: Vec<&(String, i64)> = s.entries().iter().collect();
    keys.sort_by(|a, b| dahonghua_core::jsstr::js_str_cmp(&a.0, &b.0));
    keys.iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join(",")
}

/// `blob[k] != null` — nullish, not truthy. See configMerge.ts.
fn present(blob: &Value, k: &str) -> bool {
    !matches!(
        blob.get(k),
        None | Some(Value::Null) | Some(Value::Undefined)
    )
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
        let parts: Vec<&str> = arg.split('|').collect();

        let value = match kind {
            "dirty" => {
                let rs = rows(&parse(parts[0]));
                let wm: i64 = parts[1].parse().unwrap_or(0);
                dirty_since(&rs, wm)
                    .iter()
                    .map(|e| e.id.clone())
                    .collect::<Vec<_>>()
                    .join(",")
            }
            "bump" => {
                // applied left to right, so both directions show
                let mut wm = 0;
                for n in parts[0].split(',') {
                    wm = bump(wm, n.parse().unwrap_or(0));
                }
                wm.to_string()
            }
            "advance" => {
                let rs = rows(&parse(parts[0]));
                let wm: i64 = parts[1].parse().unwrap_or(0);
                advance(wm, &dirty_since(&rs, wm)).to_string()
            }
            "delay" => {
                let base: i64 = parts[0].parse().unwrap_or(0);
                let max: i64 = parts[1].parse().unwrap_or(0);
                let n: usize = parts[2].parse().unwrap_or(0);
                let mut d = 0;
                let mut seen = Vec::new();
                for _ in 0..n {
                    d = next_delay(d, base, max);
                    seen.push(d.to_string());
                }
                seen.join(",")
            }
            "adopt" => {
                let local = stamps(&parse(parts[0]));
                let remote = if parts[1] == "none" {
                    None
                } else {
                    Some(stamps(&parse(parts[1])))
                };
                let blob = parse(parts[2]);
                let a = adopt_sections(&local, remote.as_ref(), |k| present(&blob, k));
                format!("take=[{}] stamps=[{}]", a.take.join(","), show(&a.stamps))
            }
            "newer" => {
                let local = stamps(&parse(parts[0]));
                let remote = if parts[1] == "none" {
                    None
                } else {
                    Some(stamps(&parse(parts[1])))
                };
                local_newer_than(&local, remote.as_ref()).to_string()
            }
            "present" => {
                let blob = parse(parts[0]);
                CONFIG_SECTIONS
                    .iter()
                    .filter(|k| present(&blob, k))
                    .copied()
                    .collect::<Vec<_>>()
                    .join(",")
            }
            "log" => {
                let ids = match parse(parts[0]) {
                    Value::Arr(items) => items
                        .iter()
                        .map(|i| match i {
                            Value::Str(s) => s.clone(),
                            _ => String::new(),
                        })
                        .collect::<Vec<_>>(),
                    _ => vec![],
                };
                let mut log: Vec<LoggedConflict> = Vec::new();
                for id in ids {
                    log = log_conflict(
                        &log,
                        LoggedConflict {
                            entry_id: id,
                            local_updated_at: 0,
                            remote_updated_at: 0,
                            resolution: "remote".to_string(),
                            timestamp: 0,
                        },
                    );
                }
                let head: Vec<&str> = log.iter().take(3).map(|c| c.entry_id.as_str()).collect();
                let tail: Vec<&str> = log
                    .iter()
                    .skip(log.len().saturating_sub(2))
                    .map(|c| c.entry_id.as_str())
                    .collect();
                format!("{}:{}..{}", log.len(), head.join(","), tail.join(","))
            }
            other => panic!("unknown kind {other}"),
        };
        out.push(format!("{kind}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
