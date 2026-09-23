//! 贴上一朵花 — the burst of flowers from the record button.
//!
//! The shipping app rewarded a recorded entry with a dozen small flowers
//! fanning up out of the + button (`PetalBurst.tsx`); the port recorded the
//! entry and said nothing. The shape of the burst is arithmetic — where each
//! flower goes, how big, how fast, how late — and like the lens in
//! [`crate::liquid`] it is decided here and drawn there.
//!
//! Seeded, as the shipping one was, so a burst is the same burst every time
//! it is drawn from the same seed: the platform picks the seed when the entry
//! is saved, and a rebuild mid-animation does not reshuffle the flowers.

/// How many flowers a burst has.
pub const COUNT: usize = 12;

/// One flower of a burst.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Petal {
    /// Diameter, dp.
    pub size: f64,
    /// Which of the four colourings: 0 the flower, 1 its soft tint, 2 the
    /// leaf, 3 the stamen. The platform maps these to the theme's colours.
    pub hue: u8,
    /// How far it drifts sideways, dp — negative is left.
    pub dx: f64,
    /// How high it rises before it settles, dp.
    pub rise: f64,
    /// How far it turns on the way, degrees.
    pub rot: f64,
    /// How long it is in the air, and how long it waits to go, ms.
    pub duration: f64,
    pub delay: f64,
}

/// `mulberry32`, the shipping burst's generator, bit for bit: the same seed
/// gives the same flowers here as it did there.
fn mulberry32(seed: u32) -> impl FnMut() -> f64 {
    let mut a = seed;
    move || {
        a = a.wrapping_add(0x6d2b_79f5);
        let mut x = (a ^ (a >> 15)).wrapping_mul(a | 1);
        x = x.wrapping_add((x ^ (x >> 7)).wrapping_mul(x | 61)) ^ x;
        (x ^ (x >> 14)) as f64 / 4_294_967_296.0
    }
}

/// The burst for `seed`.
///
/// The flowers fan evenly from left to right — the first drifts furthest
/// left and the last furthest right — each by its share of a spread plus a
/// random reach, so a burst is a fan and never a clump on one side.
pub fn burst(seed: u32) -> Vec<Petal> {
    let mut rnd = mulberry32(seed);
    (0..COUNT)
        .map(|i| {
            let spread = (i as f64 / (COUNT - 1) as f64) * 2.0 - 1.0;
            // the order of the draws is the shipping object literal's
            let size = 9.0 + rnd() * 8.0;
            let dx = spread * (70.0 + rnd() * 50.0);
            let rise = 90.0 + rnd() * 80.0;
            let rot = rnd() * 280.0 - 140.0;
            let duration = 750.0 + rnd() * 300.0;
            let delay = rnd() * 120.0;
            Petal {
                size,
                hue: (i % 4) as u8,
                dx,
                rise,
                rot,
                duration,
                delay,
            }
        })
        .collect()
}

/// How long the whole burst lasts: its latest flower's delay plus flight.
/// The platform removes the burst after this, not after a guess.
pub fn burst_length(petals: &[Petal]) -> f64 {
    petals
        .iter()
        .map(|p| p.delay + p.duration)
        .fold(0.0, f64::max)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reference sequences taken by running the shipping JavaScript under
    /// Node — not recalled: the first draft of this test had the third value
    /// of seed 1 wrong from memory. `u32::MAX` is there for the wrap-around,
    /// where `>>> 0` and `| 0` are doing their work.
    #[test]
    fn the_generator_is_the_shipping_one() {
        for (seed, want) in [
            (
                1u32,
                vec![0.6270739405881613, 0.002735721180215478, 0.5274470399599522],
            ),
            (u32::MAX, vec![0.8964226141106337, 0.189478256739676]),
        ] {
            let mut r = mulberry32(seed);
            for w in want {
                assert_eq!(r(), w, "seed {seed}");
            }
        }
    }

    #[test]
    fn the_same_seed_is_the_same_burst() {
        assert_eq!(burst(42), burst(42));
        assert_ne!(burst(42), burst(43));
    }

    #[test]
    fn a_burst_is_a_fan_from_left_to_right() {
        let b = burst(7);
        assert_eq!(b.len(), COUNT);
        assert!(b[0].dx < -69.0, "the first goes left: {}", b[0].dx);
        assert!(
            b[COUNT - 1].dx > 69.0,
            "the last goes right: {}",
            b[COUNT - 1].dx
        );
        // not strictly ordered — the reach is random — but every flower on
        // the left half is left of every one on the right half
        let left = b[..COUNT / 2].iter().map(|p| p.dx).fold(f64::MIN, f64::max);
        let right = b[COUNT / 2..].iter().map(|p| p.dx).fold(f64::MAX, f64::min);
        assert!(left < right);
    }

    #[test]
    fn every_flower_is_inside_the_shipping_ranges() {
        for seed in [0, 1, 99, u32::MAX] {
            for (i, p) in burst(seed).iter().enumerate() {
                assert!((9.0..17.0).contains(&p.size));
                assert!((90.0..170.0).contains(&p.rise));
                assert!((-140.0..140.0).contains(&p.rot));
                assert!((750.0..1050.0).contains(&p.duration));
                assert!((0.0..120.0).contains(&p.delay));
                assert_eq!(p.hue as usize, i % 4);
            }
        }
    }

    #[test]
    fn the_burst_lasts_as_long_as_its_last_flower() {
        let b = burst(3);
        let longest = b.iter().map(|p| p.delay + p.duration).fold(0.0, f64::max);
        assert_eq!(burst_length(&b), longest);
        assert!(burst_length(&b) < 1170.0);
        assert_eq!(burst_length(&[]), 0.0);
    }
}
