// 液态玻璃 — the lens that moves, drawn.
//
// The selected-tab indicator used to be a tinted pill on a 320ms curve. A
// tinted pill is not an object: you cannot push it, it has no weight, and when
// it arrives it has obviously been repainted rather than moved. What Apple's
// Liquid Glass does differently is treat the same control as a physical thing
// — a small lens sitting ON the bar, which follows your finger, stretches when
// it is thrown, and settles on a spring.
//
// Four layers, and the first is the one that was missing:
//
//   1. a drop shadow that TRAILS — offset against the direction of travel, so
//      the lens reads as an object above the bar with light behind it rather
//      than as a hole cut in it. At rest it sits just below.
//   2. the lens body: its own backdrop blur, on top of the bar's. Two blurs
//      stacked is what a second piece of glass over the first actually does,
//      and it is why the lens is visible at all over a surface that is
//      already frosted.
//   3. a specular highlight, which LAGS to the trailing edge as it moves.
//      Light bounces off a surface; it does not travel with it. A highlight
//      pinned to the middle is the tell that the thing is a rectangle with a
//      gradient painted on it.
//   4. a rim, bright where the light falls — top, and toward the leading edge.
//
// Every number in the motion is `core::liquid`'s: the stretch (area-conserving,
// so it reads as momentum and not as growth), how far the shadow trails, where
// the highlight sits, and the spring. This file positions and paints.

import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import 'src/rust/api/liquid.dart' as q;
import 'theme.dart';

/// A small lens, `width` x `height`, moving at `velocity` dp/s.
///
/// Draws at its own size and lets the stretch overflow — the caller positions
/// it by its resting rectangle and does not have to know that a moving lens is
/// wider than a still one.
class LiquidLens extends StatelessWidget {
  const LiquidLens({
    super.key,
    required this.width,
    required this.height,
    required this.velocity,
    this.tint,
  });

  final double width;
  final double height;

  /// dp per second. Sign is the direction; everything asymmetric follows it.
  final double velocity;

  /// The lens's own colour. The theme's flower unless told otherwise.
  final Color? tint;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final spec = q.liquidSpec(isDark: p.isDark);
    final lens = q.lens(isDark: p.isDark, velocity: velocity);
    final accent = tint ?? p.hibiscus;
    final r = height / 2;
    final shape = BorderRadius.circular(r);

    // Continuous, and that matters: `sheenAt` slides toward the TRAILING edge,
    // so the leading edge is its complement. Picking a side with a comparison
    // instead would make the rim jump the instant the lens crossed zero
    // velocity, which is exactly when it is being looked at.
    final lead = 1 - lens.sheenAt;

    final body = ClipRRect(
      borderRadius: shape,
      child: BackdropFilter(
        // A second blur over the bar's own. Small — this is a thin lens, not a
        // sheet — but without it the pill is a colour and not a material.
        filter: ui.ImageFilter.blur(
          sigmaX: 6,
          sigmaY: 6,
          tileMode: TileMode.decal,
        ),
        child: Stack(
          children: [
            // Unpositioned, so the Stack sizes to it rather than taking its
            // whole constraints. Three places in this codebase have made that
            // mistake and one of them cost a bar that filled the screen.
            SizedBox(
              width: width,
              height: height,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: p.isDark ? 0.20 : 0.14),
                ),
              ),
            ),
            Positioned.fill(
              child: IgnorePointer(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: RadialGradient(
                      // Across the lens by `sheenAt`, and high up: a specular
                      // highlight on a convex surface sits above the middle.
                      center: Alignment(lens.sheenAt * 2 - 1, -0.55),
                      radius: 0.95,
                      colors: [
                        Colors.white.withValues(alpha: p.isDark ? 0.30 : 0.55),
                        Colors.white.withValues(alpha: 0),
                      ],
                      stops: const [0, 1],
                    ),
                  ),
                ),
              ),
            ),
            Positioned.fill(
              child: IgnorePointer(
                child: CustomPaint(
                  painter: _LensRim(
                    radius: r,
                    width: 1 / MediaQuery.devicePixelRatioOf(context),
                    accent: accent,
                    lead: lead,
                    dark: p.isDark,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );

    return IgnorePointer(
      child: SizedBox(
        width: width,
        height: height,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            // 可拖动的阴影 — the shadow goes where the lens has been, not where
            // it is. `BlurStyle.outer` so nothing is painted inside its own
            // shape: an inner shadow under a translucent lens would darken the
            // tint rather than sit behind it.
            Positioned(
              left: lens.trail,
              top: spec.shadowLift,
              width: width,
              height: height,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: shape,
                  boxShadow: [
                    BoxShadow(
                      color: parseHex(
                        p.shadowHex,
                      ).withValues(alpha: spec.shadowAlpha),
                      blurRadius: spec.shadowBlur,
                      blurStyle: BlurStyle.outer,
                    ),
                  ],
                ),
              ),
            ),
            // The stretch, about the lens's own centre. Scaling the shadow
            // with it would stretch the shadow too, and a shadow that deforms
            // with the object is a shadow painted on the object.
            Positioned.fill(
              child: Transform(
                alignment: Alignment.center,
                transform: Matrix4.diagonal3Values(lens.scaleX, lens.scaleY, 1),
                child: body,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The lens's rim.
///
/// Bright at the top and toward the leading edge, dim at the bottom and
/// behind. That is one stroke with a diagonal gradient rather than a border:
/// a flat border is a stroke, and a stroke that is brighter where the light
/// falls is an edge.
class _LensRim extends CustomPainter {
  const _LensRim({
    required this.radius,
    required this.width,
    required this.accent,
    required this.lead,
    required this.dark,
  });

  final double radius;
  final double width;
  final Color accent;

  /// Where the light catches, 0 at the left edge and 1 at the right.
  final double lead;
  final bool dark;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = RRect.fromRectAndRadius(
      rect.deflate(width / 2),
      Radius.circular(radius),
    );
    canvas.drawRRect(
      rrect,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = width
        ..shader = ui.Gradient.linear(
          Offset(size.width * lead, 0),
          Offset(size.width * (1 - lead), size.height),
          [
            Colors.white.withValues(alpha: dark ? 0.55 : 0.85),
            accent.withValues(alpha: dark ? 0.36 : 0.30),
            (dark ? Colors.white : accent).withValues(alpha: 0.12),
          ],
          const [0, 0.55, 1],
        ),
    );
  }

  @override
  bool shouldRepaint(_LensRim old) =>
      old.radius != radius ||
      old.width != width ||
      old.accent != accent ||
      old.lead != lead ||
      old.dark != dark;
}
