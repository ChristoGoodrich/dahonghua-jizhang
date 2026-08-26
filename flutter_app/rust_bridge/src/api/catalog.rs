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

use dahonghua_core::catalog as core;
use dahonghua_core::entry::Io;
use flutter_rust_bridge::frb;

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
