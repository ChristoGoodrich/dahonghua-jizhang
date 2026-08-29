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
use crate::entry::{Entry, EntrySource, Io, Patch};
use crate::ledger::{Ledger, RemoveUndo};
use crate::model::Budgets;

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

/// What a transfer needs. `from` and `to` are account ids.
#[derive(Debug, Clone, Default)]
pub struct TransferOpts {
    pub from: String,
    pub to: String,
    pub amt: f64,
    pub fee: Option<f64>,
    pub discount: Option<f64>,
    pub note: Option<String>,
    pub ledger: Option<String>,
    /// When the transfer happened; the caller's clock when absent.
    pub ts: Option<i64>,
}

/// One row of a bill import, after the candidate has been accepted.
///
/// `ts` is already an epoch millisecond: the candidate carried a civil date,
/// and turning that into an instant needs a timezone, which is the platform's.
#[derive(Debug, Clone)]
pub struct ImportedBill {
    pub io: Io,
    pub cat: String,
    pub amt: f64,
    pub note: String,
    pub ts: i64,
}

impl Store {
    /// Record a transfer between two accounts as one `xfer` entry.
    ///
    /// The fee comes off the FROM account and the discount credits the TO
    /// account; `io` keeps the row out of income and expense statistics.
    ///
    /// Two details differ from [`Store::add_entry`] and both are deliberate.
    /// The current account moves **unconditionally** here, where `add_entry`
    /// only moves it for an entry that names one — a transfer always has a
    /// `from`, so there is nothing to guard. And the falsy-means-absent idiom
    /// applies to `fee` and `discount`: a zero fee is no fee, not a fee of
    /// zero, because that is what `p.fee || undefined` says.
    pub fn add_transfer(&mut self, p: TransferOpts, id: String, now: i64) -> String {
        let entry = Entry {
            id,
            ts: p.ts.unwrap_or(now),
            io: Some(Io::Xfer),
            cat: "transfer".into(),
            amt: p.amt,
            acct: Some(p.from.clone()),
            acct_to: Some(p.to),
            fee: p.fee.filter(|f| truthy(*f)),
            discount: p.discount.filter(|d| truthy(*d)),
            note: p
                .note
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            ledger: p.ledger.filter(|l| !l.is_empty()),
            updated_at: Some(now),
            ..Default::default()
        };
        let entry_id = entry.id.clone();
        // pushed rather than routed through Ledger::add, which would re-assign
        // the id and the stamp this has already set
        self.ledger.push_raw(entry);
        self.current_account = p.from;
        entry_id
    }

    /// Append accepted bills in one write. Returns how many landed.
    ///
    /// `updated_at` is `now + i` rather than `now` for every row. That is not
    /// cosmetic: the sync merge resolves ties by last-write-wins, and a hundred
    /// rows sharing a millisecond would order by whatever the tiebreak
    /// happens to compare. Spacing them keeps a re-import deterministic.
    ///
    /// `ids` is the caller's — identity is a platform concern, as everywhere
    /// else in this crate. A short list silently imports fewer rows, matching
    /// nothing in the TypeScript because the TypeScript generates its own; the
    /// caller is expected to supply one id per bill.
    pub fn import_bills(&mut self, bills: &[ImportedBill], ids: &[String], now: i64) -> usize {
        self.push_batch(bills, ids, now, EntrySource::Bill)
    }

    /// Record payments the notification listener captured. Returns how many
    /// landed.
    ///
    /// The same write as [`Store::import_bills`] under a different source, and
    /// the source is what makes it more than a label: the drain planner reads
    /// `src == notif` to know which ledger rows already stand for a captured
    /// payment. An entry written without it would be invisible to the dedup and
    /// the next drain would post it again.
    pub fn post_captured(&mut self, drafts: &[ImportedBill], ids: &[String], now: i64) -> usize {
        self.push_batch(drafts, ids, now, EntrySource::Notif)
    }

    /// One write for a batch of rows that arrived from outside the app.
    ///
    /// `updated_at` steps by one per row so a batch has a stable order rather
    /// than an arbitrary one among entries sharing a millisecond.
    fn push_batch(
        &mut self,
        bills: &[ImportedBill],
        ids: &[String],
        now: i64,
        src: EntrySource,
    ) -> usize {
        if bills.is_empty() {
            return 0;
        }
        let n = bills.len().min(ids.len());
        for (i, b) in bills.iter().take(n).enumerate() {
            self.ledger.push_raw(Entry {
                id: ids[i].clone(),
                ts: b.ts,
                io: Some(b.io),
                cat: b.cat.clone(),
                amt: b.amt,
                note: (!b.note.is_empty()).then(|| b.note.clone()),
                src: Some(src),
                updated_at: Some(now + i as i64),
                ..Default::default()
            });
        }
        n
    }
}

/// `!!x` for a float, which is not `x != 0.0`: JavaScript counts `NaN` as
/// falsy too, and `p.fee || undefined` therefore drops it.
fn truthy(x: f64) -> bool {
    x != 0.0 && !x.is_nan()
}

/// Set, or clear, a per-category budget cap.
///
/// An amount of zero or less removes the cap rather than storing it.
///
/// The map is written back even when it ends up empty. That is what the
/// TypeScript does — it always calls `.set(cb)` — and the difference matters to
/// sync: an empty object is a value with a write time, where a missing field is
/// not, so clearing the last cap on one device has to be able to beat a stale
/// cap held on another.
pub fn set_cat_budget(budgets: &mut Budgets, cat_key: &str, amt: f64) {
    let mut map = budgets.per_category.take().unwrap_or_default();
    if amt > 0.0 {
        map.insert(cat_key.to_string(), amt);
    } else {
        map.remove(cat_key);
    }
    budgets.per_category = Some(map);
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

    fn transfer(from: &str, to: &str, amt: f64) -> TransferOpts {
        TransferOpts {
            from: from.into(),
            to: to.into(),
            amt,
            ..Default::default()
        }
    }

    #[test]
    fn a_transfer_names_both_accounts_and_stays_out_of_the_statistics() {
        let mut s = Store::new();
        let id = s.add_transfer(transfer("a1", "a2", 100.0), "t0".into(), 5_000);
        let e = s.ledger.all().last().unwrap();
        assert_eq!(e.id, id);
        assert_eq!(e.io, Some(Io::Xfer));
        assert_eq!(e.cat, "transfer");
        assert_eq!(e.acct.as_deref(), Some("a1"));
        assert_eq!(e.acct_to.as_deref(), Some("a2"));
        assert_eq!(e.updated_at, Some(5_000));
        assert_eq!(e.ts, 5_000);
    }

    #[test]
    fn a_transfer_moves_the_current_account_to_its_source() {
        let mut s = Store::new();
        s.add_transfer(transfer("a1", "a2", 100.0), "t0".into(), 0);
        assert_eq!(s.current_account, "a1");
    }

    #[test]
    fn a_zero_fee_is_no_fee_at_all() {
        let mut s = Store::new();
        let mut p = transfer("a1", "a2", 100.0);
        p.fee = Some(0.0);
        p.discount = Some(0.0);
        s.add_transfer(p, "t0".into(), 0);
        let e = s.ledger.all().last().unwrap();
        // `p.fee || undefined` — a zero fee is absent, not a fee of zero
        assert_eq!(e.fee, None);
        assert_eq!(e.discount, None);

        let mut p = transfer("a1", "a2", 100.0);
        p.fee = Some(2.5);
        s.add_transfer(p, "t1".into(), 0);
        assert_eq!(s.ledger.all().last().unwrap().fee, Some(2.5));
    }

    #[test]
    fn a_blank_note_or_ledger_is_absent() {
        let mut s = Store::new();
        let mut p = transfer("a1", "a2", 100.0);
        p.note = Some("   ".into());
        p.ledger = Some(String::new());
        s.add_transfer(p, "t0".into(), 0);
        let e = s.ledger.all().last().unwrap();
        assert_eq!(e.note, None);
        assert_eq!(e.ledger, None);

        let mut p = transfer("a1", "a2", 100.0);
        p.note = Some("  给妈妈  ".into());
        s.add_transfer(p, "t1".into(), 0);
        assert_eq!(
            s.ledger.all().last().unwrap().note.as_deref(),
            Some("给妈妈")
        );
    }

    #[test]
    fn a_transfer_keeps_an_explicit_timestamp() {
        let mut s = Store::new();
        let mut p = transfer("a1", "a2", 100.0);
        p.ts = Some(1_700_000_000_000);
        s.add_transfer(p, "t0".into(), 5_000);
        let e = s.ledger.all().last().unwrap();
        assert_eq!(e.ts, 1_700_000_000_000);
        // the stamp is still the clock, not the backdated time
        assert_eq!(e.updated_at, Some(5_000));
    }

    fn bill(cat: &str, amt: f64, note: &str, ts: i64) -> ImportedBill {
        ImportedBill {
            io: Io::Exp,
            cat: cat.into(),
            amt,
            note: note.into(),
            ts,
        }
    }

    #[test]
    fn imported_bills_land_as_ordinary_entries_marked_as_bills() {
        let mut s = Store::new();
        let bills = vec![
            bill("food", 35.5, "肯德基 · 午餐", 1_000),
            bill("trans", 12.0, "", 2_000),
        ];
        let ids = vec!["bi0".to_string(), "bi1".to_string()];
        assert_eq!(s.import_bills(&bills, &ids, 9_000), 2);

        let e = &s.ledger.all()[0];
        assert_eq!(e.id, "bi0");
        assert_eq!(e.src, Some(EntrySource::Bill));
        assert_eq!(e.ts, 1_000);
        assert_eq!(e.note.as_deref(), Some("肯德基 · 午餐"));
        // an empty note is absent, not an empty string
        assert_eq!(s.ledger.all()[1].note, None);
    }

    #[test]
    fn each_imported_row_gets_its_own_write_time() {
        let mut s = Store::new();
        let bills = vec![
            bill("food", 1.0, "", 0),
            bill("food", 2.0, "", 0),
            bill("food", 3.0, "", 0),
        ];
        let ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        s.import_bills(&bills, &ids, 9_000);
        let stamps: Vec<_> = s.ledger.all().iter().map(|e| e.updated_at).collect();
        // spaced, so last-write-wins has something to order by
        assert_eq!(stamps, vec![Some(9_000), Some(9_001), Some(9_002)]);
    }

    #[test]
    fn importing_nothing_writes_nothing() {
        let mut s = Store::new();
        assert_eq!(s.import_bills(&[], &[], 0), 0);
        assert!(s.ledger.all().is_empty());
    }

    #[test]
    fn an_import_does_not_move_the_current_account() {
        let mut s = Store::new();
        s.current_account = "a9".into();
        s.import_bills(&[bill("food", 1.0, "", 0)], &["x".to_string()], 0);
        assert_eq!(s.current_account, "a9");
    }

    #[test]
    fn a_budget_cap_is_set_and_cleared_by_its_amount() {
        let mut b = Budgets::default();
        set_cat_budget(&mut b, "food", 800.0);
        assert_eq!(b.per_category.as_ref().unwrap().get("food"), Some(&800.0));

        set_cat_budget(&mut b, "food", 0.0);
        assert_eq!(b.per_category.as_ref().unwrap().get("food"), None);
    }

    #[test]
    fn a_negative_cap_clears_rather_than_stores() {
        let mut b = Budgets::default();
        set_cat_budget(&mut b, "food", 800.0);
        set_cat_budget(&mut b, "food", -5.0);
        assert!(b.per_category.as_ref().unwrap().is_empty());
    }

    #[test]
    fn the_map_survives_as_an_empty_map_rather_than_vanishing() {
        // the TypeScript always calls .set(cb); an empty object is a value with
        // a write time, and a clear has to be able to beat a stale cap
        let mut b = Budgets::default();
        set_cat_budget(&mut b, "food", 0.0);
        assert_eq!(b.per_category, Some(std::collections::BTreeMap::new()));
    }
}
