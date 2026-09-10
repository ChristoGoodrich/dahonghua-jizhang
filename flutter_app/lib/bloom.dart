// 大红花 — the app's own mark, drawn.
//
// The empty ledger used to say 🌺, and an emoji is the wrong thing in two
// ways. It is somebody else's drawing — the hibiscus that shipped is Noto's on
// one phone, Samsung's on another, and a fallback box on a third — and it is
// not the flower on the launcher icon the user just tapped. The first screen
// of an empty app is exactly where the mark should be its own.
//
// So it is drawn, and drawn from the icon rather than from memory. The
// geometry below was measured off `assets/images/icon.png`, the same file
// `tool/gen_icons.py` resizes into the five launcher densities: five petal
// circles on an orbit, one centre circle, one petal pointing straight up. The
// numbers are ratios of the mark's own radius so the same shape comes out at
// any size, and they are stated here rather than derived because a fit against
// a PNG is a measurement and measurements are written down.
//
//     petal orbit   0.6037 · r     158.1 px of a 261.9 px mark
//     petal radius  0.3963 · r     103.8
//     centre        0.2978 · r      78.0
//
// The colours are the palette's rather than the PNG's, and that is a
// difference on purpose. The icon is the default theme's #D94E5C on #E8A838
// because a launcher icon cannot change; on screen the mark takes whichever
// flower the user chose, so 茉莉 gets a green one. The two agree wherever the
// default theme is in force, which is where anyone would compare them.

import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'theme.dart';

/// The mark, `size` across from petal tip to petal tip.
class Bloom extends StatelessWidget {
  const Bloom({super.key, this.size = 48, this.petal, this.core});

  final double size;

  /// Overrides, for a mark that has to sit on something other than paper.
  /// Both default to the theme's flower.
  final Color? petal;
  final Color? core;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _BloomPainter(
          petal: petal ?? p.hibiscus,
          core: core ?? p.stamen,
        ),
      ),
    );
  }
}

class _BloomPainter extends CustomPainter {
  const _BloomPainter({required this.petal, required this.core});

  final Color petal;
  final Color core;

  /// Measured from `assets/images/icon.png`; see the file header.
  static const double _orbit = 0.6037;
  static const double _petal = 0.3963;
  static const double _core = 0.2978;

  @override
  void paint(Canvas canvas, Size size) {
    final r = size.shortestSide / 2;
    // The flower's own centre on the box's centre, which is where the icon
    // puts it. Its bounding box is NOT centred — the top petal reaches further
    // up than the two bottom ones reach down — and balancing the box instead
    // would draw a mark that sits differently from the launcher's.
    final c = Offset(size.width / 2, size.height / 2);

    final fill = Paint()
      ..color = petal
      ..isAntiAlias = true;
    for (var i = 0; i < 5; i++) {
      // Straight up, then every 72°.
      final a = -math.pi / 2 + i * 2 * math.pi / 5;
      canvas.drawCircle(
        c + Offset(math.cos(a), math.sin(a)) * (_orbit * r),
        _petal * r,
        fill,
      );
    }
    canvas.drawCircle(
      c,
      _core * r,
      Paint()
        ..color = core
        ..isAntiAlias = true,
    );
  }

  @override
  bool shouldRepaint(_BloomPainter old) =>
      old.petal != petal || old.core != core;
}
