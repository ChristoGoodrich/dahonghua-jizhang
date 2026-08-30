//! The palette, and which one is chosen.
//!
//! Every colour on every screen comes from here. `theme.dart` said so from the
//! day it was written — anything *computed* from a colour is a Rust call — and
//! until now the Dart side held one hard-coded light palette because there was
//! nothing to call.
//!
//! The choice lives here too rather than in Dart, for the same reason the cycle
//! start does: it is a setting the user made, it belongs in the config blob,
//! and a screen holding its own copy would be a second place for it to be
//! wrong.

use std::sync::{Mutex, MutexGuard, OnceLock};

use flutter_rust_bridge::frb;

use dahonghua_core::theme::{make_theme, swatch, ThemeKey};

/// The chosen flower, and whether the room is lit.
struct Choice {
    key: String,
    dark: bool,
}

fn choice() -> MutexGuard<'static, Choice> {
    static C: OnceLock<Mutex<Choice>> = OnceLock::new();
    let m = C.get_or_init(|| {
        Mutex::new(Choice {
            key: "default".into(),
            dark: false,
        })
    });
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// One palette, as strings. `#RRGGBB`, `#RRGGBBAA` or `rgba(…)` — parsing them
/// is the platform's, and `theme.dart` already has both functions for it.
#[derive(Debug, Clone, PartialEq)]
pub struct ThemeView {
    pub hibiscus: String,
    pub hibiscus_deep: String,
    pub hibiscus_soft: String,
    pub stamen: String,
    pub leaf: String,
    pub leaf_deep: String,
    pub paper: String,
    pub paper_warm: String,
    pub ink: String,
    pub ink_soft: String,
    pub line: String,
    pub card: String,
    pub tint: String,
    pub tint_strong: String,
    pub grad_from: String,
    pub grad_to: String,
    pub shadow: String,
    pub glow: String,
    pub overlay: String,
    pub is_dark: bool,
}

/// A theme the picker offers: its key and the accent it is recognised by.
#[derive(Debug, Clone, PartialEq)]
pub struct ThemeOption {
    pub key: String,
    pub swatch: String,
}

fn view(key: ThemeKey, dark: bool) -> ThemeView {
    let t = make_theme(key, dark);
    ThemeView {
        hibiscus: t.hibiscus,
        hibiscus_deep: t.hibiscus_deep,
        hibiscus_soft: t.hibiscus_soft,
        stamen: t.stamen,
        leaf: t.leaf,
        leaf_deep: t.leaf_deep,
        paper: t.paper,
        paper_warm: t.paper_warm,
        ink: t.ink,
        ink_soft: t.ink_soft,
        line: t.line,
        card: t.card,
        tint: t.tint,
        tint_strong: t.tint_strong,
        grad_from: t.grad_from,
        grad_to: t.grad_to,
        shadow: t.shadow,
        glow: t.glow,
        overlay: t.overlay,
        is_dark: t.is_dark,
    }
}

/// The palette in force.
#[frb(sync)]
pub fn current_theme() -> ThemeView {
    let c = choice();
    view(ThemeKey::parse(&c.key), c.dark)
}

/// One particular palette, for a picker that wants to draw a preview of a
/// theme nobody has chosen yet.
#[frb(sync)]
pub fn theme_of(key: String, dark: bool) -> ThemeView {
    view(ThemeKey::parse(&key), dark)
}

/// Which flower is chosen. An unknown stored key reads back as `default`,
/// which is what a config written by a build with one more flower should do.
#[frb(sync)]
pub fn theme_key() -> String {
    ThemeKey::parse(&choice().key).as_str().to_string()
}

#[frb(sync)]
pub fn is_dark() -> bool {
    choice().dark
}

#[frb(sync)]
pub fn set_theme(key: String, dark: bool) {
    let mut c = choice();
    // Normalised on the way in, so what is stored is always a key this build
    // understands and the config never carries a typo forward.
    c.key = ThemeKey::parse(&key).as_str().to_string();
    c.dark = dark;
}

/// Every theme, in the order the picker shows them.
#[frb(sync)]
pub fn theme_options() -> Vec<ThemeOption> {
    ThemeKey::ALL
        .iter()
        .map(|k| ThemeOption {
            key: k.as_str().to_string(),
            swatch: swatch(*k),
        })
        .collect()
}
