//! The small catalogues: quick-log templates, tags and ledgers, and
//! user-defined categories.
//!
//! Ported from `store/templates.ts`, `store/tags.ts` and `store/categories.ts`.
//! Together they are barely eighty lines of TypeScript, and every one of them
//! carries the same rule the ledger did: **a falsy value is stored as absent.**
//! An empty archived-ledger list becomes `undefined`, not `[]`, because an
//! explicit empty array would survive a sync round-trip as a field that is set.
//!
//! Ids and category keys are arguments here rather than generated, for the
//! reason they are everywhere else in this crate — `newId()` and `'c' +
//! Date.now()` both read a clock.

use crate::entry::Io;
use crate::model::Template;
use std::collections::BTreeMap;

/// Accent colours for custom categories, cycled by position.
pub const CAT_PALETTE: [&str; 8] = [
    "#C9778A", "#7FA8C9", "#6FB59A", "#C9A35C", "#9B8FC9", "#D08C6C", "#6FA8B5", "#D88AA0",
];

#[derive(Debug, Clone, PartialEq)]
pub struct Category {
    pub k: String,
    /// Emoji.
    pub e: String,
    pub zh: String,
    pub en: String,
    /// Accent colour.
    pub c: String,
    pub custom: Option<bool>,
}

/// The built-in categories, in picker order.
///
/// `xfer` is deliberately empty: transfers have no real category. It is kept so
/// the lookup stays total over every `Io`.
pub fn base_cats(
    io: Io,
) -> &'static [(
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
)] {
    match io {
        Io::Exp => &[
            ("food", "🍜", "餐饮", "Food", "#E89B6C"),
            ("shop", "🛍️", "购物", "Shopping", "#D08496"),
            ("trans", "🚇", "交通", "Transit", "#7FA8C9"),
            ("home", "🏠", "居家", "Home", "#9B8FC9"),
            ("fun", "🎮", "娱乐", "Fun", "#6FB59A"),
            ("health", "💊", "医疗", "Health", "#D88AA0"),
            ("study", "📚", "学习", "Study", "#C9A35C"),
            ("gift", "🎁", "人情", "Gifts", "#D08C6C"),
            ("travel", "✈️", "旅行", "Travel", "#6FA8B5"),
            ("other", "📦", "其他", "Other", "#A89E92"),
        ],
        Io::Inc => &[
            ("salary", "💰", "工资", "Salary", "#6FA88F"),
            ("bonus", "🧧", "奖金", "Bonus", "#D94E5C"),
            ("invest", "📈", "理财", "Invest", "#6FA88F"),
            ("parttime", "💼", "兼职", "Side job", "#7C9C8F"),
            ("other", "✨", "其他", "Other", "#E8A838"),
        ],
        Io::Xfer => &[],
    }
}

fn to_category(t: &(&str, &str, &str, &str, &str)) -> Category {
    Category {
        k: t.0.to_string(),
        e: t.1.to_string(),
        zh: t.2.to_string(),
        en: t.3.to_string(),
        c: t.4.to_string(),
        custom: None,
    }
}

/// Shown for transfers, and the guard that keeps [`cat_of`] total when a
/// direction has no categories at all.
pub fn transfer_cat() -> Category {
    Category {
        k: "transfer".into(),
        e: "🔄".into(),
        zh: "转账".into(),
        en: "Transfer".into(),
        c: "#A89E92".into(),
        custom: None,
    }
}

/// Built-in categories for a direction, then the user's own.
pub fn all_cats(io: Io, custom: &[Category]) -> Vec<Category> {
    base_cats(io)
        .iter()
        .map(to_category)
        .chain(custom.iter().cloned())
        .collect()
}

/// Look up a category, falling back to the **last** one rather than to a
/// generic "other" — inherited from v7, and load-bearing: a custom category
/// added last becomes the fallback for that direction.
pub fn cat_of(io: Io, k: &str, custom: &[Category]) -> Category {
    let list = all_cats(io, custom);
    list.iter()
        .find(|c| c.k == k)
        .cloned()
        .or_else(|| list.last().cloned())
        .unwrap_or_else(transfer_cat)
}

/// The name in the caller's language, falling back to the other one when a
/// custom category only filled in one.
pub fn cat_name(c: &Category, zh: bool) -> String {
    let (first, second) = if zh { (&c.zh, &c.en) } else { (&c.en, &c.zh) };
    if first.is_empty() {
        second.clone()
    } else {
        first.clone()
    }
}

/* --------------------------------------------------------------- templates */

pub fn add_template(templates: &mut Vec<Template>, mut t: Template, id: String) -> Template {
    t.id = id;
    templates.push(t.clone());
    t
}

pub fn remove_template(templates: &mut Vec<Template>, id: &str) {
    templates.retain(|t| t.id != id);
}

/// What logging a template produces, before the ledger stamps it.
///
/// The note falls back to an empty string rather than staying absent — the
/// TypeScript writes `tpl.note ?? ''` — while the ledger falls back to *absent*
/// when there is no current one, because `curLedger || undefined` treats the
/// empty string as nothing.
#[derive(Debug, Clone, PartialEq)]
pub struct TemplateDraft {
    pub io: Io,
    pub cat: String,
    pub amt: f64,
    pub note: String,
    pub acct: String,
    pub ledger: Option<String>,
}

/// Build the entry a template would log. `None` for an unknown id, matching the
/// TypeScript's `null`.
pub fn template_draft(
    templates: &[Template],
    id: &str,
    current_account: &str,
    current_ledger: &str,
) -> Option<TemplateDraft> {
    let t = templates.iter().find(|t| t.id == id)?;
    Some(TemplateDraft {
        io: t.io,
        cat: t.cat.clone(),
        amt: t.amt,
        note: t.note.clone().unwrap_or_default(),
        acct: current_account.to_string(),
        ledger: (!current_ledger.is_empty()).then(|| current_ledger.to_string()),
    })
}

/* -------------------------------------------------------------------- tags */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TagKind {
    Normal,
    Ledger,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Tags {
    pub normal: Vec<String>,
    pub ledger: Vec<String>,
}

impl Tags {
    fn list_mut(&mut self, kind: TagKind) -> &mut Vec<String> {
        match kind {
            TagKind::Normal => &mut self.normal,
            TagKind::Ledger => &mut self.ledger,
        }
    }
}

/// Add a tag if it is not already there. Duplicates are ignored, not an error.
pub fn add_tag(tags: &mut Tags, kind: TagKind, name: &str) {
    let list = tags.list_mut(kind);
    if !list.iter().any(|g| g == name) {
        list.push(name.to_string());
    }
}

/// Remove a tag. Removing the *active* ledger also clears the filter, so the
/// list does not stay filtered by something that no longer exists.
pub fn remove_tag(tags: &mut Tags, kind: TagKind, name: &str, current_ledger: &mut String) {
    tags.list_mut(kind).retain(|g| g != name);
    if kind == TagKind::Ledger && current_ledger == name {
        current_ledger.clear();
    }
}

/// Archive or unarchive a ledger. Archived ledgers drop out of the filter bar
/// and the record-sheet picker; entries already tagged with one keep the tag.
///
/// `archived` is `None` rather than an empty list when nothing is archived —
/// `next.length ? next : undefined` in the TypeScript. Same falsy-means-absent
/// rule as everywhere else, and the same reason: an explicit `[]` would survive
/// a sync round-trip as a field that is set.
pub fn archive_ledger(
    archived: &mut Option<Vec<String>>,
    name: &str,
    archive: bool,
    current_ledger: &mut String,
) {
    let mut list = archived.take().unwrap_or_default();
    if archive {
        if !list.iter().any(|l| l == name) {
            list.push(name.to_string());
        }
    } else {
        list.retain(|l| l != name);
    }
    *archived = (!list.is_empty()).then_some(list);

    if archive && current_ledger == name {
        current_ledger.clear();
    }
}

/* -------------------------------------------------------------- categories */

/// Create a custom category. `key` is the caller's — the TypeScript builds it
/// from `Date.now()`.
///
/// The accent cycles through [`CAT_PALETTE`] by how many custom categories that
/// direction already has, so a fresh one never repeats its neighbour until the
/// palette wraps.
pub fn add_custom_cat(list: &mut Vec<Category>, key: String, name: &str, emoji: &str) -> Category {
    let c = Category {
        k: key,
        e: emoji.to_string(),
        zh: name.to_string(),
        en: name.to_string(),
        c: CAT_PALETTE[list.len() % CAT_PALETTE.len()].to_string(),
        custom: Some(true),
    };
    list.push(c.clone());
    c
}

#[derive(Debug, Clone, PartialEq)]
pub struct Subcat {
    pub k: String,
    pub name: String,
}

/// Subcategories, keyed by the category they hang off.
pub type Subcats = BTreeMap<String, Vec<Subcat>>;

pub fn add_subcat(subcats: &mut Subcats, cat_key: &str, id: String, name: &str) {
    subcats
        .entry(cat_key.to_string())
        .or_default()
        .push(Subcat {
            k: id,
            name: name.to_string(),
        });
}

/// Remove one subcategory. The category's list is left in place even when it
/// empties — the TypeScript writes the empty array back rather than deleting
/// the key, and the pickers read it either way.
pub fn remove_subcat(subcats: &mut Subcats, cat_key: &str, k: &str) {
    subcats
        .entry(cat_key.to_string())
        .or_default()
        .retain(|sc| sc.k != k);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tpl(id: &str, amt: f64, note: Option<&str>) -> Template {
        Template {
            id: id.into(),
            io: Io::Exp,
            cat: "food".into(),
            amt,
            note: note.map(|s| s.to_string()),
            name: "午饭".into(),
        }
    }

    #[test]
    fn templates_are_added_and_removed_by_id() {
        let mut list = vec![];
        add_template(&mut list, tpl("", 35.0, None), "t0".into());
        add_template(&mut list, tpl("", 12.0, None), "t1".into());
        assert_eq!(list.len(), 2);

        remove_template(&mut list, "t0");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "t1");

        remove_template(&mut list, "nope"); // idempotent
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn a_template_draft_carries_the_current_account_and_ledger() {
        let list = vec![tpl("t0", 35.0, Some("午饭"))];
        let d = template_draft(&list, "t0", "a1", "旅行").unwrap();
        assert_eq!(d.amt, 35.0);
        assert_eq!(d.note, "午饭");
        assert_eq!(d.acct, "a1");
        assert_eq!(d.ledger.as_deref(), Some("旅行"));
    }

    #[test]
    fn a_template_without_a_note_logs_an_empty_one_not_an_absent_one() {
        let list = vec![tpl("t0", 35.0, None)];
        assert_eq!(template_draft(&list, "t0", "a1", "").unwrap().note, "");
    }

    #[test]
    fn no_current_ledger_means_no_ledger_at_all() {
        // `curLedger || undefined` — the empty string is nothing
        let list = vec![tpl("t0", 35.0, None)];
        assert_eq!(template_draft(&list, "t0", "a1", "").unwrap().ledger, None);
    }

    #[test]
    fn an_unknown_template_drafts_nothing() {
        assert!(template_draft(&[], "t0", "a1", "").is_none());
    }

    #[test]
    fn tags_do_not_duplicate() {
        let mut t = Tags::default();
        add_tag(&mut t, TagKind::Normal, "旅行");
        add_tag(&mut t, TagKind::Normal, "旅行");
        assert_eq!(t.normal, ["旅行"]);
    }

    #[test]
    fn the_two_tag_lists_are_independent() {
        let mut t = Tags::default();
        add_tag(&mut t, TagKind::Normal, "x");
        add_tag(&mut t, TagKind::Ledger, "x");
        assert_eq!(t.normal, ["x"]);
        assert_eq!(t.ledger, ["x"]);

        let mut cur = String::new();
        remove_tag(&mut t, TagKind::Normal, "x", &mut cur);
        assert!(t.normal.is_empty());
        assert_eq!(t.ledger, ["x"]);
    }

    #[test]
    fn removing_the_active_ledger_clears_the_filter() {
        let mut t = Tags::default();
        add_tag(&mut t, TagKind::Ledger, "旅行");
        let mut cur = "旅行".to_string();
        remove_tag(&mut t, TagKind::Ledger, "旅行", &mut cur);
        assert_eq!(cur, "");
    }

    #[test]
    fn removing_a_different_ledger_leaves_the_filter_alone() {
        let mut t = Tags::default();
        add_tag(&mut t, TagKind::Ledger, "旅行");
        add_tag(&mut t, TagKind::Ledger, "家用");
        let mut cur = "旅行".to_string();
        remove_tag(&mut t, TagKind::Ledger, "家用", &mut cur);
        assert_eq!(cur, "旅行");
    }

    #[test]
    fn an_empty_archive_list_is_stored_as_absent() {
        let mut archived = None;
        let mut cur = String::new();

        archive_ledger(&mut archived, "旅行", true, &mut cur);
        assert_eq!(archived, Some(vec!["旅行".to_string()]));

        archive_ledger(&mut archived, "旅行", false, &mut cur);
        assert_eq!(archived, None); // not Some(vec![])
    }

    #[test]
    fn archiving_twice_does_not_duplicate() {
        let mut archived = None;
        let mut cur = String::new();
        archive_ledger(&mut archived, "旅行", true, &mut cur);
        archive_ledger(&mut archived, "旅行", true, &mut cur);
        assert_eq!(archived, Some(vec!["旅行".to_string()]));
    }

    #[test]
    fn archiving_the_active_ledger_resets_the_filter_to_all() {
        let mut archived = None;
        let mut cur = "旅行".to_string();
        archive_ledger(&mut archived, "旅行", true, &mut cur);
        assert_eq!(cur, "");
    }

    #[test]
    fn unarchiving_the_active_ledger_does_not_reset_it() {
        let mut archived = Some(vec!["旅行".to_string()]);
        let mut cur = "旅行".to_string();
        archive_ledger(&mut archived, "旅行", false, &mut cur);
        assert_eq!(cur, "旅行");
    }

    #[test]
    fn custom_categories_cycle_the_palette_by_position() {
        let mut list = vec![];
        for i in 0..10 {
            let c = add_custom_cat(&mut list, format!("c{i}"), "名", "🌸");
            assert_eq!(c.c, CAT_PALETTE[i % CAT_PALETTE.len()]);
        }
        assert_eq!(list[8].c, list[0].c); // wraps
    }

    #[test]
    fn a_custom_category_seeds_both_names_and_marks_itself_custom() {
        let mut list = vec![];
        let c = add_custom_cat(&mut list, "c1".into(), "宠物", "🐈");
        assert_eq!(c.zh, "宠物");
        assert_eq!(c.en, "宠物");
        assert_eq!(c.e, "🐈");
        assert_eq!(c.custom, Some(true));
    }

    #[test]
    fn subcategories_hang_off_their_category() {
        let mut m = Subcats::new();
        add_subcat(&mut m, "food", "sc0".into(), "早餐");
        add_subcat(&mut m, "food", "sc1".into(), "午餐");
        add_subcat(&mut m, "transport", "sc2".into(), "地铁");

        assert_eq!(m["food"].len(), 2);
        assert_eq!(m["transport"].len(), 1);

        remove_subcat(&mut m, "food", "sc0");
        assert_eq!(m["food"].len(), 1);
        assert_eq!(m["food"][0].name, "午餐");
    }

    #[test]
    fn emptying_a_category_leaves_the_key_behind() {
        // the TypeScript writes the empty array back rather than deleting
        let mut m = Subcats::new();
        add_subcat(&mut m, "food", "sc0".into(), "早餐");
        remove_subcat(&mut m, "food", "sc0");
        assert!(m.contains_key("food"));
        assert!(m["food"].is_empty());
    }

    #[test]
    fn removing_from_an_unknown_category_creates_it_empty() {
        // `map[catKey] ?? []` then written back — the TypeScript does the same
        let mut m = Subcats::new();
        remove_subcat(&mut m, "nope", "sc0");
        assert_eq!(m.get("nope"), Some(&vec![]));
    }
}
