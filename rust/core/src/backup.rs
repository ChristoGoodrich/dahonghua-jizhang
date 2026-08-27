//! Local backups: what a snapshot is called, and which ones to keep.
//!
//! Ported from `src/util/backup.ts`. Small, and worth porting anyway because
//! two of its four rules are the kind a second implementation gets subtly
//! wrong:
//!
//! * **`.enc.json` also ends with `.json`.** The filter accepts either suffix
//!   and the parse strips the longer one *first*; checking the shorter one
//!   first turns `backup_123.enc.json` into a plain backup named
//!   `backup_123.enc`, whose timestamp then parses as `NaN`.
//! * **Pruning keeps the NEWEST**, which only works because the list was sorted
//!   descending first. `slice(keep)` on an unsorted list deletes whichever
//!   happened to come back from the directory last.
//!
//! Encryption is deliberately not here. It is AES-256-GCM over a PBKDF2 key,
//! which would cost this crate three dependencies against the one it has, and
//! a cipher is not a decision the ledger needs to own. The name says whether a
//! file is encrypted; what that means is the platform's.

/// What a backup taken at `ts` is called.
///
/// `f64` and not an integer, because the TypeScript takes a JS number and
/// interpolates it — `backup_${ts}` — so it spells `12.5` and `1e+21` the way
/// `String(n)` does. The app only ever passes `Date.now()`, but a signature
/// that quietly truncated would be a difference hidden rather than removed.
pub fn backup_name(ts: f64, encrypted: bool) -> String {
    let ext = if encrypted { ".enc.json" } else { ".json" };
    format!("backup_{}{ext}", crate::num::js_num(ts))
}

/// One backup, as read back off the directory listing.
#[derive(Debug, Clone, PartialEq)]
pub struct BackupInfo {
    pub name: String,
    /// Epoch milliseconds, through [`crate::num::js_number`] — which is
    /// `Number(s)` and not an integer parse. Three of its answers matter here:
    /// an EMPTY remainder is **zero**, not unorderable; `12.5` and `1e+21`
    /// parse; and anything else is `NaN`, which sorts last rather than
    /// pretending to be a time.
    pub time: f64,
    pub encrypted: bool,
}

/// Read a filename. `None` for anything that is not a backup.
///
/// The suffix order matters: `.enc.json` is stripped before `.json`, because a
/// name ending in the former ends in the latter too.
pub fn parse_backup_name(name: &str) -> Option<BackupInfo> {
    if !name.starts_with("backup_") {
        return None;
    }
    let (stripped, encrypted) = match name.strip_suffix(".enc.json") {
        Some(s) => (s, true),
        None => (name.strip_suffix(".json")?, false),
    };
    Some(BackupInfo {
        name: name.to_string(),
        // `Number(stripped.replace('backup_', ''))`, and the whole point of
        // `js_number` is that this is not an integer parse.
        time: crate::num::js_number(&stripped["backup_".len()..]),
        encrypted,
    })
}

/// Every backup in a directory listing, newest first.
///
/// Names whose time is `NaN` sort **last**, in listing order.
///
/// `(a, b) => b.time - a.time` is not a total order once a time is `NaN`: the
/// comparator returns `NaN` and ECMA-262 leaves the result
/// implementation-defined from there, so a stray `backup_draft.json` made the
/// sort — and therefore the prune — arbitrary. The same failure
/// `domain/order.ts` fixed for amounts, and the same fix, applied to the
/// TypeScript alongside this port: rank the unorderable value explicitly, at
/// the end, where pruning reaches it only after every real backup is safe.
pub fn list_backups(names: &[String]) -> Vec<BackupInfo> {
    let mut out: Vec<BackupInfo> = names.iter().filter_map(|n| parse_backup_name(n)).collect();
    out.sort_by(|a, b| match (a.time.is_nan(), b.time.is_nan()) {
        (true, true) => std::cmp::Ordering::Equal,
        (true, false) => std::cmp::Ordering::Greater,
        (false, true) => std::cmp::Ordering::Less,
        _ => b
            .time
            .partial_cmp(&a.time)
            .unwrap_or(std::cmp::Ordering::Equal),
    });
    out
}

/// Which backups to delete so that `keep` remain.
///
/// The list must already be newest-first — see [`list_backups`]. Returns the
/// excess in listing order; an empty result when there is nothing to prune.
pub fn prune(list: &[BackupInfo], keep: usize) -> Vec<&BackupInfo> {
    if list.len() <= keep {
        return Vec::new();
    }
    list[keep..].iter().collect()
}

/// How many snapshots are kept by default.
pub const MAX_BACKUPS: usize = 10;

/// The version stamped into a backup document.
///
/// Eight, and not the file format's own `version: 1` — `buildBackup` writes the
/// *app's* schema version, which is what an importer needs to know. The two
/// numbers live in different documents and mean different things.
pub const BACKUP_APP_VERSION: i64 = 8;

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_name_carries_its_time_and_whether_it_is_encrypted() {
        assert_eq!(backup_name(1700.0, false), "backup_1700.json");
        assert_eq!(backup_name(1700.0, true), "backup_1700.enc.json");
        // spelled as `String(n)` does, which is where the two sides could
        // otherwise disagree without either being obviously wrong
        assert_eq!(backup_name(12.5, false), "backup_12.5.json");
        assert_eq!(backup_name(1e21, false), "backup_1e+21.json");
    }

    #[test]
    fn an_encrypted_name_is_not_read_as_a_plain_one() {
        // `.enc.json` ends with `.json`, so stripping the shorter suffix first
        // would leave `backup_1700.enc` and a time of NaN
        let b = parse_backup_name("backup_1700.enc.json").unwrap();
        assert!(b.encrypted);
        assert_eq!(b.time, 1700.0);
    }

    #[test]
    fn a_round_trip_holds_both_ways() {
        for (ts, enc) in [(1.0f64, false), (1_700_000_000_000.0, true), (12.5, false)] {
            let b = parse_backup_name(&backup_name(ts, enc)).unwrap();
            assert_eq!(b.time, ts);
            assert_eq!(b.encrypted, enc);
        }
    }

    #[test]
    fn anything_that_is_not_a_backup_is_refused() {
        assert!(parse_backup_name("entries.json").is_none());
        assert!(parse_backup_name("backup_1700.txt").is_none());
        assert!(parse_backup_name("backup_1700").is_none());
        assert!(parse_backup_name("prefix_backup_1700.json").is_none());
    }

    #[test]
    fn an_empty_remainder_is_zero_and_a_word_is_not_a_number() {
        // `Number('')` is 0, which is the JavaScript fact this got wrong first
        // time: an empty name is the OLDEST backup, not an unorderable one
        assert_eq!(parse_backup_name("backup_.json").unwrap().time, 0.0);
        assert!(parse_backup_name("backup_draft.json")
            .unwrap()
            .time
            .is_nan());
    }

    #[test]
    fn a_fractional_or_exponential_name_still_parses() {
        assert_eq!(parse_backup_name("backup_12.5.json").unwrap().time, 12.5);
        assert_eq!(parse_backup_name("backup_1e+21.json").unwrap().time, 1e21);
    }

    #[test]
    fn the_listing_is_newest_first() {
        let l = list_backups(&names(&[
            "backup_100.json",
            "backup_300.json",
            "other.txt",
            "backup_200.enc.json",
        ]));
        assert_eq!(
            l.iter().map(|b| b.time).collect::<Vec<_>>(),
            [300.0, 200.0, 100.0]
        );
    }

    #[test]
    fn an_unorderable_backup_sorts_last_and_is_never_pruned_first() {
        let l = list_backups(&names(&[
            "backup_draft.json",
            "backup_100.json",
            "backup_300.json",
        ]));
        assert!(l.last().unwrap().time.is_nan());
        // keeping two drops the unorderable one, not the older real one
        let gone = prune(&l, 2);
        assert_eq!(gone.len(), 1);
        assert!(gone[0].time.is_nan());
    }

    #[test]
    fn pruning_keeps_the_newest() {
        let l = list_backups(&names(&[
            "backup_100.json",
            "backup_200.json",
            "backup_300.json",
        ]));
        let gone = prune(&l, 2);
        assert_eq!(gone.iter().map(|b| b.time).collect::<Vec<_>>(), [100.0]);
    }

    #[test]
    fn pruning_a_short_list_deletes_nothing() {
        let l = list_backups(&names(&["backup_100.json"]));
        assert!(prune(&l, 10).is_empty());
        assert!(prune(&l, 1).is_empty());
    }

    #[test]
    fn keeping_none_deletes_everything() {
        let l = list_backups(&names(&["backup_100.json", "backup_200.json"]));
        assert_eq!(prune(&l, 0).len(), 2);
    }
}
