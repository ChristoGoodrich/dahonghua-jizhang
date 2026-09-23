// The charts 统计 draws, from geometry the core already computed.
//
// Every coordinate here arrived from `api::stats`: points in the core's
// 300×96 box, the Bézier segments of the curve through them, where each
// gridline sits, where zero is, which point is the peak, what share of the
// tallest each bar is. What is left to this side is scaling that box to a
// canvas, and everything a chart looks like rather than says — stroke
// widths, gradients, dashes, the size of a dot.
//
// The line used to be a polyline with a dot on every day and nothing behind
// it, which on a month of real spending reads as a seismograph. The curve is
// monotone cubic, and why it is that curve and not the obvious one is in
// `core::chart::smooth`: the obvious one draws negative spending.

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import 'src/rust/api/stats.dart' as stats;
import 'theme.dart';

/// The core's box, scaled to a canvas. The only arithmetic a painter here
/// does.
class ChartBox {
  ChartBox(Size size, double w, double h)
    : sx = size.width / w,
      sy = size.height / h;

  final double sx;
  final double sy;

  Offset at(double x, double y) => Offset(x * sx, y * sy);
}

/// The curve through a line, as a path. Empty if any coordinate is not a
/// number — which is what a `NaN` in the data looks like by the time it gets
/// here, and drawing nothing is honest where drawing a line is not.
Path curveThrough(
  List<stats.ChartPoint> line,
  List<stats.CubicView> curve,
  ChartBox b,
) {
  final path = Path();
  if (line.isEmpty || line.any((p) => p.x.isNaN || p.y.isNaN)) return path;
  final start = b.at(line.first.x, line.first.y);
  path.moveTo(start.dx, start.dy);
  for (final c in curve) {
    final c1 = b.at(c.c1X, c.c1Y);
    final c2 = b.at(c.c2X, c.c2Y);
    final to = b.at(c.x, c.y);
    path.cubicTo(c1.dx, c1.dy, c2.dx, c2.dy, to.dx, to.dy);
  }
  return path;
}

/// One line on a [LineChartPainter].
class Series {
  const Series({
    required this.line,
    required this.curve,
    required this.color,
    this.fill = false,
    this.dashed = false,
    this.width = 2.4,
  });

  final List<stats.ChartPoint> line;
  final List<stats.CubicView> curve;
  final Color color;

  /// A gradient under the curve, down to zero.
  final bool fill;
  final bool dashed;
  final double width;
}

/// Curves over gridlines, with one point of the first series marked.
class LineChartPainter extends CustomPainter {
  LineChartPainter({
    required this.series,
    required this.boxW,
    required this.boxH,
    required this.zero,
    required this.grid,
    required this.ring,
    this.ticks = const [],
    this.tickLabels = const [],
    this.labelStyle = const TextStyle(fontSize: 10),
    this.labelsLeft = false,
    this.progress = 1,
    this.mark,
    this.guide = false,
  });

  /// Drawn last-to-first, so the first is on top.
  final List<Series> series;
  final double boxW;
  final double boxH;

  /// Where zero sits, in the box.
  final double zero;
  final Color grid;

  /// The colour a marker's ring is cut out of — the card behind the chart.
  final Color ring;
  final List<stats.TickView> ticks;
  final List<String> tickLabels;
  final TextStyle labelStyle;

  /// Gridline labels at the left end rather than the right — for a chart
  /// whose lines converge on the right, where a label would sit on them.
  final bool labelsLeft;

  /// How much of the chart has been revealed, left to right, 0..1.
  final double progress;

  /// A point of the first series to mark, and whether to drop a guide to it.
  final int? mark;
  final bool guide;

  @override
  void paint(Canvas canvas, Size size) {
    final b = ChartBox(size, boxW, boxH);
    final zeroY = zero * b.sy;

    for (var i = 0; i < ticks.length; i++) {
      final y = ticks[i].y * b.sy;
      final paint = Paint()
        ..color = i == 0 ? grid : grid.withValues(alpha: grid.a * 0.7)
        ..strokeWidth = 1;
      if (i == 0) {
        canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
      } else {
        for (var x = 0.0; x < size.width; x += 7) {
          canvas.drawLine(Offset(x, y), Offset(x + 3, y), paint);
        }
      }
      final label = i < tickLabels.length ? tickLabels[i] : '';
      if (label.isEmpty) continue;
      final tp = TextPainter(
        text: TextSpan(text: label, style: labelStyle),
        textDirection: TextDirection.ltr,
      )..layout();
      tp.paint(
        canvas,
        Offset(labelsLeft ? 0 : size.width - tp.width, y - tp.height - 2),
      );
    }

    canvas.save();
    canvas.clipRect(
      Rect.fromLTWH(-8, -8, (size.width + 16) * progress, size.height + 16),
    );
    for (final s in series.reversed) {
      if (s.line.isEmpty) continue;
      if (s.line.length == 1) {
        canvas.drawCircle(
          b.at(s.line.first.x, s.line.first.y),
          s.width * 1.4,
          Paint()..color = s.color,
        );
        continue;
      }
      final path = curveThrough(s.line, s.curve, b);
      if (s.fill) {
        final first = b.at(s.line.first.x, s.line.first.y);
        final last = b.at(s.line.last.x, s.line.last.y);
        final area = Path.from(path)
          ..lineTo(last.dx, zeroY)
          ..lineTo(first.dx, zeroY)
          ..close();
        canvas.drawPath(
          area,
          Paint()
            ..shader = ui.Gradient.linear(Offset.zero, Offset(0, zeroY), [
              s.color.withValues(alpha: 0.26),
              s.color.withValues(alpha: 0.0),
            ]),
        );
      }
      final stroke = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = s.width
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..color = s.color;
      if (s.dashed) {
        for (final m in path.computeMetrics()) {
          for (var d = 0.0; d < m.length; d += 9) {
            canvas.drawPath(
              m.extractPath(d, math.min(d + 5, m.length)),
              stroke,
            );
          }
        }
      } else {
        canvas.drawPath(path, stroke);
      }
    }
    canvas.restore();

    final m = mark;
    if (m == null || series.isEmpty || progress < 1) return;
    final line = series.first.line;
    if (m < 0 || m >= line.length) return;
    final at = b.at(line[m].x, line[m].y);
    if (guide) {
      canvas.drawLine(
        Offset(at.dx, 0),
        Offset(at.dx, zeroY),
        Paint()
          ..color = series.first.color.withValues(alpha: 0.35)
          ..strokeWidth = 1,
      );
    }
    canvas.drawCircle(at, 6, Paint()..color = ring);
    canvas.drawCircle(at, 4, Paint()..color = series.first.color);
  }

  @override
  bool shouldRepaint(LineChartPainter old) =>
      old.series != series ||
      old.progress != progress ||
      old.mark != mark ||
      old.guide != guide ||
      old.grid != grid ||
      old.ticks != ticks;
}

/// The category ring: rounded arcs with a gap between each, from the start
/// and share of each the core computed.
class DonutPainter extends CustomPainter {
  DonutPainter({
    required this.slices,
    required this.track,
    this.progress = 1,
    this.selected,
    this.stroke = 18,
  });

  final List<stats.SliceView> slices;
  final Color track;
  final double progress;

  /// The category picked in the list, drawn thicker with the rest dimmed.
  final String? selected;
  final double stroke;

  @override
  void paint(Canvas canvas, Size size) {
    // room for the picked arc to grow without leaving the canvas
    final r = (size.shortestSide - stroke - 8) / 2;
    final c = size.center(Offset.zero);
    final rect = Rect.fromCircle(center: c, radius: r);

    canvas.drawCircle(
      c,
      r,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..color = track.withValues(alpha: 0.35),
    );

    // A round cap reaches half the stroke past the end of its arc, so each
    // arc is trimmed by that at both ends, and by a hairline more, for the
    // gap to show. A slice too small to survive the trim is drawn square
    // instead: as a round dot it was wider than its own share, and three 1%
    // categories side by side were three dots piled on each other.
    final cap = (stroke / 2) / r;
    final gap = 2.5 / r;
    final full = slices.length == 1;
    for (final sl in slices) {
      final on = selected == sl.cat;
      final dim = selected != null && !on;
      // −90° so the first slice starts at twelve o'clock
      final start = -math.pi / 2 + sl.start * 2 * math.pi * progress;
      final sweep = sl.frac * 2 * math.pi * progress;
      final round = !full && sweep - 2 * cap - gap > 0;
      final paint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = on ? stroke + 5 : stroke
        ..strokeCap = round ? StrokeCap.round : StrokeCap.butt
        ..color = parseHex(sl.color).withValues(alpha: dim ? 0.3 : 1);
      if (full) {
        canvas.drawArc(rect, start, sweep, false, paint);
      } else if (round) {
        canvas.drawArc(
          rect,
          start + cap + gap / 2,
          sweep - 2 * cap - gap,
          false,
          paint,
        );
      } else {
        canvas.drawArc(
          rect,
          start + gap / 2,
          math.max(sweep - gap, 0.004),
          false,
          paint,
        );
      }
    }
  }

  @override
  bool shouldRepaint(DonutPainter old) =>
      old.slices != slices ||
      old.progress != progress ||
      old.selected != selected ||
      old.track != track;
}

/// One column of a [Columns] chart.
class ColumnItem {
  const ColumnItem({
    required this.label,
    required this.value,
    required this.frac,
    this.strong = false,
  });

  final String label;

  /// Printed over the bar; empty for none.
  final String value;

  /// The bar's height as a share of the tallest — the core's `bar_fracs`.
  final double frac;

  /// Drawn in full colour; the rest are a tint of it.
  final bool strong;
}

/// A row of rounded bars with a value over each and a label under.
class Columns extends StatelessWidget {
  const Columns({
    super.key,
    required this.items,
    required this.color,
    this.height = 132,
    this.progress = 1,
  });

  final List<ColumnItem> items;
  final Color color;
  final double height;
  final double progress;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    return SizedBox(
      height: height,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          for (final it in items)
            Expanded(
              child: Column(
                children: [
                  // The bar takes whatever the label below leaves, and the
                  // value above it shrinks before it overflows: a fixed
                  // allowance for the text was one pixel short in a CJK font,
                  // and would be more at a larger font size.
                  Expanded(
                    child: LayoutBuilder(
                      builder: (context, c) => Column(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          Flexible(
                            child: FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Text(
                                it.value,
                                maxLines: 1,
                                style: TextStyle(
                                  fontSize: 10.5,
                                  fontFeatures: tabular,
                                  fontWeight: it.strong
                                      ? FontWeight.w700
                                      : FontWeight.w500,
                                  color: it.strong ? color : p.inkSoft,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Container(
                            width: 22,
                            // a bar with a value is never flat, however small
                            height: it.frac > 0
                                ? math.max(
                                    3.0,
                                    (c.maxHeight - 20).clamp(0.0, c.maxHeight) *
                                        it.frac *
                                        progress,
                                  )
                                : 0,
                            decoration: BoxDecoration(
                              borderRadius: const BorderRadius.vertical(
                                top: Radius.circular(7),
                                bottom: Radius.circular(3),
                              ),
                              color: it.strong
                                  ? null
                                  : color.withValues(alpha: 0.2),
                              gradient: it.strong
                                  ? LinearGradient(
                                      begin: Alignment.topCenter,
                                      end: Alignment.bottomCenter,
                                      colors: [
                                        color,
                                        color.withValues(alpha: 0.72),
                                      ],
                                    )
                                  : null,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    it.label,
                    maxLines: 1,
                    overflow: TextOverflow.fade,
                    softWrap: false,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: it.strong ? FontWeight.w600 : FontWeight.w400,
                      color: it.strong ? p.ink : p.inkSoft,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// A thin horizontal share bar.
class Meter extends StatelessWidget {
  const Meter({
    super.key,
    required this.frac,
    required this.color,
    this.progress = 1,
  });

  final double frac;
  final Color color;
  final double progress;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(3),
    child: SizedBox(
      height: 6,
      child: Stack(
        fit: StackFit.expand,
        children: [
          ColoredBox(color: palette.line.withValues(alpha: 0.45)),
          FractionallySizedBox(
            alignment: Alignment.centerLeft,
            widthFactor: (frac * progress).clamp(0.0, 1.0),
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(3),
                gradient: LinearGradient(
                  colors: [color.withValues(alpha: 0.7), color],
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
