//! Where a chart's points go — the arithmetic under the drawing.
//!
//! Ported from `src/features/stats/geometry.ts`, itself lifted out of
//! `TrendChart.tsx`. That component says of itself that it is a "hand-rolled
//! dual polyline in the app's own chart voice… and no chart library", which was
//! a deliberate choice and stays one. What it means here is that the mapping
//! from values to coordinates is the app's own code rather than a dependency's,
//! so it answers to the parity corpus like everything else does.
//!
//! Three guards in fifteen lines, and each one is the sort a rewrite drops:
//!
//! * **`Math.max()` of nothing is `-Infinity`**, not zero. Filtering a series
//!   out and then asking for its maximum would put every point at negative
//!   infinity and draw nothing at all.
//! * **A single point has no span to divide by**, so `n - 1` is zero.
//! * **An all-zero series would divide by a zero maximum.**

/// The drawing box, in the units the `viewBox` uses. A Flutter painter scales
/// these to its own canvas; the shape is the same either way.
pub const CHART_W: f64 = 300.0;
pub const CHART_H: f64 = 96.0;
pub const CHART_PAD: f64 = 7.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// Which series a chart draws.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeriesType {
    Exp,
    Inc,
    Both,
}

impl SeriesType {
    pub fn parse(s: &str) -> SeriesType {
        match s {
            "exp" => SeriesType::Exp,
            "inc" => SeriesType::Inc,
            _ => SeriesType::Both,
        }
    }

    fn draws_exp(self) -> bool {
        matches!(self, SeriesType::Exp | SeriesType::Both)
    }

    fn draws_inc(self) -> bool {
        matches!(self, SeriesType::Inc | SeriesType::Both)
    }
}

/// The tallest value any drawn series reaches, and never less than 1.
///
/// The `1` is not cosmetic. It is the divisor for every y, so an all-zero day
/// would otherwise be a division by zero — and it also keeps a chart of small
/// numbers from being stretched to fill the box, which is the honest way to
/// draw "almost nothing happened".
///
/// `Math.max` propagates `NaN`, so a `NaN` anywhere in a drawn series makes the
/// whole maximum `NaN` and every point with it. Reproduced rather than tidied:
/// a chart that silently ignored a bad value would draw a plausible line over
/// data it could not actually read.
pub fn chart_max(exp: &[f64], inc: &[f64], series: SeriesType) -> f64 {
    let mut m = 1.0_f64;
    let drawn = series
        .draws_exp()
        .then_some(exp)
        .into_iter()
        .chain(series.draws_inc().then_some(inc));
    for v in drawn.flatten() {
        if v.is_nan() || m.is_nan() {
            return f64::NAN;
        }
        m = m.max(*v);
    }
    m
}

/// The x for the `i`th of `n` points, spread evenly across the padded box.
pub fn x_of(i: usize, n: usize) -> f64 {
    // `Math.max(1, n - 1)` — a single point would otherwise divide by zero, and
    // `n` is unsigned here so the subtraction is saturating for the same reason
    let span = (n.saturating_sub(1)).max(1) as f64;
    CHART_PAD + (i as f64 / span) * (CHART_W - 2.0 * CHART_PAD)
}

/// The y for a value, measured down from the top as SVG does.
pub fn y_of(v: f64, max: f64) -> f64 {
    CHART_H - CHART_PAD - (v / max) * (CHART_H - 2.0 * CHART_PAD)
}

/// A series as drawable points.
///
/// Rounded to one decimal, which is what the polyline string carries — so what
/// is compared is what is drawn, rather than a value that happens to round to
/// it. `toFixed(1)` rounds half away from zero for a positive number, which is
/// what `round_1` reproduces; a y can be negative when a value exceeds the
/// maximum, which cannot happen through [`chart_max`] but can through a caller
/// that supplies its own.
pub fn polyline(values: &[f64], max: f64, n: usize) -> Vec<Point> {
    values
        .iter()
        .enumerate()
        .map(|(i, v)| Point {
            x: round_1(x_of(i, n)),
            y: round_1(y_of(*v, max)),
        })
        .collect()
}

/// `Number(x.toFixed(1))`.
///
/// [`crate::money::to_fixed_num`] rather than `format!("{x:.1}")`: Rust's
/// formatter breaks an exact tie to **even** and `toFixed` breaks it **away
/// from zero**, so `0.25` formats as `0.2` there and `0.3` here. The two agree
/// on everything that is not an exact tie in binary, which is exactly why a
/// first draft of this file used the wrong one and passed nine of its ten
/// tests.
fn round_1(x: f64) -> f64 {
    crate::money::to_fixed_num(x, 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_maximum_is_never_less_than_one() {
        // an all-zero series would otherwise divide every y by zero
        assert_eq!(chart_max(&[0.0, 0.0], &[0.0], SeriesType::Both), 1.0);
        assert_eq!(chart_max(&[], &[], SeriesType::Both), 1.0);
        assert_eq!(chart_max(&[0.5], &[0.2], SeriesType::Both), 1.0);
    }

    #[test]
    fn a_series_that_is_not_drawn_does_not_count() {
        assert_eq!(chart_max(&[100.0], &[5.0], SeriesType::Inc), 5.0);
        assert_eq!(chart_max(&[100.0], &[5.0], SeriesType::Exp), 100.0);
        assert_eq!(chart_max(&[100.0], &[5.0], SeriesType::Both), 100.0);
    }

    #[test]
    fn an_empty_drawn_series_does_not_become_negative_infinity() {
        // `Math.max(...[])` is -Infinity, which would put every point off the
        // top of the box and draw nothing
        assert_eq!(chart_max(&[], &[7.0], SeriesType::Exp), 1.0);
    }

    #[test]
    fn a_nan_anywhere_drawn_makes_the_whole_maximum_nan() {
        // Math.max propagates it, and a chart that ignored it would draw a
        // plausible line over data it could not read
        assert!(chart_max(&[1.0, f64::NAN], &[], SeriesType::Exp).is_nan());
        // …but not from a series nobody is drawing
        assert_eq!(chart_max(&[f64::NAN], &[5.0], SeriesType::Inc), 5.0);
    }

    #[test]
    fn a_single_point_sits_at_the_left_padding() {
        // rather than dividing by a span of zero
        assert_eq!(x_of(0, 1), CHART_PAD);
        assert_eq!(x_of(0, 0), CHART_PAD);
    }

    #[test]
    fn points_span_the_padded_box() {
        let n = 5;
        assert_eq!(x_of(0, n), CHART_PAD);
        assert_eq!(x_of(n - 1, n), CHART_W - CHART_PAD);
    }

    #[test]
    fn the_maximum_sits_at_the_top_padding_and_zero_at_the_bottom() {
        assert_eq!(y_of(10.0, 10.0), CHART_PAD);
        assert_eq!(y_of(0.0, 10.0), CHART_H - CHART_PAD);
    }

    #[test]
    fn a_polyline_is_rounded_to_one_decimal() {
        let pts = polyline(&[0.0, 5.0, 10.0], 10.0, 3);
        assert_eq!(pts.len(), 3);
        assert_eq!(pts[0], Point { x: 7.0, y: 89.0 });
        assert_eq!(pts[2], Point { x: 293.0, y: 7.0 });
        // the middle one is the interesting arithmetic
        assert_eq!(pts[1], Point { x: 150.0, y: 48.0 });
    }

    #[test]
    fn rounding_follows_the_formatter_rather_than_the_rounder() {
        // 0.05 is not exactly representable; `toFixed(1)` reads the expansion
        assert_eq!(round_1(0.05), 0.1);
        assert_eq!(round_1(0.25), 0.3);
        assert_eq!(round_1(-0.25), -0.3);
        assert_eq!(round_1(1.0 / 3.0), 0.3);
    }

    #[test]
    fn a_series_shorter_than_the_span_still_draws_where_it_belongs() {
        // `values` and `n` are separate arguments in the TypeScript too, and a
        // caller that passes a filtered series keeps the original spacing
        let pts = polyline(&[1.0, 2.0], 2.0, 5);
        assert_eq!(pts[0].x, CHART_PAD);
        assert_eq!(pts[1].x, round_1(x_of(1, 5)));
    }
}
