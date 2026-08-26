//! Reimbursement claims and refunds across the boundary.
//!
//! Every write here goes through the ledger's stamping, and the reason is worth
//! repeating from the TypeScript: writing `rb`/`rbAmt`/`refund` without a
//! per-field time left them to the merge's content tiebreak, so marking an
//! expense 已报销 on one device could be silently reverted to 待报销 by a staler
//! one. **Clearing is a stamped write for the same reason** — it has to beat a
//! device still holding `pending`.
//!
//! Two behaviours the screen must not re-derive:
//!
//! * Toggling only clears when the claim is **pending**. A settled one re-opens
//!   rather than disappearing, because the TypeScript tests `rb === 'pending'`
//!   and not `rb != null`.
//! * A refund logs a second row — a linked income — pushed **raw** rather than
//!   through `add_entry`. It therefore carries `updatedAt` but no `fieldTs`,
//!   and it does not move the current account. Routing it through `add` would
//!   have been tidier and would have changed behaviour on both counts.

use dahonghua_core::catalog;
use dahonghua_core::entry::{Io, Reimburse};
use dahonghua_core::reimburse as core;
use flutter_rust_bridge::frb;

use super::store::store;

/// One claim, as the screen draws it.
#[derive(Debug, Clone, PartialEq)]
pub struct ClaimView {
    pub id: String,
    /// `pending` | `done`.
    pub state: String,
    pub cat: String,
    pub name: String,
    pub emoji: String,
    /// `#RRGGBB`.
    pub color: String,
    pub note: String,
    pub amt: f64,
    /// What was actually reimbursed. Falls back to the amount for a settled
    /// claim that predates the field.
    pub rb_amt: f64,
    pub ts: i64,
}

/// Everything the screen needs, in one pass over the ledger.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ClaimList {
    /// Newest first, pending and settled together — the shipping screen sorts
    /// by date rather than grouping by state, so a claim does not jump when it
    /// is settled.
    pub items: Vec<ClaimView>,
    /// Outstanding: the sum of the pending amounts.
    pub pending_sum: f64,
    /// Settled: the sum of what came back, not of what was spent.
    pub done_sum: f64,
}

#[frb(sync)]
pub fn claims(zh: bool) -> ClaimList {
    let s = store();
    let mut out = ClaimList::default();
    for e in s.ledger.all() {
        if e.deleted_at.is_some_and(|v| v != 0) {
            continue;
        }
        let state = match e.rb {
            Some(Reimburse::Pending) => "pending",
            Some(Reimburse::Done) => "done",
            None => continue,
        };
        let rb_amt = e.rb_amt.unwrap_or(e.amt);
        if state == "pending" {
            out.pending_sum += e.amt;
        } else {
            out.done_sum += rb_amt;
        }
        let c = catalog::cat_of(e.io.unwrap_or(Io::Exp), &e.cat, &[]);
        out.items.push(ClaimView {
            id: e.id.clone(),
            state: state.to_string(),
            cat: e.cat.clone(),
            name: catalog::cat_name(&c, zh),
            emoji: c.e.clone(),
            color: c.c.clone(),
            note: e.note.clone().unwrap_or_default(),
            amt: e.amt,
            rb_amt,
            ts: e.ts,
        });
    }
    // newest first, and stable so two rows sharing a timestamp keep their order
    out.items.sort_by_key(|c| std::cmp::Reverse(c.ts));
    out
}

/// Cycle the claim state: nothing → pending → (confirm) done → pending.
///
/// Only `pending` clears. A settled claim re-opens rather than disappearing.
#[frb(sync)]
pub fn toggle_reimburse(id: String, now: i64) -> bool {
    core::toggle_reimburse(&mut store().ledger, &id, now)
}

/// Settle a claim, recording what came back.
#[frb(sync)]
pub fn confirm_reimburse(id: String, now: i64) -> bool {
    core::confirm_reimburse(&mut store().ledger, &id, now)
}

/// Drop the claim entirely, state and amount together.
#[frb(sync)]
pub fn unmark_reimburse(id: String, now: i64) -> bool {
    core::unmark_reimburse(&mut store().ledger, &id, now)
}

/// Refund part or all of an expense. Returns how much was actually refunded.
///
/// Zero for an unknown id, for one already fully refunded, or for an amount
/// that is not positive — the cap is the core's, and a screen that clamped
/// first would be a second implementation of it.
#[frb(sync)]
pub fn refund_entry(id: String, amount: f64, zh: bool, new_id: String, now: i64) -> f64 {
    let mut s = store();
    let acct = s.current_account.clone();
    core::refund_entry(&mut s.ledger, &id, amount, zh, &[], &acct, new_id, now)
}

/// How much of an expense has already come back, and how much still could.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RefundState {
    pub refunded: f64,
    /// `amt - refunded`, never negative.
    pub remaining: f64,
}

#[frb(sync)]
pub fn refund_state(id: String) -> Option<RefundState> {
    let s = store();
    let e = s.ledger.get(&id)?;
    let refunded = e.refund.unwrap_or(0.0);
    Some(RefundState {
        refunded,
        remaining: (e.amt - refunded).max(0.0),
    })
}
