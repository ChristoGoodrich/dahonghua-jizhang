// 贴上一朵花 — a dozen small flowers out of the + button when an entry lands.
//
// The shipping app did this (`PetalBurst.tsx`) and the port saved the entry in
// silence. Where each flower goes, how big and for how long is
// `core::burst`'s, from a seed picked when the entry is saved; this draws the
// flight — out, up and a little back down, turning, growing in and fading out
// — over the numbers it is given.

import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'bloom.dart';
import 'src/rust/api/burst.dart' as burst;
import 'theme.dart';

class PetalBurst extends StatefulWidget {
  const PetalBurst({super.key, required this.seed, required this.onDone});

  final int seed;

  /// The last flower has landed; the host takes the burst away.
  final VoidCallback onDone;

  /// How many bursts have started, for a test. Whether one is on screen at a
  /// given instant depends on how long the frames before it took — the
  /// flight is real time on a device, and a slow rebuild can outlast it —
  /// so a test asks whether one was planted rather than whether it is still
  /// in the air.
  @visibleForTesting
  static int planted = 0;

  @override
  State<PetalBurst> createState() => _PetalBurstState();
}

class _PetalBurstState extends State<PetalBurst>
    with SingleTickerProviderStateMixin {
  late final burst.BurstView _b = burst.petalBurst(
    seed: widget.seed & 0xffffffff,
  );
  late final AnimationController _t = AnimationController(
    vsync: this,
    duration: Duration(milliseconds: _b.length.ceil()),
  )..forward().whenComplete(() => widget.onDone());

  @override
  void initState() {
    super.initState();
    PetalBurst.planted++;
  }

  @override
  void dispose() {
    _t.dispose();
    super.dispose();
  }

  /// A keyframe track: `values[i]` at `at[i]`, straight lines between.
  static double _track(double v, List<double> at, List<double> values) {
    if (v <= at.first) return values.first;
    for (var i = 1; i < at.length; i++) {
      if (v <= at[i]) {
        final f = (v - at[i - 1]) / (at[i] - at[i - 1]);
        return values[i - 1] + (values[i] - values[i - 1]) * f;
      }
    }
    return values.last;
  }

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final hues = [
      (p.hibiscus, p.stamen),
      (p.hibiscusSoft, p.stamen),
      (p.leaf, p.leafDeep),
      (p.stamen, p.hibiscus),
    ];
    return IgnorePointer(
      child: AnimatedBuilder(
        animation: _t,
        builder: (context, _) {
          final ms = _t.value * _b.length;
          // No size of its own: every flower is placed from the + button's
          // centre, which is where the host puts this. A Stack of nothing but
          // positioned children under loose constraints would otherwise try
          // to be infinitely large.
          return SizedBox.shrink(
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                for (final f in _b.petals)
                  () {
                    final raw = ((ms - f.delay) / f.duration).clamp(0.0, 1.0);
                    final v = Curves.easeOutQuad.transform(raw);
                    final (petal, core) = hues[f.hue % hues.length];
                    // rise fast, then drift down a little — a petal's arc
                    final dy = _track(
                      v,
                      const [0, 0.62, 1],
                      [0, -f.rise, -f.rise + 30],
                    );
                    final opacity = _track(
                      v,
                      const [0, 0.08, 0.7, 1],
                      const [0, 1, 1, 0],
                    );
                    final scale = _track(
                      v,
                      const [0, 0.15, 1],
                      const [0.3, 1, 0.9],
                    );
                    return Positioned(
                      left: f.dx * v - f.size / 2,
                      top: dy - f.size / 2,
                      child: Opacity(
                        opacity: opacity.clamp(0.0, 1.0),
                        child: Transform.rotate(
                          angle: f.rot * v * math.pi / 180,
                          child: Transform.scale(
                            scale: scale,
                            child: Bloom(
                              size: f.size,
                              petal: petal,
                              core: core,
                            ),
                          ),
                        ),
                      ),
                    );
                  }(),
              ],
            ),
          );
        },
      ),
    );
  }
}
