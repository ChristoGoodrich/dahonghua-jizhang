//! Subscriptions across the boundary.
//!
//! Recurring charges that post themselves when due. Two things here are worth
//! reading before the code:
//!
//! **The sweep is two calls, and it has to be.** Deciding *which dates* are due
//! is calendar arithmetic and belongs to the core; turning one of those dates
//! into the timestamp an entry carries needs a timezone, which is the
//! platform's. So `pending` answers with dates, Dart converts them, and
//! `commit` posts. `commit` recomputes the plan from the same inputs rather
//! than trusting anything held between the calls — two calls that must agree
//! are safer when neither remembers the other.
//!
//! **The charge id is derived, not random**, and the TypeScript's comment is
//! the reason: boot runs the sweep while the first cloud pull is still in
//! flight, so a second device charges from its own stale cursor before it
//! learns the first already did. With random ids both rows survive the merge
//! and the user is billed twice; with `sub_{id}_{ts}` they are the same row.

use dahonghua_core::civil::Civil;
use dahonghua_core::model::{Sub, SubFreq};
use dahonghua_core::subs;
use flutter_rust_bridge::frb;
use std::sync::{Mutex, MutexGuard, OnceLock};

use super::store::store;

pub(crate) fn subs_lock() -> MutexGuard<'static, Vec<Sub>> {
    static S: OnceLock<Mutex<Vec<Sub>>> = OnceLock::new();
    let m = S.get_or_init(|| Mutex::new(Vec::new()));
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub(crate) fn subs_of() -> Vec<Sub> {
    subs_lock().clone()
}

pub(crate) fn set_subs_inner(v: Vec<Sub>) {
    *subs_lock() = v;
}

/// One subscription, as Dart holds it.
#[derive(Debug, Clone, PartialEq)]
pub struct SubView {
    pub id: String,
    pub name: String,
    pub emoji: String,
    pub amt: f64,
    /// `monthly` | `yearly`.
    pub freq: String,
    /// Day of the month, 1..=28.
    pub day: u32,
    /// Charge month for a yearly sub, 1..=12.
    pub month: Option<u32>,
    pub cat: String,
    pub created: i64,
    /// `YYYY-M-D` with a **0-indexed** month, inherited from v7. Empty when the
    /// subscription has never fired.
    pub last_charged: String,
    /// A transfer posts between two accounts instead of an expense.
    pub is_transfer: bool,
    pub from: Option<String>,
    pub to: Option<String>,
    /// Total instalments, or none for an open-ended subscription.
    pub periods: Option<u32>,
    pub charged: u32,
}

impl From<&Sub> for SubView {
    fn from(s: &Sub) -> Self {
        SubView {
            id: s.id.clone(),
            name: s.name.clone(),
            emoji: s.emoji.clone(),
            amt: s.amt,
            freq: match s.freq {
                SubFreq::Yearly => "yearly".into(),
                SubFreq::Monthly => "monthly".into(),
            },
            day: s.day,
            month: s.month,
            cat: s.cat.clone(),
            created: s.created,
            last_charged: s.last_charged.clone().unwrap_or_default(),
            is_transfer: s.is_transfer == Some(true),
            from: s.from.clone(),
            to: s.to.clone(),
            periods: s.periods,
            charged: s.charged.unwrap_or(0),
        }
    }
}

#[frb(sync)]
pub fn subs() -> Vec<SubView> {
    subs_lock().iter().map(SubView::from).collect()
}

/// A subscription to create.
///
/// A struct rather than thirteen parameters, for the reason `NewTransfer` is
/// one: half of these are optional and several are the same type in adjacent
/// positions, which at a call site is an invitation to swap two of them.
#[derive(Debug, Clone)]
pub struct NewSub {
    pub name: String,
    pub amt: f64,
    /// `monthly` | `yearly`.
    pub freq: String,
    pub day: u32,
    pub month: Option<u32>,
    pub cat: String,
    pub emoji: String,
    /// Posts a transfer between `from` and `to` instead of an expense.
    pub is_transfer: bool,
    pub from: Option<String>,
    pub to: Option<String>,
    /// Total instalments. Absent or zero is open-ended.
    pub periods: Option<u32>,
}

/// Create a subscription. Returns its id.
///
/// `day` is clamped to 1..=28 and `month` to 1..=12, as the shipping form does:
/// a subscription billed on the 31st would skip February, and the picker never
/// offers one, but a restored file can say anything.
#[frb(sync)]
pub fn add_sub(sub: NewSub, id: String, now: i64) -> String {
    let NewSub {
        name,
        amt,
        freq,
        day,
        month,
        cat,
        emoji,
        is_transfer,
        from,
        to,
        periods,
    } = sub;
    let s = Sub {
        id: id.clone(),
        name,
        emoji,
        amt,
        freq: if freq == "yearly" {
            SubFreq::Yearly
        } else {
            SubFreq::Monthly
        },
        day: day.clamp(1, 28),
        month: month.map(|m| m.clamp(1, 12)),
        cat,
        created: now,
        // `lastCharged: ''` rather than absent — a fresh subscription has a
        // cursor at its creation date, and an empty string is what the
        // TypeScript writes there
        last_charged: Some(String::new()),
        is_transfer: is_transfer.then_some(true),
        from,
        to,
        // 360 is the shipping cap: thirty years of monthly instalments
        periods: periods.filter(|p| *p > 0).map(|p| p.min(360)),
        charged: None,
    };
    subs_lock().push(s);
    id
}

#[frb(sync)]
pub fn remove_sub(id: String) -> bool {
    let mut s = subs_lock();
    let before = s.len();
    s.retain(|x| x.id != id);
    s.len() != before
}

/// The next charge date at or after `from`, as `YYYY-M-D` with a 0-indexed
/// month — the same encoding the cursor uses.
///
/// A day past the end of a month **overflows** rather than clamping, because
/// `new Date(y, m, 31)` does: a subscription billed on the 31st charges on
/// 3 March in a non-leap year, not on the 28th of February.
#[frb(sync)]
pub fn sub_next_due(id: String, from: String) -> Option<String> {
    let s = subs_lock();
    let sub = s.iter().find(|x| x.id == id)?;
    Some(subs::encode(subs::next_due_date(sub, parse_day(&from)?)))
}

/// `YYYY-M-D` with a 0-indexed month, as the cursor is written.
fn parse_day(s: &str) -> Option<Civil> {
    let mut it = s.split('-');
    let y = it.next()?.parse().ok()?;
    let m = it.next()?.parse().ok()?;
    let d = it.next()?.parse().ok()?;
    Some(Civil::new(y, m, d))
}

/// Every date that would be charged, and every cursor that would move.
///
/// `starts` is parallel to [`subs`]: where each subscription's cursor sits,
/// as a calendar day. Decoding it from `lastCharged` is arithmetic, but
/// falling back to the day `created` names is a conversion from an epoch —
/// which needs a timezone, so Dart supplies the answer.
///
/// Nothing is written. This exists so the platform can turn the dates into
/// timestamps before [`subs_commit`] posts anything.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PendingCharges {
    /// Parallel with [`Self::days`]: which subscription each charge belongs to.
    pub sub_ids: Vec<String>,
    /// `YYYY-M-D`, 0-indexed month, oldest first.
    pub days: Vec<String>,
    /// Subscriptions whose cursor moves without posting anything — a fully-paid
    /// instalment still advances, and that has to be stored or it is recomputed
    /// on every launch.
    pub cursor_only: Vec<String>,
}

#[frb(sync)]
pub fn subs_pending(starts: Vec<String>, today: String) -> PendingCharges {
    let Some(today) = parse_day(&today) else {
        return PendingCharges::default();
    };
    let list = subs_of();
    let mut out = PendingCharges::default();
    for (i, sub) in list.iter().enumerate() {
        let Some(start) = starts.get(i).and_then(|s| parse_day(s)) else {
            continue;
        };
        let due = subs::compute_due_charges(sub, start, today);
        if due.charges.is_empty() {
            continue;
        }
        let to_apply = subs::apply_cap(sub, due.charges);
        if to_apply.is_empty() {
            out.cursor_only.push(sub.id.clone());
            continue;
        }
        for d in to_apply {
            out.sub_ids.push(sub.id.clone());
            out.days.push(subs::encode(d));
        }
    }
    out
}

/// Post the charges and advance the cursors. Returns the names that fired.
///
/// `days` and `epochs` are parallel: the timestamp Dart computed for each
/// calendar day. The plan is recomputed from `starts` and `today` rather than
/// remembered from [`subs_pending`], so the two calls cannot disagree about
/// what was due — and a day with no epoch supplied is skipped rather than
/// guessed at.
#[frb(sync)]
pub fn subs_commit(
    starts: Vec<String>,
    today: String,
    days: Vec<String>,
    epochs: Vec<i64>,
    now: i64,
) -> Vec<String> {
    let Some(today_c) = parse_day(&today) else {
        return Vec::new();
    };
    let epoch_of = |d: &str| {
        days.iter()
            .position(|x| x == d)
            .and_then(|i| epochs.get(i).copied())
    };

    let mut list = subs_of();
    let mut fired = Vec::new();
    let mut s = store();
    for (i, sub) in list.iter_mut().enumerate() {
        let Some(start) = starts.get(i).and_then(|x| parse_day(x)) else {
            continue;
        };
        let due = subs::compute_due_charges(sub, start, today_c);
        if due.charges.is_empty() {
            continue;
        }
        let to_apply = subs::apply_cap(sub, due.charges);
        if to_apply.is_empty() {
            sub.last_charged = Some(due.last_charged);
            continue;
        }
        for d in &to_apply {
            let Some(ts) = epoch_of(&subs::encode(*d)) else {
                continue;
            };
            let id = format!("sub_{}_{}", sub.id, ts);
            if s.ledger.get(&id).is_some() {
                continue; // already charged locally
            }
            s.ledger.push_raw(charge_entry(sub, id, ts, now));
            fired.push(sub.name.clone());
        }
        sub.last_charged = Some(due.last_charged);
        if sub.periods.is_some() {
            // `toApply.length`, not the number of rows actually written: a
            // charge skipped because its derived id is already present still
            // counts against the instalment, since it did fire once
            sub.charged = Some(sub.charged.unwrap_or(0) + to_apply.len() as u32);
        }
    }
    drop(s);
    set_subs_inner(list);
    fired
}

fn charge_entry(sub: &Sub, id: String, ts: i64, now: i64) -> dahonghua_core::entry::Entry {
    use dahonghua_core::entry::{Entry, Io};
    let is_transfer = sub.is_transfer == Some(true);
    match (is_transfer, sub.from.as_deref(), sub.to.as_deref()) {
        (true, Some(from), Some(to)) if !from.is_empty() && !to.is_empty() => Entry {
            id,
            ts,
            io: Some(Io::Xfer),
            cat: "transfer".into(),
            amt: sub.amt,
            acct: Some(from.to_string()),
            acct_to: Some(to.to_string()),
            note: Some(sub.name.clone()),
            from_sub: Some(true),
            updated_at: Some(now),
            ..Default::default()
        },
        _ => Entry {
            id,
            ts,
            io: Some(Io::Exp),
            // `sub.cat || 'home'` — a blank category falls back
            cat: if sub.cat.is_empty() {
                "home".into()
            } else {
                sub.cat.clone()
            },
            amt: sub.amt,
            note: Some(sub.name.clone()),
            from_sub: Some(true),
            updated_at: Some(now),
            ..Default::default()
        },
    }
}
