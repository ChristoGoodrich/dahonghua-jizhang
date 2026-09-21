//! One account's history.
//!
//! The rows and the deltas are `core::acct`, checked against the TypeScript by
//! 5,400 parity cases. This turns them into shapes Dart can hold, and reads
//! the ledger out of the store so the screen does not have to pass it in.

use flutter_rust_bridge::frb;

use dahonghua_core::acct::acct_rows;

use crate::api::store::{store, EntryView};

/// An entry, and what it did to the balance of the account being viewed.
///
/// The delta is not derivable from the entry alone — the same transfer is
/// negative on one side and positive on the other, by different amounts. That
/// is the whole reason this carries a number rather than letting the screen
/// compute one.
#[derive(Debug, Clone)]
pub struct AcctRowView {
    pub entry: EntryView,
    pub delta: f64,
}

/// Every entry touching `id`, newest first. Tombstones excluded.
#[frb(sync)]
pub fn rows_for_account(id: String) -> Vec<AcctRowView> {
    let s = store();
    acct_rows(&id, s.ledger.all())
        .into_iter()
        .map(|r| AcctRowView {
            entry: EntryView::from(r.entry),
            delta: r.delta,
        })
        .collect()
}
