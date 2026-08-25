//! Filtering entries, and reading a date range out of a search box.
//!
//! Ported from `src/domain/filter.ts`.
//!
//! [`parse_date_range`] answers in civil dates rather than epoch milliseconds,
//! for the reason `civil.rs` gives everywhere else — and here the reason is
//! doubled, because half these queries are *relative*. "上周" needs to know
//! what today is, and the TypeScript reads its own clock to find out. Today is
//! an argument here, which makes the whole function reproducible.

use crate::bills::CivilTime;
use crate::civil::{days_in_month, parse_iso_date as ymd, Civil};
use crate::entry::{Entry, Io};
use crate::jsstr::{js_trim, JS_SPACE_CLASS};
use regex_lite::Regex;
use std::sync::OnceLock;

/// Which entries a view is showing. Every field absent means "everything".
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FilterState {
    pub io: Option<Io>,
    pub cat: Option<String>,
    pub acct: Option<String>,
    /// Inclusive, in epoch milliseconds — these come from the platform, which
    /// resolved a [`DateRange`] against its own timezone.
    pub date_from: Option<i64>,
    pub date_to: Option<i64>,
}

/// True when an entry passes every active filter.
///
/// The bounds are truthiness tests in the TypeScript — `if (filter.dateFrom &&
/// …)` — so epoch zero reads as "no bound" rather than as the start of 1970.
/// Reproduced rather than corrected: an entry before 1970 is not a thing this
/// app can hold, and the alternative is a behaviour change nobody asked for.
pub fn matches_filter(d: &Entry, filter: &FilterState) -> bool {
    if filter.io.is_some() && d.io != filter.io {
        return false;
    }
    if let Some(cat) = filter.cat.as_deref().filter(|s| !s.is_empty()) {
        if d.cat != cat {
            return false;
        }
    }
    if let Some(acct) = filter.acct.as_deref().filter(|s| !s.is_empty()) {
        if d.acct.as_deref() != Some(acct) {
            return false;
        }
    }
    if let Some(from) = filter.date_from.filter(|v| *v != 0) {
        if d.ts < from {
            return false;
        }
    }
    if let Some(to) = filter.date_to.filter(|v| *v != 0) {
        if d.ts > to {
            return false;
        }
    }
    true
}

/* --------------------------------------------------------- date ranges -- */

/// A range of wall-clock time, inclusive at both ends.
///
/// `from` is always midnight and `to` always 23:59:59, which is what every
/// branch of the TypeScript builds. The platform turns the pair into the epoch
/// milliseconds [`FilterState`] compares against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DateRange {
    pub from: CivilTime,
    pub to: CivilTime,
}

fn start(d: Civil) -> CivilTime {
    CivilTime {
        date: d,
        h: 0,
        mi: 0,
        s: 0,
    }
}

fn end(d: Civil) -> CivilTime {
    CivilTime {
        date: d,
        h: 23,
        mi: 59,
        s: 59,
    }
}

/// A whole month, from `new Date(y, m, 1)` to `new Date(y, m + 1, 0)`.
///
/// Built from *components*, which is a different animal from the ISO strings
/// the day and range branches use. Components carry the legacy two-digit-year
/// rule and roll silently out of range; strings validate and do not remap the
/// year. Both behaviours are real and this crate reproduces each where it
/// belongs — see [`ymd`] for the other half.
fn whole_month(y: i32, m: i32) -> DateRange {
    // MakeFullYear: years 0 through 99 mean 1900 through 1999
    let y = if (0..=99).contains(&y) { 1900 + y } else { y };
    // `new Date(y, m + 1, 0)` — day zero of the next month is the last day of
    // this one, which is how the TypeScript spells it
    let first = Civil::new(y, m, 1);
    DateRange {
        from: start(first),
        to: end(Civil::new(
            first.y,
            first.m,
            days_in_month(first.y, first.m),
        )),
    }
}

fn whole_day(d: Civil) -> DateRange {
    DateRange {
        from: start(d),
        to: end(d),
    }
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("pattern compiles"))
}

fn range_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    // `\s` here is JavaScript's, not `regex_lite`'s: the latter is the ASCII
    // six, the former includes NBSP, the ideographic space and the BOM. A
    // range pasted with a BOM either side of its separator matched in the app
    // and did not here.
    let pattern = format!(
        r"^([0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}){s}*[~\-]{s}*([0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}})$",
        s = JS_SPACE_CLASS
    );
    re(&R, &pattern)
}

fn month_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"^([0-9]{4})-([0-9]{2})$")
}

fn day_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"^([0-9]{4})-([0-9]{2})-([0-9]{2})$")
}

fn zh_month_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"^([0-9]{1,2})月$")
}

/// Read a date range out of a search query.
///
/// Accepts `2024-01` for a month, `2024-01-15` for a day, `2024-01-01~2024-01-31`
/// for an explicit range, `1月` for a month of the current year, and the
/// relative words 今天/昨天/本周/上周/本月/上月 with their English equivalents.
///
/// `today` is what the TypeScript reads from its own clock. Passing it makes
/// every relative branch reproducible, which is the only way the parity corpus
/// can compare them.
pub fn parse_date_range(query: &str, today: Civil) -> Option<DateRange> {
    let q = js_trim(query);

    // explicit range — note the separator alternation includes `-`, so
    // `2024-01-01-2024-01-31` parses too
    if let Some(c) = range_re().captures(q) {
        // `if (!isNaN(from) && !isNaN(to))` — an unparseable end falls through
        // to the branches below rather than returning
        if let (Some(a), Some(b)) = (ymd(&c[1]), ymd(&c[2])) {
            return Some(DateRange {
                from: start(a),
                to: end(b),
            });
        }
    }

    if let Some(c) = month_re().captures(q) {
        let y: i32 = c[1].parse().expect("four digits");
        let m: i32 = c[2].parse().expect("two digits");
        return Some(whole_month(y, m - 1));
    }

    if day_re().is_match(q) {
        if let Some(d) = ymd(q) {
            return Some(whole_day(d));
        }
    }

    if let Some(c) = zh_month_re().captures(q) {
        let m: i32 = c[1].parse::<i32>().expect("one or two digits") - 1;
        // the guard is on the *parsed* month, so 0月 and 13月 fall through to
        // the relative words rather than producing a rolled-over range
        if (0..12).contains(&m) {
            return Some(whole_month(today.y, m));
        }
    }

    // `now.getDay() || 7` is 1 = Monday … 7 = Sunday, where
    // `weekday_monday_first` is 0 = Monday … 6 = Sunday. The shift is real, not
    // cosmetic: the week arithmetic below subtracts it.
    let dow = today.weekday_monday_first() + 1;

    Some(match q {
        "本月" | "this month" => whole_month(today.y, today.m),
        "上月" | "last month" => whole_month(today.y, today.m - 1),
        "上周" | "last week" => DateRange {
            from: start(Civil::new(today.y, today.m, today.d - dow - 6)),
            to: end(Civil::new(today.y, today.m, today.d - dow)),
        },
        "本周" | "this week" => DateRange {
            from: start(Civil::new(today.y, today.m, today.d - dow + 1)),
            to: end(Civil::new(today.y, today.m, today.d + (7 - dow))),
        },
        "今天" | "today" => whole_day(today),
        "昨天" | "yesterday" => whole_day(Civil::new(today.y, today.m, today.d - 1)),
        _ => return None,
    })
}

/* ------------------------------------------------------- search queries -- */

/// Keywords that set the direction filter, and where a word boundary belongs.
///
/// `\b` is defined against `\w`, which holds no CJK character, so `\b支出\b`
/// can never match — the Chinese keywords were dead in the TypeScript until
/// that was fixed. Boundaries stay around the ASCII words, where they stop
/// `expense` matching inside `inexpensive`, and are dropped around the Chinese
/// ones, where they only ever prevented a match.
fn io_words() -> &'static [(Io, Regex)] {
    static R: OnceLock<Vec<(Io, Regex)>> = OnceLock::new();
    R.get_or_init(|| {
        [
            (Io::Exp, r"(?i)\b(?:expense|spent)\b|支出|花掉"),
            (Io::Inc, r"(?i)\b(?:income|earned)\b|收入|进账"),
            (Io::Xfer, r"(?i)\btransfer\b|转账"),
        ]
        .iter()
        .map(|(io, p)| (*io, Regex::new(p).expect("pattern compiles")))
        .collect()
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedQuery {
    /// What is left to match as free text.
    pub text: String,
    pub filter: FilterState,
    /// The civil range, when the query named one. The platform resolves it to
    /// the epoch bounds that go into [`FilterState`].
    pub range: Option<DateRange>,
}

/// Split a search box into a date range, a direction, and the text that is left.
///
/// A query that is *entirely* a date clears the text: the whole box was the
/// range, so there is nothing left to match by name.
pub fn parse_search_query(query: &str, today: Civil) -> ParsedQuery {
    let mut text = js_trim(query).to_string();
    let mut filter = FilterState::default();

    let range = parse_date_range(&text, today);
    if range.is_some() {
        text.clear();
    }

    for (io, re) in io_words() {
        let stripped = js_trim(&re.replace_all(&text, "")).to_string();
        if stripped != text {
            filter.io = Some(*io);
            text = stripped;
            break;
        }
    }

    ParsedQuery {
        text,
        filter,
        range,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(y: i32, m: i32, d: i32) -> Civil {
        Civil::new(y, m, d)
    }

    fn entry(io: Io, cat: &str, acct: Option<&str>, ts: i64) -> Entry {
        Entry {
            ts,
            io: Some(io),
            cat: cat.into(),
            amt: 10.0,
            acct: acct.map(|s| s.to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn an_empty_filter_passes_everything() {
        assert!(matches_filter(
            &entry(Io::Exp, "food", None, 1_000),
            &FilterState::default()
        ));
    }

    #[test]
    fn each_field_narrows_independently() {
        let e = entry(Io::Exp, "food", Some("a1"), 1_000);
        let f = |p: FilterState| matches_filter(&e, &p);
        assert!(f(FilterState {
            io: Some(Io::Exp),
            ..Default::default()
        }));
        assert!(!f(FilterState {
            io: Some(Io::Inc),
            ..Default::default()
        }));
        assert!(f(FilterState {
            cat: Some("food".into()),
            ..Default::default()
        }));
        assert!(!f(FilterState {
            cat: Some("trans".into()),
            ..Default::default()
        }));
        assert!(f(FilterState {
            acct: Some("a1".into()),
            ..Default::default()
        }));
        assert!(!f(FilterState {
            acct: Some("a2".into()),
            ..Default::default()
        }));
    }

    #[test]
    fn every_active_filter_must_pass_not_just_one() {
        let e = entry(Io::Exp, "food", None, 1_000);
        assert!(!matches_filter(
            &e,
            &FilterState {
                io: Some(Io::Exp),
                cat: Some("trans".into()),
                ..Default::default()
            }
        ));
    }

    #[test]
    fn the_date_bounds_are_inclusive() {
        let e = entry(Io::Exp, "food", None, 1_000);
        let f = |from, to| {
            matches_filter(
                &e,
                &FilterState {
                    date_from: from,
                    date_to: to,
                    ..Default::default()
                },
            )
        };
        assert!(f(Some(1_000), Some(1_000)));
        assert!(!f(Some(1_001), None));
        assert!(!f(None, Some(999)));
    }

    #[test]
    fn a_zero_bound_means_no_bound() {
        // `if (filter.dateFrom && …)` in the TypeScript
        let e = entry(Io::Exp, "food", None, -5);
        assert!(matches_filter(
            &e,
            &FilterState {
                date_from: Some(0),
                ..Default::default()
            }
        ));
    }

    #[test]
    fn a_month_runs_to_its_real_last_day() {
        let r = parse_date_range("2024-02", c(2026, 0, 1)).unwrap();
        assert_eq!(r.from.date, c(2024, 1, 1));
        assert_eq!(r.to.date, c(2024, 1, 29)); // leap year
        assert_eq!((r.from.h, r.from.mi, r.from.s), (0, 0, 0));
        assert_eq!((r.to.h, r.to.mi, r.to.s), (23, 59, 59));

        let r = parse_date_range("2025-02", c(2026, 0, 1)).unwrap();
        assert_eq!(r.to.date, c(2025, 1, 28));
    }

    #[test]
    fn a_day_is_that_day_from_midnight_to_a_second_before_the_next() {
        let r = parse_date_range("2024-01-15", c(2026, 0, 1)).unwrap();
        assert_eq!(r.from.date, c(2024, 0, 15));
        assert_eq!(r.to.date, c(2024, 0, 15));
        assert_eq!(r.to.h, 23);
    }

    #[test]
    fn an_explicit_range_takes_both_ends() {
        let r = parse_date_range("2024-01-01~2024-01-31", c(2026, 0, 1)).unwrap();
        assert_eq!(r.from.date, c(2024, 0, 1));
        assert_eq!(r.to.date, c(2024, 0, 31));

        // the separator alternation includes `-`, so this parses too
        let r = parse_date_range("2024-01-01-2024-01-31", c(2026, 0, 1)).unwrap();
        assert_eq!(r.to.date, c(2024, 0, 31));
    }

    #[test]
    fn a_bare_chinese_month_means_this_year() {
        let r = parse_date_range("3月", c(2026, 7, 20)).unwrap();
        assert_eq!(r.from.date, c(2026, 2, 1));
        assert_eq!(r.to.date, c(2026, 2, 31));
    }

    #[test]
    fn an_out_of_range_chinese_month_is_not_a_range() {
        assert!(parse_date_range("0月", c(2026, 7, 20)).is_none());
        assert!(parse_date_range("13月", c(2026, 7, 20)).is_none());
    }

    #[test]
    fn this_month_and_last_month_read_the_given_day() {
        let today = c(2026, 0, 15); // January
        let r = parse_date_range("本月", today).unwrap();
        assert_eq!((r.from.date, r.to.date), (c(2026, 0, 1), c(2026, 0, 31)));

        // last month crosses the year boundary
        let r = parse_date_range("上月", today).unwrap();
        assert_eq!((r.from.date, r.to.date), (c(2025, 11, 1), c(2025, 11, 31)));
    }

    #[test]
    fn the_week_runs_monday_to_sunday() {
        // 2026-08-20 is a Thursday: 3 Monday-first, 4 as `getDay() || 7`
        let today = c(2026, 7, 20);
        assert_eq!(today.weekday_monday_first(), 3);

        let r = parse_date_range("本周", today).unwrap();
        assert_eq!((r.from.date, r.to.date), (c(2026, 7, 17), c(2026, 7, 23)));

        let r = parse_date_range("上周", today).unwrap();
        assert_eq!((r.from.date, r.to.date), (c(2026, 7, 10), c(2026, 7, 16)));
    }

    #[test]
    fn a_sunday_belongs_to_the_week_that_is_ending() {
        // `now.getDay() || 7` turns Sunday into 7, so the week it closes is the
        // one that started six days earlier
        let sunday = c(2026, 7, 23);
        assert_eq!(sunday.weekday_monday_first(), 6); // 7 as `getDay() || 7`
        let r = parse_date_range("本周", sunday).unwrap();
        assert_eq!((r.from.date, r.to.date), (c(2026, 7, 17), c(2026, 7, 23)));
    }

    #[test]
    fn today_and_yesterday_cross_a_month_boundary() {
        let r = parse_date_range("今天", c(2026, 8, 1)).unwrap();
        assert_eq!(r.from.date, c(2026, 8, 1));
        let r = parse_date_range("昨天", c(2026, 8, 1)).unwrap();
        assert_eq!(r.from.date, c(2026, 7, 31));
    }

    #[test]
    fn english_relative_words_mean_the_same_thing() {
        let today = c(2026, 7, 20);
        for (zh, en) in [
            ("本月", "this month"),
            ("上月", "last month"),
            ("本周", "this week"),
            ("上周", "last week"),
            ("今天", "today"),
            ("昨天", "yesterday"),
        ] {
            assert_eq!(
                parse_date_range(zh, today),
                parse_date_range(en, today),
                "{zh} vs {en}"
            );
        }
    }

    #[test]
    fn anything_else_is_not_a_range() {
        for q in [
            "",
            "肯德基",
            "2024",
            "24-01",
            "2024-1",
            "2024-13-40x",
            "next week",
        ] {
            assert!(parse_date_range(q, c(2026, 0, 1)).is_none(), "{q}");
        }
    }

    #[test]
    fn the_chinese_direction_keywords_match() {
        let today = c(2026, 0, 1);
        let r = parse_search_query("买菜 支出", today);
        assert_eq!(r.filter.io, Some(Io::Exp));
        assert_eq!(r.text, "买菜");

        assert_eq!(
            parse_search_query("收入 工资", today).filter.io,
            Some(Io::Inc)
        );
        assert_eq!(
            parse_search_query("转账 给妈妈", today).filter.io,
            Some(Io::Xfer)
        );
    }

    #[test]
    fn the_word_boundary_still_guards_the_ascii_words() {
        let today = c(2026, 0, 1);
        assert_eq!(parse_search_query("inexpensive", today).filter.io, None);
        assert_eq!(parse_search_query("transferred", today).filter.io, None);
        assert_eq!(
            parse_search_query("EXPENSE", today).filter.io,
            Some(Io::Exp)
        );
    }

    #[test]
    fn a_query_that_is_entirely_a_date_leaves_no_text() {
        let r = parse_search_query("2024-01", c(2026, 0, 1));
        assert_eq!(r.text, "");
        assert!(r.range.is_some());
    }

    #[test]
    fn the_first_direction_that_strips_anything_wins() {
        let r = parse_search_query("支出 收入", c(2026, 0, 1));
        assert_eq!(r.filter.io, Some(Io::Exp));
    }
}
