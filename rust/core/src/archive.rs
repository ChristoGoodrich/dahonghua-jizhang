//! Archiving — keeping the new-entry pickers short without touching history.
//!
//! Ported from `src/domain/archive.ts`.
//!
//! Archiving an account (a cancelled card, a used-up prepaid) or a ledger (a
//! finished trip) takes it out of the pickers and nothing else: every past
//! entry keeps its account, every balance still counts, and the flag is always
//! reversible. Nothing here rewrites data — which is why all four functions are
//! filters and none of them is a mutation.

use crate::accounts::Account;

/// Accounts to offer for a **new** entry: the live ones, plus anything in
/// `keep`.
///
/// `keep` is the currently-selected account, so editing an old entry booked to
/// an archived account still shows that account selected rather than silently
/// dropping it. Original order preserved.
///
/// The TypeScript filters `keepIds` with `!!x`, so an empty string never keeps
/// anything — it is "no account selected" rather than an account named "".
pub fn picker_accounts<'a>(accounts: &'a [Account], keep: &[&str]) -> Vec<&'a Account> {
    let keep: Vec<&str> = keep.iter().copied().filter(|s| !s.is_empty()).collect();
    accounts
        .iter()
        .filter(|a| a.archived != Some(true) || keep.contains(&a.id.as_str()))
        .collect()
}

/// The accounts shown in the archived section of the accounts screen.
pub fn archived_accounts(accounts: &[Account]) -> Vec<&Account> {
    accounts
        .iter()
        .filter(|a| a.archived == Some(true))
        .collect()
}

/// Ledgers to offer in the filter bar and record sheet: the live ones plus
/// `keep`.
///
/// Unlike [`picker_accounts`], `keep` here is a single name and is **not**
/// emptiness-checked — an empty `keep` still matches an archived ledger named
/// `""`. Reproduced rather than made consistent: the two functions were written
/// at different times and an empty ledger name is a real, if odd, state.
pub fn picker_ledgers<'a>(ledgers: &'a [String], archived: &[String], keep: &str) -> Vec<&'a str> {
    ledgers
        .iter()
        .filter(|l| !archived.contains(l) || l.as_str() == keep)
        .map(String::as_str)
        .collect()
}

/// The archived ledgers, in their original order.
pub fn archived_ledgers<'a>(ledgers: &'a [String], archived: &[String]) -> Vec<&'a str> {
    ledgers
        .iter()
        .filter(|l| archived.contains(l))
        .map(String::as_str)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acct(id: &str, archived: Option<bool>) -> Account {
        Account {
            id: id.into(),
            name: id.into(),
            archived,
            ..Default::default()
        }
    }

    fn ids(v: Vec<&Account>) -> Vec<String> {
        v.into_iter().map(|a| a.id.clone()).collect()
    }

    #[test]
    fn the_picker_drops_archived_accounts() {
        let accounts = vec![
            acct("a", None),
            acct("b", Some(true)),
            acct("c", Some(false)),
        ];
        assert_eq!(ids(picker_accounts(&accounts, &[])), vec!["a", "c"]);
    }

    #[test]
    fn the_picker_keeps_the_selected_one() {
        let accounts = vec![acct("a", None), acct("b", Some(true))];
        assert_eq!(ids(picker_accounts(&accounts, &["b"])), vec!["a", "b"]);
    }

    #[test]
    fn an_empty_keep_id_keeps_nothing() {
        // `keepIds.filter(x => !!x)` — "" is no selection, not an account
        let accounts = vec![acct("", Some(true)), acct("a", None)];
        assert_eq!(ids(picker_accounts(&accounts, &[""])), vec!["a"]);
    }

    #[test]
    fn the_original_order_survives() {
        let accounts = vec![acct("z", None), acct("a", None), acct("m", Some(true))];
        assert_eq!(ids(picker_accounts(&accounts, &["m"])), vec!["z", "a", "m"]);
    }

    #[test]
    fn the_archived_section_is_the_complement() {
        let accounts = vec![
            acct("a", None),
            acct("b", Some(true)),
            acct("c", Some(false)),
        ];
        assert_eq!(ids(archived_accounts(&accounts)), vec!["b"]);
    }

    #[test]
    fn ledgers_filter_the_same_way() {
        let ledgers: Vec<String> = ["home", "trip", "work"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let archived = vec!["trip".to_string()];
        assert_eq!(
            picker_ledgers(&ledgers, &archived, ""),
            vec!["home", "work"]
        );
        assert_eq!(
            picker_ledgers(&ledgers, &archived, "trip"),
            vec!["home", "trip", "work"]
        );
        assert_eq!(archived_ledgers(&ledgers, &archived), vec!["trip"]);
    }

    #[test]
    fn an_empty_keep_does_match_an_empty_ledger_name() {
        // the asymmetry with picker_accounts, reproduced rather than tidied
        let ledgers = vec![String::new(), "home".to_string()];
        let archived = vec![String::new()];
        assert_eq!(picker_ledgers(&ledgers, &archived, ""), vec!["", "home"]);
    }

    #[test]
    fn nothing_archived_changes_nothing() {
        let ledgers: Vec<String> = ["a", "b"].iter().map(|s| s.to_string()).collect();
        assert_eq!(picker_ledgers(&ledgers, &[], ""), vec!["a", "b"]);
        assert!(archived_ledgers(&ledgers, &[]).is_empty());
    }
}
