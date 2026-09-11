//! Finding entries: a search box that also understands dates and directions.
//!
//! Two calls, because a query can name a *range* and a range is not something
//! this side can resolve. `parse_query` splits "上周 支出 星巴克" into a civil
//! range, a direction, and the text that is left; Dart turns the civil range
//! into the epoch bounds that `search_ids` compares against, because midnight
//! last Monday is a question about the device's zone.
//!
//! Neither the matching nor the parsing is written here — `search::matches`
//! and `filter::parse_search_query` are ported and under corpora of their own.
//! This is the shape conversion and the id list.

use flutter_rust_bridge::frb;

use dahonghua_core::civil::Civil;
use dahonghua_core::entry::Io;
use dahonghua_core::filter::{matches_filter, parse_search_query, FilterState};
use dahonghua_core::search::matches_search;

use super::store::{by_id, store};

fn parse_day(s: &str) -> Civil {
    let mut it = s.split('-');
    let y = it.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    Civil::new(y, m - 1, d)
}

/// A wall-clock instant the platform has yet to place. `mo` is 1-based,
/// matching `DateTime`, not the core's 0-based month.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WallTime {
    pub y: i32,
    pub mo: i32,
    pub d: i32,
    pub h: u32,
    pub mi: u32,
    pub s: u32,
}

/// What a search box turned out to mean.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedQueryView {
    /// What is left to match as free text. Empty when the whole box was a date:
    /// the range *was* the query, so there is nothing left to match by name.
    pub text: String,
    /// `exp` or `inc` when the query named a direction.
    pub io: Option<String>,
    pub from: Option<WallTime>,
    pub to: Option<WallTime>,
}

/// Split a search box into a date range, a direction, and the rest.
///
/// `today` is `y-m-d` in the device's own calendar — "上周" means the week the
/// phone thinks it is in.
#[frb(sync)]
pub fn parse_query(query: String, today: String) -> ParsedQueryView {
    let p = parse_search_query(&query, parse_day(&today));
    let wall = |t: dahonghua_core::bills::CivilTime| WallTime {
        y: t.date.y,
        mo: t.date.m + 1,
        d: t.date.d,
        h: t.h,
        mi: t.mi,
        s: t.s,
    };
    ParsedQueryView {
        text: p.text,
        io: p.filter.io.map(|io| io.as_str().to_string()),
        from: p.range.map(|r| wall(r.from)),
        to: p.range.map(|r| wall(r.to)),
    }
}

/// Which of `ids` match, in the order given.
///
/// The order is the caller's, not a ranking: this is a filter over the list
/// already on screen, so the rows that survive keep the position they had.
///
/// `zh` decides which language's category names the free text is matched
/// against — searching "food" in an English build should find 餐饮.
#[frb(sync)]
#[allow(clippy::too_many_arguments)]
pub fn search_ids(
    ids: Vec<String>,
    text: String,
    io: Option<String>,
    cat: Option<String>,
    acct: Option<String>,
    from_ms: Option<i64>,
    to_ms: Option<i64>,
    zh: bool,
) -> Vec<String> {
    let filter = FilterState {
        io: io.as_deref().and_then(Io::parse),
        cat,
        acct,
        date_from: from_ms,
        date_to: to_ms,
    };
    let s = store();
    let by = by_id(&s);
    ids.into_iter()
        .filter(|id| {
            let Some(e) = by.get(id.as_str()).copied() else {
                return false;
            };
            // No custom categories: this port has no editor for them yet, and
            // the core already prefers a custom name over a built-in one.
            matches_filter(e, &filter) && matches_search(e, &text, &[], zh)
        })
        .collect()
}
