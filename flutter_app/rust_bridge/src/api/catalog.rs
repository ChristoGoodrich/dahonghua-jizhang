//! Categories across the boundary.
//!
//! Every row of the entry list shows an emoji, a name and an accent colour, and
//! all three come from a lookup with two behaviours worth not reimplementing in
//! Dart:
//!
//! * the fallback is the **last** category rather than a generic "other", which
//!   is inherited from v7 and load-bearing — a custom category added last
//!   becomes the fallback for that direction;
//! * a custom category that filled in only one language falls back to the other
//!   rather than showing an empty string.
//!
//! Neither is the kind of thing a second implementation gets right by accident.
//!
//! Tags, ledgers and templates live here too, because they live in
//! `catalog.rs` on the other side. Two of their rules are the sort that only
//! show themselves once broken: removing the **active** ledger clears the
//! filter, so the list does not stay filtered by something that no longer
//! exists; and the archived-ledger list is stored as *absent* rather than as an
//! empty array, because an explicit `[]` would survive a sync round-trip as a
//! field that is set.

use dahonghua_core::archive;
use dahonghua_core::catalog::{self as core, TagKind, Tags};
use dahonghua_core::entry::Io;
use dahonghua_core::model::Template;
use flutter_rust_bridge::frb;
use std::sync::{Mutex, MutexGuard, OnceLock};

/// A category, as Dart holds it.
#[derive(Debug, Clone, PartialEq)]
pub struct CategoryView {
    pub k: String,
    /// Emoji.
    pub e: String,
    pub zh: String,
    pub en: String,
    /// Accent colour, `#RRGGBB`.
    pub c: String,
    pub custom: bool,
}

impl From<core::Category> for CategoryView {
    fn from(c: core::Category) -> Self {
        CategoryView {
            k: c.k,
            e: c.e,
            zh: c.zh,
            en: c.en,
            c: c.c,
            custom: c.custom.unwrap_or(false),
        }
    }
}

impl From<CategoryView> for core::Category {
    fn from(c: CategoryView) -> Self {
        core::Category {
            k: c.k,
            e: c.e,
            zh: c.zh,
            en: c.en,
            c: c.c,
            custom: c.custom.then_some(true),
        }
    }
}

fn custom_of(custom: Vec<CategoryView>) -> Vec<core::Category> {
    custom.into_iter().map(Into::into).collect()
}

/// Every category for one direction, in picker order: built-ins then custom.
#[frb(sync)]
pub fn all_cats(io: String, custom: Vec<CategoryView>) -> Vec<CategoryView> {
    let io = Io::parse(&io).unwrap_or(Io::Exp);
    core::all_cats(io, &custom_of(custom))
        .into_iter()
        .map(Into::into)
        .collect()
}

/// Look up one category. Never fails: an unknown key falls back to the last.
#[frb(sync)]
pub fn cat_of(io: String, key: String, custom: Vec<CategoryView>) -> CategoryView {
    let io = Io::parse(&io).unwrap_or(Io::Exp);
    core::cat_of(io, &key, &custom_of(custom)).into()
}

/// A category's name in the caller's language.
#[frb(sync)]
pub fn cat_name(cat: CategoryView, zh: bool) -> String {
    core::cat_name(&cat.into(), zh)
}

/// The lookup and the naming in one call, which is what a list row wants.
///
/// A row draws four things and a round trip per row per rebuild is four times
/// more boundary crossing than it needs. This is one.
#[derive(Debug, Clone, PartialEq)]
pub struct CatLabel {
    pub emoji: String,
    pub name: String,
    /// `#RRGGBB`.
    pub color: String,
}

#[frb(sync)]
pub fn cat_label(io: String, key: String, zh: bool, custom: Vec<CategoryView>) -> CatLabel {
    let io = Io::parse(&io).unwrap_or(Io::Exp);
    let c = core::cat_of(io, &key, &custom_of(custom));
    CatLabel {
        emoji: c.e.clone(),
        name: core::cat_name(&c, zh),
        color: c.c.clone(),
    }
}

// ---------- tags, ledgers and templates ----------

/// The tag lists and what is archived.
///
/// One lock rather than three: removing a ledger has to reach the current
/// selection, and archiving one has to reach both the archived list and the
/// selection. Splitting them would mean taking two locks in an order that
/// matters.
///
/// Not part of the API surface: the generator would otherwise emit an accessor
/// per field, and two of the fields are core types it can only reach through an
/// opaque handle. What Dart gets is the functions below.
#[frb(ignore)]
#[derive(Debug, Clone, Default)]
pub(crate) struct Library {
    pub tags: Tags,
    /// `None` when nothing is archived — see the module docs.
    pub archived: Option<Vec<String>>,
    pub current_ledger: String,
    pub templates: Vec<Template>,
}

pub(crate) fn library() -> MutexGuard<'static, Library> {
    static L: OnceLock<Mutex<Library>> = OnceLock::new();
    let m = L.get_or_init(|| Mutex::new(Library::default()));
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub(crate) fn library_of() -> Library {
    library().clone()
}

pub(crate) fn set_library_inner(l: Library) {
    *library() = l;
}

fn kind_of(kind: &str) -> TagKind {
    if kind == "ledger" {
        TagKind::Ledger
    } else {
        TagKind::Normal
    }
}

/// The ordinary tags.
#[frb(sync)]
pub fn tags() -> Vec<String> {
    library().tags.normal.clone()
}

/// Every ledger, archived ones included.
#[frb(sync)]
pub fn ledgers() -> Vec<String> {
    library().tags.ledger.clone()
}

/// The ledgers a picker should offer: everything unarchived, plus `keep` even
/// when it is archived.
///
/// The exception is the point — an entry already on an archived ledger must not
/// silently move off it.
#[frb(sync)]
pub fn pickable_ledgers(keep: String) -> Vec<String> {
    let l = library();
    let archived = l.archived.clone().unwrap_or_default();
    archive::picker_ledgers(&l.tags.ledger, &archived, &keep)
        .into_iter()
        .map(str::to_string)
        .collect()
}

#[frb(sync)]
pub fn archived_ledgers() -> Vec<String> {
    let l = library();
    let archived = l.archived.clone().unwrap_or_default();
    archive::archived_ledgers(&l.tags.ledger, &archived)
        .into_iter()
        .map(str::to_string)
        .collect()
}

/// `normal` or `ledger`. A duplicate is ignored rather than refused.
#[frb(sync)]
pub fn add_tag(kind: String, name: String) {
    let mut l = library();
    core::add_tag(&mut l.tags, kind_of(&kind), &name);
}

/// Remove a tag. Removing the **active** ledger clears the filter too.
#[frb(sync)]
pub fn remove_tag(kind: String, name: String) {
    let mut l = library();
    let lib = &mut *l;
    core::remove_tag(
        &mut lib.tags,
        kind_of(&kind),
        &name,
        &mut lib.current_ledger,
    );
}

/// Archive or unarchive a ledger. Entries already tagged with it keep the tag;
/// archiving the active one clears the filter.
#[frb(sync)]
pub fn archive_ledger(name: String, archive: bool) {
    let mut l = library();
    let lib = &mut *l;
    core::archive_ledger(&mut lib.archived, &name, archive, &mut lib.current_ledger);
}

#[frb(sync)]
pub fn current_ledger() -> String {
    library().current_ledger.clone()
}

#[frb(sync)]
pub fn set_current_ledger(name: String) {
    library().current_ledger = name;
}

/// A pinned entry the record sheet offers as a one-tap chip.
#[derive(Debug, Clone, PartialEq)]
pub struct TemplateView {
    pub id: String,
    /// `exp` | `inc` | `xfer`.
    pub io: String,
    pub cat: String,
    pub amt: f64,
    pub note: Option<String>,
    pub name: String,
}

impl From<&Template> for TemplateView {
    fn from(t: &Template) -> Self {
        TemplateView {
            id: t.id.clone(),
            io: t.io.as_str().to_string(),
            cat: t.cat.clone(),
            amt: t.amt,
            note: t.note.clone(),
            name: t.name.clone(),
        }
    }
}

#[frb(sync)]
pub fn templates() -> Vec<TemplateView> {
    library().templates.iter().map(TemplateView::from).collect()
}

#[frb(sync)]
pub fn add_template(
    id: String,
    io: String,
    cat: String,
    amt: f64,
    note: Option<String>,
    name: String,
) -> String {
    let mut l = library();
    let t = core::add_template(
        &mut l.templates,
        Template {
            id: String::new(),
            io: Io::parse(&io).unwrap_or(Io::Exp),
            cat,
            amt,
            note,
            name,
        },
        id,
    );
    t.id
}

#[frb(sync)]
pub fn remove_template(id: String) {
    core::remove_template(&mut library().templates, &id);
}

/// What logging a template would produce, before the ledger stamps it.
///
/// The note falls back to an empty string while the ledger falls back to
/// **absent**: `tpl.note ?? ''` against `curLedger || undefined`, which treats
/// the empty string as nothing. Two fallbacks, two different answers, and the
/// difference is the sort a second implementation flattens.
#[derive(Debug, Clone, PartialEq)]
pub struct TemplateDraftView {
    pub io: String,
    pub cat: String,
    pub amt: f64,
    pub note: String,
    pub acct: String,
    pub ledger: Option<String>,
}

#[frb(sync)]
pub fn template_draft(id: String) -> Option<TemplateDraftView> {
    let l = library();
    let acct = super::store::store().current_account.clone();
    core::template_draft(&l.templates, &id, &acct, &l.current_ledger).map(|d| TemplateDraftView {
        io: d.io.as_str().to_string(),
        cat: d.cat,
        amt: d.amt,
        note: d.note,
        acct: d.acct,
        ledger: d.ledger,
    })
}
