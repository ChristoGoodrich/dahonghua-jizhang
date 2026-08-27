//! Numeric helpers whose whole job is to match JavaScript, not to be idiomatic.
//!
//! Every ported module that rounds money has to go through here. The two
//! languages genuinely disagree: `Math.round` in JS breaks ties toward +∞,
//! while Rust's `f64::round` breaks them away from zero. They agree on positive
//! values and diverge on negative ones — so `-389.485` becomes `-389.48` in the
//! shipping app and would become `-389.49` under a naive port. The parity
//! harness (`npm run parity:calc`) caught exactly that.

/// `Math.round` from JavaScript: ties go toward positive infinity.
#[inline]
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// Round to 2 decimal places the way the TypeScript ledger does.
#[inline]
pub fn round2(x: f64) -> f64 {
    js_round(x * 100.0) / 100.0
}

/// `+(x).toFixed(digits)` from JavaScript.
///
/// A third rounding rule, distinct from the two already here. `Math.round`
/// breaks ties toward +∞ and `Intl` breaks them away from zero, but both of
/// those are about *ties*; `toFixed` differs in what it rounds. It works on the
/// exact binary value of the number, where `Intl` works on its shortest
/// round-trip decimal digits — which is why `(1.005).toFixed(2)` is `"1.00"`
/// while `Intl` gives `1.01`: the f64 nearest 1.005 is slightly below it.
///
/// Used where the TypeScript writes `+(x).toFixed(6)`, which is how the rate
/// table keeps its precision bounded.
#[inline]
pub fn to_fixed(x: f64, digits: u32) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let scale = 10_f64.powi(digits as i32);
    js_round(x * scale) / scale
}

/// `String(n)` from JavaScript.
///
/// Rust's `{}` is always fixed-point and `{:e}` always exponential; JavaScript
/// switches between them at 1e21 and 1e-7. That difference is invisible until
/// a number has to be *spelled* the same on both sides — which is exactly what
/// `glass.rs` does when it builds an `rgba(...)` string, and what every parity
/// dump does when it renders an answer.
pub fn js_num(x: f64) -> String {
    if x.is_nan() {
        return "NaN".to_string();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
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

/// Largest first, with `NaN` last — a **total** order.
///
/// The TypeScript spelled this `b.amt - a.amt` for a long time, which is not a
/// total order: a `NaN` amount makes the comparator return `NaN`, and ECMA-262
/// leaves the sort order implementation-defined from there. In Node,
/// `[10, NaN, 50, 20]` came back completely untouched while
/// `[10, 20, 50, NaN]` sorted properly — and the app ships on Hermes, not on
/// the V8 the harness runs under, so the shipping answer was not even the one
/// under test.
///
/// A `NaN` amount is reachable: a malformed import, a conversion with no rate,
/// a hand-edited backup. Ranking it last is arbitrary, but it is arbitrary in
/// the same way everywhere, which is the property that was missing.
///
/// See `src/domain/order.ts`, which is the same order on the other side.
pub fn desc_by_amt(a: f64, b: f64) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    match (a.is_nan(), b.is_nan()) {
        (true, true) => Ordering::Equal,
        (true, false) => Ordering::Greater,
        (false, true) => Ordering::Less,
        _ => b.partial_cmp(&a).unwrap_or(Ordering::Equal),
    }
}

/// `Math.max(a, b)` — which is not `f64::max`.
///
/// `f64::max` returns the non-NaN operand; `Math.max` returns NaN if either is
/// NaN. A watermark is the place that matters: one unparseable `updatedAt`
/// should poison the comparison loudly rather than be quietly skipped over.
pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a >= b {
        a
    } else {
        b
    }
}

/// `Number(s)` from JavaScript, which is not `str::parse`.
///
/// Three differences bite in practice, and the backup corpus found all three:
///
/// * **`Number('')` is `0`**, not an error and not `NaN`. So is any string of
///   nothing but whitespace. That is why a backup file called `backup_.json`
///   reads as epoch zero rather than as unorderable: it sorts oldest and is
///   pruned first, which is a defensible thing to do with a file whose name
///   says nothing.
/// * It accepts **fractional and exponential** forms, so `12.5` and `1e+21`
///   are numbers where an integer parse would fail.
/// * It accepts `Infinity` with an optional sign, and rejects the spellings
///   Rust's own parser takes — `inf`, `NaN` and `nan` are all `NaN` here.
///
/// Hexadecimal, octal and binary literals are accepted, as `Number` does.
pub fn js_number(s: &str) -> f64 {
    let t = s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] {
        let upper = prefix.to_ascii_uppercase();
        if let Some(rest) = t.strip_prefix(prefix).or_else(|| t.strip_prefix(&upper)) {
            return u128::from_str_radix(rest, radix)
                .map(|v| v as f64)
                .unwrap_or(f64::NAN);
        }
    }
    // Rust's parser takes `inf`, `infinity`, `nan` and `NaN` in any case;
    // JavaScript's takes none of them.
    let lower = t.to_ascii_lowercase();
    if lower.contains("inf") || lower.contains("nan") {
        return f64::NAN;
    }
    t.parse().unwrap_or(f64::NAN)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desc_by_amt_is_a_total_order() {
        use std::cmp::Ordering::*;
        assert_eq!(desc_by_amt(50.0, 10.0), Less); // 50 comes first
        assert_eq!(desc_by_amt(10.0, 50.0), Greater);
        assert_eq!(desc_by_amt(10.0, 10.0), Equal);
        // NaN last, and consistently so — the property `b - a` did not have
        assert_eq!(desc_by_amt(f64::NAN, 10.0), Greater);
        assert_eq!(desc_by_amt(10.0, f64::NAN), Less);
        assert_eq!(desc_by_amt(f64::NAN, f64::NAN), Equal);
    }

    #[test]
    fn desc_by_amt_sorts_a_list_with_a_hole_in_it() {
        let mut v = [10.0, f64::NAN, 50.0, 20.0];
        v.sort_by(|a, b| desc_by_amt(*a, *b));
        assert_eq!(&v[..3], &[50.0, 20.0, 10.0]);
        assert!(v[3].is_nan());
    }

    #[test]
    fn ties_go_toward_positive_infinity_like_javascript() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0); // f64::round would give -3.0
        assert_eq!(js_round(-0.5), -0.0);
        assert_eq!(js_round(-38948.5), -38948.0);
    }

    #[test]
    fn ordinary_values_are_unsurprising() {
        assert_eq!(js_round(2.4), 2.0);
        assert_eq!(js_round(2.6), 3.0);
        assert_eq!(js_round(-2.4), -2.0);
        assert_eq!(js_round(-2.6), -3.0);
    }

    #[test]
    fn to_fixed_bounds_precision() {
        assert_eq!(to_fixed(1.0 / 7.2, 6), 0.138889);
        assert_eq!(to_fixed(7.2, 6), 7.2);
        assert_eq!(to_fixed(0.0, 6), 0.0);
        assert_eq!(to_fixed(-1.0 / 3.0, 6), -0.333333);
    }

    #[test]
    fn to_fixed_leaves_non_finite_alone() {
        assert!(to_fixed(f64::NAN, 2).is_nan());
        assert_eq!(to_fixed(f64::INFINITY, 2), f64::INFINITY);
    }

    #[test]
    fn js_number_is_not_str_parse() {
        // the three the backup corpus caught
        assert_eq!(js_number(""), 0.0);
        assert_eq!(js_number("   "), 0.0);
        assert_eq!(js_number("12.5"), 12.5);
        assert_eq!(js_number("1e+21"), 1e21);
        // the spellings Rust takes but JavaScript does not
        assert!(js_number("inf").is_nan());
        assert!(js_number("NaN").is_nan());
        assert!(js_number("nan").is_nan());
        // and the one it does take
        assert_eq!(js_number("Infinity"), f64::INFINITY);
        assert_eq!(js_number("-Infinity"), f64::NEG_INFINITY);
        // ordinary cases
        assert_eq!(js_number("1700"), 1700.0);
        assert_eq!(js_number("-1"), -1.0);
        assert_eq!(js_number("0x10"), 16.0);
        assert!(js_number("draft").is_nan());
        assert!(js_number("12abc").is_nan());
    }

    #[test]
    fn round2_matches_the_ledger() {
        assert_eq!(round2(-389.485), -389.48);
        assert_eq!(round2(3.333333), 3.33);
        assert_eq!(round2(0.1 + 0.2), 0.3);
    }
}
