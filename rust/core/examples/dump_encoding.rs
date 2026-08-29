//! Rust half of the bill-encoding parity harness. See
//! `scripts/encoding-parity.ts`.

use dahonghua_core::encoding::{decode_gbk, decode_utf8, looks_like_utf8};
use std::io::Read;

fn bytes_of(hex: &str) -> Vec<u8> {
    (0..hex.len() / 2)
        .map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap_or(0))
        .collect()
}

/// Text as escaped code points, so a decoded `U+FFFD` or a newline stays on one
/// line and is visible when it differs.
fn show(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        let c = ch as u32;
        if (0x20..0x7f).contains(&c) && ch != '\\' {
            out.push(ch);
        } else {
            out.push_str(&format!("\\u{{{c:x}}}"));
        }
    }
    out
}

/// Which decoder `decode_bill_text` would pick — reported rather than run, so
/// the answer does not depend on what decoders an engine happens to have.
fn decide(bytes: &[u8]) -> &'static str {
    if bytes.len() >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf {
        return "utf8-bom";
    }
    if looks_like_utf8(bytes) {
        "utf8"
    } else {
        "gbk"
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
        let (kind, hex) = line.split_once('\t').expect("kind and hex");
        let bytes = bytes_of(hex);

        let value = match kind {
            "utf8?" => if looks_like_utf8(&bytes) { "1" } else { "0" }.to_string(),
            "decide" => decide(&bytes).to_string(),
            "gbk" => show(&decode_gbk(&bytes)),
            "utf8" => {
                if looks_like_utf8(&bytes) {
                    show(&decode_utf8(&bytes))
                } else {
                    "invalid".to_string()
                }
            }
            "bill" => {
                let text = match decide(&bytes) {
                    "utf8-bom" => decode_utf8(&bytes[3..]),
                    "utf8" => decode_utf8(&bytes),
                    _ => decode_gbk(&bytes),
                };
                show(&text)
            }
            other => panic!("unknown kind {other:?}"),
        };
        out.push_str(&value);
        out.push('\n');
    }
    print!("{out}");
}
