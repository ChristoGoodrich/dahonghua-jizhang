//! String operations where JavaScript does not mean what Rust means.
//!
//! The sibling of [`crate::num`], which holds the number-to-string half of the
//! same problem, and of [`crate::jsobj`], which holds the key-ordering half.

/// `String.prototype.trim()`.
///
/// **Not** `str::trim()`. Rust trims the Unicode `White_Space` property;
/// JavaScript trims `WhiteSpace ∪ LineTerminator`, and the two disagree on
/// exactly two characters:
///
/// | | JavaScript | Rust |
/// | --- | --- | --- |
/// | `U+0085` NEL | keeps | trims |
/// | `U+FEFF` ZWNBSP (the BOM) | trims | keeps |
///
/// Both are reachable and the BOM one is not exotic at all: text pasted out of
/// a file very often carries one, and a search query of `"\u{FEFF}2024-01"`
/// found a whole month in the shipping app and nothing at all in a first draft
/// of this crate. The parity corpora had never generated either character,
/// which is why five modules passed with `str::trim()` in them.
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// The characters `String.prototype.trim` removes, and that a JavaScript regex
/// matches with `\s`.
///
/// `regex_lite`'s own `\s` is the ASCII five plus space, so a pattern ported
/// from JavaScript has to spell this out. See [`JS_SPACE_CLASS`].
pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}'      // TAB
        | '\u{a}'    // LF
        | '\u{b}'    // VT
        | '\u{c}'    // FF
        | '\u{d}'    // CR
        | '\u{20}'   // SP
        | '\u{a0}'   // NBSP
        | '\u{1680}' // OGHAM SPACE MARK
        | '\u{2028}' // LINE SEPARATOR
        | '\u{2029}' // PARAGRAPH SEPARATOR
        | '\u{202f}' // NARROW NBSP
        | '\u{205f}' // MEDIUM MATHEMATICAL SPACE
        | '\u{3000}' // IDEOGRAPHIC SPACE
        | '\u{feff}' // ZWNBSP — the BOM
    ) || ('\u{2000}'..='\u{200a}').contains(&c) // EN QUAD .. HAIR SPACE
}

/// A regex character class matching exactly what a JavaScript `\s` matches.
///
/// Written out because `regex_lite` has no Unicode classes. Use it in place of
/// `\s` in any pattern ported from JavaScript — `[…]*` rather than `\s*`.
pub const JS_SPACE_CLASS: &str = r"[\t\n\x0B\x0C\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}]";

/// `a < b` as JavaScript compares strings: **by UTF-16 code unit**.
///
/// Rust's own `str` ordering is by code point, and the two disagree for every
/// non-BMP character. A surrogate is `0xD800..=0xDFFF`, so JavaScript sorts an
/// emoji *below* `U+E000`, where Rust sorts `U+1F600` above it:
///
/// ```text
///            "\u{1F600}" < "\u{E000}"
///   JS       true
///   Rust     false
/// ```
///
/// It matters wherever a comparison decides an outcome rather than just a
/// display order — [`crate::merge`]'s equal-timestamp tiebreak compares
/// serialised rows, and a note with an emoji in it is an ordinary row.
pub fn js_str_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strings_compare_by_utf16_code_unit() {
        use std::cmp::Ordering::*;
        // the three pairs where code-unit and code-point ordering part company
        assert_eq!(js_str_cmp("\u{1F600}", "\u{E000}"), Less);
        assert_eq!(js_str_cmp("\u{1F600}", "\u{FFFD}"), Less);
        assert_eq!(js_str_cmp("\u{10000}", "\u{FFFF}"), Less);
        // …and Rust's own ordering says the opposite on all three
        assert!("\u{1F600}" > "\u{E000}");
        assert!("\u{1F600}" > "\u{FFFD}");
        assert!("\u{10000}" > "\u{FFFF}");
    }

    #[test]
    fn everything_inside_the_bmp_agrees() {
        use std::cmp::Ordering::*;
        assert_eq!(js_str_cmp("a", "b"), Less);
        assert_eq!(js_str_cmp("\u{4E2D}", "\u{1F600}"), Less);
        assert_eq!(js_str_cmp("", "a"), Less);
        assert_eq!(js_str_cmp("abc", "abc"), Equal);
        assert_eq!(js_str_cmp("ab", "abc"), Less);
    }

    #[test]
    fn the_two_characters_rust_gets_wrong() {
        // Rust's own trim removes NEL and keeps the BOM; JavaScript is the
        // other way round, and so is this
        assert_eq!(js_trim("\u{85}a\u{85}"), "\u{85}a\u{85}");
        assert_eq!("\u{85}a\u{85}".trim(), "a");
        assert_eq!(js_trim("\u{feff}a\u{feff}"), "a");
        assert_eq!("\u{feff}a\u{feff}".trim(), "\u{feff}a\u{feff}");
    }

    #[test]
    fn everything_both_agree_on() {
        for c in [
            '\u{9}', '\u{a}', '\u{b}', '\u{c}', '\u{d}', ' ', '\u{a0}', '\u{1680}', '\u{2000}',
            '\u{200a}', '\u{2028}', '\u{2029}', '\u{202f}', '\u{205f}', '\u{3000}',
        ] {
            let s = format!("{c}x{c}");
            assert_eq!(js_trim(&s), "x", "U+{:04X}", c as u32);
        }
    }

    #[test]
    fn characters_neither_trims() {
        // a zero-width space is not whitespace to either language
        assert_eq!(js_trim("\u{200b}a"), "\u{200b}a");
        // nor is the Mongolian vowel separator, since Unicode 6.3
        assert_eq!(js_trim("\u{180e}a"), "\u{180e}a");
    }

    #[test]
    fn an_all_space_string_trims_to_nothing() {
        assert_eq!(js_trim(" \t\u{feff}\u{3000} "), "");
    }

    #[test]
    fn the_regex_class_matches_the_predicate() {
        let re = regex_lite::Regex::new(&format!("^{JS_SPACE_CLASS}$")).expect("class compiles");
        for c in (0u32..0x3100)
            .filter_map(char::from_u32)
            .chain(['\u{feff}'])
        {
            assert_eq!(
                re.is_match(&c.to_string()),
                is_js_space(c),
                "U+{:04X}",
                c as u32
            );
        }
    }
}
