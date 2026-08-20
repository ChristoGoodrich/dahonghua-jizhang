//! 柔光玻璃 across the FFI boundary.
//!
//! The types here mirror `dahonghua_core::glass` rather than re-exporting it.
//! That is deliberate: the core answers to the parity harness, and its shapes
//! are chosen to match the TypeScript it replaces. The moment an FFI attribute
//! or a `String` field appears there to suit Dart, the core has started
//! answering to two masters. So the bridge converts, and the core stays pure.
//!
//! Everything is `sync` — these are arithmetic, measured in microseconds, and
//! a Flutter build method cannot await.

use dahonghua_core::glass as core;
use flutter_rust_bridge::frb;

/// Where a glass surface sits in the stack.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GlassLevel {
    Chrome,
    Sheet,
    Card,
}

/// How much of the material a device can actually render.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GlassTier {
    Full,
    Wash,
    Solid,
}

impl From<GlassLevel> for core::GlassLevel {
    fn from(l: GlassLevel) -> Self {
        match l {
            GlassLevel::Chrome => core::GlassLevel::Chrome,
            GlassLevel::Sheet => core::GlassLevel::Sheet,
            GlassLevel::Card => core::GlassLevel::Card,
        }
    }
}

impl From<GlassTier> for core::GlassTier {
    fn from(t: GlassTier) -> Self {
        match t {
            GlassTier::Full => core::GlassTier::Full,
            GlassTier::Wash => core::GlassTier::Wash,
            GlassTier::Solid => core::GlassTier::Solid,
        }
    }
}

impl From<core::GlassTier> for GlassTier {
    fn from(t: core::GlassTier) -> Self {
        match t {
            core::GlassTier::Full => GlassTier::Full,
            core::GlassTier::Wash => GlassTier::Wash,
            core::GlassTier::Solid => GlassTier::Solid,
        }
    }
}

/// The per-level constants, as Dart can hold them. `edge` widens from
/// `&'static str` to `String` because a borrowed lifetime cannot cross.
#[derive(Debug, Clone, PartialEq)]
pub struct GlassSpec {
    pub intensity: f64,
    pub wash_alpha: f64,
    pub wash_alpha_flat: f64,
    pub sheen: f64,
    pub sheen_height: f64,
    pub edge: String,
    /// Negative means "the platform's hairline" — Flutter substitutes
    /// `1 / devicePixelRatio`, the way `StyleSheet.hairlineWidth` did.
    pub edge_width: f64,
}

fn theme(is_dark: bool, card: String, paper: String) -> core::GlassTheme {
    core::GlassTheme {
        is_dark,
        card,
        paper,
    }
}

/// 感知环境颜色 — the wash a surface should paint over a given colour.
///
/// Returns a finished `rgba(...)`. Flutter parses it once rather than
/// recomputing the mix, which is the whole point of the arithmetic living in
/// Rust: a `color-mix` in a stylesheet needs a browser, and four numbers need
/// nothing.
#[frb(sync)]
pub fn wash_color(
    is_dark: bool,
    card: String,
    paper: String,
    level: GlassLevel,
    under: Option<String>,
    alpha: Option<f64>,
    surface: Option<String>,
) -> String {
    core::wash_color(
        &theme(is_dark, card, paper),
        level.into(),
        under.as_deref(),
        alpha,
        surface.as_deref(),
    )
}

/// 根据内容属性自动调整通透度.
#[frb(sync)]
pub fn readability_alpha(is_dark: bool, level: GlassLevel, density: f64, tier: GlassTier) -> f64 {
    core::readability_alpha(
        &theme(is_dark, "#FFFFFF".into(), "#FBF7F0".into()),
        level.into(),
        density,
        tier.into(),
    )
}

#[frb(sync)]
pub fn glass_spec(is_dark: bool, level: GlassLevel) -> GlassSpec {
    let s = core::glass_spec(
        &theme(is_dark, "#FFFFFF".into(), "#FBF7F0".into()),
        level.into(),
    );
    GlassSpec {
        intensity: s.intensity,
        wash_alpha: s.wash_alpha,
        wash_alpha_flat: s.wash_alpha_flat,
        sheen: s.sheen,
        sheen_height: s.sheen_height,
        edge: s.edge.to_string(),
        edge_width: s.edge_width,
    }
}

#[frb(sync)]
pub fn resolve_tier(reduce_transparency: bool, is_web: bool) -> GlassTier {
    core::resolve_tier(reduce_transparency, is_web).into()
}

/// 感知交互行为 — the bloom that answers a touch.
#[frb(sync)]
pub fn touch_light_color(is_dark: bool) -> String {
    core::touch_light_color(&theme(is_dark, "#FFFFFF".into(), "#FBF7F0".into())).to_string()
}

/// Relative luminance, exposed because the UI decides content density from it.
#[frb(sync)]
pub fn luminance(hex: String) -> f64 {
    core::luminance(&hex)
}
