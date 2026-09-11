//! Bill import: bytes in, a preview out.
//!
//! Three core modules meet here. [`encoding`] decides whether the file is UTF-8
//! or GBK and decodes it, [`bills`] finds the header and reads the rows, and
//! [`dedup`] maps each row to a category and works out which ones the ledger
//! already has. The screen renders the result and, if the user accepts it,
//! calls `store::import_bills`.
//!
//! Two things stay on the platform, as everywhere else in this bridge:
//!
//! * **Which calendar day an existing entry falls on.** Dedup buckets by day,
//!   and a day is a question about the device's zone. Dart passes `days_of`
//!   alongside `ids`, in ledger order — the order decides which of several
//!   equal slots a row consumes.
//!
//! * **What instant a bill's wall-clock time is.** A candidate crosses carrying
//!   the six fields the CSV spelled out; Dart builds the `DateTime` and takes
//!   the epoch milliseconds from it. A row reading 02:30 on a spring-forward
//!   morning is a wall time that does not exist, and the platform is the only
//!   thing here entitled to an opinion about what it means.

use flutter_rust_bridge::frb;

use dahonghua_core::bills::{parse_bills, BillSource};
use dahonghua_core::civil::Civil;
use dahonghua_core::dedup::{existing_row, to_candidates, ExistingRow};
use dahonghua_core::encoding::decode_bill_text;
use dahonghua_core::num::round2;

use super::store::{by_id, store};

fn parse_day(s: &str) -> Civil {
    let mut it = s.split('-');
    let y = it.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    Civil::new(y, m - 1, d)
}

/// One row the import would add, or has recognised as already present.
#[derive(Debug, Clone, PartialEq)]
pub struct CandidateView {
    pub io: String,
    pub cat: String,
    pub amt: f64,
    pub note: String,
    /// The wall-clock time the file gave, for Dart to turn into an instant.
    /// `mo` is 1-based, matching `DateTime`, not the core's 0-based month.
    pub y: i32,
    pub mo: i32,
    pub d: i32,
    pub h: u32,
    pub mi: u32,
    pub s: u32,
    /// The ledger already holds this one.
    pub dup: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RowErrorView {
    /// 1-indexed line in the original file.
    pub row: u32,
    pub reason: String,
}

/// Everything the import screen shows before anything is written.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportPreview {
    /// `alipay`, `wechat` or `generic`.
    pub source: String,
    /// A header was found and at least one row came out of it. False means the
    /// file is not a bill export this app understands, and the screen says so
    /// rather than showing an empty list that looks like an empty file.
    pub ok: bool,
    /// Every candidate, duplicates included, in file order. The screen shows
    /// them all — a row the import will skip is information, not noise.
    pub candidates: Vec<CandidateView>,
    pub fresh_count: u32,
    pub dup_count: u32,
    /// Data rows below the header that could not be read at all.
    pub skipped: u32,
    pub errors: Vec<RowErrorView>,
    pub exp_count: u32,
    pub inc_count: u32,
    pub exp_sum: f64,
    pub inc_sum: f64,
}

/// Read a picked file and work out what importing it would do.
///
/// Nothing is written. `ids` and `days_of` are the live ledger in its own
/// order, so dedup sees the entries as they are at the moment of the pick
/// rather than as they were when the screen opened.
///
/// Custom categories are passed empty: this port has no custom-category
/// editor, so there are none to pass. When it gains one, they go here — the
/// core already takes them, and `map_category` prefers a custom keyword match
/// over a built-in one.
#[frb(sync)]
pub fn preview_bills(bytes: Vec<u8>, ids: Vec<String>, days_of: Vec<String>) -> ImportPreview {
    let text = decode_bill_text(&bytes);
    let parsed = parse_bills(&text);

    let existing: Vec<ExistingRow> = {
        let s = store();
        let by = by_id(&s);
        let n = ids.len().min(days_of.len());
        (0..n)
            .filter_map(|i| {
                let e = *by.get(ids[i].as_str())?;
                existing_row(e, parse_day(&days_of[i]))
            })
            .collect()
    };

    let candidates = to_candidates(&parsed.bills, &existing, &[], &[]);

    let mut fresh_count = 0_u32;
    let mut exp_count = 0_u32;
    let mut inc_count = 0_u32;
    let mut exp_sum = 0.0_f64;
    let mut inc_sum = 0.0_f64;
    for c in &candidates {
        if c.dup {
            continue;
        }
        fresh_count += 1;
        if c.io == dahonghua_core::entry::Io::Inc {
            inc_count += 1;
            inc_sum += c.amt;
        } else {
            exp_count += 1;
            exp_sum += c.amt;
        }
    }

    ImportPreview {
        source: match parsed.source {
            BillSource::Alipay => "alipay",
            BillSource::Wechat => "wechat",
            BillSource::Generic => "generic",
        }
        .to_string(),
        ok: parsed.header_row >= 0 && !candidates.is_empty(),
        candidates: candidates
            .iter()
            .map(|c| CandidateView {
                io: c.io.as_str().to_string(),
                cat: c.cat.clone(),
                amt: c.amt,
                note: c.note.clone(),
                y: c.at.date.y,
                mo: c.at.date.m + 1,
                d: c.at.date.d,
                h: c.at.h,
                mi: c.at.mi,
                s: c.at.s,
                dup: c.dup,
            })
            .collect(),
        fresh_count,
        dup_count: candidates.len() as u32 - fresh_count,
        skipped: parsed.skipped as u32,
        errors: parsed
            .errors
            .iter()
            .map(|e| RowErrorView {
                row: e.row as u32,
                reason: e.reason.clone(),
            })
            .collect(),
        exp_count,
        inc_count,
        // Summed then rounded, the way the shipping screen does it: rounding
        // each row first would drift from the total the rows add up to.
        exp_sum: round2(exp_sum),
        inc_sum: round2(inc_sum),
    }
}
