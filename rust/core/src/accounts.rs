//! Accounts — the money containers entries point at.
//!
//! Ported from `src/store/accounts.ts`. Small, but three of its rules are the
//! kind that only look important once they are broken:
//!
//! * **`default` cannot be deleted or archived.** It is the fallback every
//!   orphaned entry migrates to, so removing it would strand them.
//! * **Deleting an account rewrites the entries that reference it**, and does so
//!   through the same stamping the ledger uses. An unstamped rewrite is
//!   invisible to the sync push watermark, so other devices would keep pointing
//!   at an account that no longer exists.
//! * **Transfers targeting the account migrate too.** `acct_to` is as much a
//!   reference as `acct`; the TypeScript's own comment records that v7 left
//!   those dangling.

use crate::entry::Patch;
use crate::ledger::Ledger;

pub const DEFAULT_ACCOUNT: &str = "default";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AccountKind {
    #[default]
    Cash,
    /// A liability rather than an asset.
    Credit,
    Prepaid,
    /// Holds a foreign currency.
    Fx,
}

impl AccountKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AccountKind::Cash => "cash",
            AccountKind::Credit => "credit",
            AccountKind::Prepaid => "prepaid",
            AccountKind::Fx => "fx",
        }
    }

    pub fn parse(s: &str) -> Option<AccountKind> {
        Some(match s {
            "cash" => AccountKind::Cash,
            "credit" => AccountKind::Credit,
            "prepaid" => AccountKind::Prepaid,
            "fx" => AccountKind::Fx,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub name_en: Option<String>,
    /// Starting balance, not the running one.
    pub balance: f64,
    pub kind: Option<AccountKind>,
    /// Credit card: the day of the month the statement closes, 1..=28.
    pub statement_day: Option<u32>,
    /// Credit card: the day of the month payment is due, 1..=28.
    pub due_day: Option<u32>,
    /// Fx: the currency this account holds.
    pub fx_code: Option<String>,
    /// Fx: weighted average purchase rate (1 fx_code = N base).
    pub fx_rate: Option<f64>,
    /// Hidden from the new-entry pickers; history and balance are kept.
    pub archived: Option<bool>,
}

/// The optional settings a new account may carry. Which ones survive depends on
/// the kind — a cash account given a statement day silently drops it, exactly as
/// the TypeScript does.
#[derive(Debug, Clone, Default)]
pub struct NewAccountOpts {
    pub statement_day: Option<u32>,
    pub due_day: Option<u32>,
    pub fx_code: Option<String>,
}

/// Create an account. `id` comes from the caller, for the same reason it does
/// on the ledger: generating one reads a clock and a random source.
pub fn add_account(
    accounts: &mut Vec<Account>,
    id: String,
    name: String,
    balance: f64,
    kind: AccountKind,
    opts: &NewAccountOpts,
) -> Account {
    let mut a = Account {
        id,
        // the TypeScript seeds nameEn with the same string; the settings screen
        // is where they diverge
        name_en: Some(name.clone()),
        name,
        balance,
        kind: Some(kind),
        ..Default::default()
    };
    if kind == AccountKind::Credit {
        // `if (opts?.statementDay)` in JS — 0 is falsy there, so a zero day is
        // dropped rather than stored
        if let Some(d) = opts.statement_day.filter(|d| *d != 0) {
            a.statement_day = Some(d);
        }
        if let Some(d) = opts.due_day.filter(|d| *d != 0) {
            a.due_day = Some(d);
        }
    }
    if kind == AccountKind::Fx {
        if let Some(code) = opts.fx_code.as_deref().filter(|c| !c.is_empty()) {
            a.fx_code = Some(code.to_uppercase());
        }
    }
    accounts.push(a.clone());
    a
}

/// Delete an account, migrating everything that referenced it to `default`.
///
/// Returns `false` for `default` itself, which is not deletable.
pub fn remove_account(
    accounts: &mut Vec<Account>,
    ledger: &mut Ledger,
    current: &mut String,
    id: &str,
    now: i64,
) -> bool {
    if id == DEFAULT_ACCOUNT {
        return false;
    }

    let touched: Vec<(String, bool, bool)> = ledger
        .all()
        .iter()
        .map(|e| {
            (
                e.id.clone(),
                e.acct.as_deref() == Some(id),
                e.acct_to.as_deref() == Some(id),
            )
        })
        .filter(|(_, from, to)| *from || *to)
        .collect();

    for (entry_id, from, to) in touched {
        let patch = Patch {
            acct: from.then(|| DEFAULT_ACCOUNT.to_string()),
            acct_to: to.then(|| DEFAULT_ACCOUNT.to_string()),
            ..Default::default()
        };
        ledger.update(&entry_id, &patch, now);
    }

    accounts.retain(|a| a.id != id);
    if current == id {
        *current = DEFAULT_ACCOUNT.to_string();
    }
    true
}

/// Archive or unarchive. Returns `false` for `default`, which stays visible
/// because it is the fallback.
pub fn archive_account(
    accounts: &mut [Account],
    current: &mut String,
    id: &str,
    archived: bool,
) -> bool {
    if id == DEFAULT_ACCOUNT {
        return false;
    }
    for a in accounts.iter_mut() {
        if a.id == id {
            // `archived || undefined` in the TypeScript: false is stored as
            // absent, not as false. Same falsy-means-gone rule as the refund
            // counter, and the same reason — an explicit `false` would survive
            // a sync round-trip as a field that is set.
            a.archived = archived.then_some(true);
        }
    }
    // never leave a just-archived account as the target for new entries
    if archived && current == id {
        *current = DEFAULT_ACCOUNT.to_string();
    }
    true
}

/// Accounts offered in the record sheet: everything not archived, plus
/// whichever one is currently selected even if it is archived — editing an old
/// entry on an archived account must not silently move it.
pub fn pickable<'a>(accounts: &'a [Account], selected: &str) -> Vec<&'a Account> {
    accounts
        .iter()
        .filter(|a| a.archived != Some(true) || a.id == selected)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::{Entry, Io};

    fn seed() -> (Vec<Account>, Ledger, String) {
        let accounts = vec![
            Account {
                id: "default".into(),
                name: "默认".into(),
                ..Default::default()
            },
            Account {
                id: "a1".into(),
                name: "招行".into(),
                ..Default::default()
            },
            Account {
                id: "a2".into(),
                name: "支付宝".into(),
                ..Default::default()
            },
        ];
        let ledger = Ledger::from_entries(vec![
            Entry {
                id: "e0".into(),
                io: Some(Io::Exp),
                amt: 35.0,
                acct: Some("a1".into()),
                ..Default::default()
            },
            Entry {
                id: "e1".into(),
                io: Some(Io::Xfer),
                amt: 200.0,
                acct: Some("a2".into()),
                acct_to: Some("a1".into()),
                ..Default::default()
            },
            Entry {
                id: "e2".into(),
                io: Some(Io::Exp),
                amt: 12.0,
                acct: Some("default".into()),
                ..Default::default()
            },
        ]);
        (accounts, ledger, "a1".to_string())
    }

    #[test]
    fn a_new_account_seeds_its_english_name() {
        let mut accounts = vec![];
        let a = add_account(
            &mut accounts,
            "x".into(),
            "现金".into(),
            100.0,
            AccountKind::Cash,
            &Default::default(),
        );
        assert_eq!(a.name, "现金");
        assert_eq!(a.name_en.as_deref(), Some("现金"));
        assert_eq!(accounts.len(), 1);
    }

    #[test]
    fn card_days_are_kept_only_for_a_credit_account() {
        let opts = NewAccountOpts {
            statement_day: Some(5),
            due_day: Some(23),
            ..Default::default()
        };
        let mut accounts = vec![];
        let credit = add_account(
            &mut accounts,
            "c".into(),
            "卡".into(),
            0.0,
            AccountKind::Credit,
            &opts,
        );
        assert_eq!(credit.statement_day, Some(5));
        assert_eq!(credit.due_day, Some(23));

        let cash = add_account(
            &mut accounts,
            "k".into(),
            "现金".into(),
            0.0,
            AccountKind::Cash,
            &opts,
        );
        assert_eq!(cash.statement_day, None);
        assert_eq!(cash.due_day, None);
    }

    #[test]
    fn a_zero_day_is_dropped_the_way_a_falsy_one_is_in_javascript() {
        let opts = NewAccountOpts {
            statement_day: Some(0),
            due_day: Some(0),
            ..Default::default()
        };
        let mut accounts = vec![];
        let a = add_account(
            &mut accounts,
            "c".into(),
            "卡".into(),
            0.0,
            AccountKind::Credit,
            &opts,
        );
        assert_eq!(a.statement_day, None);
        assert_eq!(a.due_day, None);
    }

    #[test]
    fn an_fx_code_is_upper_cased_and_only_kept_for_an_fx_account() {
        let opts = NewAccountOpts {
            fx_code: Some("usd".into()),
            ..Default::default()
        };
        let mut accounts = vec![];
        let fx = add_account(
            &mut accounts,
            "f".into(),
            "美元".into(),
            0.0,
            AccountKind::Fx,
            &opts,
        );
        assert_eq!(fx.fx_code.as_deref(), Some("USD"));

        let cash = add_account(
            &mut accounts,
            "k".into(),
            "现金".into(),
            0.0,
            AccountKind::Cash,
            &opts,
        );
        assert_eq!(cash.fx_code, None);
    }

    #[test]
    fn the_default_account_cannot_be_deleted() {
        let (mut accounts, mut ledger, mut cur) = seed();
        assert!(!remove_account(
            &mut accounts,
            &mut ledger,
            &mut cur,
            "default",
            9_000
        ));
        assert_eq!(accounts.len(), 3);
    }

    #[test]
    fn deleting_migrates_entries_that_spent_from_it() {
        let (mut accounts, mut ledger, mut cur) = seed();
        assert!(remove_account(
            &mut accounts,
            &mut ledger,
            &mut cur,
            "a1",
            9_000
        ));
        assert_eq!(ledger.get("e0").unwrap().acct.as_deref(), Some("default"));
        assert!(accounts.iter().all(|a| a.id != "a1"));
    }

    #[test]
    fn deleting_migrates_transfers_that_targeted_it() {
        // the case v7 left dangling
        let (mut accounts, mut ledger, mut cur) = seed();
        remove_account(&mut accounts, &mut ledger, &mut cur, "a1", 9_000);
        assert_eq!(
            ledger.get("e1").unwrap().acct_to.as_deref(),
            Some("default")
        );
        // the FROM side of that transfer is untouched
        assert_eq!(ledger.get("e1").unwrap().acct.as_deref(), Some("a2"));
    }

    #[test]
    fn the_migration_is_stamped_so_sync_can_see_it() {
        let (mut accounts, mut ledger, mut cur) = seed();
        remove_account(&mut accounts, &mut ledger, &mut cur, "a1", 9_000);
        let e = ledger.get("e0").unwrap();
        assert_eq!(e.updated_at, Some(9_000));
        assert_eq!(e.stamp_of("acct"), Some(9_000));
    }

    #[test]
    fn entries_on_other_accounts_are_left_alone() {
        let (mut accounts, mut ledger, mut cur) = seed();
        remove_account(&mut accounts, &mut ledger, &mut cur, "a1", 9_000);
        let e = ledger.get("e2").unwrap();
        assert_eq!(e.updated_at, None); // never stamped
        assert!(!e.has_stamps());
    }

    #[test]
    fn deleting_the_selected_account_falls_back_to_default() {
        let (mut accounts, mut ledger, mut cur) = seed();
        remove_account(&mut accounts, &mut ledger, &mut cur, "a1", 9_000);
        assert_eq!(cur, "default");
    }

    #[test]
    fn deleting_an_unselected_account_leaves_the_selection_alone() {
        let (mut accounts, mut ledger, mut cur) = seed();
        remove_account(&mut accounts, &mut ledger, &mut cur, "a2", 9_000);
        assert_eq!(cur, "a1");
    }

    #[test]
    fn archiving_stores_absence_rather_than_false() {
        let (mut accounts, _, mut cur) = seed();
        archive_account(&mut accounts, &mut cur, "a2", true);
        assert_eq!(
            accounts.iter().find(|a| a.id == "a2").unwrap().archived,
            Some(true)
        );

        archive_account(&mut accounts, &mut cur, "a2", false);
        assert_eq!(
            accounts.iter().find(|a| a.id == "a2").unwrap().archived,
            None
        );
    }

    #[test]
    fn the_default_account_cannot_be_archived() {
        let (mut accounts, _, mut cur) = seed();
        assert!(!archive_account(&mut accounts, &mut cur, "default", true));
        assert_eq!(accounts[0].archived, None);
    }

    #[test]
    fn archiving_the_selected_account_falls_back_to_default() {
        let (mut accounts, _, mut cur) = seed();
        archive_account(&mut accounts, &mut cur, "a1", true);
        assert_eq!(cur, "default");
    }

    #[test]
    fn unarchiving_the_selected_account_does_not_move_the_selection() {
        let (mut accounts, _, _) = seed();
        let mut cur = "a2".to_string();
        archive_account(&mut accounts, &mut cur, "a2", false);
        assert_eq!(cur, "a2");
    }

    #[test]
    fn an_archived_account_stays_pickable_while_it_is_the_selected_one() {
        let (mut accounts, _, _) = seed();
        let mut cur = "a2".to_string();
        archive_account(&mut accounts, &mut cur, "a2", true);
        let ids: Vec<&str> = pickable(&accounts, "a2")
            .iter()
            .map(|a| a.id.as_str())
            .collect();
        assert!(ids.contains(&"a2"));

        let ids: Vec<&str> = pickable(&accounts, "a1")
            .iter()
            .map(|a| a.id.as_str())
            .collect();
        assert!(!ids.contains(&"a2"));
    }
}
