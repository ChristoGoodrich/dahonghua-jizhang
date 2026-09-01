//! Multi-currency across the boundary: the rate table, and the unit everything
//! is denominated in.
//!
//! `set_base_currency` is the most dangerous operation in the app, and the
//! reason is in the data model rather than the code. `Entry.amt`, account
//! balances, asset values, loan amounts, subscription charges, template amounts
//! and budgets are all defined as *"in the user's base currency"*. The base is
//! not a label on those numbers — it is the unit they are in.
//!
//! An earlier version of the shipping TypeScript only reassigned the label,
//! which reinterpreted the whole history at a stroke: a ￥10,000 balance became
//! $10,000 on a CNY→USD switch. It rewrites everything now, or refuses.
//!
//! **Which is why this file is the only one that touches more than one piece of
//! state at a time.** Everything denominated in the base has to move together;
//! leaving one behind is a silent corruption rather than a visible failure.
//!
//! Fetching rates is not here. That is an HTTP call with a timeout, which is
//! the platform's.

use dahonghua_core::currency as core;
use dahonghua_core::model::Budgets;
use dahonghua_core::money::{self, Currencies};
use flutter_rust_bridge::frb;
use std::collections::BTreeMap;

use super::store::{currencies_of, set_currencies_inner, set_settings_inner, settings_of};
use crate::api::db;

/// One tracked currency and what it is worth.
#[derive(Debug, Clone, PartialEq)]
pub struct RateView {
    pub code: String,
    /// 1 `code` = this many of the base.
    pub rate: f64,
    /// `￥`, `$`… or the code itself when there is no symbol for it.
    pub symbol: String,
    pub is_base: bool,
}

/// The base, and every rate against it, sorted by code.
///
/// Sorted because a `HashMap` has no order and a list that reshuffled itself
/// between two reads of the same table would read as a bug.
#[frb(sync)]
pub fn rates() -> Vec<RateView> {
    let c = currencies_of();
    let base = base_code(&c);
    let mut out: Vec<RateView> = c
        .rates
        .iter()
        .map(|(code, rate)| RateView {
            code: code.clone(),
            rate: *rate,
            symbol: money::cur_symbol(code),
            is_base: *code == base,
        })
        .collect();
    out.sort_by(|a, b| a.code.cmp(&b.code));
    out
}

#[frb(sync)]
pub fn base_currency() -> String {
    base_code(&currencies_of())
}

/// `currencies.base || 'CNY'` — an empty base is the default, not an error.
fn base_code(c: &Currencies) -> String {
    if c.base.is_empty() {
        "CNY".to_string()
    } else {
        c.base.clone()
    }
}

/// Set or overwrite one rate.
///
/// No validation here on purpose: the screen owns what a sensible number is,
/// and [`set_base_currency`] refuses anything unusable at the point it matters.
#[frb(sync)]
pub fn set_rate(code: String, rate: f64) {
    db::mark_config();
    let mut c = currencies_of();
    core::set_rate(&mut c, &code, rate);
    set_currencies_inner(c);
}

/// Start tracking a code, at parity.
///
/// A code already sitting at **zero** counts as missing and is reset to one —
/// `if (!rates[code])` is a truthiness test, and a rate of zero is not a rate.
#[frb(sync)]
pub fn add_rate(code: String) {
    db::mark_config();
    let mut c = currencies_of();
    core::add_rate(&mut c, &code);
    set_currencies_inner(c);
}

#[frb(sync)]
pub fn remove_rate(code: String) {
    db::mark_config();
    let mut c = currencies_of();
    core::remove_rate(&mut c, &code);
    set_currencies_inner(c);
}

/// What a base switch did: `ok` | `same` | `noRate`.
#[frb(sync)]
pub fn set_base_currency(code: String, now: i64) -> String {
    // Changing the base currency re-denominates every entry in the
    // ledger, which is as bulk as a change gets.
    db::mark_all();
    // Five guards, held in this order and this order only:
    //
    //   store → subscriptions → networth(assets) → networth(loans)
    //         → catalog(library)
    //
    // These are the pieces the core rewrites in place. Nothing else in the
    // bridge holds two at once, so a fixed order here is the whole deadlock
    // argument.
    //
    // Budgets and the rate table are taken as COPIES instead, and written back
    // only on success. That is not laziness about a sixth and seventh lock: it
    // is what makes the all-or-nothing property hold no matter what the core
    // does internally, rather than relying on it to have decided before it
    // mutates. The caller is Dart's one UI isolate, so there is nothing to
    // race with in between.
    let mut s = super::store::store();
    let mut subs = super::subscriptions::subs_lock();
    let mut assets = super::networth::assets_lock();
    let mut loans = super::networth::loans_lock();
    let mut lib = super::catalog::library();
    let set = settings_of();
    let mut currencies = currencies_of();

    let mut budgets = Budgets {
        budget: set.budget,
        // `dailyBudget` of zero is unset, and unset is absent — the same
        // falsy-means-absent rule the budget screen is built on
        daily: (set.daily_budget != 0.0).then_some(set.daily_budget),
        weekly: None,
        per_category: (!set.caps.is_empty())
            .then(|| set.caps.iter().cloned().collect::<BTreeMap<String, f64>>()),
    };

    let store_ref = &mut *s;
    let result = core::set_base_currency(
        core::Denominated {
            ledger: &mut store_ref.ledger,
            accounts: &mut store_ref.accounts,
            assets: &mut assets,
            loans: &mut loans,
            subs: &mut subs,
            templates: &mut lib.templates,
            budgets: &mut budgets,
            currencies: &mut currencies,
        },
        &code,
        now,
    );

    // A refusal must leave these exactly as they were, or "refusing beats
    // corrupting" is a slogan rather than a property.
    if result == core::BaseSwitch::Ok {
        set_currencies_inner(currencies);
        set_settings_inner(super::store::BudgetSettings {
            budget: budgets.budget,
            daily_budget: budgets.daily.unwrap_or(0.0),
            cycle_start: set.cycle_start,
            caps: budgets
                .per_category
                .map(|m| m.into_iter().collect())
                .unwrap_or_default(),
        });
    }

    match result {
        core::BaseSwitch::Ok => "ok",
        core::BaseSwitch::Same => "same",
        core::BaseSwitch::NoRate => "noRate",
    }
    .to_string()
}

/// The codes the picker offers, and what each is called.
///
/// The core answers `None` for a code it has no name for, and the picker only
/// ever offers ones it does — so the list is built from the codes rather than
/// filtered afterwards.
#[frb(sync)]
pub fn known_currencies() -> Vec<RateView> {
    let c = currencies_of();
    let base = base_code(&c);
    [
        "CNY", "USD", "AUD", "EUR", "GBP", "JPY", "HKD", "KRW", "CAD", "SGD",
    ]
    .iter()
    .map(|code| RateView {
        code: code.to_string(),
        rate: c.rates.get(*code).copied().unwrap_or(0.0),
        symbol: money::cur_symbol(code),
        is_base: *code == base,
    })
    .collect()
}

/// The display name for a code — `人民币 ¥` — or the code itself when the core
/// has no name for it.
#[frb(sync)]
pub fn currency_name(code: String) -> String {
    money::cur_name(&code)
        .map(str::to_string)
        .unwrap_or_else(|| code.clone())
}
