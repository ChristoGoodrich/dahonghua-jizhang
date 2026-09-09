// 柔光玻璃 — the material, rendered.
//
// `core::glass` decides every number: the blur intensity, the wash a surface
// paints over the room behind it, the specular sheen, the readability alpha
// that thickens the wash when the blur is unavailable, and — added after the
// first two attempts at this looked wrong — the vibrancy, the rim and the
// grain.
//
// ## Why the first version did not look like glass
//
// It blurred, and it washed, and the result was grey mush. A Gaussian blur is
// an average of neighbouring pixels, and averaging colour walks toward grey:
// a red row and a green row behind the bar come out beige. Real frosted glass
// scatters light without draining it, and every system implementation of this
// material compensates for that — Apple's vibrancy is documented as amplifying
// the colour of the content behind, and HyperOS's own 高光 modules expose the
// same knob as "material colour mixing".
//
// So the composition is five layers, in order:
//
//   1. the backdrop, blurred AND re-saturated — one composed ImageFilter, so
//      the amplification applies to the blurred result rather than to the
//      sharp content underneath it
//   2. the wash — this surface's own colour, pulled toward what is behind it
//   3. grain, to break the banding a wide blur leaves on a near-flat backdrop
//   4. the sheen — a specular band along the top
//   5. the rim — a border that is bright where the light falls and dim where
//      it does not, which is the difference between an edge and a stroke
//
// Below the `full` tier the blur drops out and the wash thickens to
// compensate, which is `readabilityAlpha`'s whole job. Nothing else changes:
// a surface that cannot blur should still look deliberate.

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import 'src/rust/api/glass.dart' as g;
import 'theme.dart';

/// A surface made of the app's glass.
///
/// `level` picks the recipe — `chrome` for the bar, `card` for a panel,
/// `sheet` for something modal. `under` is what sits behind it, which the wash
/// is mixed toward; passing the wrong one makes the material look painted on
/// rather than seen through.
class Glass extends StatelessWidget {
  const Glass({
    super.key,
    required this.child,
    this.level = g.GlassLevel.card,
    this.density = 0.6,
    this.under,
    this.radius = 16,
    this.edge = true,
    this.sheen = true,
    this.padding = EdgeInsets.zero,
    this.touch = 0,
    this.surface,
  });

  final Widget child;
  final g.GlassLevel level;

  /// How much content rests on it, 0..1. Denser content needs a thicker wash
  /// to stay readable, which is what the core works out.
  final double density;

  /// The colour behind this surface. Defaults to the theme's paper.
  final String? under;

  final double radius;
  final bool edge;
  final bool sheen;
  final EdgeInsets padding;

  /// 点按有光. 0..1, driven by whatever is animating the press.
  final double touch;

  /// The material's own colour before it picks up the room. Defaults to the
  /// card; a dark chrome surface passes ink so it stays dark glass rather than
  /// becoming a light panel that white text falls off.
  final String? surface;

  @override
  Widget build(BuildContext context) {
    final p = palette;

    final tier = g.resolveTier(
      reduceTransparency:
          MediaQuery.maybeDisableAnimationsOf(context) ?? false,
      isWeb: false,
    );
    final spec = g.glassSpec(isDark: p.isDark, level: level);
    final alpha = g.readabilityAlpha(
      isDark: p.isDark,
      level: level,
      density: density,
      tier: tier,
    );
    final wash = parseRgba(g.washColor(
      isDark: p.isDark,
      card: p.cardHex,
      paper: p.paperHex,
      level: level,
      under: under ?? p.paperHex,
      alpha: alpha,
      surface: surface,
    ));

    final shape = BorderRadius.circular(radius);
    final hairline = 1 / MediaQuery.devicePixelRatioOf(context);

    // Layers 2–5, over whatever the backdrop turned out to be.
    Widget front = Stack(
      children: [
        // The content is the unpositioned child so the Stack sizes to it. A
        // Stack whose children are all positioned takes its whole constraints,
        // which this file got wrong once and cost a bar that filled the
        // screen.
        Container(
          decoration: BoxDecoration(color: wash),
          padding: padding,
          child: child,
        ),
        if (spec.noise > 0)
          Positioned.fill(
            child: IgnorePointer(
              child: CustomPaint(
                painter: _Grain(opacity: spec.noise, dark: p.isDark),
              ),
            ),
          ),
        if (sheen && spec.sheen > 0)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: spec.sheenHeight,
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Colors.white.withValues(alpha: spec.sheen),
                      Colors.white.withValues(alpha: 0),
                    ],
                  ),
                ),
              ),
            ),
          ),
        if (touch > 0)
          Positioned.fill(
            child: IgnorePointer(
              child: ColoredBox(
                color: parseRgba(g.touchLightColor(isDark: p.isDark))
                    .withValues(alpha: touch.clamp(0.0, 1.0)),
              ),
            ),
          ),
        if (edge)
          Positioned.fill(
            child: IgnorePointer(
              child: CustomPaint(
                painter: _Rim(
                  radius: radius,
                  width: spec.edgeWidth < 0 ? hairline : spec.edgeWidth,
                  top: spec.rimTop,
                  bottom: spec.rimBottom,
                  dark: p.isDark,
                ),
              ),
            ),
          ),
      ],
    );

    front = ClipRRect(borderRadius: shape, child: front);

    if (tier != g.GlassTier.full) return front;

    // The backdrop. `compose` rather than two filters: the saturation has to
    // apply to the BLURRED result, and a ColorFilter applied separately would
    // amplify the sharp content and then blur it — which averages the
    // amplification away again and looks identical to no vibrancy at all.
    final saturate = ui.ColorFilter.matrix(
      g
          .saturationMatrix(vibrancy: spec.vibrancy)
          .map((v) => v.toDouble())
          .toList(),
    );
    final sigma = spec.intensity / 4;

    return ClipRRect(
      borderRadius: shape,
      child: BackdropFilter(
        filter: ui.ImageFilter.compose(
          outer: saturate,
          inner: ui.ImageFilter.blur(
            sigmaX: sigma,
            sigmaY: sigma,
            // Decal, not the default clamp: a clamped blur smears the pixels
            // at the surface's own edge outward, which draws a bright halo
            // along the rim and is the tell that a blur was faked.
            tileMode: TileMode.decal,
          ),
        ),
        child: front,
      ),
    );
  }
}

/// The lit rim.
///
/// A border with a direction. `rim_top` lightens and `rim_bottom` darkens on a
/// light theme, and the two swap on a dark one — a pale surface is found by the
/// light on its upper curve, a dark one by the light on its lower.
class _Rim extends CustomPainter {
  const _Rim({
    required this.radius,
    required this.width,
    required this.top,
    required this.bottom,
    required this.dark,
  });

  final double radius;
  final double width;
  final double top;
  final double bottom;
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
          rect.topCenter,
          rect.bottomCenter,
          [
            Colors.white.withValues(alpha: top),
            Colors.white.withValues(alpha: top * 0.15),
            (dark ? Colors.white : Colors.black).withValues(alpha: bottom),
          ],
          const [0.0, 0.5, 1.0],
        ),
    );
  }

  @override
  bool shouldRepaint(_Rim old) =>
      old.radius != radius ||
      old.width != width ||
      old.top != top ||
      old.bottom != bottom ||
      old.dark != dark;
}

/// Grain.
///
/// Deterministic, seeded once, so the surface does not shimmer between frames
/// — animated noise on a bar that is always on screen is a battery cost and a
/// distraction. Drawn as points rather than an image so there is no asset to
/// ship and nothing to decode.
class _Grain extends CustomPainter {
  const _Grain({required this.opacity, required this.dark});

  final double opacity;
  final bool dark;

  @override
  void paint(Canvas canvas, Size size) {
    final rnd = math.Random(20260909);
    final n = (size.width * size.height / 90).clamp(0, 4000).toInt();
    final light = Paint()..color = Colors.white.withValues(alpha: opacity);
    final shade = Paint()
      ..color = (dark ? Colors.black : const Color(0xFF6B4632))
          .withValues(alpha: opacity * 0.8);

    final pts = <Offset>[];
    final dots = <Offset>[];
    for (var i = 0; i < n; i++) {
      final o = Offset(rnd.nextDouble() * size.width,
          rnd.nextDouble() * size.height);
      (rnd.nextBool() ? pts : dots).add(o);
    }
    canvas.drawPoints(ui.PointMode.points, pts, light);
    canvas.drawPoints(ui.PointMode.points, dots, shade);
  }

  @override
  bool shouldRepaint(_Grain old) =>
      old.opacity != opacity || old.dark != dark;
}
