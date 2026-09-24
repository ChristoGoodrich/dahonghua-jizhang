// A segmented control: a track, and a thumb that slides to the choice.
//
// The one control this app has for "which of these few". It started on 统计
// for the window and the direction, and 记一笔's 支出/收入/转账 were three
// outlined boxes beside it — two languages for one question, on screens a
// thumb moves between a dozen times a day.
//
// The thumb is an object, the way the tab bar's lens is: it has a position of
// its own, a finger can push it, it stretches when it is thrown and settles on
// a spring, and a flick lands where it was heading. It used to be a tap target
// that animated between fixed places — press, and it slid; drag, and nothing
// happened, which on a control that looks like it slides is the one thing a
// thumb tries first. The rules are `core::liquid`'s, the same ones the tab
// bar's lens follows, so the two cannot come to disagree about what a flick
// is.

import 'package:flutter/material.dart';
import 'package:flutter/physics.dart';
import 'package:flutter/services.dart';

import 'src/rust/api/liquid.dart' as q;
import 'tap.dart';
import 'theme.dart';

/// A segmented control: a track with a thumb that slides to the choice.
class Segmented extends StatefulWidget {
  const Segmented({
    super.key,
    required this.items,
    required this.value,
    required this.onChanged,
    required this.keyPrefix,
    this.compact = false,
  });

  final List<(String, String)> items;
  final String value;

  /// Called when a choice is made: a tap, or a drag let go of. Not on every
  /// segment a drag passes over — 统计 reads the whole ledger again for each
  /// answer, and a thumb dragged across three segments is one decision.
  final ValueChanged<String> onChanged;

  /// Each segment is keyed `<prefix>-<value>`, the track `<prefix>-drag`.
  final String keyPrefix;
  final bool compact;

  @override
  State<Segmented> createState() => _SegmentedState();
}

class _SegmentedState extends State<Segmented>
    with SingleTickerProviderStateMixin {
  /// Where the thumb is, in segments: 0 is resting on the first, 1.5 is
  /// halfway between the second and the third. In segments rather than dp so
  /// the first frame needs no layout to be right, and a width that changes
  /// under it — a rotation, a font scale — leaves it on the same choice.
  ///
  /// Unbounded, because a spring overshoots.
  late final AnimationController _pos = AnimationController.unbounded(
    vsync: this,
    value: _index.toDouble(),
  );

  SpringSimulation? _sim;
  double _target = 0;

  bool _dragging = false;

  /// Segments per second while a finger is on it.
  double _dragV = 0;
  double _lastMs = 0;
  final _clock = Stopwatch()..start();

  /// The width of one segment at the last layout.
  double _itemW = 1;

  int get _count => widget.items.length;

  int get _index =>
      widget.items.indexWhere((e) => e.$1 == widget.value).clamp(0, _count - 1);

  @override
  void initState() {
    super.initState();
    _target = _pos.value;
  }

  @override
  void didUpdateWidget(Segmented old) {
    super.didUpdateWidget(old);
    // A tap, or the value changed from outside. Either way the thumb is
    // somewhere the value says it should not be.
    final want = _index.toDouble();
    if (!_dragging && (want - _target).abs() > 1e-6) _settleTo(want, _velocity);
  }

  @override
  void dispose() {
    _pos.dispose();
    super.dispose();
  }

  /// Segments per second, whichever thing is moving the thumb.
  double get _velocity {
    if (_dragging) return _dragV;
    final sim = _sim;
    final t = _pos.lastElapsedDuration;
    if (sim == null || t == null || !_pos.isAnimating) return 0;
    return sim.dx(t.inMicroseconds / 1e6);
  }

  void _settleTo(double at, double velocity) {
    // The spring is stated in dp and the thumb moves in segments. A linear
    // spring's motion scales with its displacement, so the same constants
    // give the same feel in either unit — only the velocity has to be
    // expressed in the one the simulation is in.
    final s = q.liquidSpec(isDark: palette.isDark);
    _target = at;
    _sim = SpringSimulation(
      SpringDescription(
        mass: s.mass,
        stiffness: s.stiffness,
        damping: s.damping,
      ),
      _pos.value,
      at,
      velocity,
    );
    _pos.animateWith(_sim!);
  }

  /// The segment the thumb is over, from the core — the same rule that says
  /// which tab the bar's lens is over.
  int _under(double at) =>
      q.tabAt(x: (at + 0.5) * _itemW, itemW: _itemW, count: _count);

  void _dragStart(DragStartDetails _) {
    // Caught where it is, not where it was going.
    _pos.stop();
    _sim = null;
    setState(() => _dragging = true);
    _dragV = 0;
    _lastMs = _clock.elapsedMicroseconds / 1000;
  }

  void _dragUpdate(DragUpdateDetails d) {
    final ms = _clock.elapsedMicroseconds / 1000;
    // A delta over a claimed zero milliseconds is an infinite velocity, and
    // an infinite velocity is a NaN transform one multiplication later.
    final dt = (ms - _lastMs).clamp(1.0, 64.0);
    _lastMs = ms;
    final ds = d.primaryDelta! / _itemW;
    _dragV = ds / dt * 1000;
    final before = _under(_pos.value);
    _pos.value = (_pos.value + ds).clamp(0.0, (_count - 1).toDouble());
    _target = _pos.value;
    final now = _under(_pos.value);
    if (now != before) {
      HapticFeedback.selectionClick();
      setState(() {});
    }
  }

  void _dragEnd(DragEndDetails d) {
    // Segments per second, and dp per second for the core, which measures a
    // flick in the unit a finger moves in.
    final v = (d.primaryVelocity ?? 0) / _itemW;
    final i = q.snap(
      isDark: palette.isDark,
      x: (_pos.value + 0.5) * _itemW,
      itemW: _itemW,
      count: _count,
      velocity: v * _itemW,
    );
    setState(() => _dragging = false);
    _dragV = 0;
    _settleTo(i.toDouble(), v);
    final k = widget.items[i].$1;
    if (k != widget.value) {
      HapticFeedback.selectionClick();
      widget.onChanged(k);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = palette;
    // While a finger is on it the label under the thumb is the one lit: the
    // choice is being made, and the words should say which it would be.
    final lit = _dragging ? _under(_pos.value) : _index;
    return GestureDetector(
      key: Key('${widget.keyPrefix}-drag'),
      // Horizontal only: a vertical drag belongs to the page it is on.
      onHorizontalDragStart: _dragStart,
      onHorizontalDragUpdate: _dragUpdate,
      onHorizontalDragEnd: _dragEnd,
      child: Container(
        height: widget.compact ? 30 : 38,
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(
          color: p.paperWarm,
          borderRadius: BorderRadius.circular(Rad.pill),
          border: Border.all(color: p.line.withValues(alpha: 0.6)),
        ),
        child: LayoutBuilder(
          builder: (context, c) {
            _itemW = (c.maxWidth / _count).clamp(1.0, double.infinity);
            return Stack(
              children: [
                Positioned.fill(
                  child: AnimatedBuilder(
                    animation: _pos,
                    builder: (context, _) {
                      final lens = q.lens(
                        isDark: p.isDark,
                        velocity: _velocity * _itemW,
                      );
                      return Align(
                        alignment: Alignment.topLeft,
                        child: Transform.translate(
                          offset: Offset(_pos.value * _itemW, 0),
                          // Longer and thinner when thrown, about its own
                          // centre — the lens's stretch, which conserves area
                          // so it reads as momentum rather than growth.
                          child: Transform(
                            alignment: Alignment.center,
                            transform: Matrix4.diagonal3Values(
                              lens.scaleX,
                              lens.scaleY,
                              1,
                            ),
                            child: SizedBox(
                              key: Key('${widget.keyPrefix}-thumb'),
                              width: _itemW,
                              height: c.maxHeight,
                              child: _thumb(p),
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
                Row(
                  children: [
                    for (final (i, (k, label)) in widget.items.indexed)
                      Expanded(
                        child: Tap(
                          key: Key('${widget.keyPrefix}-$k'),
                          filled: false,
                          radius: Rad.pill,
                          semanticLabel: label,
                          onTap: () => widget.onChanged(k),
                          child: Center(
                            child: Text(
                              label,
                              style: TextStyle(
                                fontSize: widget.compact ? 12 : 13.5,
                                fontWeight: i == lit
                                    ? FontWeight.w700
                                    : FontWeight.w500,
                                color: i == lit ? p.ink : p.inkSoft,
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _thumb(Palette p) => DecoratedBox(
    decoration: BoxDecoration(
      // On paper the card is lighter than the track by itself; in the dark
      // the two are a shade apart, so the thumb is lifted toward the ink
      // until it reads as the one that is on.
      color: p.isDark
          ? Color.alphaBlend(p.ink.withValues(alpha: 0.1), p.card)
          : p.card,
      borderRadius: BorderRadius.circular(Rad.pill),
      boxShadow: [
        BoxShadow(
          color: parseHex(p.shadowHex).withValues(alpha: p.isDark ? 0.3 : 0.1),
          blurRadius: 6,
          offset: const Offset(0, 2),
        ),
      ],
    ),
  );
}
