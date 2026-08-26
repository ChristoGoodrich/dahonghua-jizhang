//! Money formatting across the boundary.
//!
//! `fmt_num` is not `toFixed(2)` with commas bolted on. It reproduces
//! `Intl.NumberFormat`'s grouping *and* JavaScript's rounding, which breaks ties
//! toward +∞ where Rust's `f64::round` breaks them away from zero — the very
//! first divergence the parity harness found, on its very first run. A second
//! implementation in Dart would be a third chance to get that wrong.
//!
//! Dart's own `NumberFormat` would round differently again, and would do it
//! only on some locales.

use dahonghua_core::money as core;
use flutter_rust_bridge::frb;

/// A bare amount with grouping and two decimals: `12,345.68`.
#[frb(sync)]
pub fn fmt_num(n: f64) -> String {
    core::fmt_num(n)
}

/// An amount with its currency symbol in front: `￥12,345.68`.
#[frb(sync)]
pub fn fmt(n: f64, symbol: String) -> String {
    core::fmt(n, &symbol)
}

/// An abbreviated amount for a tight space: `￥1.2万`, `￥1.2k`.
#[frb(sync)]
pub fn fmt_short(n: f64, symbol: String) -> String {
    core::fmt_short(n, &symbol)
}

/// The symbol for a currency code, or the code itself when there is none.
#[frb(sync)]
pub fn cur_symbol(code: String) -> String {
    core::cur_symbol(&code)
}

/// A signed amount as the entry list writes it: `-35.50`, `+9,000.00`.
///
/// The sign follows the direction rather than the number, so a negative
/// expense — which a refund adjustment can produce — still reads as an expense.
/// That is what the shipping list does: `d.io === 'exp' ? '-' : '+'`, then the
/// magnitude formatted separately.
#[frb(sync)]
pub fn fmt_signed(n: f64, io: String) -> String {
    let sign = if io == "exp" { '-' } else { '+' };
    format!("{sign}{}", core::fmt_num(n))
}

/// `String(n)` from JavaScript — what a number looks like when it is put into
/// a text field rather than shown as money.
///
/// Not `fmt_num`: that groups and pads to two decimals, and a keypad
/// expression of `35.50` would read back as a different number from the `35.5`
/// the template holds. JavaScript switches to exponent notation at 1e21 and
/// 1e-7, and this is where that switch has to be the same on both sides.
#[frb(sync)]
pub fn plain(n: f64) -> String {
    dahonghua_core::num::js_num(n)
}
