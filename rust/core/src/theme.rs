//! The palette: seven flowers, each in light and dark.
//!
//! Ported from `makeTheme` in `src/theme/tokens.ts`. It is colour arithmetic
//! with no I/O in it, which is exactly the shape this crate takes — and the
//! Flutter side already says so in `theme.dart`: anything *computed* from a
//! colour belongs here, and only the ink it is read against stays over there.
//!
//! Two things are worth reading twice, because both are load-bearing and
//! neither is obvious.
//!
//! **The alpha is string concatenation.** `base.hibiscus + '14'` appends two
//! hex digits to a six-digit colour, producing `#RRGGBBAA`. That is the
//! TypeScript's own trick and it is reproduced literally: a caller that parsed
//! the accent, applied an opacity and re-serialised would land on a different
//! byte for at least some accents, and the two halves of a migration have to
//! agree byte for byte or the corpus is worthless.
//!
//! **Dark mode replaces surfaces and keeps accents.** A flower stays its own
//! colour at night; only the room's paper, ink and lines change. That is why
//! `DARK_SURFACES` is applied *after* the theme's own overrides rather than
//! before — a dark sakura is sakura's accent on the shared dark paper, not
//! sakura's own paper darkened.

/// Which flower. `default` is the hibiscus the app is named for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeKey {
    Default,
    Sakura,
    Daisy,
    Jasmine,
    Ocean,
    Forest,
    Sunset,
}

impl ThemeKey {
    /// The order the picker shows them in.
    pub const ALL: [ThemeKey; 7] = [
        ThemeKey::Default,
        ThemeKey::Sakura,
        ThemeKey::Daisy,
        ThemeKey::Jasmine,
        ThemeKey::Ocean,
        ThemeKey::Forest,
        ThemeKey::Sunset,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            ThemeKey::Default => "default",
            ThemeKey::Sakura => "sakura",
            ThemeKey::Daisy => "daisy",
            ThemeKey::Jasmine => "jasmine",
            ThemeKey::Ocean => "ocean",
            ThemeKey::Forest => "forest",
            ThemeKey::Sunset => "sunset",
        }
    }

    /// An unknown key is the default rather than an error — a stored theme from
    /// a newer build should not stop the app from opening.
    pub fn parse(s: &str) -> ThemeKey {
        match s {
            "sakura" => ThemeKey::Sakura,
            "daisy" => ThemeKey::Daisy,
            "jasmine" => ThemeKey::Jasmine,
            "ocean" => ThemeKey::Ocean,
            "forest" => ThemeKey::Forest,
            "sunset" => ThemeKey::Sunset,
            _ => ThemeKey::Default,
        }
    }
}

/// Every colour a screen may ask for, as `#RRGGBB`, `#RRGGBBAA` or `rgba(…)`.
///
/// Strings rather than a packed integer, because that is what the TypeScript
/// holds and what the corpus compares. Parsing them is the platform's job and
/// `theme.dart` already has the two functions for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Theme {
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
    /// Accent fill for a selected chip, about 8% alpha.
    pub tint: String,
    /// A stronger accent wash, about 15%.
    pub tint_strong: String,
    pub grad_from: String,
    pub grad_to: String,
    /// Warm brown on paper, black at night.
    pub shadow: String,
    pub glow: String,
    /// The scrim behind a sheet.
    pub overlay: String,
    pub is_dark: bool,
}

struct Base {
    hibiscus: &'static str,
    hibiscus_deep: &'static str,
    hibiscus_soft: &'static str,
    stamen: &'static str,
    leaf: &'static str,
    leaf_deep: &'static str,
    paper: &'static str,
    paper_warm: &'static str,
    ink: &'static str,
    ink_soft: &'static str,
    line: &'static str,
    card: &'static str,
}

const BASE: Base = Base {
    hibiscus: "#D94E5C",
    hibiscus_deep: "#B83A48",
    hibiscus_soft: "#EC9AA2",
    stamen: "#E8A838",
    leaf: "#6FA88F",
    leaf_deep: "#4E7A68",
    paper: "#FBF7F0",
    paper_warm: "#F6EEE2",
    ink: "#2B2622",
    ink_soft: "#8A8178",
    line: "#EADFCF",
    card: "#FFFFFF",
};

/// Per-theme accents, plus a faint light-mode surface tint so each flower sets
/// the whole room's atmosphere rather than only the buttons.
fn accents(key: ThemeKey) -> Base {
    let mut b = BASE;
    match key {
        ThemeKey::Default => {}
        ThemeKey::Sakura => {
            b.hibiscus = "#E8869B";
            b.hibiscus_deep = "#C76482";
            b.hibiscus_soft = "#F2B3C4";
            b.paper = "#FCF5F3";
            b.paper_warm = "#F8EBE8";
            b.line = "#F0DCDA";
        }
        ThemeKey::Daisy => {
            b.hibiscus = "#E0A93C";
            b.hibiscus_deep = "#BC8A26";
            b.hibiscus_soft = "#F0CE84";
            b.stamen = "#D94E5C";
            b.paper = "#FCF8ED";
            b.paper_warm = "#F7EFDA";
            b.line = "#EDE2C6";
        }
        ThemeKey::Jasmine => {
            b.hibiscus = "#7C9C8F";
            b.hibiscus_deep = "#5C7C6F";
            b.hibiscus_soft = "#A8C2B8";
            b.paper = "#F6F9F5";
            b.paper_warm = "#ECF1EA";
            b.line = "#DCE6DA";
        }
        ThemeKey::Ocean => {
            b.hibiscus = "#4A90B8";
            b.hibiscus_deep = "#3670A0";
            b.hibiscus_soft = "#8DC0E0";
            b.paper = "#F2F7FB";
            b.paper_warm = "#E4EEF6";
            b.line = "#D0DEE8";
        }
        ThemeKey::Forest => {
            b.hibiscus = "#5C8A5C";
            b.hibiscus_deep = "#3E6B3E";
            b.hibiscus_soft = "#94C494";
            b.paper = "#F3F7F2";
            b.paper_warm = "#E6EDE5";
            b.line = "#D5DFD4";
        }
        ThemeKey::Sunset => {
            b.hibiscus = "#D97840";
            b.hibiscus_deep = "#B85E2A";
            b.hibiscus_soft = "#E8AB80";
            b.paper = "#FBF5EF";
            b.paper_warm = "#F6EBE0";
            b.line = "#EEDDD0";
        }
    }
    b
}

/// The palette for one flower, lit or unlit.
pub fn make_theme(key: ThemeKey, dark: bool) -> Theme {
    let mut b = accents(key);
    if dark {
        // Surfaces only. The accent is what makes it that flower.
        b.paper = "#1C1A18";
        b.paper_warm = "#262320";
        b.ink = "#F0EAE2";
        b.ink_soft = "#9A9186";
        b.line = "#3A3531";
        b.card = "#262320";
    }

    // `base.hibiscus + '14'` — two hex digits appended to a six-digit colour.
    // Concatenation, not an opacity calculation; see the module header.
    let alpha = |c: &str, a: &str| format!("{c}{a}");

    Theme {
        hibiscus: b.hibiscus.into(),
        hibiscus_deep: b.hibiscus_deep.into(),
        hibiscus_soft: b.hibiscus_soft.into(),
        stamen: b.stamen.into(),
        leaf: b.leaf.into(),
        leaf_deep: b.leaf_deep.into(),
        paper: b.paper.into(),
        paper_warm: b.paper_warm.into(),
        ink: b.ink.into(),
        ink_soft: b.ink_soft.into(),
        line: b.line.into(),
        card: b.card.into(),
        tint: alpha(b.hibiscus, if dark { "26" } else { "14" }),
        tint_strong: alpha(b.hibiscus, if dark { "3D" } else { "26" }),
        grad_from: b.hibiscus.into(),
        grad_to: b.hibiscus_deep.into(),
        shadow: if dark { "#000000" } else { "#6B4632" }.into(),
        glow: b.hibiscus_deep.into(),
        // Warm ink rather than black: a neutral-black scrim reads as a cheap
        // dimmer over this palette. The room stays lit and the sheet still
        // separates.
        overlay: if dark {
            "rgba(10,8,7,0.58)"
        } else {
            "rgba(58,44,36,0.32)"
        }
        .into(),
        is_dark: dark,
    }
}

/// The accent shown as this theme's swatch in the picker.
pub fn swatch(key: ThemeKey) -> String {
    accents(key).hibiscus.to_string()
}

/* ---------------------------------------------------------------- warning */

/// The colour that says "too much": over a budget, more than last month, a
/// balance below zero, a permission missing, a row that will be deleted.
///
/// Every one of those used to be painted in the flower, which is right for a
/// warm flower and wrong for a cool one. In 森林 the flower is as green as the
/// leaf, and the leaf is what this app says "in" and "on track" with — so an
/// overspent budget, a card ¥3,120 in debt and "比上月同期多" all read as
/// good news. 茉莉 is the same green-grey; 海洋's blue says nothing either
/// way, which for a warning is saying nothing.
///
/// So a warm flower warns in its own colour and a cool one borrows 大红花's
/// red. Not a per-theme table: a flower added next year is warm or it is not,
/// and [warn] answers for it without being told.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Warn {
    /// On a tint, a bar, an icon.
    pub tone: String,
    /// Text on paper.
    pub deep: String,
}

pub fn warn(key: ThemeKey) -> Warn {
    let flower = accents(key);
    let from = if is_warm(flower.hibiscus) {
        flower
    } else {
        BASE
    };
    Warn {
        tone: from.hibiscus.into(),
        deep: from.hibiscus_deep.into(),
    }
}

/// Hue in degrees, `0..360`, of a `#RRGGBB`. `None` for a grey, which has
/// none, and for anything that is not six hex digits.
fn hue(hex: &str) -> Option<f64> {
    let h = hex.strip_prefix('#')?;
    if h.len() != 6 {
        return None;
    }
    let ch = |i: usize| u8::from_str_radix(h.get(i..i + 2)?, 16).ok();
    let (r, g, b) = (ch(0)? as f64, ch(2)? as f64, ch(4)? as f64);
    let max = r.max(g).max(b);
    let d = max - r.min(g).min(b);
    if d == 0.0 {
        return None;
    }
    let sector = if max == r {
        (g - b) / d
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    Some((sector * 60.0).rem_euclid(360.0))
}

/// Red through amber — the hues a warning is read in. A grey is not warm.
fn is_warm(hex: &str) -> bool {
    hue(hex).is_some_and(|h| !(60.0..330.0).contains(&h))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_theme_is_the_hibiscus_the_app_is_named_for() {
        assert_eq!(make_theme(ThemeKey::Default, false).hibiscus, "#D94E5C");
    }

    #[test]
    fn a_flower_keeps_its_accent_in_the_dark() {
        let light = make_theme(ThemeKey::Ocean, false);
        let dark = make_theme(ThemeKey::Ocean, true);
        assert_eq!(light.hibiscus, dark.hibiscus);
    }

    #[test]
    fn the_dark_surfaces_are_shared_rather_than_per_flower() {
        for key in ThemeKey::ALL {
            assert_eq!(make_theme(key, true).paper, "#1C1A18");
        }
    }

    #[test]
    fn a_light_flower_paints_its_own_paper() {
        assert_eq!(make_theme(ThemeKey::Sakura, false).paper, "#FCF5F3");
        assert_eq!(make_theme(ThemeKey::Forest, false).paper, "#F3F7F2");
    }

    #[test]
    fn the_tint_is_the_accent_with_two_hex_digits_stuck_on() {
        let t = make_theme(ThemeKey::Default, false);
        assert_eq!(t.tint, "#D94E5C14");
        assert_eq!(t.tint_strong, "#D94E5C26");
    }

    #[test]
    fn the_dark_tints_are_stronger() {
        let t = make_theme(ThemeKey::Default, true);
        assert_eq!(t.tint, "#D94E5C26");
        assert_eq!(t.tint_strong, "#D94E5C3D");
    }

    #[test]
    fn daisy_swaps_the_accent_and_the_stamen() {
        // The one theme whose stamen is not the shared amber.
        let t = make_theme(ThemeKey::Daisy, false);
        assert_eq!(t.hibiscus, "#E0A93C");
        assert_eq!(t.stamen, "#D94E5C");
    }

    #[test]
    fn an_unknown_key_is_the_default_rather_than_a_failure() {
        assert_eq!(ThemeKey::parse("chrysanthemum"), ThemeKey::Default);
        assert_eq!(ThemeKey::parse(""), ThemeKey::Default);
    }

    #[test]
    fn every_key_round_trips_through_its_name() {
        for key in ThemeKey::ALL {
            assert_eq!(ThemeKey::parse(key.as_str()), key);
        }
    }

    #[test]
    fn hues_are_the_usual_ones() {
        assert_eq!(hue("#FF0000"), Some(0.0));
        assert_eq!(hue("#00FF00"), Some(120.0));
        assert_eq!(hue("#0000FF"), Some(240.0));
        assert_eq!(hue("#FF00FF"), Some(300.0));
        assert_eq!(hue("#808080"), None);
        assert_eq!(hue("#FFF"), None);
        assert_eq!(hue("red"), None);
    }

    #[test]
    fn a_warm_flower_warns_in_its_own_colour() {
        for key in [
            ThemeKey::Default,
            ThemeKey::Sakura,
            ThemeKey::Daisy,
            ThemeKey::Sunset,
        ] {
            let t = make_theme(key, false);
            let w = warn(key);
            assert_eq!(w.tone, t.hibiscus, "{key:?}");
            assert_eq!(w.deep, t.hibiscus_deep, "{key:?}");
        }
    }

    #[test]
    fn a_cool_flower_borrows_the_hibiscus() {
        for key in [ThemeKey::Jasmine, ThemeKey::Ocean, ThemeKey::Forest] {
            assert_eq!(warn(key), warn(ThemeKey::Default), "{key:?}");
        }
    }

    /// The property the rule exists for, in every flower and both rooms: a
    /// warning is never within a quarter-turn of the leaf's hue, so nothing
    /// "too much" can be read as "in".
    #[test]
    fn no_warning_can_be_mistaken_for_the_leaf() {
        for key in ThemeKey::ALL {
            for dark in [false, true] {
                let leaf = hue(&make_theme(key, dark).leaf_deep).unwrap();
                let w = warn(key);
                for c in [&w.tone, &w.deep] {
                    let h = hue(c).unwrap();
                    let gap = (h - leaf).abs().min(360.0 - (h - leaf).abs());
                    assert!(gap >= 90.0, "{key:?} {c} is {gap:.0}° from the leaf");
                }
            }
        }
    }

    #[test]
    fn the_scrim_is_warm_ink_rather_than_black() {
        assert!(make_theme(ThemeKey::Default, false)
            .overlay
            .contains("58,44,36"));
    }
}
