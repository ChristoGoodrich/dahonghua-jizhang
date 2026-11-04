//! Getting the ledger out, as a CSV anything can read.
//!
//! Which rows appear, in what order, and what each column says are all
//! `export::to_rows`'s, under a corpus of its own. What crosses here is the
//! text; writing it to a file and handing it to another app is the platform's,
//! because a share sheet is not a decision.
//!
//! The days come from Dart, as they always do. The shipping app's export used
//! `toISOString().slice(0, 10)` — the **UTC** day — so in Sydney every entry
//! logged before ten in the morning exported with yesterday's date. The core
//! takes the local day instead, and that is the caller's to supply.
//!
//! XLSX is not here. `writeXlsx` is 210 lines of ZIP and XML with no decisions
//! in it, and the core carries exactly one dependency; a spreadsheet writer is
//! not what that budget is for. CSV opens in Excel — the BOM the core writes is
//! there so it does, without a code page being guessed at Chinese category
//! names.

use super::day::parse_day;
use flutter_rust_bridge::frb;

use dahonghua_core::entry::Io;
use dahonghua_core::export::{to_csv, CustomCats, ExportRow};

use super::catalog::custom_cats_of;
use super::store::{by_id, store};

/// The whole ledger as CSV **bytes**, oldest first.
///
/// Bytes and not a `String`, for a reason worth stating: Dart's `Utf8Decoder`
/// strips a leading BOM, so the U+FEFF the core writes cannot survive crossing
/// as a string — it would arrive silently gone and the file would open in
/// Excel as mojibake. An export is a file anyway, and a file is bytes.
///
/// `ids` and `days_of` are parallel: each entry's local calendar day, resolved
/// by Dart. Passing the ids rather than whole entries keeps this a projection
/// of state the store already owns.
///
/// Tombstones are dropped by the core: an export states what the ledger holds,
/// not what it has ever held.
#[frb(sync)]
pub fn export_csv(ids: Vec<String>, days_of: Vec<String>) -> Vec<u8> {
    // Taken before the store. A transfer has no categories of the user's own.
    let (exp, inc) = (custom_cats_of(Io::Exp), custom_cats_of(Io::Inc));
    let s = store();
    let by = by_id(&s);
    let n = ids.len().min(days_of.len());
    let rows: Vec<ExportRow> = (0..n)
        .filter_map(|i| {
            let e = *by.get(ids[i].as_str())?;
            Some(ExportRow {
                entry: e.clone(),
                day: parse_day(&days_of[i]),
            })
        })
        .collect();
    let accounts: Vec<(String, String)> = s
        .accounts
        .iter()
        .map(|a| (a.id.clone(), a.name.clone()))
        .collect();
    // The CSV names each row's category, and a custom one was written under
    // the fallback category's name.
    to_csv(
        &rows,
        &accounts,
        CustomCats {
            exp: &exp,
            inc: &inc,
            xfer: &[],
        },
    )
    .into_bytes()
}
