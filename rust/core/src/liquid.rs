//! 液态玻璃 — a lens that moves, and how it moves.
//!
//! `glass.rs` answers what the material looks like standing still. This answers
//! what it does when a finger pushes it, which is a different kind of question
//! and a different kind of arithmetic: springs, velocity, and where a flick was
//! heading.
//!
//! The thing being described is the selected-tab indicator. It used to be a
//! tinted pill that teleported between four positions on a 320ms curve, and a
//! tinted pill is not an object — you cannot push it, it has no weight, and
//! when it arrives it has clearly been redrawn rather than moved. Apple's
//! Liquid Glass is the same control done as a physical lens: it follows the
//! finger, it **stretches** in the direction of travel, its shadow **trails**
//! behind it, and it settles on a spring rather than at the end of a duration.
//!
//! Three things here, and each is a decision two implementations could get
//! differently:
//!
//! * **Squash and stretch.** A lens that stretched without thinning would be a
//!   lens that grew, and growth reads as a scale animation rather than as
//!   momentum. Area is conserved: `scale_y = 1 / scale_x`.
//! * **Where a flick lands.** Not the nearest tab — the tab it was *heading*
//!   for. A finger that lets go 40% of the way across but still moving fast
//!   was going to the next one, and stopping it short is what makes a control
//!   feel sticky.
//! * **Where the highlight sits.** A specular highlight is light reflecting
//!   off a surface, and on a surface that is moving it lags to the trailing
//!   edge. Pinning it to the centre is the tell that the thing is a rectangle
//!   with a gradient painted on it.

/// The constants a moving lens is made of.
///
/// Distances are dp and velocities dp/s, which is what every platform's
/// gesture recogniser reports and therefore the one unit that needs no
/// conversion at the boundary.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LiquidSpec {
    /// The settle spring. Underdamped on purpose — a critically damped
    /// indicator arrives correctly and feels dead.
    pub mass: f64,
    pub stiffness: f64,
    pub damping: f64,

    /// How much the lens stretches, per dp/s, and the cap.
    pub stretch: f64,
    pub stretch_max: f64,

    /// How far the shadow trails behind, per dp/s, and the cap in dp.
    pub trail: f64,
    pub trail_max: f64,

    /// How far ahead a release is projected when deciding where it lands, in
    /// seconds. The standard predictive fling: `x + v * fling`.
    pub fling: f64,

    /// How far the highlight slides toward the trailing edge at full speed,
    /// as a fraction of the lens's width.
    pub sheen_travel: f64,

    /// The speed at which every one of the above reaches its cap.
    pub top_speed: f64,

    /// The drop shadow under the lens: how dark, how soft, and how far it sits
    /// below at rest. This is what says the lens is *on* the bar rather than
    /// *in* it — a tinted pill with no shadow is a hole, not an object.
    pub shadow_alpha: f64,
    pub shadow_blur: f64,
    pub shadow_lift: f64,
}

/// The lens for a theme.
///
/// The dark room takes a longer trail and a heavier shadow: there is less
/// contrast available to say the lens is above the bar rather than in it, so
/// the shadow has to do more of the saying.
pub fn liquid_spec(is_dark: bool) -> LiquidSpec {
    LiquidSpec {
        trail_max: if is_dark { 12.0 } else { 9.0 },
        shadow_alpha: if is_dark { 0.42 } else { 0.16 },
        ..BASE
    }
}

/// Everything both rooms share, written once so they cannot drift.
const BASE: LiquidSpec = LiquidSpec {
    mass: 1.0,
    stiffness: 260.0,
    damping: 22.0,
    stretch: 0.00022,
    stretch_max: 0.34,
    trail: 0.010,
    trail_max: 9.0,
    fling: 0.09,
    sheen_travel: 0.22,
    top_speed: 2400.0,
    shadow_alpha: 0.16,
    shadow_blur: 8.0,
    shadow_lift: 1.5,
};

/// What the lens looks like at a given velocity.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Lens {
    /// Multiplier on the lens's width, at least 1.
    pub scale_x: f64,
    /// Multiplier on its height, at most 1 — the reciprocal, so the area does
    /// not change and the stretch reads as momentum rather than growth.
    pub scale_y: f64,
    /// How far the shadow sits behind the lens, in dp, signed **against** the
    /// direction of travel.
    pub trail: f64,
    /// Where the specular highlight sits across the lens, 0 at the left edge
    /// and 1 at the right. Half at rest, sliding to the trailing edge as it
    /// moves.
    pub sheen_at: f64,
}

impl Lens {
    /// The lens standing still.
    pub const STILL: Lens = Lens {
        scale_x: 1.0,
        scale_y: 1.0,
        trail: 0.0,
        sheen_at: 0.5,
    };
}

/// The lens's shape at `velocity` dp/s.
///
/// Everything saturates at `top_speed` rather than growing without bound: a
/// fling can report several thousand dp/s, and a lens that stretched linearly
/// with that would be a smear across the whole bar.
pub fn lens(spec: &LiquidSpec, velocity: f64) -> Lens {
    if !velocity.is_finite() || velocity == 0.0 {
        return Lens::STILL;
    }
    let speed = velocity.abs().min(spec.top_speed);
    let dir = if velocity > 0.0 { 1.0 } else { -1.0 };

    let scale_x = 1.0 + (spec.stretch * speed).min(spec.stretch_max);
    let trail = -dir * (spec.trail * speed).min(spec.trail_max);
    // Toward the trailing edge, on the same saturating ramp so the highlight
    // and the shadow agree about which way the lens is going.
    let slide = spec.sheen_travel * (speed / spec.top_speed);

    Lens {
        scale_x,
        scale_y: 1.0 / scale_x,
        trail,
        sheen_at: (0.5 - dir * slide).clamp(0.0, 1.0),
    }
}

/// Which tab sits under `x`, where `x` is measured from the row's left edge.
///
/// Used live while a finger is dragging, so the tab under the lens lights up
/// as it passes rather than after the finger lifts.
pub fn tab_at(x: f64, item_w: f64, count: usize) -> usize {
    if count == 0 || item_w <= 0.0 || !x.is_finite() {
        return 0;
    }
    ((x / item_w).floor().max(0.0) as usize).min(count - 1)
}

/// Where a tab's lens rests, measured from the row's left edge.
pub fn centre_of(index: usize, item_w: f64) -> f64 {
    (index as f64 + 0.5) * item_w
}

/// Which tab a release at `x` moving at `velocity` lands on.
///
/// The motion is projected forward by `fling` seconds and *then* the tab under
/// it is taken. That is the whole difference between a control that catches a
/// flick and one that drops it: at the midpoint of a tab, a finger travelling
/// at 1200 dp/s is 108dp further on by the time it would have stopped, which
/// is a tab and a half away.
pub fn snap(spec: &LiquidSpec, x: f64, item_w: f64, count: usize, velocity: f64) -> usize {
    let v = if velocity.is_finite() { velocity } else { 0.0 };
    tab_at(x + v * spec.fling, item_w, count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> LiquidSpec {
        liquid_spec(false)
    }

    /// The rule that makes a stretch read as momentum instead of as a scale
    /// animation: the lens gets longer AND thinner, and the product does not
    /// move.
    #[test]
    fn stretching_conserves_the_area() {
        for v in [-2000.0, -300.0, 300.0, 900.0, 5000.0] {
            let l = lens(&spec(), v);
            assert!(l.scale_x > 1.0, "v={v} did not stretch");
            assert!(l.scale_y < 1.0, "v={v} did not thin");
            assert!(
                (l.scale_x * l.scale_y - 1.0).abs() < 1e-12,
                "v={v} changed area: {} x {}",
                l.scale_x,
                l.scale_y
            );
        }
    }

    /// A fling can report several thousand dp/s. A lens that took that
    /// literally would be a smear.
    #[test]
    fn everything_saturates() {
        let s = spec();
        let fast = lens(&s, 100_000.0);
        let top = lens(&s, s.top_speed);
        assert_eq!(fast, top);
        assert!((fast.scale_x - 1.0) <= s.stretch_max + 1e-12);
        assert!(fast.trail.abs() <= s.trail_max + 1e-12);
    }

    /// The shadow is *behind*, and behind means the other way from travel.
    #[test]
    fn the_shadow_trails_rather_than_leads() {
        let s = spec();
        assert!(lens(&s, 900.0).trail < 0.0, "moving right, shadow left");
        assert!(lens(&s, -900.0).trail > 0.0, "moving left, shadow right");
        assert_eq!(lens(&s, 0.0).trail, 0.0);
    }

    /// Light lags. A highlight pinned to the middle is the tell that the thing
    /// is a rectangle with a gradient painted on it.
    #[test]
    fn the_highlight_slides_to_the_trailing_edge() {
        let s = spec();
        assert_eq!(lens(&s, 0.0).sheen_at, 0.5);
        assert!(lens(&s, 900.0).sheen_at < 0.5);
        assert!(lens(&s, -900.0).sheen_at > 0.5);
        for v in [-100_000.0, 100_000.0] {
            let at = lens(&s, v).sheen_at;
            assert!((0.0..=1.0).contains(&at), "v={v} at={at}");
        }
    }

    /// Standing still is standing still, and a NaN velocity — which is what a
    /// zero-duration drag produces — must not become a NaN transform.
    #[test]
    fn a_still_lens_and_a_broken_velocity_are_both_the_resting_shape() {
        let s = spec();
        assert_eq!(lens(&s, 0.0), Lens::STILL);
        assert_eq!(lens(&s, f64::NAN), Lens::STILL);
        assert_eq!(lens(&s, f64::INFINITY), Lens::STILL);
    }

    #[test]
    fn a_tab_is_the_cell_the_point_is_in() {
        assert_eq!(tab_at(0.0, 50.0, 4), 0);
        assert_eq!(tab_at(49.9, 50.0, 4), 0);
        assert_eq!(tab_at(50.0, 50.0, 4), 1);
        assert_eq!(tab_at(199.0, 50.0, 4), 3);
        // dragged past either end
        assert_eq!(tab_at(-80.0, 50.0, 4), 0);
        assert_eq!(tab_at(9999.0, 50.0, 4), 3);
        assert_eq!(tab_at(10.0, 0.0, 4), 0, "a zero-width tab divides by zero");
        assert_eq!(tab_at(10.0, 50.0, 0), 0, "and no tabs has no answer");
    }

    #[test]
    fn a_tab_rests_at_its_own_middle() {
        assert_eq!(centre_of(0, 50.0), 25.0);
        assert_eq!(centre_of(3, 50.0), 175.0);
        // and where it rests is inside the cell it belongs to
        for i in 0..4 {
            assert_eq!(tab_at(centre_of(i, 50.0), 50.0, 4), i);
        }
    }

    /// A slow release goes where it is. A flick goes where it was heading —
    /// and at the midpoint of tab 1, 1200 dp/s is a tab and a half onward.
    #[test]
    fn a_flick_lands_where_it_was_going_not_where_it_let_go() {
        let s = spec();
        assert_eq!(snap(&s, 75.0, 50.0, 4, 0.0), 1);
        assert_eq!(snap(&s, 75.0, 50.0, 4, 1200.0), 3);
        assert_eq!(snap(&s, 75.0, 50.0, 4, -1200.0), 0);
        // and a flick off the end still lands on the end
        assert_eq!(snap(&s, 175.0, 50.0, 4, 9000.0), 3);
        assert_eq!(snap(&s, 25.0, 50.0, 4, -9000.0), 0);
    }

    /// The settle is underdamped: `damping < 2·sqrt(stiffness·mass)`. A
    /// critically damped indicator arrives correctly and feels dead, and this
    /// is the one line that says which of the two this is.
    #[test]
    fn the_spring_overshoots_rather_than_creeping() {
        for dark in [false, true] {
            let s = liquid_spec(dark);
            let critical = 2.0 * (s.stiffness * s.mass).sqrt();
            assert!(s.damping < critical, "dark={dark} {} {critical}", s.damping);
            assert!(s.damping > 0.4 * critical, "dark={dark} would wobble");
        }
    }

    /// The dark room has less contrast to separate the lens from the bar, so
    /// the shadow does more of the work — it is darker and it trails further.
    /// Everything else is shared, and the shared half is written once.
    #[test]
    fn only_the_shadow_differs_between_the_rooms() {
        let (l, d) = (liquid_spec(false), liquid_spec(true));
        assert!(d.trail_max > l.trail_max);
        assert!(d.shadow_alpha > l.shadow_alpha);
        assert_eq!(
            LiquidSpec {
                trail_max: l.trail_max,
                shadow_alpha: l.shadow_alpha,
                ..d
            },
            l
        );
    }

    // ---- properties over many inputs ------------------------------------

    /// A finger can put `x` anywhere, including past both ends and into the
    /// junk a fling reports. The answer is still a valid tab index.
    #[test]
    fn tab_and_snap_stay_inside_the_bar() {
        let s = spec();
        for count in [0usize, 1, 2, 4, 7] {
            for item_w in [0.0, -1.0, 1.0, 50.0, 200.0] {
                for x in [-1e6, -50.0, -0.1, 0.0, 1.0, 75.0, 199.0, 1e6, f64::NAN] {
                    let t = tab_at(x, item_w, count);
                    if count == 0 {
                        assert_eq!(t, 0);
                    } else {
                        assert!(t < count, "tab_at({x},{item_w},{count}) = {t}");
                    }
                    for v in [f64::NAN, -1e6, -1200.0, 0.0, 3.0, 1e6] {
                        let sn = snap(&s, x, item_w, count, v);
                        if count == 0 {
                            assert_eq!(sn, 0);
                        } else {
                            assert!(sn < count, "snap({x},{item_w},{count},{v}) = {sn}");
                        }
                    }
                }
            }
        }
    }

    /// The area rule, and that the sheen never leaves the lens.
    #[test]
    fn the_lens_never_folds_or_leaks() {
        for dark in [false, true] {
            let s = liquid_spec(dark);
            for v in [-1e6, -2000.0, -1.0, 0.0, 1.0, 2000.0, 1e6, f64::NAN, f64::INFINITY] {
                let l = lens(&s, v);
                assert!(l.scale_x.is_finite() && l.scale_x > 0.0);
                assert!(l.scale_y.is_finite() && l.scale_y > 0.0);
                if v != 0.0 && v.is_finite() {
                    assert!(
                        (l.scale_x * l.scale_y - 1.0).abs() < 1e-9,
                        "v={v} area moved"
                    );
                }
                assert!((0.0..=1.0).contains(&l.sheen_at), "sheen {v}");
                assert!(l.trail.is_finite());
            }
        }
    }
}
