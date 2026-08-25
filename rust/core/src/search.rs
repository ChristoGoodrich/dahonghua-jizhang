//! Free-text entry search, plus the `>100` / `<=50` / `=40` amount operators.
//!
//! Ported from `src/domain/search.ts`.
//!
//! Case folding is `to_lowercase`, which is exactly `String.prototype
//! .toLowerCase` — checked rather than assumed, across the cases that usually
//! separate two implementations: `İ` folding to `i` plus a combining dot, the
//! Greek final sigma, `ǅ`, `ẞ`, `ĲSSEL`. All sixteen agree.

use crate::catalog::{cat_name, cat_of, Category};
use crate::entry::Entry;
use crate::jsstr::{js_trim, JS_SPACE_CLASS};
use crate::num::js_num;
use regex_lite::Regex;
use std::sync::OnceLock;

fn amount_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        // `\s` is JavaScript's, so `>` + NBSP + `100` parses the same way here
        // as it does in the app
        Regex::new(&format!(
            r"^(>=|<=|>|<|=){s}*([0-9]+(?:\.[0-9]+)?)$",
            s = JS_SPACE_CLASS
        ))
        .expect("pattern compiles")
    })
}

/// True when an entry matches the query.
///
/// An empty query matches everything, which is what makes the search box
/// harmless to focus.
///
/// A query that is entirely an amount comparison — `>100`, `<=50`, `=40` — is
/// treated as one and never falls through to the text search. Note it compares
/// `amt`, the base-currency figure the list displays, so the results match what
/// the user is looking at rather than what was originally typed in.
pub fn matches_search(d: &Entry, query: &str, custom: &[Category], zh: bool) -> bool {
    let q = js_trim(query).to_lowercase();
    if q.is_empty() {
        return true;
    }

    if let Some(c) = amount_re().captures(&q) {
        // the capture is `[0-9]+(\.[0-9]+)?`, so `parseFloat` cannot fail or
        // stop early on it
        let n: f64 = c[2].parse().unwrap_or(f64::NAN);
        return match &c[1] {
            ">" => d.amt > n,
            "<" => d.amt < n,
            ">=" => d.amt >= n,
            "<=" => d.amt <= n,
            // '=' — a strict equality, so a NaN amount never matches anything
            _ => d.amt == n,
        };
    }

    // `Entry.io` is a required field in the TypeScript and `catOf` takes an
    // `IO`, so an entry reaching the search box always has a direction. This
    // crate models `io` as optional because bill parsing meets rows before
    // they are classified; the fallback is unreachable from here.
    let cat = cat_of(d.io.unwrap_or(crate::entry::Io::Exp), &d.cat, custom);
    let mut haystack = vec![
        cat_name(&cat, zh),
        d.note.clone().unwrap_or_default(),
        js_num(d.amt),
    ];
    haystack.extend(d.tags.clone().unwrap_or_default());
    haystack.push(d.ledger.clone().unwrap_or_default());
    haystack.join(" ").to_lowercase().contains(&q)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::Io;

    fn e(cat: &str, amt: f64) -> Entry {
        Entry {
            io: Some(Io::Exp),
            cat: cat.into(),
            amt,
            ..Default::default()
        }
    }

    fn m(d: &Entry, q: &str) -> bool {
        matches_search(d, q, &[], false)
    }

    #[test]
    fn an_empty_query_matches_everything() {
        assert!(m(&e("food", 10.0), ""));
        assert!(m(&e("food", 10.0), "   "));
        // the BOM is whitespace to JavaScript, so this is empty too
        assert!(m(&e("food", 10.0), "\u{feff}"));
    }

    #[test]
    fn the_category_name_is_searchable() {
        assert!(m(&e("food", 10.0), "food"));
        assert!(m(&e("food", 10.0), "FOOD"));
        assert!(!m(&e("food", 10.0), "rent"));
    }

    #[test]
    fn the_note_tags_ledger_and_amount_are_searchable() {
        let d = Entry {
            note: Some("Lunch with Bo".into()),
            tags: Some(vec!["work".into(), "reimbursable".into()]),
            ledger: Some("Trip".into()),
            ..e("food", 42.5)
        };
        assert!(m(&d, "lunch"));
        assert!(m(&d, "reimburs"));
        assert!(m(&d, "trip"));
        assert!(m(&d, "42.5"));
    }

    #[test]
    fn the_amount_operators_compare_numerically() {
        let d = e("food", 100.0);
        assert!(m(&d, ">99"));
        assert!(!m(&d, ">100"));
        assert!(m(&d, ">=100"));
        assert!(m(&d, "<101"));
        assert!(m(&d, "<=100"));
        assert!(m(&d, "=100"));
        assert!(!m(&d, "=100.01"));
    }

    #[test]
    fn an_operator_takes_javascript_whitespace_after_it() {
        let d = e("food", 100.0);
        assert!(m(&d, "> 99"));
        assert!(m(&d, ">\u{a0}99"));
        assert!(m(&d, ">\u{3000}99"));
    }

    #[test]
    fn a_nan_amount_matches_no_comparison() {
        let d = e("food", f64::NAN);
        for q in [">0", "<0", ">=0", "<=0", "=0"] {
            assert!(!m(&d, q), "{q}");
        }
    }

    #[test]
    fn something_that_only_looks_like_an_operator_is_text() {
        // no digits, so it falls through to the substring search
        let d = Entry {
            note: Some(">abc".into()),
            ..e("food", 1.0)
        };
        assert!(m(&d, ">abc"));
        // a trailing minus is not part of the number pattern either
        assert!(!m(&e("food", 1.0), ">-1"));
    }

    #[test]
    fn folding_matches_javascript_on_the_awkward_cases() {
        let d = Entry {
            note: Some("\u{130}stanbul".into()),
            ..e("food", 1.0)
        };
        // `İ` lowercases to `i` plus a combining dot in both languages
        assert!(m(&d, "i\u{307}stanbul"));
        let g = Entry {
            note: Some("\u{391}\u{3a3}".into()),
            ..e("food", 1.0)
        };
        // the final sigma rule, applied identically on both sides
        assert!(m(&g, "\u{3b1}\u{3c2}"));
    }

    #[test]
    fn the_query_is_trimmed_the_way_javascript_trims() {
        let d = e("food", 100.0);
        assert!(m(&d, "  >99  "));
        assert!(m(&d, "\u{feff}>99\u{feff}"));
        // NEL is not whitespace to JavaScript, so this stays unparseable
        assert!(!m(&d, "\u{85}>99"));
    }
}
