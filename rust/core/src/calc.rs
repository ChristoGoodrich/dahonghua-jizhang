//! Inline calculator for the amount field ("15+8" → 23).
//!
//! Ported from `src/domain/calc.ts`. Behaviour is deliberately identical,
//! including the awkward parts — division by zero yields 0 rather than an
//! error, a trailing operator is ignored so the live preview works while
//! typing, and results are rounded to two decimals. The TypeScript tests were
//! ported alongside it so the two implementations can be diffed by running
//! both suites, which is the only way a rewrite this size stays honest.

#[derive(Debug, Clone, Copy, PartialEq)]
enum Tok {
    Num(f64),
    Add,
    Sub,
    Mul,
    Div,
}

impl Tok {
    fn is_op(self) -> bool {
        !matches!(self, Tok::Num(_))
    }
}

fn tokenize(expr: &str) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut num = String::new();

    let flush = |num: &mut String, out: &mut Vec<Tok>| {
        if !num.is_empty() {
            // parseFloat semantics: a malformed segment such as "1.2.3" takes the
            // longest valid prefix rather than failing the whole expression.
            out.push(Tok::Num(parse_float_prefix(num)));
            num.clear();
        }
    };

    for ch in expr.chars() {
        match ch {
            '0'..='9' | '.' => num.push(ch),
            '+' => {
                flush(&mut num, &mut out);
                out.push(Tok::Add);
            }
            '-' => {
                flush(&mut num, &mut out);
                out.push(Tok::Sub);
            }
            '*' | '×' => {
                flush(&mut num, &mut out);
                out.push(Tok::Mul);
            }
            '/' | '÷' => {
                flush(&mut num, &mut out);
                out.push(Tok::Div);
            }
            _ => {}
        }
    }
    flush(&mut num, &mut out);
    out
}

/// JavaScript `parseFloat`: consume the longest leading run that parses, else 0.
fn parse_float_prefix(s: &str) -> f64 {
    let mut best = 0.0_f64;
    let mut seen_dot = false;
    for (i, ch) in s.char_indices() {
        match ch {
            '0'..='9' => {}
            '.' if !seen_dot => seen_dot = true,
            _ => break,
        }
        if let Ok(v) = s[..=i].parse::<f64>() {
            best = v;
        }
    }
    best
}

/// Evaluate an expression. Empty or invalid input yields 0; a trailing operator
/// is dropped so a half-typed "15+" still previews as 15.
pub fn eval_expr(expr: &str) -> f64 {
    let mut toks = tokenize(expr);
    while toks.last().is_some_and(|t| t.is_op()) {
        toks.pop();
    }
    if toks.is_empty() || toks[0].is_op() {
        return 0.0;
    }

    // pass 1: × ÷
    let mut p1: Vec<Tok> = Vec::with_capacity(toks.len());
    let mut i = 0;
    while i < toks.len() {
        match toks[i] {
            Tok::Mul | Tok::Div => {
                let op = toks[i];
                let a = match p1.pop() {
                    Some(Tok::Num(v)) => v,
                    _ => return 0.0,
                };
                i += 1;
                let b = match toks.get(i) {
                    Some(Tok::Num(v)) => *v,
                    _ => return 0.0,
                };
                // matches the TS guard: dividing by zero gives 0, never Infinity
                let v = if matches!(op, Tok::Mul) {
                    a * b
                } else if b == 0.0 {
                    0.0
                } else {
                    a / b
                };
                p1.push(Tok::Num(v));
            }
            t => p1.push(t),
        }
        i += 1;
    }

    // pass 2: + −
    let mut acc = match p1.first() {
        Some(Tok::Num(v)) => *v,
        _ => return 0.0,
    };
    let mut i = 1;
    while i + 1 < p1.len() + 1 {
        let (Some(op), Some(Tok::Num(b))) = (p1.get(i), p1.get(i + 1)) else {
            break;
        };
        acc = match op {
            Tok::Add => acc + b,
            Tok::Sub => acc - b,
            _ => acc,
        };
        i += 2;
    }

    if acc.is_finite() {
        crate::num::round2(acc)
    } else {
        0.0
    }
}

/// True when the expression carries an operator, so the UI shows a "= result"
/// preview. Index 0 is skipped so a leading sign never counts.
pub fn has_operator(expr: &str) -> bool {
    expr.chars()
        .skip(1)
        .any(|c| matches!(c, '+' | '-' | '×' | '÷' | '*' | '/'))
}

const OPS: [char; 4] = ['+', '-', '×', '÷'];

/// Apply one keypad key to the current expression.
/// Keys: a digit, `.`, one of `+ - × ÷`, `back`, `clear`, `eq`.
pub fn apply_key(expr: &str, key: &str) -> String {
    match key {
        "clear" => return String::new(),
        "back" => {
            let mut s = expr.to_string();
            s.pop();
            return s;
        }
        "eq" => {
            return if expr.is_empty() {
                String::new()
            } else {
                format_num(eval_expr(expr))
            }
        }
        _ => {}
    }

    let last = expr.chars().last();
    let key_char = key.chars().next().unwrap_or('\0');

    if key.chars().count() == 1 && OPS.contains(&key_char) {
        if expr.is_empty() {
            return String::new(); // no leading operator
        }
        if last.is_some_and(|c| OPS.contains(&c)) {
            let mut s = expr.to_string();
            s.pop();
            s.push(key_char);
            return s; // replace a trailing operator
        }
        return format!("{expr}{key}");
    }

    // the digits typed since the last operator
    let seg: &str = expr.rsplit(|c| OPS.contains(&c)).next().unwrap_or("");

    if key == "." {
        if seg.contains('.') {
            return expr.to_string(); // one dot per segment
        }
        return format!("{expr}{}", if seg.is_empty() { "0." } else { "." });
    }

    // a digit — never leave a segment as "05" or "00"
    if seg == "0" {
        if key == "0" {
            return expr.to_string();
        }
        let mut s = expr.to_string();
        s.pop();
        s.push_str(key);
        return s;
    }
    format!("{expr}{key}")
}

/// `String(n)` for the values this calculator produces: integers lose the ".0"
/// that Rust's Display would add, matching how the TS field renders.
fn format_num(n: f64) -> String {
    if n == n.trunc() && n.abs() < 1e21 {
        format!("{}", n as i64)
    } else {
        let s = format!("{n}");
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluates_plain_numbers() {
        assert_eq!(eval_expr("15"), 15.0);
        assert_eq!(eval_expr("0.5"), 0.5);
        assert_eq!(eval_expr(""), 0.0);
    }

    #[test]
    fn applies_operator_precedence() {
        assert_eq!(eval_expr("2+3*4"), 14.0);
        assert_eq!(eval_expr("2*3+4"), 10.0);
        assert_eq!(eval_expr("12.5+8"), 20.5);
        assert_eq!(eval_expr("100-30-20"), 50.0);
    }

    #[test]
    fn accepts_the_keypad_glyphs() {
        assert_eq!(eval_expr("6×7"), 42.0);
        assert_eq!(eval_expr("84÷2"), 42.0);
    }

    #[test]
    fn division_by_zero_is_zero_not_infinity() {
        assert_eq!(eval_expr("5÷0"), 0.0);
    }

    #[test]
    fn ignores_a_trailing_operator_so_the_preview_works_while_typing() {
        assert_eq!(eval_expr("15+"), 15.0);
        assert_eq!(eval_expr("15+8-"), 23.0);
    }

    #[test]
    fn a_leading_operator_yields_zero() {
        assert_eq!(eval_expr("+5"), 0.0);
        assert_eq!(eval_expr("÷"), 0.0);
    }

    #[test]
    fn rounds_to_two_decimals() {
        assert_eq!(eval_expr("10÷3"), 3.33);
        assert_eq!(eval_expr("0.1+0.2"), 0.3);
    }

    #[test]
    fn detects_operators_but_not_a_leading_sign() {
        assert!(has_operator("15+8"));
        assert!(has_operator("6×7"));
        assert!(!has_operator("158"));
        assert!(!has_operator("-15"));
        assert!(!has_operator(""));
    }

    #[test]
    fn clear_and_back() {
        assert_eq!(apply_key("123", "clear"), "");
        assert_eq!(apply_key("123", "back"), "12");
        assert_eq!(apply_key("", "back"), "");
    }

    #[test]
    fn eq_settles_the_expression() {
        assert_eq!(apply_key("12+8", "eq"), "20");
        assert_eq!(apply_key("10÷4", "eq"), "2.5");
        assert_eq!(apply_key("", "eq"), "");
    }

    #[test]
    fn operators_never_lead_and_never_double_up() {
        assert_eq!(apply_key("", "+"), "");
        assert_eq!(apply_key("15", "+"), "15+");
        assert_eq!(apply_key("15+", "×"), "15×");
    }

    #[test]
    fn one_dot_per_segment() {
        assert_eq!(apply_key("1", "."), "1.");
        assert_eq!(apply_key("1.5", "."), "1.5");
        assert_eq!(apply_key("", "."), "0.");
        assert_eq!(apply_key("1.5+", "."), "1.5+0.");
        assert_eq!(apply_key("1.5+2", "."), "1.5+2.");
    }

    #[test]
    fn leading_zeros_are_normalized() {
        assert_eq!(apply_key("0", "0"), "0");
        assert_eq!(apply_key("0", "5"), "5");
        assert_eq!(apply_key("10", "0"), "100");
        assert_eq!(apply_key("1+0", "5"), "1+5");
    }

    #[test]
    fn a_full_keypad_run_matches_the_typescript_behaviour() {
        // "12+8=" as the user would tap it
        let mut e = String::new();
        for k in ["1", "2", "+", "8", "eq"] {
            e = apply_key(&e, k);
        }
        assert_eq!(e, "20");
    }
}
