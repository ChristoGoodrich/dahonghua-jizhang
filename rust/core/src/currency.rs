//! Multi-currency: the rate table, and switching the unit everything is
//! denominated in.
//!
//! Ported from `src/store/currency.ts`. `set_base_currency` is the most
//! dangerous operation in the app, and the reason is in the data model rather
//! than the code: `Entry.amt`, account balances, asset values, loan amounts and
//! budgets are all defined as *"in the user's base currency"*. The base is not
//! a label on those numbers — it is the unit they are in.
//!
//! An earlier version of the TypeScript only reassigned the label, which
//! reinterpreted the whole history at a stroke: a ¥10,000 balance became
//! $10,000 on a CNY→USD switch. The comment recording that is still in the
//! source, and it is why this function rewrites everything or refuses.
//!
//! `updateRates` is not ported. It is an HTTP call with a timeout, which is I/O
//! and belongs outside a crate that compiles for both Android and wasm.

use crate::entry::Patch;
use crate::ledger::{stamp, Ledger};
use crate::model::{Asset, Budgets, Loan, Sub, Template};
use crate::money::Currencies;
use crate::num::{round2, to_fixed};

/// What a base-currency switch did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BaseSwitch {
    Ok,
    /// Already the base; nothing to do.
    Same,
    /// No usable rate for the incoming code. Refusing beats corrupting.
    NoRate,
}

/// Everything a base switch has to re-express. Borrowed together because the
/// operation is all-or-nothing: leaving any one of them in the old unit is a
/// silent corruption rather than a visible failure.
pub struct Denominated<'a> {
    pub ledger: &'a mut Ledger,
    pub accounts: &'a mut Vec<crate::accounts::Account>,
    pub assets: &'a mut Vec<Asset>,
    pub loans: &'a mut Vec<Loan>,
    pub subs: &'a mut Vec<Sub>,
    pub templates: &'a mut Vec<Template>,
    pub budgets: &'a mut Budgets,
    pub currencies: &'a mut Currencies,
}

/// Switch the base currency, re-expressing every stored figure in the new unit.
///
/// `rates[code]` reads as "1 `code` = that many of the old base", so converting
/// into the new unit is a divide. Rounding is to cents through [`round2`],
/// which kills the drift a divide introduces — and which follows JavaScript's
/// tie rule, not Rust's.
pub fn set_base_currency(d: Denominated<'_>, code: &str, now: i64) -> BaseSwitch {
    let old_base = if d.currencies.base.is_empty() {
        "CNY".to_string()
    } else {
        d.currencies.base.clone()
    };
    if code == old_base {
        return BaseSwitch::Same;
    }

    // `!rate || !Number.isFinite(rate) || rate <= 0` — the first test also
    // catches 0 and NaN in JavaScript, so all three are folded here
    let rate = match d.currencies.rates.get(code) {
        Some(r) if r.is_finite() && *r > 0.0 => *r,
        _ => return BaseSwitch::NoRate,
    };
    let conv = |n: f64| round2(n / rate);

    // Every rewritten entry is stamped. The rewrite changes real money fields,
    // so it has to raise updated_at above the push watermark and carry fresh
    // field times. Unstamped, none of it would ever upload, and the next pull's
    // equal-timestamp tiebreak would mix old-base and new-base amounts row by
    // row — corrupting every synced device rather than just this one.
    //
    // By position, not by id: `Ledger::get` is first-wins, so a ledger that
    // somehow holds two rows with one id would convert the first twice and
    // leave the second alone. Rebuilding from `all()` visits each row once.
    let entries: Vec<crate::entry::Entry> = d
        .ledger
        .all()
        .iter()
        .map(|e| {
            let native = e.cur.as_deref() == Some(code);
            let mut patch = Patch {
                amt: Some(
                    // an entry originally typed in the incoming currency
                    // round-trips exactly, rather than being divided back
                    // through a rate
                    match (native, e.orig_amt) {
                        (true, Some(orig)) => orig,
                        _ => conv(e.amt),
                    },
                ),
                fee: e.fee.map(conv),
                discount: e.discount.map(conv),
                rb_amt: e.rb_amt.map(conv),
                refund: e.refund.map(conv),
                ..Default::default()
            };
            if native {
                // it is not "foreign" any more once its own currency became the
                // base; clearing also stamps the clear
                patch.clear.push("cur");
                patch.clear.push("origAmt");
            }
            stamp(e, &patch, now)
        })
        .collect();
    *d.ledger = Ledger::from_entries(entries);

    for a in d.accounts.iter_mut() {
        a.balance = conv(a.balance);
    }
    for a in d.assets.iter_mut() {
        a.val = conv(a.val);
    }
    for l in d.loans.iter_mut() {
        l.amt = conv(l.amt);
        l.repaid = l.repaid.map(conv);
    }
    for s in d.subs.iter_mut() {
        s.amt = conv(s.amt);
    }
    for t in d.templates.iter_mut() {
        t.amt = conv(t.amt);
    }

    d.budgets.budget = conv(d.budgets.budget);
    d.budgets.daily = d.budgets.daily.map(conv);
    d.budgets.weekly = d.budgets.weekly.map(conv);
    if let Some(per_cat) = d.budgets.per_category.as_mut() {
        for v in per_cat.values_mut() {
            *v = conv(*v);
        }
    }

    // Re-anchor the table on the new base. Each rate read "1 c = r oldBase",
    // and 1 oldBase = 1/rate newBase, so "1 c = r/rate newBase". The old base
    // joins the table; the new base leaves it, because a base has no rate
    // against itself.
    let mut next = std::collections::HashMap::new();
    for (c, r) in d.currencies.rates.iter() {
        if c == code {
            continue;
        }
        next.insert(c.clone(), to_fixed(r / rate, 6));
    }
    next.insert(old_base, to_fixed(1.0 / rate, 6));

    d.currencies.base = code.to_string();
    d.currencies.rates = next;
    BaseSwitch::Ok
}

/// Set or overwrite one rate. No validation — the settings screen owns that,
/// and `set_base_currency` refuses anything unusable at the point it matters.
pub fn set_rate(currencies: &mut Currencies, code: &str, rate: f64) {
    currencies.rates.insert(code.to_string(), rate);
}

/// Add a code at parity if it is not already tracked.
///
/// `if (!rates[code])` in the TypeScript, so a code sitting at 0 is treated as
/// missing and reset to 1 — falsy means absent again.
pub fn add_rate(currencies: &mut Currencies, code: &str) {
    let missing = match currencies.rates.get(code) {
        Some(r) => *r == 0.0,
        None => true,
    };
    if missing {
        currencies.rates.insert(code.to_string(), 1.0);
    }
}

pub fn remove_rate(currencies: &mut Currencies, code: &str) {
    currencies.rates.remove(code);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::Account;
    use crate::entry::{Entry, Io};
    use crate::model::{AssetKind, LoanKind, SubFreq};
    use std::collections::{BTreeMap, HashMap};

    struct World {
        ledger: Ledger,
        accounts: Vec<Account>,
        assets: Vec<Asset>,
        loans: Vec<Loan>,
        subs: Vec<Sub>,
        templates: Vec<Template>,
        budgets: Budgets,
        currencies: Currencies,
    }

    impl World {
        fn denominated(&mut self) -> Denominated<'_> {
            Denominated {
                ledger: &mut self.ledger,
                accounts: &mut self.accounts,
                assets: &mut self.assets,
                loans: &mut self.loans,
                subs: &mut self.subs,
                templates: &mut self.templates,
                budgets: &mut self.budgets,
                currencies: &mut self.currencies,
            }
        }
    }

    /// A CNY ledger with USD at 7.2 and JPY at 0.048.
    fn world() -> World {
        let mut rates = HashMap::new();
        rates.insert("USD".to_string(), 7.2);
        rates.insert("JPY".to_string(), 0.048);
        World {
            ledger: Ledger::from_entries(vec![Entry {
                id: "e0".into(),
                ts: 1_000,
                io: Some(Io::Exp),
                cat: "food".into(),
                amt: 720.0,
                ..Default::default()
            }]),
            accounts: vec![Account {
                id: "default".into(),
                name: "默认".into(),
                balance: 7_200.0,
                ..Default::default()
            }],
            assets: vec![Asset {
                id: "as0".into(),
                name: "车".into(),
                kind: AssetKind::Asset,
                val: 72_000.0,
                no_count: None,
            }],
            loans: vec![Loan {
                id: "l0".into(),
                who: "张三".into(),
                kind: LoanKind::Lend,
                amt: 1_440.0,
                repaid: Some(720.0),
                ts: 1_000,
            }],
            subs: vec![Sub {
                id: "s0".into(),
                name: "音乐".into(),
                emoji: "🎵".into(),
                amt: 72.0,
                freq: SubFreq::Monthly,
                day: 1,
                month: None,
                cat: "fun".into(),
                created: 0,
                last_charged: None,
                is_transfer: None,
                from: None,
                to: None,
                periods: None,
                charged: None,
            }],
            templates: vec![Template {
                id: "t0".into(),
                io: Io::Exp,
                cat: "food".into(),
                amt: 36.0,
                note: None,
                name: "午饭".into(),
            }],
            budgets: Budgets {
                budget: 7_200.0,
                daily: Some(360.0),
                weekly: Some(1_800.0),
                per_category: Some(BTreeMap::from([("food".to_string(), 2_160.0)])),
            },
            currencies: Currencies {
                base: "CNY".into(),
                rates,
            },
        }
    }

    #[test]
    fn switching_to_the_current_base_is_a_no_op() {
        let mut w = world();
        assert_eq!(
            set_base_currency(w.denominated(), "CNY", 9_000),
            BaseSwitch::Same
        );
        assert_eq!(w.ledger.get("e0").unwrap().amt, 720.0);
    }

    #[test]
    fn an_empty_base_means_cny() {
        let mut w = world();
        w.currencies.base = String::new();
        assert_eq!(
            set_base_currency(w.denominated(), "CNY", 9_000),
            BaseSwitch::Same
        );
    }

    #[test]
    fn a_missing_rate_refuses_rather_than_corrupting() {
        let mut w = world();
        assert_eq!(
            set_base_currency(w.denominated(), "EUR", 9_000),
            BaseSwitch::NoRate
        );
        assert_eq!(w.ledger.get("e0").unwrap().amt, 720.0);
        assert_eq!(w.currencies.base, "CNY");
    }

    #[test]
    fn a_zero_or_negative_rate_refuses_too() {
        for bad in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            let mut w = world();
            w.currencies.rates.insert("EUR".into(), bad);
            assert_eq!(
                set_base_currency(w.denominated(), "EUR", 9_000),
                BaseSwitch::NoRate,
                "rate {bad} should have been refused"
            );
        }
    }

    #[test]
    fn every_denominated_figure_moves_together() {
        let mut w = world();
        assert_eq!(
            set_base_currency(w.denominated(), "USD", 9_000),
            BaseSwitch::Ok
        );

        assert_eq!(w.ledger.get("e0").unwrap().amt, 100.0); // 720 / 7.2
        assert_eq!(w.accounts[0].balance, 1_000.0);
        assert_eq!(w.assets[0].val, 10_000.0);
        assert_eq!(w.loans[0].amt, 200.0);
        assert_eq!(w.loans[0].repaid, Some(100.0));
        assert_eq!(w.subs[0].amt, 10.0);
        assert_eq!(w.templates[0].amt, 5.0);
        assert_eq!(w.budgets.budget, 1_000.0);
        assert_eq!(w.budgets.daily, Some(50.0));
        assert_eq!(w.budgets.weekly, Some(250.0));
        assert_eq!(w.budgets.per_category.as_ref().unwrap()["food"], 300.0);
    }

    #[test]
    fn the_rewrite_is_stamped_so_sync_can_see_it() {
        let mut w = world();
        set_base_currency(w.denominated(), "USD", 9_000);
        let e = w.ledger.get("e0").unwrap();
        assert_eq!(e.updated_at, Some(9_000));
        assert_eq!(e.stamp_of("amt"), Some(9_000));
    }

    #[test]
    fn an_entry_typed_in_the_incoming_currency_round_trips_exactly() {
        let mut w = world();
        // 13.99 USD was stored as 100.73 CNY at some rate; switching to USD
        // must give back 13.99, not 100.73/7.2 = 13.99 by luck
        w.ledger = Ledger::from_entries(vec![Entry {
            id: "e0".into(),
            amt: 100.73,
            cur: Some("USD".into()),
            orig_amt: Some(13.99),
            ..Default::default()
        }]);
        set_base_currency(w.denominated(), "USD", 9_000);

        let e = w.ledger.get("e0").unwrap();
        assert_eq!(e.amt, 13.99);
        // and it is no longer foreign
        assert_eq!(e.cur, None);
        assert_eq!(e.orig_amt, None);
        assert_eq!(e.stamp_of("cur"), Some(9_000));
        assert_eq!(e.stamp_of("origAmt"), Some(9_000));
    }

    #[test]
    fn an_entry_in_a_third_currency_stays_foreign() {
        let mut w = world();
        w.ledger = Ledger::from_entries(vec![Entry {
            id: "e0".into(),
            amt: 720.0,
            cur: Some("JPY".into()),
            orig_amt: Some(15_000.0),
            ..Default::default()
        }]);
        set_base_currency(w.denominated(), "USD", 9_000);

        let e = w.ledger.get("e0").unwrap();
        assert_eq!(e.amt, 100.0);
        assert_eq!(e.cur.as_deref(), Some("JPY"));
        assert_eq!(e.orig_amt, Some(15_000.0));
    }

    #[test]
    fn optional_money_fields_are_converted_only_when_present() {
        let mut w = world();
        w.ledger = Ledger::from_entries(vec![
            Entry {
                id: "e0".into(),
                amt: 720.0,
                fee: Some(72.0),
                ..Default::default()
            },
            Entry {
                id: "e1".into(),
                amt: 720.0,
                ..Default::default()
            },
        ]);
        set_base_currency(w.denominated(), "USD", 9_000);

        assert_eq!(w.ledger.get("e0").unwrap().fee, Some(10.0));
        assert_eq!(w.ledger.get("e1").unwrap().fee, None);
        assert_eq!(w.ledger.get("e1").unwrap().stamp_of("fee"), None);
    }

    #[test]
    fn the_rate_table_is_re_anchored_on_the_new_base() {
        let mut w = world();
        set_base_currency(w.denominated(), "USD", 9_000);

        assert_eq!(w.currencies.base, "USD");
        // the new base leaves the table
        assert!(!w.currencies.rates.contains_key("USD"));
        // the old base joins it: 1 CNY = 1/7.2 USD
        assert_eq!(w.currencies.rates["CNY"], to_fixed(1.0 / 7.2, 6));
        // and everything else is re-expressed: 1 JPY = 0.048/7.2 USD
        assert_eq!(w.currencies.rates["JPY"], to_fixed(0.048 / 7.2, 6));
    }

    #[test]
    fn a_duplicated_id_is_converted_once_each_not_once_per_occurrence() {
        // `Ledger::get` is first-wins. Looking rows up by id would convert the
        // first copy once per occurrence and never touch the second.
        let mut w = world();
        w.ledger = Ledger::from_entries(vec![
            Entry {
                id: "dup".into(),
                amt: 720.0,
                ..Default::default()
            },
            Entry {
                id: "dup".into(),
                amt: 1440.0,
                ..Default::default()
            },
        ]);
        set_base_currency(w.denominated(), "USD", 9_000);

        let all = w.ledger.all();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].amt, 100.0);
        assert_eq!(all[1].amt, 200.0);
    }

    #[test]
    fn amounts_are_rounded_to_cents_so_a_divide_cannot_drift() {
        let mut w = world();
        w.ledger = Ledger::from_entries(vec![Entry {
            id: "e0".into(),
            amt: 100.0,
            ..Default::default()
        }]);
        set_base_currency(w.denominated(), "USD", 9_000);
        // 100 / 7.2 = 13.888…
        assert_eq!(w.ledger.get("e0").unwrap().amt, 13.89);
    }

    #[test]
    fn adding_a_rate_starts_at_parity_and_does_not_overwrite() {
        let mut c = Currencies {
            base: "CNY".into(),
            rates: HashMap::new(),
        };
        add_rate(&mut c, "USD");
        assert_eq!(c.rates["USD"], 1.0);

        set_rate(&mut c, "USD", 7.2);
        add_rate(&mut c, "USD");
        assert_eq!(c.rates["USD"], 7.2); // untouched
    }

    #[test]
    fn a_rate_sitting_at_zero_counts_as_missing() {
        // `if (!rates[code])` — falsy means absent, again
        let mut c = Currencies {
            base: "CNY".into(),
            rates: HashMap::from([("USD".to_string(), 0.0)]),
        };
        add_rate(&mut c, "USD");
        assert_eq!(c.rates["USD"], 1.0);
    }

    #[test]
    fn removing_a_rate_drops_it() {
        let mut c = Currencies {
            base: "CNY".into(),
            rates: HashMap::from([("USD".to_string(), 7.2)]),
        };
        remove_rate(&mut c, "USD");
        assert!(c.rates.is_empty());
        remove_rate(&mut c, "USD"); // idempotent
    }
}
