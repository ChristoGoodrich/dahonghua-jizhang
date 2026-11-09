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

use dahonghua_core::theme::{make_theme, swatch, warn, Appearance, ThemeKey};

/// The chosen flower, the chosen room, and the phone's room.
///
/// `system_dark` is the platform's to know and is not saved: Dart reports it
/// at launch and whenever the phone changes it.
struct Choice {
    key: String,
    appearance: Appearance,
    system_dark: bool,
}

impl Choice {
    fn dark(&self) -> bool {
        self.appearance.is_dark(self.system_dark)
    }
}

fn choice() -> MutexGuard<'static, Choice> {
    static C: OnceLock<Mutex<Choice>> = OnceLock::new();
    let m = C.get_or_init(|| {
        Mutex::new(Choice {
            key: "default".into(),
            appearance: Appearance::System,
            system_dark: false,
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
    /// What says "too much". The flower when it is warm, 大红花's red when it
    /// is not — see `core::theme::warn`.
    pub warn: String,
    pub warn_deep: String,
}

/// A theme the picker offers: its key and the accent it is recognised by.
#[derive(Debug, Clone, PartialEq)]
pub struct ThemeOption {
    pub key: String,
    pub swatch: String,
}

fn view(key: ThemeKey, dark: bool) -> ThemeView {
    let t = make_theme(key, dark);
    let w = warn(key);
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
        warn: w.tone,
        warn_deep: w.deep,
    }
}

/// The palette in force.
#[frb(sync)]
pub fn current_theme() -> ThemeView {
    let c = choice();
    view(ThemeKey::parse(&c.key), c.dark())
}

/// Which flower is chosen. An unknown stored key reads back as `default`,
/// which is what a config written by a build with one more flower should do.
#[frb(sync)]
pub fn theme_key() -> String {
    ThemeKey::parse(&choice().key).as_str().to_string()
}

/// Whether the room is dark now: the choice, or the phone's when the choice
/// is to follow it.
#[frb(sync)]
pub fn is_dark() -> bool {
    choice().dark()
}

/// `system`, `light` or `dark`.
#[frb(sync)]
pub fn appearance() -> String {
    choice().appearance.as_str().to_string()
}

/// The flower, and a room chosen lit or dark — not the phone's. What a test
/// or the tour uses to stand in a known room.
#[frb(sync)]
pub fn set_theme(key: String, dark: bool) {
    let mut c = choice();
    // Normalised on the way in, so what is stored is always a key this build
    // understands and the config never carries a typo forward.
    c.key = ThemeKey::parse(&key).as_str().to_string();
    c.appearance = if dark {
        Appearance::Dark
    } else {
        Appearance::Light
    };
}

/// The flower alone, leaving the room as it was chosen.
#[frb(sync)]
pub fn set_flower(key: String) {
    choice().key = ThemeKey::parse(&key).as_str().to_string();
}

/// The room: `system`, `light` or `dark`. Anything else follows the phone.
#[frb(sync)]
pub fn set_appearance(appearance: String) {
    choice().appearance = Appearance::parse(&appearance).unwrap_or(Appearance::System);
}

/// Whether the phone's own room is dark, as the platform reports it.
#[frb(sync)]
pub fn set_system_dark(dark: bool) {
    choice().system_dark = dark;
}

/// A saved config's choice, read back. Not for Dart: the config is.
pub(crate) fn load_choice(key: String, appearance: Appearance) {
    let mut c = choice();
    c.key = ThemeKey::parse(&key).as_str().to_string();
    c.appearance = appearance;
}

/// The room as saved, in the two keys a config carries for it.
pub(crate) fn saved_appearance() -> Appearance {
    choice().appearance
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
