// 柔光玻璃 — the material, rendered.
//
// `core::glass` has decided this since early in the port: the blur intensity,
// the wash colour a surface paints over the room behind it, the specular sheen
// on the top edge, the readability alpha that thickens the wash when the blur
// is unavailable. 1,281 parity cases against the shipping app.
//
// And until now nothing drew it. The only caller was a `MaterialProbe` screen
// that no route pointed at, so every one of those numbers was computed for a
// widget nobody could reach. The arithmetic was ported and the material was
// not, which is the opposite of the mistake this project keeps guarding
// against — usually the danger is a screen deciding for itself; here the core
// decided and no screen listened.
//
// The composition matches `src/components/ui/Glass.tsx`, in order:
//
//   1. a backdrop blur, when the tier allows one
//   2. the wash — this surface's own colour, pulled toward what is behind it
//   3. the sheen — a white gradient on the top edge, and the single cue that
//      reads as "glass" rather than "translucent panel"
//
// Below the `full` tier the blur drops out and the wash thickens to
// compensate, which is `readabilityAlpha`'s whole job.

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
  ///
  /// HyperOS 4 names this as one of the material's three behaviours — "点按有
  /// 光，操作有回应" — alongside blending toward what is under it and answering
  /// how dense the content is. The other two were here from the start and this
  /// one was not, which is most of why the surface read as a translucent panel
  /// rather than as glass: glass answers being touched.
  final double touch;

  /// The material's own colour before it picks up the room. Defaults to the
  /// card; a dark chrome surface passes ink so it stays dark glass rather than
  /// becoming a light panel that white text falls off.
  final String? surface;

  @override
  Widget build(BuildContext context) {
    final p = palette;

    // Every number below is a Rust call. None of them is recomputed here, and
    // that is deliberate: a `color-mix` needs a browser and four numbers need
    // nothing.
    final tier = g.resolveTier(
      // Flutter reports the OS accessibility setting; honouring it is the
      // reason the core takes it as an input rather than assuming a tier.
      reduceTransparency: MediaQuery.maybeDisableAnimationsOf(context) ??
          false,
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

    final hairline = 1 / MediaQuery.devicePixelRatioOf(context);
    final border = edge
        ? Border.all(
            color: parseRgba(spec.edge),
            width: spec.edgeWidth < 0 ? hairline : spec.edgeWidth,
          )
        : null;

    Widget body = Container(
      decoration: BoxDecoration(color: wash),
      padding: padding,
      child: child,
    );

    if (touch > 0) {
      body = Stack(
        children: [
          body,
          Positioned.fill(
            child: IgnorePointer(
              child: ColoredBox(
                color: parseRgba(g.touchLightColor(isDark: p.isDark))
                    .withValues(alpha: touch.clamp(0.0, 1.0)),
              ),
            ),
          ),
        ],
      );
    }

    if (sheen && spec.sheen > 0) {
      body = Stack(
        children: [
          // NOT `Positioned.fill`. A Stack whose every child is positioned has
          // nothing to size itself from, so it takes the largest size its
          // constraints allow — which made this surface fill the screen and
          // swallow every tap on it. The content has to be the unpositioned
          // child so the Stack is as tall as the content is.
          body,
          // The specular edge. Not decoration — without it the surface reads
          // as a flat translucent slab, which is the difference the whole
          // material is for.
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
        ],
      );
    }

    final shape = BorderRadius.circular(radius);

    // Below `full` there is no compositing layer at all — the wash was
    // thickened for exactly this case, so a BackdropFilter here would cost a
    // layer and change nothing.
    if (tier != g.GlassTier.full) {
      return DecoratedBox(
        decoration: BoxDecoration(borderRadius: shape, border: border),
        child: ClipRRect(borderRadius: shape, child: body),
      );
    }

    return DecoratedBox(
      decoration: BoxDecoration(borderRadius: shape, border: border),
      child: ClipRRect(
        borderRadius: shape,
        child: BackdropFilter(
          // `intensity` is the 0..100 scale expo-blur takes; sigma is what
          // Flutter takes. The ratio is the one expo-blur uses internally, so
          // the two builds blur by the same amount rather than by the same
          // number.
          filter: ui.ImageFilter.blur(
            sigmaX: spec.intensity / 4,
            sigmaY: spec.intensity / 4,
          ),
          child: body,
        ),
      ),
    );
  }
}
