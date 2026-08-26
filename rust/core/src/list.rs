//! Day grouping for the entry list — the first piece of *UI* logic to cross.
//!
//! Ported from `src/features/list/grouping.ts`, which was itself lifted out of
//! `EntryList.tsx` for this port. That extraction is the pattern the remaining
//! twenty screens follow: the ordering, the bucketing and the sums are
//! decisions and come here; the rows, the badges and the swipe gestures are
//! presentation and stay in the widget tree.
//!
//! Two things stay on the platform, for the reasons the migration has already
//! settled elsewhere:
//!
//! * **The timezone.** An entry's calendar day depends on a zone this crate
//!   does not own, so a row arrives already projected onto its day — the same
//!   shape [`crate::trends::TrendRow`] uses.
//! * **The day's printed name.** "8月26日 周三" is `toLocaleDateString`, which
//!   is Intl. What comes out is [`DayLabel`] — *which* of the three names
//!   applies — and the day itself for the third.

use crate::civil::Civil;
use crate::entry::Io;

/// One entry as the list needs it: an identity, a sum, an order, and a day.
#[derive(Debug, Clone, PartialEq)]
pub struct ListRow {
    pub id: String,
    pub io: Option<Io>,
    pub amt: f64,
    /// The raw stamp, which is what the ordering uses.
    pub ts: i64,
    /// The local calendar day the caller projected `ts` onto.
    pub day: Civil,
}

/// Which of the three day names applies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DayLabel {
    Today,
    Yesterday,
    /// Anything else — the caller spells the date.
    Date,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DayGroup {
    pub day: Civil,
    pub label: DayLabel,
    pub exp: f64,
    pub inc: f64,
    /// The day's entries, newest first.
    pub ids: Vec<String>,
}

/// Which label a day takes, against today.
///
/// Whole calendar days apart, not elapsed hours. Subtracting twenty-four hours
/// — which the TypeScript once did — makes "yesterday" the day before
/// yesterday on the morning after the clocks go forward.
pub fn label_for(day: Civil, today: Civil) -> DayLabel {
    match today.day_number() - day.day_number() {
        0 => DayLabel::Today,
        1 => DayLabel::Yesterday,
        _ => DayLabel::Date,
    }
}

/// Bucket rows into calendar days, newest day first.
///
/// Sorted by `ts` descending and bucketed in that order, so the groups come out
/// newest-first without a second sort — the insertion order of the JavaScript
/// `Map` *is* the display order, and this reproduces it with a `Vec`.
///
/// The sort is **stable** on both sides, so two entries stamped at the same
/// millisecond keep the order they arrived in. That matters more than it
/// sounds: a bill import stamps a whole batch inside one millisecond.
///
/// Nothing is filtered. The caller has already narrowed to a cycle and a
/// search, and a tombstone that reaches here is one the caller meant to show.
pub fn group_by_day(rows: &[ListRow], today: Civil) -> Vec<DayGroup> {
    let mut sorted: Vec<&ListRow> = rows.iter().collect();
    // `sort_by_key(Reverse(ts))`, which is stable in the same way `sort_by`
    // would be — and stability is the point, so the key form is not a tidy-up
    sorted.sort_by_key(|r| std::cmp::Reverse(r.ts));

    let mut groups: Vec<DayGroup> = Vec::new();
    for r in sorted {
        match groups.iter_mut().find(|g| g.day == r.day) {
            Some(g) => g.ids.push(r.id.clone()),
            None => groups.push(DayGroup {
                day: r.day,
                label: label_for(r.day, today),
                exp: 0.0,
                inc: 0.0,
                ids: vec![r.id.clone()],
            }),
        }
        // summed in the order the rows are visited, so the floating-point
        // result is bit-identical to the JavaScript's `reduce`. A transfer
        // counts in neither total: it moves money, it does not spend or earn it.
        let g = groups
            .iter_mut()
            .find(|g| g.day == r.day)
            .expect("just placed");
        match r.io {
            Some(Io::Exp) => g.exp += r.amt,
            Some(Io::Inc) => g.inc += r.amt,
            _ => {}
        }
    }
    groups
}

/// One row of the flattened list a virtualised view renders.
#[derive(Debug, Clone, PartialEq)]
pub enum FlatItem {
    Header {
        day: Civil,
        label: DayLabel,
        exp: f64,
        inc: f64,
    },
    Entry {
        id: String,
        group: Civil,
    },
    /// Several entries sharing one row, for a tablet layout.
    EntryRow {
        ids: Vec<String>,
        group: Civil,
    },
}

/// Flatten day groups into the one-dimensional list.
///
/// `columns` above 1 packs entries into rows. The `> 1` test is load-bearing
/// rather than tidy: the packing loop steps by `columns`, so a zero would never
/// advance — in JavaScript that is a hang, and the guard is what prevents it.
pub fn flatten(groups: &[DayGroup], columns: usize) -> Vec<FlatItem> {
    let mut out = Vec::new();
    for g in groups {
        out.push(FlatItem::Header {
            day: g.day,
            label: g.label,
            exp: g.exp,
            inc: g.inc,
        });
        if columns > 1 {
            for chunk in g.ids.chunks(columns) {
                out.push(FlatItem::EntryRow {
                    ids: chunk.to_vec(),
                    group: g.day,
                });
            }
        } else {
            for id in &g.ids {
                out.push(FlatItem::Entry {
                    id: id.clone(),
                    group: g.day,
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(y: i32, m: i32, d: i32) -> Civil {
        Civil::new(y, m - 1, d)
    }

    fn row(id: &str, io: Option<Io>, amt: f64, ts: i64, d: Civil) -> ListRow {
        ListRow {
            id: id.to_string(),
            io,
            amt,
            ts,
            day: d,
        }
    }

    const TODAY: fn() -> Civil = || day(2026, 8, 26);

    #[test]
    fn days_come_out_newest_first_and_so_do_their_entries() {
        let a = day(2026, 8, 24);
        let b = day(2026, 8, 26);
        let rows = [
            row("old", Some(Io::Exp), 1.0, 100, a),
            row("new", Some(Io::Exp), 2.0, 300, b),
            row("mid", Some(Io::Exp), 3.0, 200, b),
        ];
        let g = group_by_day(&rows, TODAY());
        assert_eq!(g.len(), 2);
        assert_eq!(g[0].day, b);
        assert_eq!(g[0].ids, vec!["new", "mid"]);
        assert_eq!(g[1].ids, vec!["old"]);
    }

    #[test]
    fn a_transfer_counts_in_neither_total() {
        let d = TODAY();
        let rows = [
            row("e", Some(Io::Exp), 10.0, 3, d),
            row("i", Some(Io::Inc), 100.0, 2, d),
            row("x", Some(Io::Xfer), 5000.0, 1, d),
        ];
        let g = group_by_day(&rows, TODAY());
        assert_eq!(g[0].exp, 10.0);
        assert_eq!(g[0].inc, 100.0);
        assert_eq!(g[0].ids.len(), 3); // it is still shown
    }

    #[test]
    fn an_entry_with_no_direction_counts_in_neither_either() {
        let d = TODAY();
        let g = group_by_day(&[row("?", None, 7.0, 1, d)], TODAY());
        assert_eq!((g[0].exp, g[0].inc), (0.0, 0.0));
    }

    #[test]
    fn the_three_labels() {
        let t = TODAY();
        assert_eq!(label_for(day(2026, 8, 26), t), DayLabel::Today);
        assert_eq!(label_for(day(2026, 8, 25), t), DayLabel::Yesterday);
        assert_eq!(label_for(day(2026, 8, 24), t), DayLabel::Date);
        // a day in the future is dated, not "today"
        assert_eq!(label_for(day(2026, 8, 27), t), DayLabel::Date);
    }

    #[test]
    fn a_label_crosses_a_month_boundary_by_day_not_by_arithmetic() {
        let t = day(2026, 9, 1);
        assert_eq!(label_for(day(2026, 8, 31), t), DayLabel::Yesterday);
        assert_eq!(label_for(day(2026, 8, 30), t), DayLabel::Date);
    }

    #[test]
    fn equal_stamps_keep_the_order_they_arrived_in() {
        // a bill import stamps a whole batch inside one millisecond
        let d = TODAY();
        let rows = [
            row("a", Some(Io::Exp), 1.0, 5, d),
            row("b", Some(Io::Exp), 1.0, 5, d),
            row("c", Some(Io::Exp), 1.0, 5, d),
        ];
        assert_eq!(group_by_day(&rows, TODAY())[0].ids, vec!["a", "b", "c"]);
    }

    #[test]
    fn one_column_lists_entries_and_more_packs_them() {
        let d = TODAY();
        let rows: Vec<ListRow> = (0..5)
            .map(|i| row(&format!("e{i}"), Some(Io::Exp), 1.0, 10 - i, d))
            .collect();
        let g = group_by_day(&rows, TODAY());

        let flat = flatten(&g, 1);
        assert_eq!(flat.len(), 6); // one header, five entries
        assert!(matches!(flat[1], FlatItem::Entry { .. }));

        let packed = flatten(&g, 2);
        assert_eq!(packed.len(), 4); // one header, three rows (2 + 2 + 1)
        match &packed[3] {
            FlatItem::EntryRow { ids, .. } => assert_eq!(ids.len(), 1),
            other => panic!("expected a row, got {other:?}"),
        }
    }

    #[test]
    fn zero_columns_takes_the_single_column_path() {
        // the `> 1` guard, which in JavaScript is what stops a `i += 0` loop
        // from never advancing
        let d = TODAY();
        let g = group_by_day(&[row("a", Some(Io::Exp), 1.0, 1, d)], TODAY());
        assert_eq!(flatten(&g, 0), flatten(&g, 1));
    }

    #[test]
    fn nothing_in_gives_nothing_out() {
        assert!(group_by_day(&[], TODAY()).is_empty());
        assert!(flatten(&[], 1).is_empty());
    }

    #[test]
    fn a_day_that_reappears_after_another_does_not_open_a_second_group() {
        // it cannot happen from sorted input, but the bucketing must not depend
        // on that — the JavaScript keys a Map, which would not either
        let a = day(2026, 8, 26);
        let b = day(2026, 8, 25);
        let rows = [
            row("x", Some(Io::Exp), 1.0, 300, a),
            row("y", Some(Io::Exp), 1.0, 200, b),
            row("z", Some(Io::Exp), 1.0, 100, a),
        ];
        let g = group_by_day(&rows, TODAY());
        assert_eq!(g.len(), 2);
        assert_eq!(g[0].ids, vec!["x", "z"]);
    }
}
