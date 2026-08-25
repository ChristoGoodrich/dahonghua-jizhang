//! The note suggestions the record sheet offers, learned from history.
//!
//! Ported from `src/domain/notes.ts`.

use crate::entry::{Entry, Io};
use crate::jsstr::js_trim;
use crate::num::desc_by_amt;

/// The notes used most often for one category, most-used first.
///
/// The tie-break is recency, and it is spelled as two comparisons rather than
/// `b.n - a.n || b.ts - a.ts` for the reason `order.ts` gives: a `NaN`
/// timestamp makes that comparator inconsistent and the resulting order
/// implementation-defined. That cannot happen on this side — `Entry::ts` is an
/// `i64` and holds no `NaN` — so the corpus cannot exercise it and the fix
/// lives on the TypeScript side alone. Worth saying out loud: the type already
/// rules out the bug the other language needs a comparator to rule out.
///
/// Notes are grouped by their **trimmed** text, and trimmed the way JavaScript
/// trims — a note pasted with a BOM is the same note as one without.
pub fn note_suggestions(entries: &[Entry], io: Io, cat: &str, limit: usize) -> Vec<String> {
    // (note, count, newest timestamp), in the order the notes were first seen
    let mut stat: Vec<(String, usize, f64)> = Vec::new();
    for d in entries {
        // `d.deletedAt || …` — a truthiness test, so a tombstone of zero is
        // not a tombstone
        if d.deleted_at.is_some_and(|v| v != 0) || d.io != Some(io) || d.cat != cat {
            continue;
        }
        let note = js_trim(d.note.as_deref().unwrap_or(""));
        if note.is_empty() {
            continue;
        }
        let ts = d.ts as f64;
        match stat.iter_mut().find(|(n, _, _)| n == note) {
            Some((_, n, newest)) => {
                *n += 1;
                // `if (d.ts > cur.ts)` — a NaN never wins, so the first
                // timestamp survives a corrupted one
                if ts > *newest {
                    *newest = ts;
                }
            }
            None => stat.push((note.to_string(), 1, ts)),
        }
    }
    stat.sort_by(|a, b| desc_by_amt(a.1 as f64, b.1 as f64).then_with(|| desc_by_amt(a.2, b.2)));
    stat.into_iter().take(limit).map(|(n, _, _)| n).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(cat: &str, text: &str, ts: i64) -> Entry {
        Entry {
            io: Some(Io::Exp),
            cat: cat.into(),
            note: Some(text.into()),
            ts,
            ..Default::default()
        }
    }

    fn suggest(entries: &[Entry]) -> Vec<String> {
        note_suggestions(entries, Io::Exp, "food", 6)
    }

    #[test]
    fn the_most_used_note_comes_first() {
        let entries = vec![
            note("food", "coffee", 1),
            note("food", "lunch", 2),
            note("food", "coffee", 3),
        ];
        assert_eq!(suggest(&entries), vec!["coffee", "lunch"]);
    }

    #[test]
    fn a_tie_is_broken_by_recency() {
        let entries = vec![note("food", "old", 1), note("food", "new", 9)];
        assert_eq!(suggest(&entries), vec!["new", "old"]);
    }

    #[test]
    fn other_categories_and_directions_are_ignored() {
        let entries = vec![
            note("food", "keep", 1),
            note("rent", "drop", 2),
            Entry {
                io: Some(Io::Inc),
                ..note("food", "drop", 3)
            },
        ];
        assert_eq!(suggest(&entries), vec!["keep"]);
    }

    #[test]
    fn blank_notes_are_not_suggestions() {
        let entries = vec![
            note("food", "  ", 1),
            note("food", "", 2),
            note("food", "\u{feff}", 3),
            note("food", "real", 4),
        ];
        assert_eq!(suggest(&entries), vec!["real"]);
    }

    #[test]
    fn a_pasted_bom_is_the_same_note() {
        // `str::trim()` would keep the BOM and split these into two
        let entries = vec![
            note("food", "coffee", 1),
            note("food", "\u{feff}coffee", 2),
            note("food", "tea", 3),
        ];
        assert_eq!(suggest(&entries), vec!["coffee", "tea"]);
    }

    #[test]
    fn a_zero_tombstone_is_not_a_tombstone() {
        let mut entries = vec![note("food", "kept", 1), note("food", "gone", 2)];
        entries[0].deleted_at = Some(0);
        entries[1].deleted_at = Some(1);
        assert_eq!(suggest(&entries), vec!["kept"]);
    }

    #[test]
    fn the_limit_is_honoured() {
        let entries: Vec<Entry> = (0..10).map(|i| note("food", &format!("n{i}"), i)).collect();
        assert_eq!(note_suggestions(&entries, Io::Exp, "food", 3).len(), 3);
        assert!(note_suggestions(&entries, Io::Exp, "food", 0).is_empty());
    }

    #[test]
    fn an_unusable_timestamp_does_not_win_the_tie() {
        let mut entries = vec![note("food", "sane", 5), note("food", "broken", 0)];
        entries[1].ts = i64::MIN; // the closest an integer stamp gets to unusable
        assert_eq!(suggest(&entries), vec!["sane", "broken"]);
    }
}
