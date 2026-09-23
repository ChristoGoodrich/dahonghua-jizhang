//! 隐藏金额 — the eye on the summary card.
//!
//! The shipping app kept this in its settings as `hideAmounts` and the card,
//! 资产 and 账户 all read it: a person opening their ledger on a train can
//! shut the totals without shutting the app. A device setting, like the theme
//! — it goes into the config under the same key, and does not travel in 同步.

use std::sync::atomic::{AtomicBool, Ordering};

use flutter_rust_bridge::frb;

static HIDE: AtomicBool = AtomicBool::new(false);

/// Whether the totals are hidden.
#[frb(sync)]
pub fn hide_amounts() -> bool {
    HIDE.load(Ordering::Relaxed)
}

/// Hide or show the totals. The save notices on its own — see
/// `db::flush_store` — so there is nothing to mark.
#[frb(sync)]
pub fn set_hide_amounts(hidden: bool) {
    HIDE.store(hidden, Ordering::Relaxed);
}
