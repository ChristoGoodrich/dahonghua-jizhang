//! Emits the Rust capture inbox's decisions for the shared parity corpus.
//! Paired with scripts/inbox-parity.harness.ts.

use dahonghua_core::entry::{Entry, EntrySource, Io};
use dahonghua_core::inbox::{drain, Inbox, PendingItem, MAX_UNPARSED};
use dahonghua_core::notif::{NotifEntryDraft, NotifSource, RawNotif};
use dahonghua_core::num::js_num;
use std::io::{self, Read};

/// An empty field is the empty string; `_` is an absent field.
///
/// No sentinel for "empty", because `~` — the obvious choice — is already the
/// record separator, and a cell containing one splits the record into pieces.
fn cell(s: Option<&&str>) -> Option<String> {
    match s {
        None | Some(&"_") => None,
        Some(v) => Some((*v).to_string()),
    }
}

fn pkg(short: &str) -> String {
    match short {
        "ali" => "com.eg.android.AlipayGphone",
        "wx" => "com.tencent.mm",
        "other" => "com.example.other",
        other => other,
    }
    .to_string()
}

/// id^pkg^title^text^bigText^postedAt
fn parse_raw(rec: &str) -> RawNotif {
    let f: Vec<&str> = rec.split('^').collect();
    RawNotif {
        id: f[0].to_string(),
        pkg: pkg(f[1]),
        title: cell(f.get(2)),
        text: cell(f.get(3)),
        big_text: cell(f.get(4)),
        posted_at: f[5].parse().expect("corpus postedAt"),
    }
}

/// io^amt^ts^src^deleted
fn parse_entry(rec: &str, i: usize) -> Entry {
    let f: Vec<&str> = rec.split('^').collect();
    Entry {
        id: format!("e{i}"),
        ts: f[2].parse().expect("corpus ts"),
        io: Io::parse(f[0]),
        cat: "food".into(),
        amt: f[1].parse().expect("corpus amt"),
        src: f.get(3).and_then(|s| EntrySource::parse(s)),
        deleted_at: (f.get(4) == Some(&"1")).then_some(1),
        ..Default::default()
    }
}

/// io^amt^ts — a row already waiting in the confirm queue
fn parse_pending(rec: &str, i: usize) -> PendingItem {
    let f: Vec<&str> = rec.split('^').collect();
    PendingItem {
        id: format!("p{i}"),
        draft: NotifEntryDraft {
            io: Io::parse(f[0]).expect("corpus io"),
            amt: f[1].parse().expect("corpus amt"),
            cat: "other".into(),
            note: String::new(),
            ts: f[2].parse().expect("corpus ts"),
            confident: false,
        },
        source: NotifSource::Alipay,
        raw: String::new(),
    }
}

fn show(d: &NotifEntryDraft) -> String {
    format!(
        "{}/{}/{}/{}/{}/{}",
        d.io.as_str(),
        js_num(d.amt),
        d.cat,
        d.note,
        d.ts,
        d.confident
    )
}

fn main() {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("read corpus");

    let mut out = Vec::new();
    for line in buf.lines() {
        let arg = line.trim_end_matches('\r');
        if arg.is_empty() {
            continue;
        }
        let sec: Vec<&str> = arg.split('|').collect();
        let raws: Vec<RawNotif> = match sec.first() {
            Some(&"") | None => vec![],
            Some(s) => s.split('~').map(parse_raw).collect(),
        };
        let inbox = Inbox {
            pending: match sec.get(1) {
                Some(&"") | None => vec![],
                Some(s) => s
                    .split('~')
                    .enumerate()
                    .map(|(i, r)| parse_pending(r, i))
                    .collect(),
            },
            unparsed: vec![],
        };
        let entries: Vec<Entry> = match sec.get(2) {
            Some(&"") | None => vec![],
            Some(s) => s
                .split('~')
                .enumerate()
                .map(|(i, r)| parse_entry(r, i))
                .collect(),
        };

        let o = drain(&raws, &inbox, &entries, &[]);
        let trimmed = &o.unparsed[o.unparsed.len().saturating_sub(MAX_UNPARSED)..];
        let value = [
            format!(
                "post[{}]",
                o.post.iter().map(show).collect::<Vec<_>>().join(",")
            ),
            format!(
                "queue[{}]",
                o.queue
                    .iter()
                    .map(|q| format!(
                        "{}/{}/{}/{}",
                        q.id,
                        q.source.as_str(),
                        show(&q.draft),
                        q.raw
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            format!(
                "unparsed[{}]",
                trimmed
                    .iter()
                    .map(|u| format!("{}/{}/{}/{}", u.id, u.pkg, u.raw, u.posted_at))
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            format!(
                "counts={}/{}/{}",
                o.post.len(),
                o.queue.len(),
                o.unparsed.len()
            ),
        ]
        .join("  ||  ");
        out.push(format!("{arg}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
