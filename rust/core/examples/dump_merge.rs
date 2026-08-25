//! Emits the Rust merge answers for the shared parity corpus.
//! Paired with scripts/merge-parity.ts.
//!
//! A corpus line is `kind<TAB>localJson|remoteJson`, where each side is a JSON
//! array of rows. Rows are arbitrary JSON here rather than a fixed record
//! shape, because `mergeById` is generic over the row and the fields it does
//! *not* know about are exactly what field-level merge has to carry.
//!
//! The example carries a small JSON reader for that. It is a test fixture, not
//! core code — the crate still has one dependency.

use dahonghua_core::jsval::{stable, Value};
use dahonghua_core::merge::{live_rows, merge_by_id, Resolution};
use std::io::{self, Read};

struct P<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> P<'a> {
    fn ws(&mut self) {
        while self.i < self.b.len() && (self.b[self.i] as char).is_ascii_whitespace() {
            self.i += 1;
        }
    }
    fn eat(&mut self, c: u8) -> bool {
        self.ws();
        if self.i < self.b.len() && self.b[self.i] == c {
            self.i += 1;
            true
        } else {
            false
        }
    }
    fn lit(&mut self, s: &str) -> bool {
        self.ws();
        if self.b[self.i..].starts_with(s.as_bytes()) {
            self.i += s.len();
            true
        } else {
            false
        }
    }
    fn string(&mut self) -> String {
        assert!(self.eat(b'"'), "expected a string at {}", self.i);
        let mut out = String::new();
        loop {
            let c = self.b[self.i];
            self.i += 1;
            match c {
                b'"' => return out,
                b'\\' => {
                    let e = self.b[self.i];
                    self.i += 1;
                    match e {
                        b'n' => out.push('\n'),
                        b't' => out.push('\t'),
                        b'r' => out.push('\r'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'u' => {
                            let hex = std::str::from_utf8(&self.b[self.i..self.i + 4]).unwrap();
                            let n = u32::from_str_radix(hex, 16).unwrap();
                            self.i += 4;
                            // a surrogate pair, which the corpus writes for any
                            // character outside the BMP
                            if (0xD800..0xDC00).contains(&n) && self.b.get(self.i) == Some(&b'\\') {
                                self.i += 2; // \u
                                let hex2 =
                                    std::str::from_utf8(&self.b[self.i..self.i + 4]).unwrap();
                                let lo = u32::from_str_radix(hex2, 16).unwrap();
                                self.i += 4;
                                let cp = 0x10000 + ((n - 0xD800) << 10) + (lo - 0xDC00);
                                out.push(char::from_u32(cp).unwrap());
                            } else {
                                out.push(char::from_u32(n).unwrap_or('\u{FFFD}'));
                            }
                        }
                        other => out.push(other as char),
                    }
                }
                _ => {
                    // a multi-byte character: copy its whole sequence
                    let len = utf8_len(c);
                    let s = std::str::from_utf8(&self.b[self.i - 1..self.i - 1 + len]).unwrap();
                    out.push_str(s);
                    self.i += len - 1;
                }
            }
        }
    }
    fn value(&mut self) -> Value {
        self.ws();
        match self.b[self.i] {
            b'{' => {
                self.i += 1;
                let mut entries = Vec::new();
                if self.eat(b'}') {
                    return Value::Obj(entries);
                }
                loop {
                    self.ws();
                    let k = self.string();
                    assert!(self.eat(b':'));
                    entries.push((k, self.value()));
                    if !self.eat(b',') {
                        assert!(self.eat(b'}'));
                        return Value::Obj(entries);
                    }
                }
            }
            b'[' => {
                self.i += 1;
                let mut items = Vec::new();
                if self.eat(b']') {
                    return Value::Arr(items);
                }
                loop {
                    items.push(self.value());
                    if !self.eat(b',') {
                        assert!(self.eat(b']'));
                        return Value::Arr(items);
                    }
                }
            }
            b'"' => Value::Str(self.string()),
            _ => {
                if self.lit("true") {
                    return Value::Bool(true);
                }
                if self.lit("false") {
                    return Value::Bool(false);
                }
                if self.lit("null") {
                    return Value::Null;
                }
                let start = self.i;
                while self.i < self.b.len()
                    && matches!(
                        self.b[self.i],
                        b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9'
                    )
                {
                    self.i += 1;
                }
                let s = std::str::from_utf8(&self.b[start..self.i]).unwrap();
                Value::Num(s.parse().unwrap_or(f64::NAN))
            }
        }
    }
}

fn utf8_len(b: u8) -> usize {
    match b {
        0x00..=0x7f => 1,
        0xc0..=0xdf => 2,
        0xe0..=0xef => 3,
        _ => 4,
    }
}

fn parse(s: &str) -> Vec<Value> {
    let mut p = P {
        b: s.as_bytes(),
        i: 0,
    };
    match p.value() {
        Value::Arr(items) => items,
        other => vec![other],
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
        let (a, b) = arg.split_once('|').unwrap_or((arg, "[]"));
        let local = parse(a);
        let remote = parse(b);

        let value = match kind {
            "merge" => {
                let r = merge_by_id(&local, &remote);
                let m: Vec<String> = r.merged.iter().map(stable).collect();
                let p: Vec<String> = r.to_push.iter().map(stable).collect();
                let c: Vec<String> = r
                    .conflicts
                    .iter()
                    .map(|x| {
                        format!(
                            "{}:{}:{}:{}",
                            x.entry_id,
                            dahonghua_core::num::js_num(x.local_updated_at),
                            dahonghua_core::num::js_num(x.remote_updated_at),
                            match x.resolution {
                                Resolution::Local => "local",
                                Resolution::Remote => "remote",
                                Resolution::Merged => "merged",
                            }
                        )
                    })
                    .collect();
                format!(
                    "merged=[{}] push=[{}] conflicts=[{}]",
                    m.join(","),
                    p.join(","),
                    c.join(",")
                )
            }
            "live" => {
                let l: Vec<String> = live_rows(&local).iter().map(stable).collect();
                format!("[{}]", l.join(","))
            }
            other => panic!("unknown kind {other}"),
        };
        out.push(format!("{kind}\t{value}"));
    }
    println!("{}", out.join("\n"));
}
