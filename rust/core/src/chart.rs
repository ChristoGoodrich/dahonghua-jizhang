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

// ---------------------------------------------------------------------------
// Beyond the polyline: the curve, the gridlines, and the finger.
//
// None of this is in the parity corpus, because the shipping chart drew a
// straight polyline with nothing behind it. It is here rather than in the
// painter for the reason the polyline is: each of the three is a place a
// chart can be confidently wrong while looking fine.
// ---------------------------------------------------------------------------

/// One cubic Bézier segment, continuing from wherever the last one ended.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cubic {
    pub c1: Point,
    pub c2: Point,
    pub to: Point,
}

/// A smooth curve through `points`, as Bézier segments from `points[0]`.
///
/// A polyline through daily spending reads as a seismograph; the curve is
/// what makes it read as a trend. But the obvious curve is the wrong one. A
/// Catmull-Rom spline overshoots — a day of ¥0 between two days of ¥300 dips
/// *below* the axis, drawing spending that is negative, and a flat run of
/// equal days bulges instead of lying flat. A chart that invents a value
/// between two real ones is the confident wrongness this module exists to
/// keep out.
///
/// So this is monotone cubic interpolation (Fritsch–Butland): each interior
/// tangent is the weighted harmonic mean of the slopes either side, or flat
/// where the data turns. That bounds every tangent by three times the smaller
/// neighbouring slope, which puts both control points of each segment inside
/// the vertical range of its two ends — and a Bézier never leaves the hull of
/// its control points. The curve can only pass through the values; it cannot
/// exceed them, and where two days are equal it lies flat between them.
///
/// Fewer than two points have nothing to join and return no segments.
pub fn smooth(points: &[Point]) -> Vec<Cubic> {
    let n = points.len();
    if n < 2 {
        return Vec::new();
    }
    let h: Vec<f64> = points.windows(2).map(|w| w[1].x - w[0].x).collect();
    let d: Vec<f64> = points
        .windows(2)
        .zip(&h)
        .map(|(w, &h)| if h == 0.0 { 0.0 } else { (w[1].y - w[0].y) / h })
        .collect();

    let mut m = vec![0.0; n];
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for i in 1..n - 1 {
        let (d0, d1) = (d[i - 1], d[i]);
        m[i] = if d0 * d1 <= 0.0 {
            // a turn, or a flat side: the curve must not carry on past it
            0.0
        } else {
            let (h0, h1) = (h[i - 1], h[i]);
            3.0 * (h0 + h1) / ((2.0 * h1 + h0) / d0 + (h1 + 2.0 * h0) / d1)
        };
    }

    (0..n - 1)
        .map(|i| {
            let (a, b) = (points[i], points[i + 1]);
            let t = h[i] / 3.0;
            Cubic {
                c1: Point {
                    x: a.x + t,
                    y: a.y + m[i] * t,
                },
                c2: Point {
                    x: b.x - t,
                    y: b.y - m[i + 1] * t,
                },
                to: b,
            }
        })
        .collect()
}

/// Round values for gridlines, from zero up to no more than `max`.
///
/// Steps of 1, 2 or 5 times a power of ten, the smallest that keeps the count
/// at `target` or under — so a peak of ¥2,800 gets lines at 0, 1,000 and
/// 2,000, not at 0, 933 and 1,867. The lines sit under the data rather than
/// rescaling it: the scale is [`chart_max`]'s, which the corpus pins, so the
/// top gridline is at or below the peak rather than the peak being squeezed
/// down to meet one.
///
/// A maximum that is not a positive finite number has only the baseline.
pub fn nice_ticks(max: f64, target: usize) -> Vec<f64> {
    if !max.is_finite() || max <= 0.0 || target == 0 {
        return vec![0.0];
    }
    let rough = max / target as f64;
    let mag = 10f64.powf(rough.log10().floor());
    let step = [1.0, 2.0, 5.0, 10.0]
        .iter()
        .map(|k| k * mag)
        .find(|s| *s >= rough)
        .unwrap_or(10.0 * mag);
    let mut out = Vec::new();
    let mut i = 0.0;
    // multiplied, not accumulated: adding 0.1 ten times is not 1.0
    while i * step <= max * (1.0 + 1e-12) {
        out.push(i * step);
        i += 1.0;
    }
    out
}

/// Which of `n` points a finger at `x` means: the nearest one.
///
/// The inverse of [`x_of`], rounded and held inside the chart, so dragging
/// past either end stays on the end point instead of reading off the array.
/// `None` for an empty chart, where there is nothing to point at.
pub fn index_at(x: f64, n: usize) -> Option<usize> {
    if n == 0 {
        return None;
    }
    if n == 1 || x.is_nan() {
        return Some(0);
    }
    let span = CHART_W - 2.0 * CHART_PAD;
    let t = ((x - CHART_PAD) / span).clamp(0.0, 1.0);
    Some(((t * (n - 1) as f64).round() as usize).min(n - 1))
}

/// Each value as a share of the largest, for bars.
///
/// Never divided by less than 1, as [`chart_max`] is never less than 1, and
/// for the same two reasons: an all-zero set would divide by zero, and a set
/// of tiny amounts should draw as tiny rather than be stretched to fill the
/// track. The shipping bars were `total / Math.max(...totals, 1)`.
pub fn bar_fracs(values: &[f64]) -> Vec<f64> {
    let max = values.iter().copied().fold(1.0_f64, f64::max);
    values.iter().map(|v| (v / max).clamp(0.0, 1.0)).collect()
}

/// Gridlines for a series: [`nice_ticks`] of the largest value it has.
///
/// Of the data, not of [`chart_max`]. The scale never drops below 1, so an
/// empty week has a maximum of 1 and would get lines at 0, 0.5 and 1 — an
/// axis labelled ¥0, ¥1, ¥1 over nothing at all. An empty chart has only its
/// baseline. A `NaN` is skipped here; the scale is where it is allowed to
/// poison the drawing, and one poisoned layer is enough.
pub fn gridlines(values: &[f64], target: usize) -> Vec<f64> {
    let top = values
        .iter()
        .copied()
        .filter(|v| !v.is_nan())
        .fold(0.0_f64, f64::max);
    nice_ticks(top, target)
}

/// The first of the largest values, for the marker on a trend's peak.
///
/// `None` when nothing is above zero: a peak marker on a flat line points at
/// an arbitrary day and calls it the most expensive one.
pub fn peak(values: &[f64]) -> Option<usize> {
    let mut best: Option<(usize, f64)> = None;
    for (i, v) in values.iter().enumerate() {
        if *v > 0.0 && best.is_none_or(|(_, b)| *v > b) {
            best = Some((i, *v));
        }
    }
    best.map(|(i, _)| i)
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

    // ---- the curve, the gridlines, the finger ----

    fn pts(ys: &[f64]) -> Vec<Point> {
        ys.iter()
            .enumerate()
            .map(|(i, y)| Point {
                x: x_of(i, ys.len()),
                y: *y,
            })
            .collect()
    }

    /// The curve passes through every point it was given, in order.
    #[test]
    fn the_curve_passes_through_the_data() {
        let p = pts(&[89.0, 20.0, 60.0, 89.0, 7.0]);
        let segs = smooth(&p);
        assert_eq!(segs.len(), p.len() - 1);
        for (s, want) in segs.iter().zip(&p[1..]) {
            assert_eq!(s.to, *want);
        }
    }

    /// The property the choice of curve is for. A day of nothing between two
    /// big days must not dip past the baseline, and no segment may rise above
    /// the higher of its two ends: every control point stays inside the
    /// vertical range of its segment, and a Bézier stays inside the hull of
    /// its control points.
    #[test]
    fn the_curve_never_goes_past_a_value_it_joins() {
        let cases: [&[f64]; 4] = [
            &[89.0, 7.0, 89.0, 7.0, 89.0],
            &[89.0, 89.0, 10.0, 89.0, 89.0, 89.0, 40.0],
            &[80.0, 70.0, 60.0, 7.0, 6.9, 6.8],
            &[50.0, 7.0],
        ];
        for ys in cases {
            let p = pts(ys);
            for (i, s) in smooth(&p).iter().enumerate() {
                let (lo, hi) = (p[i].y.min(p[i + 1].y), p[i].y.max(p[i + 1].y));
                for c in [s.c1.y, s.c2.y] {
                    assert!(
                        c >= lo - 1e-9 && c <= hi + 1e-9,
                        "{ys:?} segment {i}: control {c} outside {lo}..{hi}"
                    );
                }
            }
        }
    }

    /// Two equal days are joined by a flat line, not a bulge.
    #[test]
    fn equal_neighbours_are_joined_flat() {
        let p = pts(&[40.0, 89.0, 89.0, 20.0]);
        let s = smooth(&p)[1];
        assert_eq!((s.c1.y, s.c2.y), (89.0, 89.0));
    }

    #[test]
    fn one_point_is_not_a_curve() {
        assert!(smooth(&pts(&[40.0])).is_empty());
        assert!(smooth(&[]).is_empty());
    }

    #[test]
    fn gridlines_fall_on_round_numbers() {
        assert_eq!(nice_ticks(2800.0, 3), vec![0.0, 1000.0, 2000.0]);
        assert_eq!(nice_ticks(100.0, 4), vec![0.0, 50.0, 100.0]);
        assert_eq!(nice_ticks(1.0, 4), vec![0.0, 0.5, 1.0]);
        assert_eq!(nice_ticks(12_800.0, 3), vec![0.0, 5000.0, 10_000.0]);
        for (max, target) in [(37.5, 3), (999.0, 4), (123_456.0, 3), (1.0, 1)] {
            let t = nice_ticks(max, target);
            assert_eq!(t[0], 0.0);
            assert!(t.len() <= target + 1, "{max}/{target}: {t:?}");
            assert!(*t.last().unwrap() <= max, "{max}: {t:?}");
            let step = t.get(1).copied().unwrap_or(max);
            let mantissa = step / 10f64.powf(step.log10().floor());
            assert!(
                [1.0, 2.0, 5.0].iter().any(|k| (mantissa - k).abs() < 1e-9),
                "{max}: a step of {step}"
            );
        }
    }

    #[test]
    fn a_maximum_that_is_not_a_number_has_only_a_baseline() {
        assert_eq!(nice_ticks(f64::NAN, 3), vec![0.0]);
        assert_eq!(nice_ticks(0.0, 3), vec![0.0]);
        assert_eq!(nice_ticks(-5.0, 3), vec![0.0]);
    }

    /// The finger lands on the point it is over, and past either end it
    /// stays on the end.
    #[test]
    fn a_finger_finds_the_point_under_it() {
        for n in [1usize, 2, 7, 31] {
            for i in 0..n {
                assert_eq!(index_at(x_of(i, n), n), Some(i), "{i} of {n}");
            }
            assert_eq!(index_at(-50.0, n), Some(0));
            assert_eq!(index_at(CHART_W + 50.0, n), Some(n - 1));
        }
        assert_eq!(index_at(150.0, 0), None);
        // halfway between two points goes to one of them, not off the end
        let mid = (x_of(2, 7) + x_of(3, 7)) / 2.0;
        assert!(matches!(index_at(mid, 7), Some(2) | Some(3)));
    }

    #[test]
    fn bars_are_shares_of_the_largest() {
        assert_eq!(bar_fracs(&[50.0, 100.0, 0.0]), vec![0.5, 1.0, 0.0]);
        // an empty week does not divide by zero, and pennies stay small
        assert_eq!(bar_fracs(&[0.0, 0.0]), vec![0.0, 0.0]);
        assert_eq!(bar_fracs(&[0.25]), vec![0.25]);
        assert!(bar_fracs(&[]).is_empty());
    }

    #[test]
    fn an_empty_chart_has_only_its_baseline() {
        assert_eq!(gridlines(&[0.0, 0.0, 0.0], 3), vec![0.0]);
        assert_eq!(gridlines(&[], 3), vec![0.0]);
        assert_eq!(
            gridlines(&[0.0, 2800.0, f64::NAN], 3),
            vec![0.0, 1000.0, 2000.0]
        );
    }

    #[test]
    fn the_peak_is_the_first_of_the_largest() {
        assert_eq!(peak(&[1.0, 5.0, 3.0, 5.0]), Some(1));
        assert_eq!(peak(&[0.0, 0.0]), None);
        assert_eq!(peak(&[]), None);
        assert_eq!(peak(&[f64::NAN, 2.0]), Some(1));
    }
}
