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
}
