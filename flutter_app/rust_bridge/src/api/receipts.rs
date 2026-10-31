//! 小票 across the boundary: which receipt files can go.
//!
//! Listing the folders, reading the lists and deleting the files are Dart's.
//! Which files nothing can show or bring back is `dahonghua_core::receipts`,
//! and every rule about what still needs a receipt is written down there.

use dahonghua_core::receipts as core;
use flutter_rust_bridge::frb;

use super::store::store;

/// A sealed snapshot's list of receipts, as read off the disk.
#[derive(Debug, Clone)]
pub struct ReceiptList {
    /// The list's file name: `backup_123.enc.receipts`.
    pub name: String,
    pub text: String,
}

/// The receipts in `files` — the attachments folder, by name — that nothing
/// can show or bring back. `backups` is the backup folder's files, `lists`
/// the receipt lists found among them, and `in_use` the names the platform
/// has in hand that no row may name yet.
///
/// Not `sync`. It reads the whole ledger against a folder that only ever
/// grew, and it runs at launch, under the first frames.
pub fn sweep_receipts(
    files: Vec<String>,
    backups: Vec<String>,
    lists: Vec<ReceiptList>,
    in_use: Vec<String>,
    now: i64,
) -> Vec<String> {
    let lists: Vec<(String, String)> = lists.into_iter().map(|l| (l.name, l.text)).collect();
    let holds = core::Holds {
        backups: &backups,
        lists: &lists,
        in_use: &in_use,
    };
    core::sweep(&files, store().ledger.all(), now, &holds)
}

/// The receipts a snapshot taken now carries: every live row's, once each.
#[frb(sync)]
pub fn carried_receipts() -> Vec<String> {
    core::carried(store().ledger.all())
}

/// The list a sealed snapshot writes beside it.
#[frb(sync)]
pub fn receipt_list(names: Vec<String>) -> String {
    core::list_doc(&names)
}
