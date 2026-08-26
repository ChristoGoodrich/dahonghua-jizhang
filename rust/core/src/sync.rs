//! What `sync/` decides, with the network left on the platform.
//!
//! Three things live here, ported from three files that each had a few lines of
//! judgement buried in a lot of I/O:
//!
//! * **The push watermark and its backoff** (`sync/pushScheduler.ts`) — which
//!   rows are dirty, how far the watermark may advance, how long to wait after
//!   a failure. The timers and the HTTP stay outside; what is here is the
//!   arithmetic that decides whether a change reaches the cloud.
//! * **Per-section config adoption** (`sync/configMerge.ts`) — which parts of a
//!   remote config blob win, and whether the server is behind.
//! * **The conflict log's cap** (`sync/conflictLog.ts`) — newest first, bounded.
//!
//! `sync/auth.ts` and `sync/supabase.ts` are not represented, and not by
//! oversight: after the SDK calls are removed there is nothing left in either
//! but `email.trim()`, which is [`crate::jsstr::js_trim`] rather than
//! `str::trim` for the reason that module gives.

use crate::entry::Entry;
use crate::jsstr::js_str_cmp;
use std::cmp::Ordering;

// ---------- the push watermark ----------

/// Rows the server has not seen: `(e.updatedAt ?? 0) > watermark`.
///
/// Strictly greater, which is what makes the watermark a watermark — a row
/// whose stamp equals it has been pushed. It also means a row stamped in the
/// same millisecond as the newest row of a batch already in flight is not
/// picked up by the *next* flush. That is a real window and it is left as the
/// TypeScript has it: the next `pullAndMerge` sends the row anyway, because a
/// row the server does not have is in `to_push` regardless of any watermark.
pub fn dirty_since(entries: &[Entry], watermark: i64) -> Vec<&Entry> {
    dirty_since_by(
        entries,
        |e| e.updated_at.unwrap_or(0) as f64,
        watermark as f64,
    )
}

/// [`dirty_since`] at the type the rows are actually held in.
///
/// The TypeScript is `dirtySince<T>(items, stamp, watermark)` — generic, with
/// the stamp injected, precisely so the filter and the advance cannot come
/// apart. The port specialised it to `Entry` and then needed it for the
/// `Value` rows [`crate::merge`] works in, which is how a rule ends up written
/// twice. This is the one implementation; the `Entry` pair are wrappers.
pub fn dirty_since_by<T>(items: &[T], stamp: impl Fn(&T) -> f64, watermark: f64) -> Vec<&T> {
    items.iter().filter(|e| stamp(e) > watermark).collect()
}

/// How far the watermark may move after a batch is persisted.
///
/// `dirty.reduce((m, e) => Math.max(m, stamp(e)), watermark)` — seeded with the
/// current watermark, so it never moves backwards, and past **only** what was
/// actually written. A watermark that advanced on intent rather than on
/// success would drop every change in a failed batch silently.
pub fn advance(watermark: i64, pushed: &[&Entry]) -> i64 {
    advance_by(watermark as f64, pushed, |e| {
        e.updated_at.unwrap_or(0) as f64
    }) as i64
}

/// [`advance`] at the type the rows are actually held in. See [`dirty_since_by`].
///
/// `Math.max`, not `f64::max`: a `NaN` stamp poisons the watermark rather than
/// being quietly skipped, which is the louder of the two failures and the one
/// that matches the shipping app.
pub fn advance_by<T>(watermark: f64, pushed: &[&T], stamp: impl Fn(&T) -> f64) -> f64 {
    pushed
        .iter()
        .fold(watermark, |m, e| crate::num::js_max(m, stamp(e)))
}

/// `Math.max(watermark, v)` — raise the watermark after a pull or an echo.
pub fn bump(watermark: i64, v: i64) -> i64 {
    bump_by(watermark as f64, v as f64) as i64
}

/// [`bump`] at the type the rows are actually held in. See [`dirty_since_by`].
pub fn bump_by(watermark: f64, v: f64) -> f64 {
    crate::num::js_max(watermark, v)
}

/// The next backoff delay: `Math.min(d ? d * 2 : base, max)`.
///
/// Doubling from `base`, capped. A zero means "not currently backing off", so
/// the first failure after a success waits `base` rather than nothing.
pub fn next_delay(current: i64, base: i64, max: i64) -> i64 {
    let next = if current != 0 {
        current.saturating_mul(2)
    } else {
        base
    };
    next.min(max)
}

/// The scheduler's defaults, from `PushSchedulerConfig`.
pub const DEBOUNCE_MS: i64 = 800;
pub const RETRY_BASE_MS: i64 = 2_000;
pub const RETRY_MAX_MS: i64 = 60_000;

// ---------- per-section config ----------

/// The independent domains inside the one config row, in the order
/// `configMerge.ts` lists them — which is the order sections are considered,
/// and therefore the order `take` comes back in.
pub const CONFIG_SECTIONS: [&str; 13] = [
    "lang",
    "settings",
    "customCats",
    "accounts",
    "assets",
    "loans",
    "subs",
    "templates",
    "tags",
    "curLedger",
    "currencies",
    "subcats",
    "curAccount",
];

/// Per-section last-edit times. Insertion-ordered like the JavaScript object it
/// mirrors, because [`crate::jsval::stable`] sorts and nothing else here reads
/// the order.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Stamps(Vec<(String, i64)>);

impl Stamps {
    pub fn new() -> Stamps {
        Stamps(Vec::new())
    }

    pub fn get(&self, k: &str) -> Option<i64> {
        self.0.iter().find(|(x, _)| x == k).map(|(_, v)| *v)
    }

    pub fn set(&mut self, k: &str, v: i64) {
        match self.0.iter_mut().find(|(x, _)| x == k) {
            Some((_, slot)) => *slot = v,
            None => self.0.push((k.to_string(), v)),
        }
    }

    pub fn entries(&self) -> &[(String, i64)] {
        &self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl FromIterator<(String, i64)> for Stamps {
    fn from_iter<T: IntoIterator<Item = (String, i64)>>(iter: T) -> Stamps {
        let mut s = Stamps::new();
        for (k, v) in iter {
            s.set(&k, v);
        }
        s
    }
}

/// What a remote blob's sections are worth against what this device last
/// edited.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Adoption {
    /// Sections whose remote copy wins and should be written to the store.
    pub take: Vec<String>,
    /// The local stamps afterwards. Adopting takes the remote stamp too, so
    /// later comparisons stay stable across devices.
    pub stamps: Stamps,
}

/// Which sections of a remote blob to adopt.
///
/// `present` answers whether the blob actually carries a section — nullish
/// rather than truthy, see `configMerge.ts` for why that distinction cost a
/// special case.
///
/// The two defaults are not symmetric and both matter. A section this device
/// has never edited reads as `0`; a section the *blob* has no stamp for reads
/// as `1`. So a legacy blob carrying no stamps at all still wins on a fresh
/// device (1 > 0) and loses to any real edit (a `Date.now()` is enormous).
pub fn adopt_sections(
    local: &Stamps,
    remote: Option<&Stamps>,
    present: impl Fn(&str) -> bool,
) -> Adoption {
    let mut stamps = local.clone();
    let mut take = Vec::new();
    for k in CONFIG_SECTIONS {
        if !present(k) {
            continue;
        }
        let r = remote.and_then(|m| m.get(k)).unwrap_or(1);
        if r <= stamps.get(k).unwrap_or(0) {
            continue;
        }
        stamps.set(k, r);
        take.push(k.to_string());
    }
    Adoption { take, stamps }
}

/// True when some locally-stamped section is newer than the blob's stamp for
/// it — the server copy is missing local edits and needs a push.
///
/// Runs immediately after [`adopt_sections`] in the realtime handler. A section
/// that was just adopted can never come back true here, or two devices would
/// trade one blob forever, each undoing the other.
pub fn local_newer_than(local: &Stamps, remote: Option<&Stamps>) -> bool {
    CONFIG_SECTIONS
        .iter()
        .any(|k| local.get(k).unwrap_or(0) > remote.and_then(|m| m.get(k)).unwrap_or(1))
}

// ---------- the conflict log ----------

/// How many resolutions the log keeps.
pub const MAX_CONFLICT_ENTRIES: usize = 100;

#[derive(Debug, Clone, PartialEq)]
pub struct LoggedConflict {
    pub entry_id: String,
    pub local_updated_at: i64,
    pub remote_updated_at: i64,
    /// `'local' | 'remote' | 'merged'`.
    pub resolution: String,
    pub timestamp: i64,
}

/// `cachedLog.unshift(entry)` then a cap — newest first, oldest dropped.
///
/// The cap is applied *after* the insert, so a full log still accepts a new
/// entry and drops its oldest rather than refusing the new one.
pub fn log_conflict(log: &[LoggedConflict], entry: LoggedConflict) -> Vec<LoggedConflict> {
    let mut out = Vec::with_capacity((log.len() + 1).min(MAX_CONFLICT_ENTRIES));
    out.push(entry);
    out.extend(log.iter().take(MAX_CONFLICT_ENTRIES - 1).cloned());
    out
}

// ---------- sign-in ----------

/// `email.trim()` before it reaches the auth call.
///
/// The only decision left in `sync/auth.ts` once the SDK is removed, and it is
/// not `str::trim`: a mail address pasted out of a file very often carries a
/// BOM, which JavaScript trims and Rust does not. Sorting it out here rather
/// than at nine call sites is why [`crate::jsstr`] exists.
pub fn normalize_credential(s: &str) -> &str {
    crate::jsstr::js_trim(s)
}

/// Order two section names the way JavaScript orders strings. Exposed because
/// the config blob's own key order is compared when devices disagree.
pub fn section_cmp(a: &str, b: &str) -> Ordering {
    js_str_cmp(a, b)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(id: &str, updated: Option<i64>) -> Entry {
        Entry {
            id: id.to_string(),
            updated_at: updated,
            ..Default::default()
        }
    }

    fn stamps(pairs: &[(&str, i64)]) -> Stamps {
        pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    fn all(_: &str) -> bool {
        true
    }

    // ---------- the watermark ----------

    #[test]
    fn dirty_is_strictly_newer_than_the_watermark() {
        let rows = [e("a", Some(5)), e("b", Some(10)), e("c", Some(11))];
        let d = dirty_since(&rows, 10);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].id, "c");
    }

    #[test]
    fn a_row_that_was_never_stamped_is_never_dirty() {
        // `e.updatedAt ?? 0` against a watermark that starts at 0. The pull
        // sends it instead: a row the server lacks is pushed whatever the
        // watermark says.
        let rows = [e("a", None)];
        assert!(dirty_since(&rows, 0).is_empty());
    }

    #[test]
    fn the_watermark_advances_only_past_what_was_written() {
        let rows = [e("a", Some(5)), e("b", Some(10))];
        let pushed: Vec<&Entry> = rows.iter().collect();
        assert_eq!(advance(0, &pushed), 10);
        // and never backwards
        assert_eq!(advance(99, &pushed), 99);
        assert_eq!(advance(7, &[]), 7);
    }

    #[test]
    fn bumping_never_lowers_the_watermark() {
        assert_eq!(bump(10, 5), 10);
        assert_eq!(bump(10, 50), 50);
    }

    #[test]
    fn the_backoff_doubles_from_base_and_stops_at_the_ceiling() {
        let mut d = 0;
        let mut seen = Vec::new();
        for _ in 0..8 {
            d = next_delay(d, RETRY_BASE_MS, RETRY_MAX_MS);
            seen.push(d);
        }
        assert_eq!(
            seen,
            vec![2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]
        );
    }

    #[test]
    fn a_success_resets_the_backoff_to_base() {
        let d = next_delay(32_000, RETRY_BASE_MS, RETRY_MAX_MS);
        assert_eq!(d, 60_000);
        assert_eq!(next_delay(0, RETRY_BASE_MS, RETRY_MAX_MS), 2_000);
    }

    #[test]
    fn the_backoff_cannot_overflow_its_way_below_the_ceiling() {
        assert_eq!(next_delay(i64::MAX, RETRY_BASE_MS, RETRY_MAX_MS), 60_000);
    }

    // ---------- config sections ----------

    #[test]
    fn a_remotely_newer_section_is_adopted_and_a_locally_newer_one_is_not() {
        let local = stamps(&[("accounts", 100), ("tags", 900)]);
        let remote = stamps(&[("accounts", 500), ("tags", 500)]);
        let a = adopt_sections(&local, Some(&remote), |k| k == "accounts" || k == "tags");
        assert_eq!(a.take, vec!["accounts"]);
        assert_eq!(a.stamps.get("accounts"), Some(500)); // the stamp comes too
        assert_eq!(a.stamps.get("tags"), Some(900));
    }

    #[test]
    fn a_section_the_blob_does_not_carry_is_left_entirely_alone() {
        let a = adopt_sections(&Stamps::new(), Some(&stamps(&[("accounts", 500)])), |k| {
            k == "tags"
        });
        assert_eq!(a.take, vec!["tags"]);
        assert_eq!(a.stamps.get("accounts"), None); // not stamped, not taken
    }

    #[test]
    fn a_fresh_device_adopts_a_legacy_blob_with_no_stamps_at_all() {
        let a = adopt_sections(&Stamps::new(), None, all);
        assert_eq!(a.take.len(), CONFIG_SECTIONS.len());
        assert_eq!(a.stamps.get("accounts"), Some(1)); // barely newer than never
    }

    #[test]
    fn any_real_local_edit_beats_a_legacy_blob() {
        let a = adopt_sections(&stamps(&[("accounts", 1_700_000_000_000)]), None, all);
        assert!(!a.take.iter().any(|k| k == "accounts"));
    }

    #[test]
    fn an_equal_stamp_is_a_stalemate_in_both_directions() {
        let local = stamps(&[("accounts", 500)]);
        let remote = stamps(&[("accounts", 500)]);
        let a = adopt_sections(&local, Some(&remote), |k| k == "accounts");
        assert!(a.take.is_empty());
        assert!(!local_newer_than(&a.stamps, Some(&remote)));
    }

    #[test]
    fn a_section_just_adopted_is_never_pushed_straight_back() {
        // otherwise two devices trade one blob forever, each undoing the other
        for (l, r) in [(0, 0), (0, 5), (5, 0), (5, 5), (1, 1)] {
            let local = if l == 0 {
                Stamps::new()
            } else {
                stamps(&[("tags", l)])
            };
            let remote = if r == 0 {
                Stamps::new()
            } else {
                stamps(&[("tags", r)])
            };
            let a = adopt_sections(&local, Some(&remote), |k| k == "tags");
            if a.take.iter().any(|k| k == "tags") {
                assert!(!local_newer_than(&a.stamps, Some(&remote)), "{l} vs {r}");
            }
        }
    }

    #[test]
    fn a_blob_with_no_stamp_for_a_section_this_device_edited_needs_a_push() {
        let a = adopt_sections(&stamps(&[("tags", 5)]), Some(&Stamps::new()), |k| {
            k == "tags"
        });
        assert!(a.take.is_empty());
        assert!(local_newer_than(&a.stamps, Some(&Stamps::new())));
    }

    #[test]
    fn a_never_edited_device_does_not_push_over_a_legacy_blob() {
        // 0 > 1 is false, which is the whole reason the remote default is 1
        assert!(!local_newer_than(&Stamps::new(), None));
        assert!(local_newer_than(&stamps(&[("subs", 2)]), None));
    }

    #[test]
    fn a_stamp_outside_the_known_sections_is_not_consulted() {
        // the blob may carry stamps this build has never heard of; only the
        // thirteen sections it knows how to apply are compared
        assert!(!local_newer_than(&stamps(&[("somethingNew", 9_999)]), None));
    }

    // ---------- the conflict log ----------

    fn conflict(id: &str) -> LoggedConflict {
        LoggedConflict {
            entry_id: id.to_string(),
            local_updated_at: 1,
            remote_updated_at: 2,
            resolution: "remote".to_string(),
            timestamp: 3,
        }
    }

    #[test]
    fn the_newest_conflict_is_first() {
        let log = log_conflict(&[], conflict("a"));
        let log = log_conflict(&log, conflict("b"));
        assert_eq!(
            log.iter().map(|c| c.entry_id.as_str()).collect::<Vec<_>>(),
            vec!["b", "a"]
        );
    }

    #[test]
    fn a_full_log_accepts_the_new_entry_and_drops_the_oldest() {
        let mut log: Vec<LoggedConflict> = Vec::new();
        for i in 0..MAX_CONFLICT_ENTRIES + 20 {
            log = log_conflict(&log, conflict(&format!("c{i}")));
        }
        assert_eq!(log.len(), MAX_CONFLICT_ENTRIES);
        assert_eq!(log[0].entry_id, "c119");
        assert_eq!(log[MAX_CONFLICT_ENTRIES - 1].entry_id, "c20");
    }

    // ---------- sign-in ----------

    #[test]
    fn a_pasted_address_loses_its_bom() {
        assert_eq!(normalize_credential("\u{feff} a@b.com \n"), "a@b.com");
        // and keeps the one character Rust would have taken
        assert_eq!(normalize_credential("\u{85}a@b.com"), "\u{85}a@b.com");
    }
}
