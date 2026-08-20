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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn round2_matches_the_ledger() {
        assert_eq!(round2(-389.485), -389.48);
        assert_eq!(round2(3.333333), 3.33);
        assert_eq!(round2(0.1 + 0.2), 0.3);
    }
}
