//! Two things the ledger already knows about itself.
//!
//! The consecutive-day streak, and the notes a category is usually given. Both
//! are ported and both were sitting unreached; neither has any state of its
//! own, which is why they fit in one module.
//!
//! The days are the platform's, as always — "consecutive" is a claim about
//! calendar days and a calendar day is a question about the device's zone.

use flutter_rust_bridge::frb;

use dahonghua_core::civil::Civil;
use dahonghua_core::entry::Io;
use dahonghua_core::notes::note_suggestions;
use dahonghua_core::streak::streak_days;

use super::store::store;

fn parse_day(s: &str) -> Civil {
    let mut it = s.split('-');
    let y = it.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    Civil::new(y, m - 1, d)
}

/// How many days in a row end today, counting back.
///
/// `days` is one `y-m-d` per entry, resolved by Dart. Duplicates and order do
/// not matter — the core folds them into a set of distinct days before
/// counting.
#[frb(sync)]
pub fn streak(days: Vec<String>, today: String) -> u32 {
    let civil: Vec<Civil> = days.iter().map(|d| parse_day(d)).collect();
    streak_days(&civil, parse_day(&today)) as u32
}

/// The notes this category is usually given, most-used first.
///
/// Offered rather than imposed: the record sheet shows these as chips, and a
/// user who wants something else types it. An empty list is the ordinary state
/// for a category used for the first time, not a failure.
#[frb(sync)]
pub fn note_hints(io: String, cat: String, limit: u32) -> Vec<String> {
    let Some(io) = Io::parse(&io) else {
        return Vec::new();
    };
    let s = store();
    note_suggestions(s.ledger.all(), io, &cat, limit as usize)
}
