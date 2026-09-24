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
    /// Saturation applied to the blurred backdrop. See `core::glass`.
    pub vibrancy: f64,
    /// The lit rim, top and bottom.
    pub rim_top: f64,
    pub rim_bottom: f64,
    /// Grain, to break the banding a wide blur leaves behind.
    pub noise: f64,
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
        vibrancy: s.vibrancy,
        rim_top: s.rim_top,
        rim_bottom: s.rim_bottom,
        noise: s.noise,
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

/// The 4x5 colour matrix a renderer applies to the blurred backdrop.
///
/// Twenty numbers rather than one, because the matrix is what every platform's
/// API actually takes and deriving it in each renderer is exactly the kind of
/// arithmetic this crate exists to hold on one side of the boundary.
#[frb(sync)]
pub fn saturation_matrix(vibrancy: f64) -> Vec<f64> {
    core::saturation_matrix(vibrancy).to_vec()
}

/// 渐进模糊 — how the ground under a floating surface dissolves.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScrimSpec {
    /// How far the fade reaches beyond the surface, in dp. The renderer adds
    /// the surface's own height and the gesture inset.
    pub fade: f64,
    /// How much of a header's own height the ramp takes, from its bottom
    /// edge up. Inside the header, unlike `fade`.
    pub header_ramp: f64,
    /// How far above a floating bar its ground starts. See
    /// `core::glass::ScrimSpec::foot`.
    pub foot: f64,
    /// Blur sigma at the deepest point; zero below the `Full` tier.
    pub sigma: f64,
    pub bands: u32,
    /// Alpha of the paper wash at the deepest point.
    pub wash: f64,
}

/// One step of the ramp.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScrimBand {
    /// The band's top edge, 0 at the top of the scrim and 1 at the bottom.
    pub top: f64,
    /// Where the band's mask reaches full strength; it fades in from nothing
    /// at `top`, which is what keeps the joins from showing.
    pub full: f64,
    /// The sigma this band contributes, not the blur seen through it.
    pub sigma: f64,
    /// The blur seen through this band and every shallower one — what the
    /// band applies when every band blurs one shared capture of the page.
    pub depth: f64,
}

/// How much of a bottom scrim its ramp takes. See `core::glass::foot_ramp`.
#[frb(sync)]
pub fn foot_ramp(foot: f64, surface: f64) -> f64 {
    core::foot_ramp(foot, surface)
}

#[frb(sync)]
pub fn scrim_spec(is_dark: bool, tier: GlassTier) -> ScrimSpec {
    let s = core::scrim_spec(
        &theme(is_dark, "#FFFFFF".into(), "#FBF7F0".into()),
        tier.into(),
    );
    ScrimSpec {
        fade: s.fade,
        header_ramp: s.header_ramp,
        foot: s.foot,
        sigma: s.sigma,
        bands: s.bands as u32,
        wash: s.wash,
    }
}

/// The ramp, as the stack of nested blurs a renderer can actually draw.
///
/// The per-band sigma is not `sigma / bands`: blurs compose by variance, so
/// looking through σ=3 and then σ=4 is looking through σ=5. Getting that wrong
/// puts the whole ramp in the top two bands, which is the opposite of the
/// effect. `core::glass` states the curve; this hands over the steps.
#[frb(sync)]
pub fn scrim_bands(sigma: f64, bands: u32) -> Vec<ScrimBand> {
    core::scrim_bands(sigma, bands as usize)
        .into_iter()
        .map(|b| ScrimBand {
            top: b.top,
            full: b.full,
            sigma: b.sigma,
            depth: b.depth,
        })
        .collect()
}

/// The wash's alpha at each band edge, `bands + 1` of them.
#[frb(sync)]
pub fn scrim_ramp(wash: f64, bands: u32) -> Vec<f64> {
    core::scrim_ramp(wash, bands as usize)
}
