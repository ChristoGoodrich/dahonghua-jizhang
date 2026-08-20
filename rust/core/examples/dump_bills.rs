//! Emits the Rust bill parser's answers for the shared parity corpus.
//! Paired with scripts/bills-parity.ts.
//!
//! Answers are rendered as JSON because a bill export is the one corpus whose
//! *input* is itself full of commas, quotes, tabs and newlines — any ad-hoc
//! separator would be ambiguous against the very thing being tested. The
//! TypeScript side uses `JSON.stringify`; `jstr` below matches it.
//!
//! Corpus lines are `kind<TAB>arg`, with the arg's own tabs, newlines, carriage
//! returns and backslashes escaped so one case stays one line.

use dahonghua_core::bills::{
    auto_map, detect_source, find_header_row, parse_amount, parse_bills, parse_csv, parse_date,
    parse_io, ColumnMap, ParseResult,
};
use std::io::{self, Read};

/// `JSON.stringify` for a string: quotes, backslash and the C0 controls, with
/// everything else — including all non-ASCII — passed through as-is.
fn jstr(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// `String(n)` from JavaScript.
///
/// Rust's `{}` is always fixed-point and `{:e}` always exponential; JavaScript
/// switches between them at 1e21 and 1e-7. Only the harness needs this, but it
/// needs it — otherwise a formatting difference reads as a port divergence.
fn jnum(x: f64) -> String {
    if !x.is_finite() {
        return "null".to_string(); // JSON.stringify(NaN) and (Infinity)
    }
    if x == 0.0 {
        return "0".to_string(); // including negative zero
    }
    let e = format!("{x:e}");
    let (mant, exp) = e.split_once('e').expect("{:e} always emits an exponent");
    let exp: i32 = exp.parse().expect("exponent is an integer");
    if exp >= 21 || exp <= -7 {
        let sign = if exp < 0 { "-" } else { "+" };
        format!("{mant}e{sign}{}", exp.abs())
    } else {
        format!("{x}")
    }
}

fn jopt(s: Option<&String>) -> String {
    s.map_or_else(|| "null".to_string(), |v| jstr(v))
}

fn jcols(c: &ColumnMap) -> String {
    format!(
        "{{\"ts\":{},\"amt\":{},\"io\":{},\"srcCat\":{},\"party\":{},\"desc\":{},\"method\":{},\"status\":{}}}",
        c.ts, c.amt, c.io, c.src_cat, c.party, c.desc, c.method, c.status
    )
}

fn jresult(r: &ParseResult) -> String {
    let bills = r
        .bills
        .iter()
        .map(|b| {
            format!(
                "{{\"y\":{},\"m\":{},\"d\":{},\"h\":{},\"mi\":{},\"s\":{},\"io\":{},\"amt\":{},\
                 \"srcCat\":{},\"party\":{},\"desc\":{},\"method\":{},\"status\":{}}}",
                b.at.date.y,
                b.at.date.m,
                b.at.date.d,
                b.at.h,
                b.at.mi,
                b.at.s,
                jstr(b.io.as_str()),
                jnum(b.amt),
                jopt(b.src_cat.as_ref()),
                jopt(b.party.as_ref()),
                jopt(b.desc.as_ref()),
                jopt(b.method.as_ref()),
                jopt(b.status.as_ref()),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let errors = r
        .errors
        .iter()
        .map(|e| format!("{{\"row\":{},\"reason\":{}}}", e.row, jstr(&e.reason)))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"source\":{},\"headerRow\":{},\"columns\":{},\"dataRows\":{},\"skipped\":{},\"bills\":[{}],\"errors\":[{}]}}",
        jstr(r.source.as_str()),
        r.header_row,
        r.columns.as_ref().map_or("null".to_string(), jcols),
        r.data_rows,
        r.skipped,
        bills,
        errors,
    )
}

/// Undo the corpus's line escaping.
fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
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
        let (kind, esc) = line.split_once('\t').expect("corpus line is kind<TAB>arg");
        let arg = unescape(esc);

        let value = match kind {
            "csv" => {
                let rows = parse_csv(&arg);
                let body = rows
                    .iter()
                    .map(|r| {
                        format!(
                            "[{}]",
                            r.iter().map(|f| jstr(f)).collect::<Vec<_>>().join(",")
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                format!("[{body}]")
            }
            "header" => {
                let rows = parse_csv(&arg);
                format!(
                    "{{\"headerRow\":{},\"source\":{},\"columns\":{}}}",
                    find_header_row(&rows),
                    jstr(detect_source(&rows).as_str()),
                    match find_header_row(&rows) {
                        i if i >= 0 => auto_map(&rows[i as usize])
                            .as_ref()
                            .map_or("null".to_string(), jcols),
                        _ => "null".to_string(),
                    }
                )
            }
            "date" => match parse_date(Some(&arg)) {
                None => "null".to_string(),
                Some(t) => format!(
                    "{{\"y\":{},\"m\":{},\"d\":{},\"h\":{},\"mi\":{},\"s\":{}}}",
                    t.date.y, t.date.m, t.date.d, t.h, t.mi, t.s
                ),
            },
            "amt" => parse_amount(Some(&arg)).map_or("null".to_string(), jnum),
            "io" => parse_io(Some(&arg)).map_or("null".to_string(), |io| jstr(io.as_str())),
            "bills" => jresult(&parse_bills(&arg)),
            other => panic!("unknown corpus kind {other}"),
        };
        out.push(format!("{kind}\t{esc}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
