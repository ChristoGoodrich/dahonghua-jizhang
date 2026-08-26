//! A JSON value, and `JSON.stringify` over it.
//!
//! [`crate::merge`] compares whole rows by serialising them, so the
//! serialisation *is* the comparison — every escape and every omission changes
//! which row wins a tie. That is the whole reason this is hand-written rather
//! than `serde_json`: the crate has one dependency, chosen for size because the
//! wasm bundle ships over mobile data, and what is needed here is sixty lines
//! of JavaScript's exact behaviour rather than a general-purpose parser.

use crate::num::js_num;

/// A JavaScript value as far as `JSON.stringify` is concerned.
///
/// [`Value::Undefined`] is not JSON; it is what an absent field is, and it
/// behaves differently depending on where it sits — omitted from an object,
/// rendered as `null` inside an array. Both are reproduced.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Undefined,
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Value>),
    /// Keys in insertion order, which is what a JavaScript object holds.
    Obj(Vec<(String, Value)>),
}

impl Value {
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Obj(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn num(&self, key: &str) -> Option<f64> {
        match self.get(key) {
            Some(Value::Num(n)) => Some(*n),
            _ => None,
        }
    }

    /// The keys of an object, in insertion order. Empty for anything else.
    pub fn keys(&self) -> Vec<&str> {
        match self {
            Value::Obj(entries) => entries.iter().map(|(k, _)| k.as_str()).collect(),
            _ => vec![],
        }
    }
}

/// `JSON.stringify(v)`, or `None` where JavaScript returns `undefined`.
pub fn stringify(v: &Value) -> Option<String> {
    match v {
        Value::Undefined => None,
        _ => Some(write(v)),
    }
}

/// `JSON.stringify` with every object's keys **sorted, at every level**.
///
/// The order-independent serialisation `merge` compares rows by. Note it is
/// not `JSON.stringify(v, keys.sort())`: an array replacer is a key *allowlist*
/// applied recursively, which silently drops nested keys — see `merge.ts` for
/// what that cost.
pub fn stable(v: &Value) -> String {
    match v {
        Value::Undefined => "undefined".to_string(),
        Value::Obj(entries) => {
            let mut keys: Vec<&(String, Value)> = entries
                .iter()
                // `JSON.stringify` omits an undefined-valued key
                .filter(|(_, val)| *val != Value::Undefined)
                .collect();
            keys.sort_by(|a, b| crate::jsstr::js_str_cmp(&a.0, &b.0));
            let parts: Vec<String> = keys
                .iter()
                .map(|(k, val)| format!("{}:{}", quote(k), stable(val)))
                .collect();
            format!("{{{}}}", parts.join(","))
        }
        Value::Arr(items) => {
            // an undefined *inside an array* is `null`, where in an object it
            // is omitted — the two places JavaScript treats it differently
            let parts: Vec<String> = items
                .iter()
                .map(|it| {
                    if *it == Value::Undefined {
                        "null".to_string()
                    } else {
                        stable(it)
                    }
                })
                .collect();
            format!("[{}]", parts.join(","))
        }
        _ => write(v),
    }
}

fn write(v: &Value) -> String {
    match v {
        // an undefined reached through an array is `null`; reached alone it is
        // handled by the caller
        Value::Undefined | Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        // `JSON.stringify(NaN)` and `JSON.stringify(Infinity)` are both `null`
        Value::Num(n) if !n.is_finite() => "null".to_string(),
        Value::Num(n) => js_num(*n),
        Value::Str(s) => quote(s),
        Value::Arr(items) => {
            let parts: Vec<String> = items.iter().map(write).collect();
            format!("[{}]", parts.join(","))
        }
        Value::Obj(entries) => {
            let parts: Vec<String> = entries
                .iter()
                .filter(|(_, val)| *val != Value::Undefined)
                .map(|(k, val)| format!("{}:{}", quote(k), write(val)))
                .collect();
            format!("{{{}}}", parts.join(","))
        }
    }
}

/// A JSON string literal, escaped the way `JSON.stringify` escapes.
///
/// The two-character forms for the five characters that have them, `\u00XX` for
/// every other control, and nothing else — a `/` is not escaped, and neither is
/// any non-ASCII character.
fn quote(s: &str) -> String {
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

/// `JSON.parse`, for the JSON `JSON.stringify` produces.
///
/// The sync boundary is JSON in **both** directions — a row arrives as JSON and
/// leaves as JSON — so reading it is core's job rather than the caller's. This
/// is scoped to that: it reads what [`stringify`] writes, which is what the
/// server column holds and what the parity corpora are written as. It is
/// lenient where `JSON.parse` would throw, because nothing here is a validator;
/// every shape it sees has already been through `JSON.stringify` once.
///
/// Two places where matching JavaScript took care:
///
/// * **A repeated key keeps the last value at the first position.**
///   `{"a":1,"b":2,"a":3}` parses to `{a:3,b:2}` — `a` stays where it first
///   appeared and takes the later value. Appending blindly would leave two `a`
///   entries and [`Value::get`] would answer with the first, which is the
///   opposite of what JavaScript does. The sync merge has already been bitten
///   once by a duplicate key resolving the wrong way round.
/// * **A lone surrogate becomes `U+FFFD`.** A JavaScript string is a sequence
///   of UTF-16 code units and may hold an unpaired one; a Rust `String` cannot.
///   `stringify` never emits one, so this is reachable only from input written
///   by hand.
pub fn parse(s: &str) -> Value {
    let mut p = Parser {
        b: s.as_bytes(),
        i: 0,
        broken: false,
    };
    p.value()
}

/// `parse`, but `None` when the document is not well-formed.
///
/// The leniency above is right for input that has already been through
/// `JSON.stringify` — which is every shape the sync path and the corpora hand
/// it. A **file on disk** is the case where that assumption fails: a write
/// interrupted by a full disk leaves a truncated array, and reading it
/// leniently recovers the rows that happen to be complete. Loading 1 of 5,000
/// entries is not a partial success. It is the first half of losing 4,999,
/// because the next save writes the 1 back.
///
/// So a caller that reads a file uses this, and refuses what it cannot read
/// rather than acting on a fragment of it.
pub fn parse_checked(s: &str) -> Option<Value> {
    let mut p = Parser {
        b: s.as_bytes(),
        i: 0,
        broken: false,
    };
    let v = p.value();
    p.ws();
    // unread trailing content is as wrong as a missing bracket: it means the
    // scan stopped somewhere the document did not end
    if p.broken || p.i < p.b.len() {
        return None;
    }
    Some(v)
}

struct Parser<'a> {
    b: &'a [u8],
    i: usize,
    /// Set when a token the grammar required was not there.
    broken: bool,
}

impl Parser<'_> {
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

    fn hex4(&mut self) -> Option<u32> {
        let end = self.i + 4;
        let hex = std::str::from_utf8(self.b.get(self.i..end)?).ok()?;
        let n = u32::from_str_radix(hex, 16).ok()?;
        self.i = end;
        Some(n)
    }

    fn string(&mut self) -> String {
        if !self.eat(b'"') {
            self.broken = true;
            return String::new();
        }
        let mut out = String::new();
        while self.i < self.b.len() {
            let c = self.b[self.i];
            self.i += 1;
            match c {
                b'"' => return out,
                b'\\' if self.i < self.b.len() => {
                    let e = self.b[self.i];
                    self.i += 1;
                    match e {
                        b'n' => out.push('\n'),
                        b't' => out.push('\t'),
                        b'r' => out.push('\r'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'u' => out.push(self.escape()),
                        other => out.push(other as char),
                    }
                }
                _ => {
                    // a multi-byte character: copy its whole sequence
                    let len = utf8_len(c);
                    let end = (self.i - 1 + len).min(self.b.len());
                    match std::str::from_utf8(&self.b[self.i - 1..end]) {
                        Ok(s) => out.push_str(s),
                        Err(_) => out.push('\u{FFFD}'),
                    }
                    self.i = end;
                }
            }
        }
        // ran off the end without a closing quote
        self.broken = true;
        out
    }

    /// The character a `\u` escape names, joining a surrogate pair when the
    /// next escape completes one.
    fn escape(&mut self) -> char {
        let Some(n) = self.hex4() else {
            return '\u{FFFD}';
        };
        if (0xD800..0xDC00).contains(&n) && self.b.get(self.i..self.i + 2) == Some(&b"\\u"[..]) {
            let save = self.i;
            self.i += 2;
            if let Some(lo) = self.hex4() {
                if (0xDC00..0xE000).contains(&lo) {
                    let cp = 0x10000 + ((n - 0xD800) << 10) + (lo - 0xDC00);
                    return char::from_u32(cp).unwrap_or('\u{FFFD}');
                }
            }
            self.i = save;
        }
        char::from_u32(n).unwrap_or('\u{FFFD}')
    }

    fn value(&mut self) -> Value {
        self.ws();
        let Some(&c) = self.b.get(self.i) else {
            self.broken = true;
            return Value::Undefined;
        };
        match c {
            b'{' => {
                self.i += 1;
                let mut entries: Vec<(String, Value)> = Vec::new();
                if self.eat(b'}') {
                    return Value::Obj(entries);
                }
                loop {
                    self.ws();
                    let k = self.string();
                    if !self.eat(b':') {
                        self.broken = true;
                    }
                    let v = self.value();
                    // a repeated key takes the later value at the earlier
                    // position, which is where `JSON.parse` leaves it
                    match entries.iter_mut().find(|(x, _)| *x == k) {
                        Some((_, slot)) => *slot = v,
                        None => entries.push((k, v)),
                    }
                    if !self.eat(b',') {
                        if !self.eat(b'}') {
                            self.broken = true;
                        }
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
                        if !self.eat(b']') {
                            self.broken = true;
                        }
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
                while self
                    .b
                    .get(self.i)
                    .is_some_and(|c| matches!(c, b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9'))
                {
                    self.i += 1;
                }
                if start == self.i {
                    // nothing here is a value at all
                    self.broken = true;
                }
                match std::str::from_utf8(&self.b[start..self.i]) {
                    Ok(t) => Value::Num(t.parse().unwrap_or(f64::NAN)),
                    Err(_) => Value::Num(f64::NAN),
                }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(pairs: &[(&str, Value)]) -> Value {
        Value::Obj(
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
        )
    }

    #[test]
    fn scalars_render_the_way_javascript_renders_them() {
        assert_eq!(stable(&Value::Null), "null");
        assert_eq!(stable(&Value::Bool(true)), "true");
        assert_eq!(stable(&Value::Num(1.0)), "1");
        assert_eq!(stable(&Value::Num(1.5)), "1.5");
        assert_eq!(stable(&Value::Num(-0.0)), "0");
        assert_eq!(stable(&Value::Num(1e21)), "1e+21");
        // NaN and the infinities are all `null` to JSON
        assert_eq!(stable(&Value::Num(f64::NAN)), "null");
        assert_eq!(stable(&Value::Num(f64::INFINITY)), "null");
        assert_eq!(stable(&Value::Num(f64::NEG_INFINITY)), "null");
    }

    #[test]
    fn a_string_is_escaped_the_way_json_escapes() {
        assert_eq!(stable(&Value::Str("a\"b".into())), r#""a\"b""#);
        assert_eq!(stable(&Value::Str("a\\b".into())), r#""a\\b""#);
        assert_eq!(stable(&Value::Str("a\nb".into())), r#""a\nb""#);
        assert_eq!(stable(&Value::Str("a\tb".into())), r#""a\tb""#);
        assert_eq!(stable(&Value::Str("a\u{1}b".into())), "\"a\\u0001b\"");
        // a forward slash is not escaped, and neither is anything non-ASCII
        assert_eq!(stable(&Value::Str("a/b".into())), r#""a/b""#);
        assert_eq!(stable(&Value::Str("\u{4E2D}".into())), "\"\u{4E2D}\"");
        assert_eq!(stable(&Value::Str("\u{1F600}".into())), "\"\u{1F600}\"");
    }

    #[test]
    fn keys_are_sorted_at_every_level() {
        let v = obj(&[
            ("b", Value::Num(1.0)),
            ("a", obj(&[("z", Value::Num(2.0)), ("y", Value::Num(3.0))])),
        ]);
        assert_eq!(stable(&v), r#"{"a":{"y":3,"z":2},"b":1}"#);
    }

    #[test]
    fn the_same_content_in_a_different_order_serialises_the_same() {
        let x = obj(&[("a", Value::Num(1.0)), ("b", Value::Num(2.0))]);
        let y = obj(&[("b", Value::Num(2.0)), ("a", Value::Num(1.0))]);
        assert_eq!(stable(&x), stable(&y));
    }

    #[test]
    fn a_nested_key_is_not_dropped() {
        // the bug this whole module exists because of: an allowlist replacer
        // filtered `fieldTs` by the row's own top-level names
        let v = obj(&[
            ("amt", Value::Num(10.0)),
            (
                "fieldTs",
                obj(&[("amt", Value::Num(7.0)), ("note", Value::Num(9.0))]),
            ),
        ]);
        assert!(stable(&v).contains("\"note\":9"), "{}", stable(&v));
    }

    #[test]
    fn an_undefined_value_is_omitted_from_an_object_and_null_in_an_array() {
        let v = obj(&[("a", Value::Undefined), ("b", Value::Num(1.0))]);
        assert_eq!(stable(&v), r#"{"b":1}"#);
        let a = Value::Arr(vec![Value::Undefined, Value::Num(1.0)]);
        assert_eq!(stable(&a), "[null,1]");
    }

    #[test]
    fn stringify_answers_nothing_for_undefined() {
        assert_eq!(stringify(&Value::Undefined), None);
        assert_eq!(stringify(&Value::Num(1.0)), Some("1".to_string()));
    }

    #[test]
    fn keys_sort_by_utf16_like_everything_else_that_compares_strings() {
        let v = obj(&[
            ("\u{1F600}", Value::Num(1.0)),
            ("\u{E000}", Value::Num(2.0)),
        ]);
        // the emoji sorts first, because its surrogate is below U+E000
        assert!(stable(&v).starts_with("{\"\u{1F600}\""), "{}", stable(&v));
    }

    #[test]
    fn what_stringify_writes_is_what_parse_reads() {
        for v in [
            Value::Null,
            Value::Bool(true),
            Value::Num(1.5),
            Value::Num(-0.0),
            Value::Num(1e21),
            Value::Str("a\"b\\c\nd\te\u{1}f".into()),
            Value::Str("\u{4E2D}\u{1F600}".into()),
            Value::Arr(vec![Value::Num(1.0), Value::Null]),
            obj(&[("b", Value::Num(1.0)), ("a", Value::Arr(vec![]))]),
        ] {
            let round = parse(&stable(&v));
            assert_eq!(stable(&round), stable(&v), "{v:?}");
        }
    }

    #[test]
    fn a_repeated_key_takes_the_later_value_at_the_earlier_position() {
        let v = parse("{\"a\":1,\"b\":2,\"a\":3}");
        assert_eq!(v.keys(), vec!["a", "b"]);
        assert_eq!(v.num("a"), Some(3.0));
    }

    #[test]
    fn nesting_and_empties_come_back() {
        assert_eq!(stable(&parse("{}")), "{}");
        assert_eq!(stable(&parse("[]")), "[]");
        let nested = "{\"a\":{\"b\":[1,{\"c\":null}]}}";
        assert_eq!(stable(&parse(nested)), nested);
    }

    #[test]
    fn a_surrogate_pair_is_one_character_and_a_lone_one_is_not() {
        assert_eq!(parse("\"\u{1F600}\""), Value::Str("\u{1F600}".into()));
        assert_eq!(parse("\"\\ud83d\\ude00\""), Value::Str("\u{1F600}".into()));
        // a Rust String cannot hold an unpaired surrogate, and stringify never
        // writes one
        assert_eq!(parse("\"\\ud83d\""), Value::Str("\u{FFFD}".into()));
    }

    #[test]
    fn numbers_read_the_way_javascript_reads_them() {
        assert_eq!(parse("1e21"), Value::Num(1e21));
        assert_eq!(parse("-1.5"), Value::Num(-1.5));
        assert_eq!(parse("0"), Value::Num(0.0));
        // 2^53+1 is not representable, and lands on the same f64 either side
        assert_eq!(parse("9007199254740993"), Value::Num(9007199254740992.0));
    }

    #[test]
    fn nothing_at_all_is_undefined_rather_than_a_panic() {
        assert_eq!(parse(""), Value::Undefined);
        assert_eq!(parse("   "), Value::Undefined);
    }

    #[test]
    fn a_well_formed_document_parses_checked() {
        for src in [
            "{}",
            "[]",
            "1",
            "null",
            "\"a\"",
            "{\"a\":[1,2,{\"b\":null}]}",
            "  { \"a\" : 1 }  ",
        ] {
            assert!(parse_checked(src).is_some(), "{src}");
        }
    }

    #[test]
    fn a_truncated_document_is_refused_rather_than_recovered() {
        // the case this exists for: a write interrupted by a full disk. Reading
        // it leniently recovers the rows that happen to be complete, and
        // writing those back loses the rest.
        for src in [
            "[{\"id\":\"e1\",\"ts\":1",
            "[{\"id\":\"e1\"},",
            "{\"a\":",
            "{\"a\"",
            "[1,2",
            "\"unterminated",
            "",
            "   ",
        ] {
            assert!(parse_checked(src).is_none(), "{src}");
        }
    }

    #[test]
    fn trailing_content_is_refused_too() {
        // it means the scan stopped somewhere the document did not end
        assert!(parse_checked("{} junk").is_none());
        assert!(parse_checked("[1] [2]").is_none());
    }

    #[test]
    fn the_lenient_parse_still_recovers_what_it_can() {
        // unchanged, because the sync path and the corpora rely on it
        assert_eq!(parse("[1,2").keys().len(), 0);
        assert!(matches!(parse("[1,2"), Value::Arr(ref v) if v.len() == 2));
    }
}
