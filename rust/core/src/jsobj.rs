//! The one reordering JavaScript does to an object's keys.
//!
//! A plain object is not a `HashMap` and not a `BTreeMap`. `Object.keys`
//! returns keys that are **array indices** first, in ascending numeric order,
//! ahead of everything and regardless of when they were inserted; only the
//! remainder come out in insertion order.
//!
//! Three things in this crate walk a user's per-category budget map and care
//! which key comes first — [`crate::budget::cat_budget_rows`] because its sort
//! is stable and ties are the normal state of a fresh cycle,
//! [`crate::insight`] because it reports the *first* category over its cap, and
//! [`crate::recap`] because it names the biggest spend. Three is the point at
//! which this stopped being one module's private business.

/// True when `k` is what JavaScript calls an *array index*: the canonical
/// decimal spelling of an integer in `0 ..= 2^32 - 2`.
///
/// Canonical is the whole test. `01` is not an index, because `String(1)` is
/// `"1"`; nor is `-1`, `1.5`, `1e2`, the empty string, or `4294967295`, which
/// is a length rather than an index.
pub fn is_array_index(k: &str) -> bool {
    if k.is_empty() || (k.len() > 1 && k.starts_with('0')) {
        return false;
    }
    if !k.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    matches!(k.parse::<u32>(), Ok(n) if n != u32::MAX)
}

/// `Object.keys` order over a map's entries held in insertion order.
///
/// Duplicates cannot occur: the source is an object, so a repeated key would
/// have overwritten rather than appended.
pub fn object_keys<T>(entries: &[(String, T)]) -> Vec<&(String, T)> {
    let mut out: Vec<&(String, T)> = entries.iter().filter(|(k, _)| is_array_index(k)).collect();
    out.sort_by_key(|(k, _)| k.parse::<u32>().expect("is_array_index checked this"));
    out.extend(entries.iter().filter(|(k, _)| !is_array_index(k)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_is_an_index_only_in_its_canonical_spelling() {
        assert!(is_array_index("0"));
        assert!(is_array_index("1"));
        assert!(is_array_index("4294967294"));
        assert!(!is_array_index("01"));
        assert!(!is_array_index(""));
        assert!(!is_array_index("-1"));
        assert!(!is_array_index("1.5"));
        assert!(!is_array_index("1e2"));
        // 2^32 - 1 is a length rather than an index
        assert!(!is_array_index("4294967295"));
        assert!(!is_array_index("4294967296"));
    }

    #[test]
    fn indices_come_first_in_numeric_order() {
        let m = vec![
            ("b".to_string(), 1),
            ("10".to_string(), 2),
            ("a".to_string(), 3),
            ("2".to_string(), 4),
        ];
        let order: Vec<&str> = object_keys(&m).iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(order, vec!["2", "10", "b", "a"]);
    }

    #[test]
    fn everything_else_keeps_insertion_order() {
        let m = vec![
            ("zed".to_string(), 1),
            ("alpha".to_string(), 2),
            ("01".to_string(), 3),
        ];
        let order: Vec<&str> = object_keys(&m).iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(order, vec!["zed", "alpha", "01"]);
    }
}
