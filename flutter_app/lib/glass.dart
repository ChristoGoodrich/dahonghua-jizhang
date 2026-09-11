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
      reduceTransparency: MediaQuery.maybeDisableAnimationsOf(context) ?? false,
      isWeb: false,
    );
    final spec = g.glassSpec(isDark: p.isDark, level: level);
    final alpha = g.readabilityAlpha(
      isDark: p.isDark,
      level: level,
      density: density,
      tier: tier,
    );
    final wash = parseRgba(
      g.washColor(
        isDark: p.isDark,
        card: p.cardHex,
        paper: p.paperHex,
        level: level,
        under: under ?? p.paperHex,
        alpha: alpha,
        surface: surface,
      ),
    );

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
                color: parseRgba(
                  g.touchLightColor(isDark: p.isDark),
                ).withValues(alpha: touch.clamp(0.0, 1.0)),
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
      ..color = (dark ? Colors.black : const Color(0xFF6B4632)).withValues(
        alpha: opacity * 0.8,
      );

    final pts = <Offset>[];
    final dots = <Offset>[];
    for (var i = 0; i < n; i++) {
      final o = Offset(
        rnd.nextDouble() * size.width,
        rnd.nextDouble() * size.height,
      );
      (rnd.nextBool() ? pts : dots).add(o);
    }
    canvas.drawPoints(ui.PointMode.points, pts, light);
    canvas.drawPoints(ui.PointMode.points, dots, shade);
  }

  @override
  bool shouldRepaint(_Grain old) => old.opacity != opacity || old.dark != dark;
}

/// 渐进模糊 — the ground a floating surface stands on.
///
/// The bar was a sticker before this. Content ran at full contrast right up to
/// its edge and then stopped, and what the eye read was the cut rather than the
/// material — the same complaint that started the vibrancy work, one layer
/// further out. HyperOS answers it with a blur that *ramps*: nothing a little
/// way above the bar, deepest at the screen's edge, so the last rows dissolve
/// into the chrome instead of being clipped by it. The header does the same
/// thing upside down.
///
/// ## How it is built, and why it is built that way
///
/// Nothing this app draws on has a progressive blur. Skia has a blur over a
/// rectangle and that is all, so the ramp is assembled out of rectangles:
/// `bands` of them, each starting lower than the last and all reaching the
/// deep end, so a point at the bottom is seen through every band and a point
/// at the top through none.
///
/// The per-band sigma is the part that is easy to get wrong and is therefore
/// not decided here. Blurs compose by variance — looking through σ=3 and then
/// σ=4 is looking through σ=5, not σ=7 — so equal steps would ramp as √k,
/// which is steep at the top, exactly where the onset has to be invisible.
/// `core::glass` states the curve and hands over the steps; see `scrim_bands`.
///
/// The wash rides the same curve. It is not only tone: a stack of clipped
/// rectangles has a hard edge at every join, and a tint that thickens across
/// those joins is what stops them being findable.
class GlassScrim extends StatelessWidget {
  const GlassScrim({super.key, this.flipped = false, this.under});

  /// Deepest at the TOP rather than the bottom, for chrome that floats above
  /// the content instead of below it.
  final bool flipped;

  /// What the wash fades toward. The page's paper unless told otherwise.
  final String? under;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final tier = g.resolveTier(
      reduceTransparency: MediaQuery.maybeDisableAnimationsOf(context) ?? false,
      isWeb: false,
    );
    final spec = g.scrimSpec(isDark: p.isDark, tier: tier);
    final ramp = g.scrimRamp(wash: spec.wash, bands: spec.bands);
    final tint = under == null ? p.paper : parseHex(under!);

    return IgnorePointer(
      // The band edges are fractions and `Positioned` wants pixels, so the box
      // has to be measured. A `FractionallySizedBox` was the first attempt and
      // cannot work: `Positioned(left, right, bottom)` leaves the height
      // unbounded, and a fraction of an unbounded height is the assertion that
      // took down sixty-nine tests at once.
      child: LayoutBuilder(
        builder: (context, c) {
          final h = c.maxHeight;
          if (!h.isFinite) return const SizedBox.shrink();

          // The ramp occupies `fade` at the SHALLOW end; everything deeper is
          // held at full strength. Spreading it across the whole box instead
          // was the first version's mistake and it showed on the first
          // screenshot: the deepest blur ended up in the 26dp behind the
          // status bar, and rows a comfortable distance BELOW the header were
          // still visibly soft. The part of the box behind the chrome is not
          // part of the transition — nobody sees it — so the transition
          // should not spend itself there.
          final fade = spec.fade.clamp(0.0, h);
          final wash = Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: flipped ? Alignment.bottomCenter : Alignment.topCenter,
                  end: flipped ? Alignment.topCenter : Alignment.bottomCenter,
                  colors: [
                    for (final a in ramp)
                      tint.withValues(alpha: a.clamp(0.0, 1.0)),
                    // Held, not extrapolated: the gradient's own last stop
                    // would otherwise land at the box's edge and stretch the
                    // ramp back over the whole thing.
                    tint.withValues(alpha: ramp.last.clamp(0.0, 1.0)),
                  ],
                  stops: [
                    for (var k = 0; k < ramp.length; k++)
                      (k / (ramp.length - 1)) * (fade / h),
                    1.0,
                  ],
                ),
              ),
            ),
          );

          if (spec.sigma <= 0) {
            // Positioned children only, so this takes its whole constraints —
            // which for once is the intent. The callers give it a box.
            return Stack(children: [wash]);
          }
          return Stack(
            children: [
              for (final band in g.scrimBands(
                sigma: spec.sigma,
                bands: spec.bands,
              ))
                // A sub-pixel sigma is a save layer for nothing. The first band
                // is deliberately that small — the top of a progressive blur
                // must not be findable — so it is the one that gets dropped,
                // and dropping it moves the total from 22 to 21.99.
                if (band.sigma >= 0.05)
                  Positioned(
                    left: 0,
                    right: 0,
                    // Every band runs to the deep end, so they nest and the
                    // blur through them compounds. That is what the per-band
                    // sigmas are computed for.
                    top: flipped ? 0 : band.top * fade,
                    bottom: flipped ? band.top * fade : 0,
                    // The clip is what confines the filter. An unclipped
                    // BackdropFilter blurs the whole screen.
                    child: ClipRect(
                      child: BackdropFilter(
                        filter: ui.ImageFilter.blur(
                          sigmaX: band.sigma,
                          sigmaY: band.sigma,
                          // Clamp, unlike `Glass`: this band's edges ARE the
                          // screen's edges, and decal would fade the content
                          // there to nothing and draw a dark seam down both
                          // sides.
                          tileMode: TileMode.clamp,
                        ),
                        child: const SizedBox.expand(),
                      ),
                    ),
                  ),
              wash,
            ],
          );
        },
      ),
    );
  }
}

/// How far a scrim reaches past the surface it stands under, in dp.
///
/// The caller adds its own height: the bar knows how tall it is and the header
/// knows the status bar's inset, and neither is arithmetic worth crossing the
/// boundary for.
double scrimFade(BuildContext context) => g
    .scrimSpec(
      isDark: palette.isDark,
      tier: g.resolveTier(
        reduceTransparency:
            MediaQuery.maybeDisableAnimationsOf(context) ?? false,
        isWeb: false,
      ),
    )
    .fade;

/// How far down a screen's content has to start so its first row is not born
/// under the header.
///
/// The status bar plus the toolbar, which is the whole of the chrome a pushed
/// screen puts over its body. Called from the screen's own build rather than
/// from inside the `Scaffold`, because a `Scaffold` with
/// `extendBodyBehindAppBar` deliberately does not consume the top inset and
/// asking twice in two places is how the two answers drift.
double headerInset(BuildContext context) =>
    MediaQuery.paddingOf(context).top + kToolbarHeight;

/// A screen whose content runs under its header instead of stopping at it.
///
/// The same arrangement the entry list already had, extracted once fifteen
/// other screens needed it: a transparent app bar standing on a [GlassScrim],
/// with the body running the full height behind both. Content is crisp at rest
/// and dissolves as it slides underneath — which is the point, and is why the
/// scrim is sized to the header alone. Given the fade as well, the transition
/// would land *below* the bar and blur rows nobody had scrolled near.
///
/// The body must pad its own top by [headerInset]. That cannot be done out
/// here: padding applied around a scrollable moves the viewport instead of its
/// contents, and a viewport that starts below the header is a viewport with
/// nothing running under it.
class ScrimScaffold extends StatelessWidget {
  const ScrimScaffold({
    super.key,
    required this.title,
    required this.body,
    this.actions,
    this.leading,
    this.floatingActionButton,
    this.bottomNavigationBar,
  });

  /// Taken as a widget rather than a string: the screens spell their own
  /// titles, and one of them spells a different title depending on what it is
  /// showing.
  final Widget title;
  final Widget body;
  final List<Widget>? actions;
  final Widget? leading;
  final Widget? floatingActionButton;
  final Widget? bottomNavigationBar;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: palette.paper,
    // Without this the scrim has nothing to blur, and a blur of a flat colour
    // is a flat colour.
    extendBodyBehindAppBar: true,
    extendBody: true,
    appBar: AppBar(
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      // Material 3 tints an app bar the moment content passes under it, and
      // content passing under it is the whole arrangement.
      scrolledUnderElevation: 0,
      elevation: 0,
      // Without this the icons are derived from a transparent background,
      // which reads as dark and asks for white icons on cream paper.
      systemOverlayStyle: systemOverlay,
      leading: leading,
      title: title,
      actions: actions,
    ),
    body: Stack(
      fit: StackFit.expand,
      children: [
        body,
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          height: headerInset(context),
          child: const GlassScrim(flipped: true),
        ),
      ],
    ),
    floatingActionButton: floatingActionButton,
    bottomNavigationBar: bottomNavigationBar,
  );
}

/// The status bar, which is the only chrome above a screen that has no header.
double statusInset(BuildContext context) => MediaQuery.paddingOf(context).top;

/// A scrolling screen with no header of its own.
///
/// The large-title tabs — 资产 and 我的 — put their title inside the list, so
/// there is no app bar for a scrim to stand under. They used a `SafeArea` to
/// clear the status bar, which pushes the list down and cuts the content dead
/// exactly where every other screen now dissolves it.
///
/// So: no `SafeArea`, the list pads its own top by [statusInset], and the
/// status bar gets a scrim of its own. Shallower than a header's, because it
/// is covering 24dp rather than 80 — the ramp is clamped to the box.
class StatusScrim extends StatelessWidget {
  const StatusScrim({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Stack(
    fit: StackFit.expand,
    children: [
      child,
      Positioned(
        top: 0,
        left: 0,
        right: 0,
        height: statusInset(context),
        child: const GlassScrim(flipped: true),
      ),
    ],
  );
}
