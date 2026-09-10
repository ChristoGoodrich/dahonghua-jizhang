//! 液态玻璃 across the FFI boundary.
//!
//! Mirrors `dahonghua_core::liquid` rather than re-exporting it, for the same
//! reason `glass.rs` does: the core answers to the parity harness and must not
//! grow FFI attributes to suit Dart.
//!
//! Everything is `sync`. These are read inside a build method and inside an
//! animation listener — sixty times a second while a finger is moving — and an
//! await in either place would be a dropped frame.

use dahonghua_core::liquid as core;
use flutter_rust_bridge::frb;

/// The constants a moving lens is made of. Distances dp, velocities dp/s.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LiquidSpec {
    /// The settle spring, as a renderer's spring description takes it.
    pub mass: f64,
    pub stiffness: f64,
    pub damping: f64,
    pub stretch: f64,
    pub stretch_max: f64,
    pub trail: f64,
    pub trail_max: f64,
    pub fling: f64,
    pub sheen_travel: f64,
    pub top_speed: f64,
    /// The drop shadow: how dark, how soft, how far below at rest.
    pub shadow_alpha: f64,
    pub shadow_blur: f64,
    pub shadow_lift: f64,
}

/// What the lens looks like at one velocity.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Lens {
    /// Wider than 1 in the direction of travel.
    pub scale_x: f64,
    /// And thinner by the reciprocal, so the area does not change.
    pub scale_y: f64,
    /// Where the shadow sits, in dp, signed against the travel.
    pub trail: f64,
    /// The highlight across the lens, 0..1.
    pub sheen_at: f64,
}

fn spec(is_dark: bool) -> core::LiquidSpec {
    core::liquid_spec(is_dark)
}

#[frb(sync)]
pub fn liquid_spec(is_dark: bool) -> LiquidSpec {
    let s = spec(is_dark);
    LiquidSpec {
        mass: s.mass,
        stiffness: s.stiffness,
        damping: s.damping,
        stretch: s.stretch,
        stretch_max: s.stretch_max,
        trail: s.trail,
        trail_max: s.trail_max,
        fling: s.fling,
        sheen_travel: s.sheen_travel,
        top_speed: s.top_speed,
        shadow_alpha: s.shadow_alpha,
        shadow_blur: s.shadow_blur,
        shadow_lift: s.shadow_lift,
    }
}

/// The lens's shape at `velocity` dp/s.
#[frb(sync)]
pub fn lens(is_dark: bool, velocity: f64) -> Lens {
    let l = core::lens(&spec(is_dark), velocity);
    Lens {
        scale_x: l.scale_x,
        scale_y: l.scale_y,
        trail: l.trail,
        sheen_at: l.sheen_at,
    }
}

/// Which tab sits under `x`, measured from the row's left edge. Live, while a
/// finger is dragging.
#[frb(sync)]
pub fn tab_at(x: f64, item_w: f64, count: u32) -> u32 {
    core::tab_at(x, item_w, count as usize) as u32
}

/// Where a tab's lens rests.
#[frb(sync)]
pub fn centre_of(index: u32, item_w: f64) -> f64 {
    core::centre_of(index as usize, item_w)
}

/// Which tab a release at `x` moving at `velocity` lands on — the tab it was
/// heading for, not the nearest one.
#[frb(sync)]
pub fn snap(is_dark: bool, x: f64, item_w: f64, count: u32, velocity: f64) -> u32 {
    core::snap(&spec(is_dark), x, item_w, count as usize, velocity) as u32
}
