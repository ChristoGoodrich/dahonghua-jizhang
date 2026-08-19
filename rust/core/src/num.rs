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
    fn round2_matches_the_ledger() {
        assert_eq!(round2(-389.485), -389.48);
        assert_eq!(round2(3.333333), 3.33);
        assert_eq!(round2(0.1 + 0.2), 0.3);
    }
}
