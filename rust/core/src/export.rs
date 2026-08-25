//! The rows an export is made of, and the CSV they render to.
//!
//! Ported from `src/domain/export.ts`.
//!
//! The **serialisation** of the XLSX half stays off this side, the same way
//! `rates` left its HTTP behind: `writeXlsx` is 210 lines of ZIP and XML with
//! no decisions in it, and `rust_xlsxwriter` is the answer when the Rust side
//! actually needs to write a file. What crosses is [`to_rows`], which is where
//! every choice lives — which entries appear, in what order, and what each
//! column says.

use crate::catalog::{cat_of, Category};
use crate::civil::Civil;
use crate::entry::{Entry, Io};
use crate::num::{desc_by_amt, js_num};

/// One cell. The amount column is a number in the XLSX and a bare numeral in
/// the CSV; everything else is text.
#[derive(Debug, Clone, PartialEq)]
pub enum Cell {
    Text(String),
    Num(f64),
}

impl Cell {
    /// `String(v)` — the same rendering the CSV writer applies to both kinds.
    pub fn as_str(&self) -> String {
        match self {
            Cell::Text(s) => s.clone(),
            Cell::Num(n) => js_num(*n),
        }
    }
}

/// Custom categories, one list per direction.
///
/// `catOf` is handed a `Record<IO, Category[]>` and picks the list matching the
/// entry, so a transfer never sees the expense customs. Taking one flat slice
/// here let a custom expense category answer for a transfer row — 2,225
/// divergences on the first run, all of them that.
#[derive(Debug, Clone, Copy, Default)]
pub struct CustomCats<'a> {
    pub exp: &'a [Category],
    pub inc: &'a [Category],
    pub xfer: &'a [Category],
}

impl<'a> CustomCats<'a> {
    fn of(&self, io: Io) -> &'a [Category] {
        match io {
            Io::Exp => self.exp,
            Io::Inc => self.inc,
            Io::Xfer => self.xfer,
        }
    }
}

/// One entry with the local calendar day the platform resolved it to.
///
/// The date column used to be `new Date(d.ts).toISOString().slice(0, 10)`,
/// which is the **UTC** day: in Sydney every entry logged before ten in the
/// morning exported with yesterday's date. It is the local day now, which is
/// the day the app has been showing all along, so the projection belongs to the
/// caller like every other calendar question in this crate.
#[derive(Debug, Clone, PartialEq)]
pub struct ExportRow {
    pub entry: Entry,
    pub day: Civil,
}

fn date_str(c: Civil) -> String {
    format!("{}-{:02}-{:02}", c.y, c.m + 1, c.d)
}

/// Header plus one line per live entry, oldest first.
///
/// Tombstones are dropped: an export states what the ledger holds, not what it
/// has ever held. The filter is `!d.deletedAt`, a truthiness test, so a
/// tombstone of zero is not a tombstone.
///
/// `accounts` maps an id to a display name; an id that names no account renders
/// as the empty string rather than as itself, which is what
/// `accounts.find(…)?.name ?? ''` does.
pub fn to_rows(
    rows: &[ExportRow],
    accounts: &[(String, String)],
    custom: CustomCats,
) -> Vec<Vec<Cell>> {
    let name_of = |id: Option<&str>| -> String {
        accounts
            .iter()
            .find(|(k, _)| Some(k.as_str()) == id)
            .map(|(_, n)| n.clone())
            .unwrap_or_default()
    };

    let mut live: Vec<&ExportRow> = rows
        .iter()
        .filter(|r| r.entry.deleted_at.is_none_or(|v| v == 0))
        .collect();
    // `sort((a, b) => a.ts - b.ts)`, oldest first and stable — spelled as a
    // total order for the reason `order.ts` gives on the other side
    live.sort_by(|a, b| desc_by_amt(b.entry.ts as f64, a.entry.ts as f64));

    let mut out = vec![vec![
        Cell::Text("date".into()),
        Cell::Text("type".into()),
        Cell::Text("category".into()),
        Cell::Text("account".into()),
        Cell::Text("amount".into()),
        Cell::Text("note".into()),
    ]];
    for r in live {
        let d = &r.entry;
        let io = d.io.unwrap_or(Io::Exp);
        let c = cat_of(io, &d.cat, custom.of(io));
        out.push(vec![
            Cell::Text(date_str(r.day)),
            Cell::Text(d.io.map(Io::as_str).unwrap_or("").to_string()),
            // `c.zh || c.en || ''` — a category with no Chinese name falls back
            // to its English one, and one with neither renders empty
            Cell::Text(if !c.zh.is_empty() {
                c.zh.clone()
            } else {
                c.en.clone()
            }),
            Cell::Text(if d.io == Some(Io::Xfer) {
                format!(
                    "{}\u{2192}{}",
                    name_of(d.acct.as_deref()),
                    name_of(d.acct_to.as_deref())
                )
            } else {
                name_of(d.acct.as_deref())
            }),
            Cell::Num(d.amt),
            Cell::Text(d.note.clone().filter(|n| !n.is_empty()).unwrap_or_default()),
        ]);
    }
    out
}

/// Quote a CSV cell, but only when it needs it.
///
/// The test is `/[",\n]/`, and note what is **not** in it: a carriage return.
/// A note containing a lone `\r` goes through unquoted and splits the row for
/// any reader that treats `\r` as a line ending. Reproduced rather than
/// widened — the fix belongs in the TypeScript first, and nothing in the app
/// produces a lone `\r` today.
pub fn csv_cell(v: &Cell) -> String {
    let s = v.as_str();
    if s.contains('"') || s.contains(',') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

/// The whole CSV, BOM included.
///
/// The BOM is there so Excel reads the file as UTF-8 instead of guessing a
/// code page and mangling every Chinese category name.
pub fn to_csv(rows: &[ExportRow], accounts: &[(String, String)], custom: CustomCats) -> String {
    let mut s = String::from("\u{feff}");
    let table = to_rows(rows, accounts, custom);
    for (i, row) in table.iter().enumerate() {
        if i > 0 {
            s.push('\n');
        }
        let cells: Vec<String> = row.iter().map(csv_cell).collect();
        s.push_str(&cells.join(","));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(ts: i64, io: Io, cat: &str, amt: f64) -> ExportRow {
        ExportRow {
            entry: Entry {
                ts,
                io: Some(io),
                cat: cat.into(),
                amt,
                ..Default::default()
            },
            day: Civil::new(2026, 5, 10),
        }
    }

    fn accounts() -> Vec<(String, String)> {
        vec![
            ("a1".to_string(), "Cash".to_string()),
            ("a2".to_string(), "Card".to_string()),
        ]
    }

    #[test]
    fn the_header_comes_first() {
        let t = to_rows(&[], &[], CustomCats::default());
        assert_eq!(t.len(), 1);
        assert_eq!(t[0][0], Cell::Text("date".into()));
        assert_eq!(t[0].len(), 6);
    }

    #[test]
    fn entries_come_out_oldest_first() {
        let rows = vec![
            row(300, Io::Exp, "food", 3.0),
            row(100, Io::Exp, "food", 1.0),
            row(200, Io::Exp, "food", 2.0),
        ];
        let t = to_rows(&rows, &[], CustomCats::default());
        let amts: Vec<Cell> = t[1..].iter().map(|r| r[4].clone()).collect();
        assert_eq!(amts, vec![Cell::Num(1.0), Cell::Num(2.0), Cell::Num(3.0)]);
    }

    #[test]
    fn a_tie_keeps_the_order_it_arrived_in() {
        let mut a = row(100, Io::Exp, "food", 1.0);
        let mut b = row(100, Io::Exp, "food", 2.0);
        a.entry.id = "a".into();
        b.entry.id = "b".into();
        let t = to_rows(&[a, b], &[], CustomCats::default());
        assert_eq!(t[1][4], Cell::Num(1.0));
        assert_eq!(t[2][4], Cell::Num(2.0));
    }

    #[test]
    fn tombstones_are_dropped_but_a_zero_is_not_a_tombstone() {
        let mut kept = row(100, Io::Exp, "food", 1.0);
        kept.entry.deleted_at = Some(0);
        let mut gone = row(200, Io::Exp, "food", 2.0);
        gone.entry.deleted_at = Some(1);
        let t = to_rows(&[kept, gone], &[], CustomCats::default());
        assert_eq!(t.len(), 2);
        assert_eq!(t[1][4], Cell::Num(1.0));
    }

    #[test]
    fn a_transfer_names_both_accounts() {
        let mut r = row(100, Io::Xfer, "trans", 50.0);
        r.entry.acct = Some("a1".into());
        r.entry.acct_to = Some("a2".into());
        let t = to_rows(&[r], &accounts(), CustomCats::default());
        assert_eq!(t[1][3], Cell::Text("Cash\u{2192}Card".into()));
    }

    #[test]
    fn an_unknown_account_renders_empty_rather_than_as_its_id() {
        let mut r = row(100, Io::Exp, "food", 1.0);
        r.entry.acct = Some("gone".into());
        let t = to_rows(&[r], &accounts(), CustomCats::default());
        assert_eq!(t[1][3], Cell::Text(String::new()));
    }

    #[test]
    fn the_date_column_is_the_local_day() {
        let mut r = row(100, Io::Exp, "food", 1.0);
        r.day = Civil::new(2026, 0, 5);
        let t = to_rows(&[r], &[], CustomCats::default());
        assert_eq!(t[1][0], Cell::Text("2026-01-05".into()));
    }

    #[test]
    fn a_csv_cell_is_quoted_only_when_it_has_to_be() {
        assert_eq!(csv_cell(&Cell::Text("plain".into())), "plain");
        assert_eq!(csv_cell(&Cell::Text("a,b".into())), "\"a,b\"");
        assert_eq!(csv_cell(&Cell::Text("a\nb".into())), "\"a\nb\"");
        assert_eq!(
            csv_cell(&Cell::Text("say \"hi\"".into())),
            "\"say \"\"hi\"\"\""
        );
        // a lone carriage return is not in the test, so it passes through
        assert_eq!(csv_cell(&Cell::Text("a\rb".into())), "a\rb");
    }

    #[test]
    fn a_number_cell_renders_the_way_javascript_renders_it() {
        assert_eq!(csv_cell(&Cell::Num(1e21)), "1e+21");
        assert_eq!(csv_cell(&Cell::Num(-0.0)), "0");
        assert_eq!(csv_cell(&Cell::Num(f64::NAN)), "NaN");
    }

    #[test]
    fn the_csv_starts_with_a_byte_order_mark() {
        let s = to_csv(&[], &[], CustomCats::default());
        assert!(s.starts_with('\u{feff}'));
        assert_eq!(s, "\u{feff}date,type,category,account,amount,note");
    }

    #[test]
    fn the_csv_has_no_trailing_newline() {
        // `rows.map(…).join('\n')` — a join, so the last row has nothing after it
        let s = to_csv(
            &[row(100, Io::Exp, "food", 1.0)],
            &[],
            CustomCats::default(),
        );
        assert!(!s.ends_with('\n'));
        assert_eq!(s.lines().count(), 2);
    }
}
