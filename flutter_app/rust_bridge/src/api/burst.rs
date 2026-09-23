//! 贴上一朵花, across the boundary: the burst's flowers, and how long it lasts.

use dahonghua_core::burst;
use flutter_rust_bridge::frb;

/// One flower of the burst. See `core::burst::Petal`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PetalView {
    pub size: f64,
    /// 0 the flower, 1 its soft tint, 2 the leaf, 3 the stamen.
    pub hue: u32,
    pub dx: f64,
    pub rise: f64,
    /// Degrees.
    pub rot: f64,
    /// Milliseconds.
    pub duration: f64,
    pub delay: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BurstView {
    pub petals: Vec<PetalView>,
    /// Milliseconds until the last flower has landed.
    pub length: f64,
}

/// The burst for `seed` — picked by the platform when the entry is saved.
#[frb(sync)]
pub fn petal_burst(seed: u32) -> BurstView {
    let petals = burst::burst(seed);
    BurstView {
        length: burst::burst_length(&petals),
        petals: petals
            .iter()
            .map(|p| PetalView {
                size: p.size,
                hue: p.hue as u32,
                dx: p.dx,
                rise: p.rise,
                rot: p.rot,
                duration: p.duration,
                delay: p.delay,
            })
            .collect(),
    }
}
