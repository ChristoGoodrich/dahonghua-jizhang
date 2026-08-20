//! The keypad calculator, across the boundary.
//!
//! `eval_expr` is the smallest function in the core that is not arithmetic
//! anyone would write twice: it reproduces the shipping TypeScript's operator
//! precedence, its percent handling, and its answer to a trailing operator.
//! Worth having on this side early because the record sheet cannot be built
//! without it.

use dahonghua_core::calc;
use flutter_rust_bridge::frb;

/// Evaluate a keypad expression. Malformed input answers 0, as it does today.
#[frb(sync)]
pub fn eval_expr(expr: String) -> f64 {
    calc::eval_expr(&expr)
}

/// Apply one keypad press to the current expression.
#[frb(sync)]
pub fn apply_key(expr: String, key: String) -> String {
    calc::apply_key(&expr, &key)
}

/// Whether the expression carries an operator, which is what decides between
/// showing a running total and showing the typed digits.
#[frb(sync)]
pub fn has_operator(expr: String) -> bool {
    calc::has_operator(&expr)
}
