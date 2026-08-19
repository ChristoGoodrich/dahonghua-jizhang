//! Currency conversion and money formatting.
//!
//! Ported from `src/domain/money.ts`. The TypeScript had to be made
//! deterministic before it could be ported at all: `fmtNum` reached for
//! `toLocaleString(undefined, …)`, which follows the *device's* locale, so the
//! same ledger rendered `￥1.234.567,50` on a German handset and
//! `￥12,34,567.50` on an Indian-English one no matter which language the user
//! had picked in the app. There is no faithful port of "whatever the phone
//! says"; the TS now pins en-US grouping, which zh-CN matches, and this module
//! implements that pin directly.
//!
//! `setDisplaySymbol`/`curOf` are not ported. They are module-level mutable
//! state driving what the UI shows, which belongs with the UI layer rather than
//! in a pure core — the symbol is passed in here instead.

use crate::num::js_round;
use std::collections::HashMap;

/// Full names as shown in the currency picker.
pub fn cur_name(code: &str) -> Option<&'static str> {
    Some(match code {
        "CNY" => "人民币 ¥",
        "USD" => "美元 $",
        "AUD" => "澳元 A$",
        "EUR" => "欧元 €",
        "GBP" => "英镑 £",
        "JPY" => "日元 ¥",
        "HKD" => "港币 HK$",
        "KRW" => "韩元 ₩",
        "CAD" => "加元 C$",
        "SGD" => "新元 S$",
        _ => return None,
    })
}

/// Symbol for a currency code. An unknown code falls back to `"CODE "` —
/// trailing space included, so it still reads as a prefix.
pub fn cur_symbol(code: &str) -> String {
    match code {
        "CNY" => "¥".into(),
        "USD" => "$".into(),
        "AUD" => "A$".into(),
        "EUR" => "€".into(),
        "GBP" => "£".into(),
        "JPY" => "¥".into(),
        "HKD" => "HK$".into(),
        "KRW" => "₩".into(),
        "CAD" => "C$".into(),
        "SGD" => "S$".into(),
        other => format!("{other} "),
    }
}

/// The user's base currency plus the rates known for the others.
#[derive(Debug, Clone, Default)]
pub struct Currencies {
    pub base: String,
    pub rates: HashMap<String, f64>,
}

impl Currencies {
    /// Empty `base` means CNY, matching the TS `currencies.base || 'CNY'`.
    fn base_or_default(&self) -> &str {
        if self.base.is_empty() {
            "CNY"
        } else {
            &self.base
        }
    }
}

/// Convert a foreign amount into the base currency.
///
/// A missing rate falls through **unconverted**, exactly as the TypeScript
/// does. That is permissive on purpose: callers must not reach here without a
/// rate (the record sheet blocks the save instead), and keeping it total means
/// a pure formatting path can never panic. Do not "fix" this without fixing the
/// caller — returning an error here would change behaviour the UI depends on.
pub fn to_base(
    amt: f64,
    code: Option<&str>,
    currencies: &Currencies,
    override_rate: Option<f64>,
) -> f64 {
    let base = currencies.base_or_default();
    match code {
        None => amt,
        Some(c) if c == base => amt,
        Some(c) => {
            if let Some(r) = override_rate {
                return amt * r;
            }
            // a zero rate is falsy in JS, so `r ? amt * r : amt` leaves it alone
            match currencies.rates.get(c) {
                Some(r) if *r != 0.0 => amt * r,
                _ => amt,
            }
        }
    }
}

/// Group the integer part in threes with `,`, the way en-US and zh-CN both do.
fn group(int_digits: &str) -> String {
    let bytes = int_digits.as_bytes();
    let mut out = String::with_capacity(int_digits.len() + int_digits.len() / 3);
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 && (bytes.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(*b as char);
    }
    out
}

/// Decompose a finite, non-negative f64 into its shortest round-trip decimal
/// digits and the position of the decimal point.
///
/// `2.605` → (`"2605"`, 1) — one digit before the point.
/// `1e21`  → (`"1"`, 22).
///
/// Shortest round-trip is what `String(n)` gives in JavaScript, and it is what
/// `Intl` rounds — which is the whole reason this exists instead of a multiply.
fn decimal_digits(mag: f64) -> (String, i32) {
    // {:e} is Rust's shortest round-trip, always as `d.ddde±x`
    let sci = format!("{mag:e}");
    let (mantissa, exp) = sci.split_once('e').expect("{:e} always emits an exponent");
    let exp: i32 = exp.parse().expect("exponent parses");
    let digits: String = mantissa.chars().filter(|c| c.is_ascii_digit()).collect();
    // point sits after the first mantissa digit, then shifts by the exponent
    (digits, exp + 1)
}

/// Round a digit string at `keep` digits, half away from zero — the mode
/// `Intl.NumberFormat` uses.
///
/// Returns `keep` digits normally, or `keep + 1` digits led by `1` when the
/// carry runs off the front (9.99 → 10.0, and 0.6 → 1 where `keep` is zero and
/// the carry *is* the whole answer). The caller shifts the decimal point right
/// by one in that case.
fn round_digits(digits: &str, keep: usize) -> (String, bool) {
    let bytes = digits.as_bytes();
    if keep >= bytes.len() {
        let mut out = digits.to_string();
        while out.len() < keep {
            out.push('0');
        }
        return (out, false);
    }
    let mut kept: Vec<u8> = bytes[..keep].to_vec();
    let round_up = bytes[keep] >= b'5';
    if !round_up {
        return (String::from_utf8(kept).unwrap(), false);
    }
    let mut i = keep;
    loop {
        if i == 0 {
            // the carry ran off the front: it becomes a new leading digit, and
            // the caller moves the point to match. Popping here would throw the
            // answer away entirely whenever `keep` is 0.
            kept.insert(0, b'1');
            return (String::from_utf8(kept).unwrap(), true);
        }
        i -= 1;
        if kept[i] == b'9' {
            kept[i] = b'0';
        } else {
            kept[i] += 1;
            return (String::from_utf8(kept).unwrap(), false);
        }
    }
}

/// Format `n` with exactly `decimals` fraction digits and `,` grouping.
///
/// Three rules here exist only to match JavaScript, and the parity harness
/// found every one of them:
///
///   * `Intl` breaks ties **away from zero** (-2.5 → -3), while `Math.round`
///     breaks them **toward +∞** (-2.5 → -2). The same codebase uses both: the
///     calculator rounds with `Math.round`, the formatter with `Intl`.
///   * `Intl` rounds the *decimal* representation, not the binary one. `2.605`
///     is 2.60499999… as an f64, yet it formats as `2.61`. Scaling by 100 and
///     rounding — the obvious port — gives `2.60`.
///   * Digits come from shortest round-trip, so 1e21 prints as
///     1,000,000,000,000,000,000,000 rather than its exact binary expansion.
///     Well outside the ledger's 1e12 ceiling, but a port with a known
///     divergence is a port nobody can trust.
fn format_fixed(n: f64, decimals: u32) -> String {
    let neg_input = n < 0.0;
    let mag = n.abs();

    let (int_str, frac_str) = if mag == 0.0 {
        ("0".to_string(), "0".repeat(decimals as usize))
    } else {
        let (digits, point) = decimal_digits(mag);
        // shift so the point sits at a fixed offset, then round there
        let lead_zeros = if point <= 0 { (-point) as usize } else { 0 };
        let padded = format!("{}{}", "0".repeat(lead_zeros), digits);
        let point = point + lead_zeros as i32; // now >= 0
        let keep = (point + decimals as i32).max(0) as usize;
        let (rounded, carried) = round_digits(&padded, keep);
        let point = point + if carried { 1 } else { 0 };

        let mut all = rounded;
        while all.len() < (point + decimals as i32) as usize {
            all.push('0');
        }
        let split = point.max(0) as usize;
        let int_part = if split == 0 {
            "0".to_string()
        } else {
            all[..split].to_string()
        };
        let frac_part = all[split..].to_string();
        (int_part.trim_start_matches('0').to_string(), frac_part)
    };

    let int_str = if int_str.is_empty() {
        "0".to_string()
    } else {
        int_str
    };

    // the sign is decided after rounding: -0.001 at two decimals rounds to
    // nothing, and a minus on a zero ("-0.00", "￥-0") was a wart the
    // TypeScript carried until this port surfaced it
    let all_zero = int_str.chars().all(|c| c == '0') && frac_str.chars().all(|c| c == '0');
    let mut out = String::new();
    if neg_input && !all_zero {
        out.push('-');
    }
    out.push_str(&group(&int_str));
    if decimals > 0 {
        out.push('.');
        out.push_str(&frac_str);
    }
    out
}

/// Number-only formatting, two decimals, no symbol — for rows that render
/// their own sign.
pub fn fmt_num(n: f64) -> String {
    if !n.is_finite() {
        // JS prints "NaN" / "∞"; the ledger never reaches here with one, but a
        // formatter that panics is worse than one that says so.
        return format!("{n}");
    }
    format_fixed(n, 2)
}

/// Amount with a currency symbol in front.
pub fn fmt(n: f64, symbol: &str) -> String {
    format!("{symbol}{}", fmt_num(n))
}

/// Rounded to whole units, with a symbol — for compact chips and summaries.
///
/// Note the two rounding modes in one function. The TypeScript is
/// `Math.round(n).toLocaleString()`: `Math.round` collapses to an integer
/// breaking ties **toward +∞**, and only then does `Intl` format it. Handing
/// the raw value straight to the formatter would break those ties **away from
/// zero** instead, and -1234.5 would render -1,235 where the app shows -1,234.
pub fn fmt_short(n: f64, symbol: &str) -> String {
    if !n.is_finite() {
        return format!("{symbol}{n}");
    }
    format!("{symbol}{}", format_fixed(js_round(n), 0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn currencies() -> Currencies {
        let mut rates = HashMap::new();
        rates.insert("USD".to_string(), 7.2);
        rates.insert("JPY".to_string(), 0.048);
        Currencies {
            base: "CNY".into(),
            rates,
        }
    }

    #[test]
    fn base_currency_passes_through() {
        let c = currencies();
        assert_eq!(to_base(100.0, Some("CNY"), &c, None), 100.0);
        assert_eq!(to_base(100.0, None, &c, None), 100.0);
    }

    #[test]
    fn converts_with_the_known_rate() {
        let c = currencies();
        assert!((to_base(10.0, Some("USD"), &c, None) - 72.0).abs() < 1e-9);
        assert!((to_base(1000.0, Some("JPY"), &c, None) - 48.0).abs() < 1e-9);
    }

    #[test]
    fn an_unknown_rate_falls_through_unconverted() {
        let c = currencies();
        assert_eq!(to_base(10.0, Some("EUR"), &c, None), 10.0);
    }

    #[test]
    fn an_override_rate_wins_over_the_current_one() {
        let c = currencies();
        assert!((to_base(10.0, Some("USD"), &c, Some(7.5)) - 75.0).abs() < 1e-9);
    }

    #[test]
    fn an_override_rate_is_ignored_for_the_base_currency() {
        let c = currencies();
        assert_eq!(to_base(100.0, Some("CNY"), &c, Some(999.0)), 100.0);
    }

    #[test]
    fn symbols_fall_back_to_the_code() {
        assert_eq!(cur_symbol("USD"), "$");
        assert_eq!(cur_symbol("XYZ"), "XYZ ");
        assert_eq!(cur_name("CNY"), Some("人民币 ¥"));
        assert_eq!(cur_name("XYZ"), None);
    }

    #[test]
    fn grouping_matches_the_pinned_locale() {
        assert_eq!(fmt_num(1234.5), "1,234.50");
        assert_eq!(fmt_num(1234567.5), "1,234,567.50");
        assert_eq!(fmt_num(999.0), "999.00");
        assert_eq!(fmt_num(1000.0), "1,000.00");
        assert_eq!(fmt_num(0.0), "0.00");
    }

    #[test]
    fn negatives_keep_their_sign_outside_the_grouping() {
        assert_eq!(fmt_num(-1234.5), "-1,234.50");
    }

    #[test]
    fn two_decimals_are_always_present() {
        assert_eq!(fmt_num(5.0), "5.00");
        assert_eq!(fmt_num(5.1), "5.10");
        assert_eq!(fmt_num(5.125), "5.13");
    }

    #[test]
    fn fmt_prefixes_the_symbol() {
        assert_eq!(fmt(50.0, "￥"), "￥50.00");
        assert_eq!(fmt(1000.0, "A$"), "A$1,000.00");
    }

    #[test]
    fn fmt_short_rounds_to_whole_units() {
        assert_eq!(fmt_short(1234.6, "￥"), "￥1,235");
        assert_eq!(fmt_short(1000.0, "$"), "$1,000");
        assert_eq!(fmt_short(1234567.0, "$"), "$1,234,567");
    }
}
