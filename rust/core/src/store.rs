//! The store: the pieces of app state that have to change together.
//!
//! `Ledger` owns entries and `accounts.rs` owns accounts, and most operations
//! belong squarely to one or the other. A few do not, and those live here.
//!
//! The first of them was found by the parity harness rather than by reading the
//! TypeScript: `addEntry` sets the current account as a side effect, so that the
//! next entry defaults to wherever the last one was spent. That behaviour is
//! nobody's if `Ledger` stays pure about entries and `accounts` stays pure about
//! accounts — it needs an owner that can see both, and putting it in the replay
//! harness instead would have hidden real behaviour in test code.

use crate::accounts::{
    add_account, archive_account, remove_account, Account, AccountKind, NewAccountOpts,
    DEFAULT_ACCOUNT,
};
use crate::entry::{Entry, Patch};
use crate::ledger::{Ledger, RemoveUndo};

#[derive(Debug, Clone)]
pub struct Store {
    pub ledger: Ledger,
    pub accounts: Vec<Account>,
    /// Where the next entry defaults to.
    pub current_account: String,
}

impl Default for Store {
    /// A fresh store has the one account that cannot be deleted.
    fn default() -> Self {
        Store {
            ledger: Ledger::new(),
            accounts: vec![Account {
                id: DEFAULT_ACCOUNT.into(),
                name: "默认".into(),
                name_en: Some("Default".into()),
                ..Default::default()
            }],
            current_account: DEFAULT_ACCOUNT.to_string(),
        }
    }
}

impl Store {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record an entry, and remember the account it landed on.
    ///
    /// The second half is the part that is easy to miss: the record sheet opens
    /// on `current_account`, so spending from a different account once makes it
    /// the default for the next entry. Only a real account moves it — an entry
    /// with none leaves the selection alone.
    pub fn add_entry(&mut self, entry: Entry, id: String, ts: Option<i64>, now: i64) -> String {
        let acct = entry.acct.clone();
        let entry_id = {
            let e = self.ledger.add(entry, id, ts, now);
            e.id.clone()
        };
        if let Some(a) = acct.filter(|a| !a.is_empty()) {
            self.current_account = a;
        }
        entry_id
    }

    pub fn update_entry(&mut self, id: &str, patch: &Patch, now: i64) -> bool {
        self.ledger.update(id, patch, now)
    }

    pub fn remove_entry(&mut self, id: &str, now: i64) -> Option<RemoveUndo> {
        self.ledger.remove(id, now)
    }

    pub fn unremove_entry(&mut self, undo: &RemoveUndo, now: i64) {
        self.ledger.unremove(undo, now)
    }

    pub fn add_account(
        &mut self,
        id: String,
        name: String,
        balance: f64,
        kind: AccountKind,
        opts: &NewAccountOpts,
    ) -> Account {
        add_account(&mut self.accounts, id, name, balance, kind, opts)
    }

    /// Delete an account and migrate everything that pointed at it.
    pub fn remove_account(&mut self, id: &str, now: i64) -> bool {
        remove_account(
            &mut self.accounts,
            &mut self.ledger,
            &mut self.current_account,
            id,
            now,
        )
    }

    pub fn archive_account(&mut self, id: &str, archived: bool) -> bool {
        archive_account(&mut self.accounts, &mut self.current_account, id, archived)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::Io;

    fn expense(amt: f64, acct: Option<&str>) -> Entry {
        Entry {
            ts: 1_000,
            io: Some(Io::Exp),
            cat: "food".into(),
            amt,
            acct: acct.map(|s| s.to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn a_fresh_store_has_the_default_account_selected() {
        let s = Store::new();
        assert_eq!(s.accounts.len(), 1);
        assert_eq!(s.current_account, "default");
    }

    #[test]
    fn recording_an_entry_makes_its_account_the_next_default() {
        let mut s = Store::new();
        s.add_account(
            "a0".into(),
            "招行".into(),
            0.0,
            AccountKind::Cash,
            &Default::default(),
        );
        s.add_entry(expense(35.0, Some("a0")), "e0".into(), Some(1_000), 1_000);
        assert_eq!(s.current_account, "a0");
    }

    #[test]
    fn an_entry_without_an_account_leaves_the_selection_alone() {
        let mut s = Store::new();
        s.add_account(
            "a0".into(),
            "招行".into(),
            0.0,
            AccountKind::Cash,
            &Default::default(),
        );
        s.add_entry(expense(35.0, Some("a0")), "e0".into(), Some(1_000), 1_000);
        s.add_entry(expense(12.0, None), "e1".into(), Some(1_000), 1_010);
        assert_eq!(s.current_account, "a0");
    }

    #[test]
    fn an_empty_account_string_is_not_an_account() {
        let mut s = Store::new();
        s.add_entry(expense(35.0, Some("")), "e0".into(), Some(1_000), 1_000);
        assert_eq!(s.current_account, "default");
    }

    #[test]
    fn deleting_the_selected_account_hands_the_selection_back_to_default() {
        let mut s = Store::new();
        s.add_account(
            "a0".into(),
            "招行".into(),
            0.0,
            AccountKind::Cash,
            &Default::default(),
        );
        s.add_entry(expense(35.0, Some("a0")), "e0".into(), Some(1_000), 1_000);
        assert_eq!(s.current_account, "a0");

        s.remove_account("a0", 2_000);
        assert_eq!(s.current_account, "default");
        assert_eq!(s.ledger.get("e0").unwrap().acct.as_deref(), Some("default"));
    }

    #[test]
    fn the_store_still_refuses_to_delete_the_default_account() {
        let mut s = Store::new();
        assert!(!s.remove_account("default", 2_000));
        assert_eq!(s.accounts.len(), 1);
    }
}
