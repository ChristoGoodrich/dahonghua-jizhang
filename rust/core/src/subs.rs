//! Subscriptions: recurring charges that post themselves when due.
//!
//! Ported from `src/domain/subscriptions.ts` and `src/store/subscriptions.ts`,
//! split along the line `civil.rs` draws. Which *dates* are due is calendar
//! arithmetic and lives here; turning one of those dates into an epoch
//! timestamp needs a timezone, so the caller supplies that as a closure.
//!
//! The charge id is the part worth reading twice. It is derived —
//! `sub_{sub_id}_{ts}` — not random, and the TypeScript comment explains why:
//! boot runs the subscription sweep while the first cloud pull is still in
//! flight, so a second device charges from its own stale cursor before it ever
//! learns the first device already did. With random ids both rows survive the
//! merge and the user is billed twice. With a derived id they are the same row
//! and collapse into one.

use crate::civil::Civil;
use crate::entry::{Entry, Io};
use crate::ledger::Ledger;
use crate::model::{Sub, SubFreq};

/// The next charge date at or after `from`.
///
/// A day past the end of a month **overflows** rather than clamping, because
/// `new Date(y, m, 31)` does — a subscription billed on the 31st charges on
/// 3 March in a non-leap year, not on the 28th of February.
pub fn next_due_date(sub: &Sub, from: Civil) -> Civil {
    let day = sub.day as i32;
    match sub.freq {
        SubFreq::Yearly => {
            // `(sub.month || 1) - 1`: a falsy month means January
            let mo = sub.month.filter(|m| *m != 0).unwrap_or(1) as i32 - 1;
            let d = Civil::new(from.y, mo, day);
            if d < from {
                Civil::new(from.y + 1, mo, day)
            } else {
                d
            }
        }
        SubFreq::Monthly => {
            let d = Civil::new(from.y, from.m, day);
            if d < from {
                Civil::new(from.y, from.m + 1, day)
            } else {
                d
            }
        }
    }
}

/// `YYYY-M-D` with a **0-indexed month**, inherited from v7 and stored on the
/// subscription as its cursor.
pub fn encode(d: Civil) -> String {
    format!("{}-{}-{}", d.y, d.m, d.d)
}

/// Parse a cursor back. `None` for anything malformed, which the caller treats
/// as "no cursor" — the TypeScript would produce a `NaN` date here and compare
/// false forever after, so refusing is the safer read of the same intent.
pub fn decode(s: &str) -> Option<Civil> {
    let mut parts = s.split('-');
    let y: i32 = parts.next()?.parse().ok()?;
    let m: i32 = parts.next()?.parse().ok()?;
    let d: i32 = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some(Civil::new(y, m, d))
}

pub struct DueResult {
    /// Dates to charge, oldest first.
    pub charges: Vec<Civil>,
    /// The cursor to store back on the subscription.
    pub last_charged: String,
}

/// Catch up every charge from the subscription's cursor to today inclusive.
///
/// `start` is where the cursor sits: the decoded `last_charged`, or the day the
/// subscription was created when it has never fired. Converting `created` from
/// an epoch stamp is the caller's job.
///
/// The 120-iteration guard is inherited. Ten years of monthly charges is more
/// than a catch-up ever needs, and it means a corrupt cursor cannot spin.
pub fn compute_due_charges(sub: &Sub, start: Civil, today: Civil) -> DueResult {
    let mut cursor = start;
    let mut charges = Vec::new();
    let mut last_charged = match sub.last_charged.as_deref() {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => encode(cursor),
    };

    for _ in 0..120 {
        // strictly after the cursor
        let after = Civil::new(cursor.y, cursor.m, cursor.d + 1);
        let due = next_due_date(sub, after);
        if due > today {
            break;
        }
        charges.push(due);
        last_charged = encode(due);
        cursor = due;
    }

    DueResult {
        charges,
        last_charged,
    }
}

/// What a sweep did.
#[derive(Debug, Default, PartialEq)]
pub struct SweepResult {
    /// Names of the subscriptions that posted something, one per charge.
    pub fired: Vec<String>,
    /// Whether any entry was posted.
    pub charged: bool,
    /// Whether a cursor moved without posting — a fully-paid instalment still
    /// advances, and that has to be persisted or it is recomputed every boot.
    pub cursor_moved: bool,
}

/// Apply every due charge.
///
/// `to_epoch` turns a due date into the timestamp the entry carries and the id
/// is derived from; it is the caller's because it needs a timezone.
pub fn run_subscriptions(
    subs: &mut [Sub],
    ledger: &mut Ledger,
    start_of: impl Fn(&Sub) -> Civil,
    today: Civil,
    to_epoch: impl Fn(Civil) -> i64,
    now: i64,
) -> SweepResult {
    let mut out = SweepResult::default();
    if subs.is_empty() {
        return out;
    }

    for sub in subs.iter_mut() {
        let DueResult {
            charges,
            last_charged,
        } = compute_due_charges(sub, start_of(sub), today);
        if charges.is_empty() {
            continue;
        }

        // instalment cap: never fire more than `periods` charges in total
        let to_apply: Vec<Civil> = match sub.periods.filter(|p| *p > 0) {
            Some(periods) => {
                let remaining = periods.saturating_sub(sub.charged.unwrap_or(0)) as usize;
                charges.into_iter().take(remaining).collect()
            }
            None => charges,
        };

        if to_apply.is_empty() {
            // fully paid, but the cursor still moved
            sub.last_charged = Some(last_charged);
            out.cursor_moved = true;
            continue;
        }

        for due in &to_apply {
            let ts = to_epoch(*due);
            let id = format!("sub_{}_{}", sub.id, ts);
            if ledger.get(&id).is_some() {
                continue; // already charged locally
            }

            let is_transfer = sub.is_transfer == Some(true);
            let entry = match (is_transfer, sub.from.as_deref(), sub.to.as_deref()) {
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
            };
            ledger.push_raw(entry);
            out.fired.push(sub.name.clone());
        }

        out.charged = true;
        sub.last_charged = Some(last_charged);
        if sub.periods.is_some() {
            // `toApply.length`, not the number of rows actually written: a
            // charge skipped because its derived id is already present still
            // counts against the instalment, since it did fire once
            sub.charged = Some(sub.charged.unwrap_or(0) + to_apply.len() as u32);
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sub(freq: SubFreq, day: u32) -> Sub {
        Sub {
            id: "s0".into(),
            name: "音乐".into(),
            emoji: "🎵".into(),
            amt: 15.0,
            freq,
            day,
            month: None,
            cat: "fun".into(),
            created: 0,
            last_charged: None,
            is_transfer: None,
            from: None,
            to: None,
            periods: None,
            charged: None,
        }
    }

    fn c(y: i32, m: i32, d: i32) -> Civil {
        Civil::new(y, m, d)
    }

    /// Local midnight is irrelevant to the maths; the tests only need the
    /// mapping to be injective and ordered.
    fn epoch(d: Civil) -> i64 {
        d.day_number() * 86_400_000
    }

    #[test]
    fn the_next_monthly_charge_is_this_month_when_it_is_still_ahead() {
        let s = sub(SubFreq::Monthly, 15);
        assert_eq!(next_due_date(&s, c(2026, 7, 1)), c(2026, 7, 15));
    }

    #[test]
    fn the_next_monthly_charge_rolls_forward_once_the_day_has_passed() {
        let s = sub(SubFreq::Monthly, 15);
        assert_eq!(next_due_date(&s, c(2026, 7, 16)), c(2026, 8, 15));
    }

    #[test]
    fn a_charge_on_the_due_day_is_today_not_next_month() {
        let s = sub(SubFreq::Monthly, 15);
        assert_eq!(next_due_date(&s, c(2026, 7, 15)), c(2026, 7, 15));
    }

    #[test]
    fn a_day_past_the_end_of_the_month_overflows_like_new_date() {
        let s = sub(SubFreq::Monthly, 31);
        // 31 February 2026 is 3 March
        assert_eq!(next_due_date(&s, c(2026, 1, 1)), c(2026, 2, 3));
    }

    #[test]
    fn a_yearly_charge_uses_its_month() {
        let mut s = sub(SubFreq::Yearly, 20);
        s.month = Some(6); // June, 1-indexed
        assert_eq!(next_due_date(&s, c(2026, 0, 1)), c(2026, 5, 20));
        assert_eq!(next_due_date(&s, c(2026, 8, 1)), c(2027, 5, 20));
    }

    #[test]
    fn a_yearly_charge_without_a_month_bills_in_january() {
        // `(sub.month || 1) - 1`
        let mut s = sub(SubFreq::Yearly, 5);
        s.month = None;
        assert_eq!(next_due_date(&s, c(2026, 3, 1)), c(2027, 0, 5));
        s.month = Some(0); // falsy in JavaScript
        assert_eq!(next_due_date(&s, c(2026, 3, 1)), c(2027, 0, 5));
    }

    #[test]
    fn cursors_round_trip_through_their_zero_indexed_encoding() {
        assert_eq!(encode(c(2026, 7, 19)), "2026-7-19");
        assert_eq!(decode("2026-7-19"), Some(c(2026, 7, 19)));
        assert_eq!(decode("2026-0-1"), Some(c(2026, 0, 1)));
    }

    #[test]
    fn a_malformed_cursor_decodes_to_nothing() {
        assert_eq!(decode(""), None);
        assert_eq!(decode("2026-7"), None);
        assert_eq!(decode("2026-7-19-1"), None);
        assert_eq!(decode("nope"), None);
    }

    #[test]
    fn nothing_is_due_before_the_first_charge_date() {
        let s = sub(SubFreq::Monthly, 15);
        let r = compute_due_charges(&s, c(2026, 7, 1), c(2026, 7, 10));
        assert!(r.charges.is_empty());
    }

    #[test]
    fn today_counts_as_due() {
        let s = sub(SubFreq::Monthly, 15);
        let r = compute_due_charges(&s, c(2026, 7, 1), c(2026, 7, 15));
        assert_eq!(r.charges, [c(2026, 7, 15)]);
        assert_eq!(r.last_charged, "2026-7-15");
    }

    #[test]
    fn a_long_gap_catches_every_missed_charge_up() {
        let s = sub(SubFreq::Monthly, 1);
        let r = compute_due_charges(&s, c(2026, 0, 1), c(2026, 4, 1));
        assert_eq!(
            r.charges,
            [c(2026, 1, 1), c(2026, 2, 1), c(2026, 3, 1), c(2026, 4, 1)]
        );
        assert_eq!(r.last_charged, "2026-4-1");
    }

    #[test]
    fn the_cursor_is_reported_even_when_nothing_fires() {
        let s = sub(SubFreq::Monthly, 15);
        let r = compute_due_charges(&s, c(2026, 7, 20), c(2026, 7, 25));
        assert!(r.charges.is_empty());
        assert_eq!(r.last_charged, "2026-7-20"); // the encoded start
    }

    #[test]
    fn an_existing_cursor_is_kept_when_nothing_fires() {
        let mut s = sub(SubFreq::Monthly, 15);
        s.last_charged = Some("2026-6-15".into());
        let r = compute_due_charges(&s, c(2026, 6, 15), c(2026, 6, 20));
        assert!(r.charges.is_empty());
        assert_eq!(r.last_charged, "2026-6-15");
    }

    #[test]
    fn the_catch_up_cannot_run_away() {
        let s = sub(SubFreq::Monthly, 1);
        // fifty years of arrears, capped at the inherited guard
        let r = compute_due_charges(&s, c(1976, 0, 1), c(2026, 0, 1));
        assert_eq!(r.charges.len(), 120);
    }

    #[test]
    fn a_sweep_posts_an_expense_per_due_date() {
        let mut subs = vec![sub(SubFreq::Monthly, 1)];
        let mut l = Ledger::new();
        let r = run_subscriptions(
            &mut subs,
            &mut l,
            |_| c(2026, 0, 1),
            c(2026, 2, 1),
            epoch,
            9_000,
        );
        assert_eq!(r.fired.len(), 2); // Feb and Mar
        assert!(r.charged);
        assert_eq!(l.len(), 2);

        let e = &l.all()[0];
        assert_eq!(e.io, Some(Io::Exp));
        assert_eq!(e.cat, "fun");
        assert_eq!(e.amt, 15.0);
        assert_eq!(e.note.as_deref(), Some("音乐"));
        assert_eq!(e.from_sub, Some(true));
        assert_eq!(e.updated_at, Some(9_000));
        assert_eq!(subs[0].last_charged.as_deref(), Some("2026-2-1"));
    }

    #[test]
    fn the_charge_id_is_derived_so_two_devices_collapse_into_one_row() {
        let mut subs = vec![sub(SubFreq::Monthly, 1)];
        let mut l = Ledger::new();
        run_subscriptions(
            &mut subs,
            &mut l,
            |_| c(2026, 0, 1),
            c(2026, 1, 1),
            epoch,
            9_000,
        );
        let id = l.all()[0].id.clone();
        assert_eq!(id, format!("sub_s0_{}", epoch(c(2026, 1, 1))));

        // the same sweep again, with the cursor reset as a stale device would
        subs[0].last_charged = None;
        run_subscriptions(
            &mut subs,
            &mut l,
            |_| c(2026, 0, 1),
            c(2026, 1, 1),
            epoch,
            9_100,
        );
        assert_eq!(l.len(), 1); // not billed twice
    }

    #[test]
    fn a_blank_category_falls_back_to_home() {
        let mut s = sub(SubFreq::Monthly, 1);
        s.cat = String::new();
        let mut subs = vec![s];
        let mut l = Ledger::new();
        run_subscriptions(
            &mut subs,
            &mut l,
            |_| c(2026, 0, 1),
            c(2026, 1, 1),
            epoch,
            9_000,
        );
        assert_eq!(l.all()[0].cat, "home");
    }

    #[test]
    fn a_transfer_subscription_posts_a_transfer() {
        let mut s = sub(SubFreq::Monthly, 1);
        s.is_transfer = Some(true);
        s.from = Some("a1".into());
        s.to = Some("a2".into());
        let mut subs = vec![s];
        let mut l = Ledger::new();
        run_subscriptions(
            &mut subs,
            &mut l,
            |_| c(2026, 0, 1),
            c(2026, 1, 1),
            epoch,
            9_000,
        );

        let e = &l.all()[0];
        assert_eq!(e.io, Some(Io::Xfer));
        assert_eq!(e.cat, "transfer");
        assert_eq!(e.acct.as_deref(), Some("a1"));
        assert_eq!(e.acct_to.as_deref(), Some("a2"));
    }

    #[test]
    fn a_transfer_subscription_missing_an_account_posts_an_expense() {
        let mut s = sub(SubFreq::Monthly, 1);
        s.is_transfer = Some(true);
        s.from = Some("a1".into());
        s.to = None;
        let mut subs = vec![s];
        let mut l = Ledger::new();
        run_subscriptions(
            &mut subs,
            &mut l,
            |_| c(2026, 0, 1),
            c(2026, 1, 1),
            epoch,
            9_000,
        );
        assert_eq!(l.all()[0].io, Some(Io::Exp));
    }

    #[test]
    fn an_instalment_stops_at_its_period_count() {
        let mut s = sub(SubFreq::Monthly, 1);
        s.periods = Some(2);
        let mut subs = vec![s];
        let mut l = Ledger::new();
        let r = run_subscriptions(
            &mut subs,
            &mut l,
            |_| c(2026, 0, 1),
            c(2026, 4, 1),
            epoch,
            9_000,
        );
        assert_eq!(r.fired.len(), 2); // four were due, two allowed
        assert_eq!(subs[0].charged, Some(2));
    }

    #[test]
    fn a_finished_instalment_advances_its_cursor_without_posting() {
        let mut s = sub(SubFreq::Monthly, 1);
        s.periods = Some(1);
        s.charged = Some(1);
        let mut subs = vec![s];
        let mut l = Ledger::new();
        let r = run_subscriptions(
            &mut subs,
            &mut l,
            |_| c(2026, 0, 1),
            c(2026, 2, 1),
            epoch,
            9_000,
        );

        assert!(r.fired.is_empty());
        assert!(!r.charged);
        assert!(r.cursor_moved); // and this is why it has to be persisted
        assert_eq!(subs[0].last_charged.as_deref(), Some("2026-2-1"));
        assert!(l.is_empty());
    }

    #[test]
    fn an_empty_subscription_list_sweeps_to_nothing() {
        let mut subs: Vec<Sub> = vec![];
        let mut l = Ledger::new();
        let r = run_subscriptions(
            &mut subs,
            &mut l,
            |_| c(2026, 0, 1),
            c(2026, 2, 1),
            epoch,
            9_000,
        );
        assert_eq!(r, SweepResult::default());
    }
}
