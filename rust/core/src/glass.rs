//! 柔光玻璃 — the soft-light glass material's arithmetic.
//!
//! Ported from `src/theme/glass.ts`. What moves here is everything that is a
//! calculation rather than a rendering decision: the sRGB mix, WCAG luminance,
//! the ambient pull, the readability curve, and the level tables they read.
//!
//! Moving it is not tidiness. The material's whole point is that a surface
//! carries its own colour pulled toward whatever it sits over, and the pull is
//! damped by luminance distance so dark chrome is not washed out. That is a
//! computation, and a computation the UI layer should be *handed*, not asked to
//! perform — the Dioxus prototype expressed it as CSS `color-mix`, which needs
//! Chrome 111+, and Android's WebView updates through a store many devices in
//! China do not have. With the mix resolved here the stylesheet receives a
//! plain `rgba(...)` and the only CSS left is `backdrop-filter`, which has
//! shipped since Chrome 76.
//!
//! The same applies whatever renders the UI. A Flutter or native front end
//! cannot evaluate `color-mix` either; it can accept four numbers.

use crate::num::{js_num, js_round};

/// How much of the material a device can actually render.
///
/// Mirrors the way HyperOS gates the effect on the SoC: every tier below
/// `Full` is a complete design, not a broken one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GlassTier {
    /// Real backdrop blur behind a translucent wash.
    Full,
    /// No blur, but still translucent: content shows through as colour.
    Wash,
    /// Opaque, for when the user has asked for less transparency.
    Solid,
}

impl GlassTier {
    pub fn as_str(self) -> &'static str {
        match self {
            GlassTier::Full => "full",
            GlassTier::Wash => "wash",
            GlassTier::Solid => "solid",
        }
    }
}

/// Where a glass surface sits in the stack. Depth, not decoration: `Chrome`
/// floats over scrolling content, `Sheet` covers it, `Card` rests in it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GlassLevel {
    Chrome,
    Sheet,
    Card,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GlassSpec {
    /// Blur intensity, 0–100. Ignored below the `Full` tier.
    pub intensity: f64,
    /// Alpha applied to the wash colour.
    pub wash_alpha: f64,
    /// Wash alpha when the tier cannot blur — more body is needed to hold
    /// contrast without the blur flattening what is underneath.
    pub wash_alpha_flat: f64,
    pub sheen: f64,
    /// How far the highlight falls before fading. A band, not a hairline: a
    /// 1px line reads as a stroke, a band reads as light catching the curve.
    pub sheen_height: f64,
    pub edge: &'static str,
    pub edge_width: f64,

    /// How far the blurred backdrop's colour is amplified, 1.0 being none.
    ///
    /// This is the layer the port did not have, and the reason a blurred
    /// surface looked like grey mush rather than glass. A Gaussian blur
    /// averages neighbouring pixels, and averaging colour is a walk toward
    /// grey: a red row and a green row behind a bar come out beige. Real
    /// frosted glass does not desaturate what it scatters, and every system
    /// implementation of this material compensates by amplifying saturation
    /// afterwards — Apple calls the result vibrancy and describes it as
    /// amplifying the colour of the content behind.
    ///
    /// Chrome carries the most because it floats over the ledger, where the
    /// colour behind it is the only thing telling you the bar is transparent
    /// at all. A sheet covers the room and needs less.
    pub vibrancy: f64,

    /// The lit rim, top and bottom.
    ///
    /// A single flat border is a stroke; a rim that is bright where the light
    /// falls and dim where it does not is an edge with a direction, which is
    /// what "随光而变" is describing. `rim_top` lightens, `rim_bottom` darkens,
    /// and the two meet around the curve.
    pub rim_top: f64,
    pub rim_bottom: f64,

    /// Grain over the whole surface.
    ///
    /// Small, and not decoration: a wide blur across a near-flat background
    /// produces visible banding, and a little noise is the standard way to
    /// break it up. It is also what makes the surface read as frosted rather
    /// than merely transparent.
    pub noise: f64,
}

/// `StyleSheet.hairlineWidth` is a platform value; the caller substitutes its
/// own. Kept as a sentinel so the tables stay declarative.
pub const HAIRLINE: f64 = -1.0;

const LIGHT: [GlassSpec; 3] = [
    GlassSpec {
        sheen_height: 26.0,
        vibrancy: 1.9,
        rim_top: 0.55,
        rim_bottom: 0.10,
        noise: 0.035,
        intensity: 62.0,
        wash_alpha: 0.54,
        wash_alpha_flat: 0.86,
        sheen: 0.5,
        edge: "rgba(255,255,255,0.65)",
        edge_width: 1.0,
    },
    GlassSpec {
        sheen_height: 22.0,
        vibrancy: 1.6,
        rim_top: 0.45,
        rim_bottom: 0.08,
        noise: 0.03,
        intensity: 48.0,
        wash_alpha: 0.82,
        wash_alpha_flat: 0.95,
        sheen: 0.38,
        edge: "rgba(255,255,255,0.55)",
        edge_width: 1.0,
    },
    GlassSpec {
        sheen_height: 14.0,
        vibrancy: 1.35,
        rim_top: 0.34,
        rim_bottom: 0.06,
        noise: 0.022,
        intensity: 30.0,
        wash_alpha: 0.9,
        wash_alpha_flat: 1.0,
        sheen: 0.22,
        edge: "rgba(255,255,255,0.42)",
        edge_width: HAIRLINE,
    },
];

const DARK: [GlassSpec; 3] = [
    GlassSpec {
        sheen_height: 26.0,
        vibrancy: 1.7,
        rim_top: 0.16,
        rim_bottom: 0.22,
        noise: 0.05,
        intensity: 70.0,
        wash_alpha: 0.62,
        wash_alpha_flat: 0.9,
        sheen: 0.14,
        edge: "rgba(255,255,255,0.14)",
        edge_width: 1.0,
    },
    GlassSpec {
        sheen_height: 22.0,
        vibrancy: 1.45,
        rim_top: 0.13,
        rim_bottom: 0.18,
        noise: 0.045,
        intensity: 54.0,
        wash_alpha: 0.85,
        wash_alpha_flat: 0.96,
        sheen: 0.1,
        edge: "rgba(255,255,255,0.12)",
        edge_width: 1.0,
    },
    GlassSpec {
        sheen_height: 14.0,
        vibrancy: 1.25,
        rim_top: 0.10,
        rim_bottom: 0.14,
        noise: 0.035,
        intensity: 34.0,
        wash_alpha: 0.92,
        wash_alpha_flat: 1.0,
        sheen: 0.07,
        edge: "rgba(255,255,255,0.09)",
        edge_width: HAIRLINE,
    },
];

/// The three theme values the material reads. The full palette stays in the UI
/// layer; glass only ever needs to know the room it is standing in.
#[derive(Debug, Clone, PartialEq)]
pub struct GlassTheme {
    pub is_dark: bool,
    pub card: String,
    pub paper: String,
}

pub fn glass_spec(t: &GlassTheme, level: GlassLevel) -> GlassSpec {
    let table = if t.is_dark { &DARK } else { &LIGHT };
    table[level as usize]
}

/// Which tier to render.
///
/// `is_web` is the platform's answer, not this crate's: react-native-web maps
/// the blur onto `backdrop-filter`, which costs a compositing layer per
/// surface, and over our own flat backgrounds the wash tier looks nearly
/// identical.
pub fn resolve_tier(reduce_transparency: bool, is_web: bool) -> GlassTier {
    if reduce_transparency {
        GlassTier::Solid
    } else if is_web {
        GlassTier::Wash
    } else {
        GlassTier::Full
    }
}

/* ------------------------------------------------------------------ colour */

/// `#RGB` / `#RRGGBB` / `#RRGGBBAA` → `[r, g, b]`.
///
/// Anything unparseable is black, which is what `parseInt(…, 16)` returning
/// `NaN` produces on the TypeScript side.
fn parse_hex(hex: &str) -> [i64; 3] {
    // `hex.replace('#', '')` — JavaScript's string-pattern replace takes the
    // **first** occurrence only, where Rust's `str::replace` takes all of them.
    // `##FFFFFF` therefore keeps a `#` and goes on to fail parsing, which is
    // the difference between black and white. Found by the corpus.
    let stripped = hex.replacen('#', "", 1);
    // `h.replace(/./g, c => c + c)` — every character doubled, not just digits
    let h: String = if stripped.chars().count() == 3 {
        stripped.chars().flat_map(|c| [c, c]).collect()
    } else {
        stripped
    };
    let six: String = h.chars().take(6).collect();
    match js_parse_int_16(&six) {
        Some(n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255],
        None => [0, 0, 0],
    }
}

/// `parseInt(s, 16)`.
///
/// Not `from_str_radix`: JavaScript reads the longest *prefix* that parses and
/// ignores the rest, so `FFzzzz` is 255 where Rust would reject the string
/// outright. It also allows leading whitespace, a sign, and an `0x` prefix.
/// `None` stands for `NaN`.
///
/// Six characters is the most this is ever handed, so the values stay inside
/// the range where JavaScript's int32 bitwise coercion and an `i64` shift
/// agree, and no `ToInt32` step is needed.
fn js_parse_int_16(s: &str) -> Option<i64> {
    let t = s.trim_start();
    let (neg, t) = match t.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, t.strip_prefix('+').unwrap_or(t)),
    };
    let t = t
        .strip_prefix("0x")
        .or_else(|| t.strip_prefix("0X"))
        .unwrap_or(t);
    let digits: String = t.chars().take_while(|c| c.is_ascii_hexdigit()).collect();
    if digits.is_empty() {
        return None;
    }
    let n = i64::from_str_radix(&digits, 16).ok()?;
    Some(if neg { -n } else { n })
}

/// Mix two colours in sRGB. `amount` is how much of `b` ends up in the result.
///
/// [`js_round`] here is faithfulness rather than necessity, and that was
/// checked rather than assumed: it differs from `f64::round` only on ties below
/// zero, and this result cannot go below zero. Each channel is bounded to
/// `[0, 255]` by the `& 255` in [`parse_hex`], `k` is clamped to `[0, 1]`, and a
/// convex combination of two values in a range stays in that range. Swapping in
/// `f64::round` changes no answer in the corpus, correctly.
pub fn mix(a: &str, b: &str, amount: f64) -> [i64; 3] {
    let [ar, ag, ab] = parse_hex(a);
    let [br, bg, bb] = parse_hex(b);
    let k = amount.clamp(0.0, 1.0);
    [
        js_round(ar as f64 + (br - ar) as f64 * k) as i64,
        js_round(ag as f64 + (bg - ag) as f64 * k) as i64,
        js_round(ab as f64 + (bb - ab) as f64 * k) as i64,
    ]
}

/// Relative luminance, WCAG 2.1. Used to decide how far a surface may travel
/// toward the room before it stops being itself.
pub fn luminance(hex: &str) -> f64 {
    let [r, g, b] = parse_hex(hex);
    let f = |c: i64| {
        let v = c as f64 / 255.0;
        if v <= 0.03928 {
            v / 12.92
        } else {
            ((v + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

const AMBIENT_PULL: f64 = 0.28;
/// How much of the pull the luminance distance is allowed to take away.
const DISTANCE_DAMPING: f64 = 0.75;

/// How far a surface travels toward the colour beneath it.
///
/// Scaled by luminance distance, and that scaling is load-bearing rather than
/// decorative. A light card over light paper can take the full pull and still
/// look like itself; the dark toast pill cannot — pulled 28% toward near-white
/// paper its text contrast fell from 14:1 to 4.9:1, technically AA and a real
/// regression on a component that has to be readable over anything.
pub fn ambient_pull(surface: &str, under: &str) -> f64 {
    let distance = (luminance(surface) - luminance(under)).abs();
    AMBIENT_PULL * (1.0 - DISTANCE_DAMPING * distance)
}

/// 感知环境颜色 — the wash a glass surface should paint, given what it sits over.
///
/// Returns the finished CSS colour. The number formatting is JavaScript's, not
/// Rust's, so the string is byte-identical to what the TypeScript emits — see
/// [`js_num`].
pub fn wash_color(
    t: &GlassTheme,
    level: GlassLevel,
    under: Option<&str>,
    alpha: Option<f64>,
    surface: Option<&str>,
) -> String {
    let spec = glass_spec(t, level);
    let base = surface.unwrap_or(&t.card);
    let room = under.unwrap_or(&t.paper);
    let [r, g, b] = mix(base, room, ambient_pull(base, room));
    let a = alpha.unwrap_or(spec.wash_alpha);
    format!("rgba({r}, {g}, {b}, {})", js_num(a))
}

/// 根据内容属性自动调整通透度 — how opaque the wash has to be for what is
/// underneath.
///
/// `density` is the caller's read of the content behind the surface, 0 for
/// empty paper to 1 for dense text. Glass over an empty ledger can be nearly
/// clear; over a full month of entries it has to carry more body or the labels
/// on top stop resolving. Readability wins: the ceiling rises with density and
/// never falls below the level's resting value.
pub fn readability_alpha(t: &GlassTheme, level: GlassLevel, density: f64, tier: GlassTier) -> f64 {
    // `solid` is not "a bit less transparent" — it is the tier a user lands on
    // by asking for less transparency, so it has to actually be opaque.
    if tier == GlassTier::Solid {
        return 1.0;
    }
    let spec = glass_spec(t, level);
    let base = if tier == GlassTier::Full {
        spec.wash_alpha
    } else {
        spec.wash_alpha_flat
    };
    let d = density.clamp(0.0, 1.0);
    (base + (1.0 - base) * d * 0.75).min(1.0)
}

/// 感知交互行为 — the specular bloom that answers a touch.
///
/// Warm white in light mode, plain white in dark, so the bloom belongs to the
/// palette rather than punching a hole in it.
pub fn touch_light_color(t: &GlassTheme) -> &'static str {
    if t.is_dark {
        "rgba(255,255,255,0.16)"
    } else {
        "rgba(255,252,247,0.72)"
    }
}

/// The saturation matrix a renderer applies to the blurred backdrop.
///
/// Returned as the five rows of a 4x5 colour matrix, flattened, because that
/// is the shape every platform takes one in — `ColorFilter.matrix` on Flutter,
/// `ColorMatrix` on Android, `feColorMatrix` in SVG. Computing it here rather
/// than in each renderer is the same rule as everything else in this crate: a
/// number two implementations could disagree about belongs on this side.
///
/// The luminance weights are Rec. 709, which is what every one of those
/// platforms uses.
pub fn saturation_matrix(v: f64) -> [f64; 20] {
    const LR: f64 = 0.2126;
    const LG: f64 = 0.7152;
    const LB: f64 = 0.0722;
    let (r, g, b) = (LR * (1.0 - v), LG * (1.0 - v), LB * (1.0 - v));
    [
        r + v,
        g,
        b,
        0.0,
        0.0,
        r,
        g + v,
        b,
        0.0,
        0.0,
        r,
        g,
        b + v,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
    ]
}

// ---------------------------------------------------------------------------
// 渐进模糊 — the scrim floating chrome stands on.
// ---------------------------------------------------------------------------

/// How the ground under a floating surface dissolves.
///
/// A glass bar with nothing under it is a sticker: content runs full contrast
/// right up to its edge and then vanishes behind it, and the eye reads the cut
/// rather than the material. HyperOS answers that with a blur that *ramps* —
/// zero a little way above the bar, deepest at the screen's edge — so the last
/// rows dissolve into the chrome instead of being clipped by it.
///
/// The ramp is the arithmetic; where it is drawn is not. This side answers how
/// deep the blur goes, over what distance, and in how many steps.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScrimSpec {
    /// How far the fade reaches *beyond* the surface it stands under, in dp.
    /// The renderer adds the surface's own height and the gesture inset.
    pub fade: f64,
    /// Blur sigma at the deepest point. Zero below the `Full` tier.
    pub sigma: f64,
    /// How many steps the ramp is cut into. See [`scrim_bands`].
    pub bands: usize,
    /// Alpha of the paper wash at the deepest point.
    pub wash: f64,
}

/// The scrim for a tier.
///
/// Below `Full` the blur is gone and the wash carries the whole effect, which
/// is the same trade [`readability_alpha`] makes: a surface that cannot blur
/// should still look deliberate. `Solid` is a plain block of paper, because a
/// user who asked for less transparency asked for exactly that.
///
/// Dark themes take a heavier wash. A dark room has less contrast to lose, so
/// the fade has to do more of the separating before the bar reads as floating
/// rather than as a hole.
pub fn scrim_spec(t: &GlassTheme, tier: GlassTier) -> ScrimSpec {
    match tier {
        GlassTier::Full => ScrimSpec {
            fade: 72.0,
            sigma: 22.0,
            bands: 6,
            wash: if t.is_dark { 0.62 } else { 0.5 },
        },
        GlassTier::Wash => ScrimSpec {
            fade: 56.0,
            sigma: 0.0,
            bands: 6,
            wash: if t.is_dark { 0.86 } else { 0.8 },
        },
        GlassTier::Solid => ScrimSpec {
            fade: 0.0,
            sigma: 0.0,
            bands: 1,
            wash: 1.0,
        },
    }
}

/// One step of the ramp: where it starts, and the blur it adds there.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScrimBand {
    /// The band's top edge, 0 at the top of the scrim and 1 at the bottom.
    /// Every band runs from there to the bottom, so they nest.
    pub top: f64,
    /// The sigma *this* band contributes, not the blur seen through it.
    pub sigma: f64,
}

/// The ramp, as a stack of nested blurs.
///
/// No renderer this app targets has a progressive blur; what they all have is
/// a backdrop blur over a rectangle. So the ramp is built out of those:
/// `bands` rectangles, each starting lower than the last and all reaching the
/// bottom, so a point near the bottom is seen through every band above it and
/// a point near the top through almost none.
///
/// Which makes the per-band sigma a real calculation rather than a guess.
/// **Blurs compose by variance, not by radius** — looking through σ=3 and then
/// σ=4 is looking through σ=5, not σ=7. Handing a renderer eight equal steps
/// would ramp as √k, which is steep at the top exactly where the onset has to
/// be invisible and flat at the bottom where the depth is wanted.
///
/// So the target is stated as a curve and the steps are derived from it. The
/// blur seen through the first k bands is `sigma · (k/n)²`, quadratic so it
/// starts almost flat, and each band supplies the difference of the squares:
///
/// ```text
/// C(k) = sigma · (k/n)²           the blur at the bottom of band k-1
/// s(k) = √(C(k)² − C(k−1)²)       what band k−1 has to add to get there
/// ```
///
/// With six bands at σ=22 the first adds 0.61 — below a pixel, which is the
/// point: the top edge of a progressive blur must not be findable. The last
/// adds 15.8, on top of the 15.3 already accumulated, reaching 22 exactly.
///
/// Six rather than more because each band is a save layer the GPU composites
/// every frame the list moves under it, and the ramp is already smooth enough
/// that a seventh would cost a frame to hide nothing.
pub fn scrim_bands(sigma: f64, bands: usize) -> Vec<ScrimBand> {
    if bands == 0 {
        return Vec::new();
    }
    let n = bands as f64;
    let mut out = Vec::with_capacity(bands);
    let mut prev = 0.0_f64;
    for k in 0..bands {
        let x = (k + 1) as f64 / n;
        let total = sigma * x * x;
        // Never negative: `total` is monotone in k, but a caller passing a
        // sigma of zero should get zeros rather than a NaN out of `sqrt`.
        let step = (total * total - prev * prev).max(0.0).sqrt();
        out.push(ScrimBand {
            top: k as f64 / n,
            sigma: step,
        });
        prev = total;
    }
    out
}

/// The wash's alpha at each band edge, `bands + 1` of them.
///
/// The same quadratic the blur follows, for the same reason and for one more:
/// a stack of clipped rectangles has a hard edge at every join, and a wash
/// that thickens across those joins is what stops them being visible. The two
/// ramps have to agree, so they are one curve stated once.
pub fn scrim_ramp(wash: f64, bands: usize) -> Vec<f64> {
    let n = bands.max(1) as f64;
    (0..=bands.max(1))
        .map(|k| {
            let x = k as f64 / n;
            wash * x * x
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn light() -> GlassTheme {
        GlassTheme {
            is_dark: false,
            card: "#FFFFFF".into(),
            paper: "#FBF7F0".into(),
        }
    }

    fn dark() -> GlassTheme {
        GlassTheme {
            is_dark: true,
            card: "#241F1B".into(),
            paper: "#171310".into(),
        }
    }

    #[test]
    fn hex_parsing_accepts_the_three_lengths_the_palette_uses() {
        assert_eq!(mix("#FFFFFF", "#FFFFFF", 0.0), [255, 255, 255]);
        assert_eq!(mix("#FFF", "#FFF", 0.0), [255, 255, 255]);
        assert_eq!(mix("#FFFFFFAA", "#000000", 0.0), [255, 255, 255]);
        assert_eq!(mix("#000", "#000", 0.0), [0, 0, 0]);
    }

    #[test]
    fn only_the_first_hash_is_stripped() {
        // JavaScript's replace('#', '') takes the first occurrence only, so
        // `##FFFFFF` still carries a `#` into parseInt and comes out black
        assert_eq!(mix("##FFFFFF", "#000000", 0.0), [0, 0, 0]);
        assert_eq!(mix("#FFFFFF", "#000000", 0.0), [255, 255, 255]);
        // and a trailing hash survives into the six characters taken
        assert_eq!(mix("#FF#FFF", "#000000", 0.0), [0, 0, 255]);
    }

    #[test]
    fn a_hex_value_is_read_as_a_prefix_the_way_parseint_reads_it() {
        // parseInt stops at the first non-digit instead of rejecting
        assert_eq!(mix("#FFzzzz", "#000000", 0.0), [0, 0, 255]);
        assert_eq!(mix("#12qq", "#000000", 0.0), [0, 0, 18]);
        // nothing parseable at all is NaN, which the caller reads as black
        assert_eq!(mix("#zz", "#000000", 0.0), [0, 0, 0]);
    }

    #[test]
    fn an_unparseable_colour_is_black_rather_than_an_error() {
        assert_eq!(mix("nonsense", "#000000", 0.0), [0, 0, 0]);
        assert_eq!(mix("", "#000000", 0.0), [0, 0, 0]);
    }

    #[test]
    fn a_mix_travels_the_requested_fraction() {
        assert_eq!(mix("#000000", "#FFFFFF", 0.5), [128, 128, 128]);
        assert_eq!(mix("#000000", "#FFFFFF", 1.0), [255, 255, 255]);
        assert_eq!(mix("#000000", "#FFFFFF", 0.0), [0, 0, 0]);
    }

    #[test]
    fn a_mix_amount_outside_zero_to_one_is_clamped() {
        assert_eq!(mix("#000000", "#FFFFFF", 5.0), [255, 255, 255]);
        assert_eq!(mix("#000000", "#FFFFFF", -5.0), [0, 0, 0]);
    }

    #[test]
    fn luminance_matches_the_wcag_endpoints() {
        assert!((luminance("#FFFFFF") - 1.0).abs() < 1e-12);
        assert!(luminance("#000000").abs() < 1e-12);
        assert!(luminance("#FBF7F0") > 0.9);
        assert!(luminance("#2B2622") < 0.05);
    }

    #[test]
    fn the_pull_shrinks_as_the_two_colours_move_apart() {
        // light over light: nearly the full pull
        let near = ambient_pull("#FFFFFF", "#FBF7F0");
        // dark over light: heavily damped, which is what keeps toast readable
        let far = ambient_pull("#2B2622", "#FBF7F0");
        // white over the warm paper is a short hop: ~0.266 of the 0.28 ceiling
        assert!((near - 0.2660).abs() < 1e-3, "{near}");
        // ink over that same paper is damped to about a third of it
        assert!((far - 0.0883).abs() < 1e-3, "{far}");
        assert!(near <= AMBIENT_PULL && near > far);
    }

    #[test]
    fn the_pull_is_symmetric() {
        let a = ambient_pull("#2B2622", "#FBF7F0");
        let b = ambient_pull("#FBF7F0", "#2B2622");
        assert!((a - b).abs() < 1e-12);
    }

    #[test]
    fn a_wash_is_a_finished_css_colour() {
        let w = wash_color(&light(), GlassLevel::Chrome, None, None, None);
        assert!(w.starts_with("rgba("), "{w}");
        assert!(w.ends_with(", 0.54)"), "{w}");
    }

    #[test]
    fn the_wash_alpha_is_spelled_the_way_javascript_spells_it() {
        // 0.8650000000000001 is what the readability curve actually produces;
        // Rust's own formatting would agree here, but the contract is JS's
        let w = wash_color(
            &light(),
            GlassLevel::Card,
            None,
            Some(0.8650000000000001),
            None,
        );
        assert!(w.ends_with(", 0.8650000000000001)"), "{w}");
        let w = wash_color(&light(), GlassLevel::Card, None, Some(1.0), None);
        assert!(w.ends_with(", 1)"), "{w}");
    }

    #[test]
    fn a_dark_surface_over_light_paper_keeps_its_own_colour() {
        // the toast pill: passes t.ink as the surface
        let w = wash_color(
            &light(),
            GlassLevel::Card,
            None,
            Some(0.91),
            Some("#2B2622"),
        );
        let nums: Vec<i64> = w
            .trim_start_matches("rgba(")
            .split(',')
            .take(3)
            .map(|s| s.trim().parse().unwrap())
            .collect();
        // #2B2622 is [43, 38, 34]; a 0.091 pull toward near-white paper moves
        // red by 19, not by the 58 an undamped 0.28 would have taken
        assert_eq!(nums, vec![61, 56, 52], "{w}");
    }

    #[test]
    fn density_raises_the_alpha_and_never_lowers_it() {
        let t = light();
        let empty = readability_alpha(&t, GlassLevel::Chrome, 0.0, GlassTier::Full);
        let dense = readability_alpha(&t, GlassLevel::Chrome, 1.0, GlassTier::Full);
        assert_eq!(empty, glass_spec(&t, GlassLevel::Chrome).wash_alpha);
        assert!(dense > empty);
        assert!(dense <= 1.0);
    }

    #[test]
    fn a_flat_tier_starts_from_the_heavier_resting_alpha() {
        let t = light();
        let full = readability_alpha(&t, GlassLevel::Chrome, 0.0, GlassTier::Full);
        let wash = readability_alpha(&t, GlassLevel::Chrome, 0.0, GlassTier::Wash);
        assert!(wash > full);
    }

    #[test]
    fn the_solid_tier_is_actually_opaque() {
        let t = light();
        assert_eq!(
            readability_alpha(&t, GlassLevel::Card, 0.0, GlassTier::Solid),
            1.0
        );
        assert_eq!(
            readability_alpha(&t, GlassLevel::Chrome, 0.0, GlassTier::Solid),
            1.0
        );
    }

    #[test]
    fn density_outside_zero_to_one_is_clamped() {
        let t = light();
        let over = readability_alpha(&t, GlassLevel::Card, 9.0, GlassTier::Full);
        let under = readability_alpha(&t, GlassLevel::Card, -9.0, GlassTier::Full);
        assert_eq!(
            over,
            readability_alpha(&t, GlassLevel::Card, 1.0, GlassTier::Full)
        );
        assert_eq!(
            under,
            readability_alpha(&t, GlassLevel::Card, 0.0, GlassTier::Full)
        );
    }

    #[test]
    fn the_tier_answers_the_platform_and_the_user() {
        assert_eq!(resolve_tier(false, false), GlassTier::Full);
        assert_eq!(resolve_tier(false, true), GlassTier::Wash);
        // asking for less transparency outranks the platform
        assert_eq!(resolve_tier(true, true), GlassTier::Solid);
        assert_eq!(resolve_tier(true, false), GlassTier::Solid);
    }

    #[test]
    fn the_touch_bloom_is_warm_in_light_and_plain_in_dark() {
        assert!(touch_light_color(&light()).starts_with("rgba(255,252,247"));
        assert!(touch_light_color(&dark()).starts_with("rgba(255,255,255"));
    }

    #[test]
    fn a_saturation_of_one_is_the_identity() {
        let m = saturation_matrix(1.0);
        // The diagonal is 1 and everything else that touches colour is 0.
        assert!((m[0] - 1.0).abs() < 1e-12);
        assert!((m[6] - 1.0).abs() < 1e-12);
        assert!((m[12] - 1.0).abs() < 1e-12);
        for i in [1, 2, 5, 7, 10, 11] {
            assert!(m[i].abs() < 1e-12, "off-diagonal {i} was {}", m[i]);
        }
    }

    #[test]
    fn a_saturation_of_zero_is_luminance() {
        // Every row becomes the same Rec. 709 weights, which is greyscale.
        let m = saturation_matrix(0.0);
        for row in 0..3 {
            assert!((m[row * 5] - 0.2126).abs() < 1e-12);
            assert!((m[row * 5 + 1] - 0.7152).abs() < 1e-12);
            assert!((m[row * 5 + 2] - 0.0722).abs() < 1e-12);
        }
    }

    /// Grey has to stay grey at any saturation, or the whole surface takes a
    /// colour cast — which on a near-white paper palette is the one thing that
    /// would be obvious immediately.
    #[test]
    fn grey_is_unmoved_at_every_saturation() {
        for v in [0.0, 0.5, 1.0, 1.9, 3.0] {
            let m = saturation_matrix(v);
            for row in 0..3 {
                let sum = m[row * 5] + m[row * 5 + 1] + m[row * 5 + 2];
                assert!((sum - 1.0).abs() < 1e-12, "v={v} row={row} sum={sum}");
            }
        }
    }

    #[test]
    fn alpha_is_never_touched() {
        for v in [0.0, 1.0, 2.0] {
            let m = saturation_matrix(v);
            assert_eq!(&m[15..20], &[0.0, 0.0, 0.0, 1.0, 0.0]);
        }
    }

    /// Chrome floats over the ledger and needs the most amplification; a card
    /// sits in it and needs the least.
    #[test]
    fn chrome_is_the_most_vibrant_level() {
        let t = light();
        let chrome = glass_spec(&t, GlassLevel::Chrome).vibrancy;
        let sheet = glass_spec(&t, GlassLevel::Sheet).vibrancy;
        let card = glass_spec(&t, GlassLevel::Card).vibrancy;
        assert!(chrome > sheet && sheet > card, "{chrome} {sheet} {card}");
        assert!(card >= 1.0, "amplifying by less than 1 would desaturate");
    }

    /// On light the rim is lit from above; on dark the brighter half is the
    /// bottom, because a dark surface on a dark room is found by its lower
    /// edge catching the light rather than its upper one.
    #[test]
    fn the_rim_turns_over_between_themes() {
        assert!(
            glass_spec(&light(), GlassLevel::Chrome).rim_top
                > glass_spec(&light(), GlassLevel::Chrome).rim_bottom
        );
        assert!(
            glass_spec(&dark(), GlassLevel::Chrome).rim_bottom
                > glass_spec(&dark(), GlassLevel::Chrome).rim_top
        );
    }
    // ---- the progressive scrim ----

    /// The whole point of composing by variance: the stack has to arrive at
    /// the sigma that was asked for, not at √n times it.
    #[test]
    fn the_bands_compose_to_the_sigma_asked_for() {
        for (sigma, n) in [(22.0, 8), (12.0, 5), (40.0, 12), (3.0, 2)] {
            let total: f64 = scrim_bands(sigma, n)
                .iter()
                .map(|b| b.sigma * b.sigma)
                .sum::<f64>()
                .sqrt();
            assert!(
                (total - sigma).abs() < 1e-9,
                "sigma={sigma} n={n} composed={total}"
            );
        }
    }

    /// Each step is bigger than the one above it, and the first is small
    /// enough that the top edge of the scrim cannot be found. A band that
    /// opened at a full pixel would draw the line the scrim exists to hide.
    #[test]
    fn the_ramp_opens_below_a_pixel_and_deepens() {
        let bands = scrim_bands(22.0, 8);
        assert!(bands[0].sigma < 1.0, "opens at {}", bands[0].sigma);
        for w in bands.windows(2) {
            assert!(w[1].sigma > w[0].sigma, "{w:?}");
            assert!(w[1].top > w[0].top);
        }
        assert_eq!(bands[0].top, 0.0, "the first band starts at the top");
    }

    /// Sigma zero is the flat tiers, and `sqrt` of a difference of zeros is a
    /// place NaN gets in. It does not.
    #[test]
    fn a_flat_tier_ramps_to_nothing() {
        for b in scrim_bands(0.0, 8) {
            assert_eq!(b.sigma, 0.0);
        }
        assert!(scrim_bands(22.0, 0).is_empty());
    }

    /// The wash reaches the alpha it was given, having started at nothing —
    /// a scrim whose top edge is already tinted is a visible rectangle.
    #[test]
    fn the_wash_runs_from_nothing_to_the_full_alpha() {
        let r = scrim_ramp(0.5, 8);
        assert_eq!(r.len(), 9);
        assert_eq!(r[0], 0.0);
        assert!((r[8] - 0.5).abs() < 1e-12);
        for w in r.windows(2) {
            assert!(w[1] >= w[0]);
        }
    }

    /// A tier that cannot blur puts the whole effect in the wash, and the one
    /// that was asked for no transparency gets a block of paper.
    #[test]
    fn the_flat_tiers_trade_blur_for_body() {
        let t = light();
        let full = scrim_spec(&t, GlassTier::Full);
        let wash = scrim_spec(&t, GlassTier::Wash);
        let solid = scrim_spec(&t, GlassTier::Solid);
        assert!(full.sigma > 0.0 && wash.sigma == 0.0 && solid.sigma == 0.0);
        assert!(wash.wash > full.wash, "no blur has to be paid for");
        assert_eq!(solid.wash, 1.0);
        assert_eq!(solid.fade, 0.0, "opaque has nothing to fade");
        assert!(scrim_spec(&dark(), GlassTier::Full).wash > full.wash);
    }
}
