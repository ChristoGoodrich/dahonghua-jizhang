// 悬浮底栏 — the glass bar and the record button beside it.
//
// Rebuilt against `src/features/nav/BottomNav.tsx`, because the first attempt
// got the SHAPE wrong, not just the finish. That version was one full-width
// strip with the record button sitting inside it as a middle tab. The design
// is two objects:
//
//   [ glass bar · four tabs · a sliding indicator ]  gap  [ record button ]
//
// centred together and sized to their content, not stretched to the screen.
// The original's comment says why: the bar stays one uninterrupted glass slab
// and the primary action gets to be a separate object with its own weight,
// rather than a notch cut into the slab.
//
// Every number here is from that file. They are laid out arithmetically rather
// than measured, which is also its choice — `onLayout` was flaky on the static
// web export, and a deterministic width means the indicator can be placed on
// the first frame instead of after one.

import 'package:flutter/material.dart';
import 'package:flutter/physics.dart';
import 'package:flutter/services.dart';

import 'glass.dart';
import 'liquid.dart';
import 'src/rust/api/glass.dart' as g;
import 'src/rust/api/liquid.dart' as q;
import 'tap.dart';
import 'theme.dart';

/// The outer gutter, and the widest the whole row is allowed to get.
const double _margin = 16;
const double _maxW = 448;

/// Inside the bar.
const double _pad = 8;
const double _border = 1;
const double _radius = 26;

/// The record button is its own capsule beside the bar. The bar is slightly
/// taller than the button, and the two are centred against each other.
const double _add = 60;
const double _addGap = 10;
const double _barH = 64;

/// How far the lens stands in from the bar's edge, top and bottom — and, at
/// the two ends, from its sides, because it is a tab wider than its slot by
/// the padding the bar gives its row.
///
/// It used to be a 46×30 pill behind the icon alone, which lit part of the
/// icon and none of the label and read as a stray chip rather than as the
/// tab being chosen. A lens that fills the tab, rounded to the bar, is the
/// HyperOS and iOS shape — and the same one the reference screenshots show.
const double _lensInset = 6;

/// How far the content below has to stay clear of the bar.
///
/// Exported because a floating bar is only floating if something is behind it:
/// every scrolling screen pads its bottom by this much so the last row can
/// come out from under the glass.
double navBottomInset(BuildContext context) =>
    _barH + 12 + navBottomPad(context);

/// The gap under the bar, respecting the gesture inset.
double navBottomPad(BuildContext context) {
  final inset = MediaQuery.viewPaddingOf(context).bottom;
  return inset + 6 < 16 ? 16 : inset + 6;
}

/// A bottom-bar slot standing on its scrim.
///
/// Shared by the nav bar and the selection bar so the two occupy exactly the
/// same box: switching between them must not move the ground, and a second
/// copy of this arithmetic is how it would.
///
/// The scrim fills the slot and the bar is placed at its foot. Both bars are
/// `_barH` tall and both clear the gesture inset by `navBottomPad`, so the only
/// thing that changes when a selection starts is what is drawn inside.
///
/// The ground starts [scrimFoot] above the bar rather than a whole `fade`: that
/// reached most of a bar-height up the list, and rows well clear of the bar
/// were already soft. Its ramp runs on into the bar's upper half, where the
/// bar's own glass carries the rest.
Widget navScrimBox(BuildContext context, {required Widget child}) {
  final pad = navBottomPad(context);
  final foot = scrimFoot(context, _barH);
  return SizedBox(
    height: foot.foot + _barH + pad,
    child: Stack(
      children: [
        Positioned.fill(child: GlassScrim(ramp: foot.ramp)),
        Positioned(left: 0, right: 0, bottom: pad, height: _barH, child: child),
      ],
    ),
  );
}

class BottomNav extends StatelessWidget {
  const BottomNav({
    super.key,
    required this.active,
    required this.onChange,
    required this.onAdd,
    required this.labels,
    this.addKey,
    this.onAddLong,
  });

  /// 0..3 — 明细 / 统计 / 资产 / 我的.
  final int active;
  final ValueChanged<int> onChange;
  final VoidCallback onAdd;
  final List<String> labels;

  /// A long press on +: 一句话记账.
  final VoidCallback? onAddLong;

  /// On the + button, so the shell can find where a burst of flowers should
  /// come out of.
  final Key? addKey;

  static const _icons = [
    Icons.receipt_long,
    Icons.pie_chart_outline,
    Icons.account_balance_wallet_outlined,
    Icons.person_outline,
  ];

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final screenW = MediaQuery.sizeOf(context).width;

    // Deterministic, so the indicator lands correctly on the first frame.
    final rowW = (screenW - 2 * _margin).clamp(0.0, _maxW);
    final barW = rowW - _add - _addGap;
    final innerW = barW - 2 * _border - 2 * _pad;
    final itemW = innerW / 4;

    // A `SizedBox` with a known height rather than a `Center`. The
    // `bottomNavigationBar` slot passes loose constraints whose maxHeight is
    // the whole screen, and `Center` takes all of it — which put the bar in
    // the middle of the display. Same shape as the Stack bug before it: a
    // widget with nothing to size it from expands, and in this slot that is
    // never what is wanted.
    //
    // The height now includes the scrim's fade, so the slot reserves the whole
    // dissolve rather than the bar overflowing upward out of it. Nothing below
    // has to change for that: `extendBody` means the body still runs the full
    // height behind, and the content's own clearance is `navBottomInset`,
    // which is deliberately shorter — rows are *supposed* to scroll into the
    // fade.
    return navScrimBox(
      context,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: rowW,
            child: Row(
              children: [
                SizedBox(width: barW, child: _bar(p, itemW)),
                const SizedBox(width: _addGap),
                _AddButton(key: addKey, onTap: onAdd, onLongPress: onAddLong),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _bar(Palette p, double itemW) {
    // The shadow lives on a wrapper. On the blurred surface itself it would be
    // clipped by the same rounding that makes the surface round.
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(_radius),
        boxShadow: [
          // `shadow(t, 'sm')` from the design tokens: 0 3px 10px at 0.06 on
          // light, 0.32 on dark. The alpha is the whole thing — the theme's
          // shadow colour is an OPAQUE warm brown (#6B4632), and using it
          // directly put a brown haze behind translucent glass, which is what
          // made the bar look muddy rather than lit.
          BoxShadow(
            color: parseHex(
              p.shadowHex,
            ).withValues(alpha: p.isDark ? 0.32 : 0.06),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Glass(
        key: const Key('tab-bar'),
        level: g.GlassLevel.chrome,
        // Chrome over the page paper, and 0.45 because tab labels have to stay
        // legible over a full month of entries scrolling underneath.
        density: 0.45,
        radius: _radius,
        padding: const EdgeInsets.symmetric(horizontal: _pad),
        child: _TabRow(
          active: active,
          onChange: onChange,
          labels: labels,
          icons: _icons,
          itemW: itemW,
        ),
      ),
    );
  }
}

/// The four tabs and the lens that sits on one of them.
///
/// Stateful because the lens has a **position of its own**, which is not the
/// same thing as the selected tab. While a finger is on it the lens is
/// wherever the finger has pushed it and the selection follows; when the
/// finger lifts the selection is decided and the lens springs to it. A widget
/// that derived the position from `active` could only ever teleport between
/// four values, which is what it used to do.
class _TabRow extends StatefulWidget {
  const _TabRow({
    required this.active,
    required this.onChange,
    required this.labels,
    required this.icons,
    required this.itemW,
  });

  final int active;
  final ValueChanged<int> onChange;
  final List<String> labels;
  final List<IconData> icons;
  final double itemW;

  @override
  State<_TabRow> createState() => _TabRowState();
}

class _TabRowState extends State<_TabRow> with SingleTickerProviderStateMixin {
  /// The lens's centre, measured from the row's left edge. Unbounded because
  /// a spring overshoots, and a controller clamped to 0..1 would clip the
  /// overshoot into a stop.
  late final AnimationController _pos = AnimationController.unbounded(
    vsync: this,
    value: q.centreOf(index: widget.active, itemW: widget.itemW),
  );

  /// The simulation currently running, kept so the velocity can be asked of
  /// it. Flutter's controller exposes where the animation is, not how fast —
  /// and how fast is what the lens's whole shape is made of.
  SpringSimulation? _sim;

  bool _dragging = false;
  double _dragV = 0;
  double _lastMs = 0;
  final _clock = Stopwatch()..start();

  /// Where the lens is heading, so a rebuild does not restart a spring that is
  /// already on its way there.
  double _target = 0;

  @override
  void initState() {
    super.initState();
    _target = _pos.value;
  }

  @override
  void didUpdateWidget(_TabRow old) {
    super.didUpdateWidget(old);
    // A tap on a tab, a swipe elsewhere in the app, or a screen that changed
    // width. All three arrive the same way: the lens is somewhere the current
    // selection says it should not be.
    final want = q.centreOf(index: widget.active, itemW: widget.itemW);
    if (!_dragging && (want - _target).abs() > 0.01) {
      _settleTo(want, _velocity);
    }
  }

  @override
  void dispose() {
    _pos.dispose();
    super.dispose();
  }

  /// dp per second, whichever thing is moving the lens.
  double get _velocity {
    if (_dragging) return _dragV;
    final sim = _sim;
    final t = _pos.lastElapsedDuration;
    if (sim == null || t == null || !_pos.isAnimating) return 0;
    return sim.dx(t.inMicroseconds / 1e6);
  }

  void _settleTo(double x, double velocity) {
    final s = q.liquidSpec(isDark: palette.isDark);
    _target = x;
    _sim = SpringSimulation(
      SpringDescription(
        mass: s.mass,
        stiffness: s.stiffness,
        damping: s.damping,
      ),
      _pos.value,
      x,
      velocity,
    );
    _pos.animateWith(_sim!);
  }

  void _dragStart(DragStartDetails _) {
    // Stop the spring where it is rather than where it was going: a finger
    // catching a lens mid-flight should catch it, not have it snap ahead.
    _pos.stop();
    _sim = null;
    _dragging = true;
    _dragV = 0;
    _lastMs = _clock.elapsedMicroseconds / 1000;
  }

  void _dragUpdate(DragUpdateDetails d) {
    final ms = _clock.elapsedMicroseconds / 1000;
    // Clamped: a delta reported over a claimed zero milliseconds is an
    // infinite velocity, and an infinite velocity is a NaN transform one
    // multiplication later.
    final dt = (ms - _lastMs).clamp(1.0, 64.0);
    _lastMs = ms;
    _dragV = d.primaryDelta! / dt * 1000;

    final n = widget.labels.length;
    _pos.value = (_pos.value + d.primaryDelta!).clamp(
      q.centreOf(index: 0, itemW: widget.itemW),
      q.centreOf(index: n - 1, itemW: widget.itemW),
    );
    _target = _pos.value;

    // Live, so the tab under the lens lights up as it passes. The alternative
    // is a lens that slides over four dark icons and lights one when the
    // finger lifts, which reads as a decision being made rather than as an
    // object being moved.
    final i = q.tabAt(x: _pos.value, itemW: widget.itemW, count: n);
    if (i != widget.active) {
      HapticFeedback.selectionClick();
      widget.onChange(i);
    }
  }

  void _dragEnd(DragEndDetails d) {
    final v = d.primaryVelocity ?? 0;
    final n = widget.labels.length;
    final i = q.snap(
      isDark: palette.isDark,
      x: _pos.value,
      itemW: widget.itemW,
      count: n,
      velocity: v,
    );
    _dragging = false;
    _dragV = 0;
    if (i != widget.active) {
      HapticFeedback.selectionClick();
      widget.onChange(i);
    }
    _settleTo(q.centreOf(index: i, itemW: widget.itemW), v);
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      key: const Key('tab-drag'),
      // Horizontal only. A vertical drag on the bar belongs to whatever is
      // scrolling behind it, and claiming it would make the bar a wall.
      behavior: HitTestBehavior.translucent,
      onHorizontalDragStart: _dragStart,
      onHorizontalDragUpdate: _dragUpdate,
      onHorizontalDragEnd: _dragEnd,
      child: SizedBox(
        height: _barH,
        child: Stack(
          children: [
            // The builder is INSIDE the Positioned, not around it: a
            // `Positioned` has to be a direct child of its `Stack`, and one
            // returned from an `AnimatedBuilder` is a child of the builder.
            // Aligning to the top-left and translating puts the lens exactly
            // where a `left`/`top` would, and repaints only the lens.
            Positioned.fill(
              child: AnimatedBuilder(
                animation: _pos,
                builder: (context, child) {
                  // The whole tab, icon and label: the slot plus the row's
                  // padding on either side less the inset, and the bar's
                  // height less the inset above and below.
                  final w = widget.itemW + 2 * (_pad - _lensInset);
                  return Align(
                    alignment: Alignment.topLeft,
                    child: Transform.translate(
                      offset: Offset(_pos.value - w / 2, _lensInset),
                      child: LiquidLens(
                        key: const Key('tab-lens'),
                        width: w,
                        height: _barH - 2 * _lensInset,
                        velocity: _velocity,
                      ),
                    ),
                  );
                },
              ),
            ),
            Row(
              children: [
                for (var i = 0; i < widget.labels.length; i++)
                  SizedBox(
                    width: widget.itemW,
                    child: _NavItem(
                      icon: widget.icons[i],
                      label: widget.labels[i],
                      active: widget.active == i,
                      onTap: () {
                        HapticFeedback.selectionClick();
                        widget.onChange(i);
                      },
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    return GestureDetector(
      key: Key('tab-$label'),
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          // The icon grows and lifts rather than only changing colour. Both
          // are small; together they are what makes the selection feel like a
          // thing that moved rather than a repaint.
          AnimatedScale(
            scale: active ? 1.18 : 1,
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOut,
            child: AnimatedSlide(
              offset: active ? const Offset(0, -0.08) : Offset.zero,
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOut,
              child: Icon(
                icon,
                size: 22,
                color: active ? p.hibiscus : p.inkSoft,
              ),
            ),
          ),
          const SizedBox(height: 3),
          AnimatedDefaultTextStyle(
            duration: const Duration(milliseconds: 220),
            style: TextStyle(
              fontSize: 11,
              height: 1,
              fontWeight: active ? FontWeight.w600 : FontWeight.w500,
              color: active ? p.hibiscus : p.inkSoft,
            ),
            child: Text(label, maxLines: 1),
          ),
        ],
      ),
    );
  }
}

/// The record button: the same material as the bar — glass edge, top sheen,
/// matching height — filled with the accent so it still reads as the one
/// primary act.
class _AddButton extends StatefulWidget {
  const _AddButton({super.key, required this.onTap, this.onLongPress});

  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  @override
  State<_AddButton> createState() => _AddButtonState();
}

class _AddButtonState extends State<_AddButton> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final spec = g.glassSpec(isDark: p.isDark, level: g.GlassLevel.chrome);

    return GestureDetector(
      key: const Key('record-button'),
      onTapDown: (_) => setState(() => _down = true),
      onTapCancel: () => setState(() => _down = false),
      onTapUp: (_) => setState(() => _down = false),
      onTap: () {
        HapticFeedback.mediumImpact();
        widget.onTap();
      },
      onLongPress: widget.onLongPress == null
          ? null
          : () {
              HapticFeedback.heavyImpact();
              setState(() => _down = false);
              widget.onLongPress!();
            },
      child: AnimatedScale(
        scale: _down ? 0.9 : 1,
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
        child: Container(
          width: _add,
          height: _add,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(_add / 2),
            border: Border.all(color: parseRgba(spec.edge), width: _border),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [p.gradFrom, p.gradTo],
            ),
            boxShadow: [
              // `shadow(t, 'glow')`: accent-tinted rather than a dark drop, so
              // a primary button feels warm instead of heavy. 0 5px 16px at
              // 0.2 on light, 0.34 on dark.
              BoxShadow(
                color: parseHex(
                  p.glowHex,
                ).withValues(alpha: p.isDark ? 0.34 : 0.2),
                blurRadius: 16,
                offset: const Offset(0, 5),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(_add / 2),
            child: Stack(
              children: [
                // The same specular band the glass carries, so the button
                // belongs to the material even though it is filled.
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  height: _add / 2,
                  child: IgnorePointer(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            Colors.white.withValues(alpha: 0.34),
                            Colors.white.withValues(alpha: 0),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                const Center(
                  child: Icon(Icons.add, color: Colors.white, size: 26),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One button on the selection bar.
///
/// `onTap` of `null` is a disabled button rather than an absent one. Which
/// actions a selection can take changes as rows are ticked — 改分类 needs one
/// side of the ledger, 更多 needs exactly one row — and a bar whose buttons
/// appear and disappear underneath a moving finger is worse than one whose
/// buttons dim.
class SelectionAction {
  const SelectionAction({
    required this.id,
    required this.icon,
    required this.label,
    this.onTap,
  });

  final String id;
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
}

/// 批量处理的操作栏 — the bar that replaces the nav bar while rows are ticked.
///
/// Same slot, same height, same material, and that is the whole design: the
/// selection is a mode of the screen, not a different screen, so the ground
/// under it must not move. Only the contents change.
///
/// One glass slab across the full width rather than a slab plus a button. The
/// record button is the one primary act on this screen and there is no primary
/// act in a selection — 删除 is not one, and giving it the accent capsule would
/// make the destructive choice the obvious one.
class SelectionBar extends StatelessWidget {
  const SelectionBar({super.key, required this.actions});

  final List<SelectionAction> actions;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final rowW = (MediaQuery.sizeOf(context).width - 2 * _margin).clamp(
      0.0,
      _maxW,
    );

    return navScrimBox(
      context,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: rowW,
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(_radius),
                boxShadow: [
                  BoxShadow(
                    color: parseHex(
                      p.shadowHex,
                    ).withValues(alpha: p.isDark ? 0.32 : 0.06),
                    blurRadius: 10,
                    offset: const Offset(0, 3),
                  ),
                ],
              ),
              child: Glass(
                key: const Key('selection-bar'),
                level: g.GlassLevel.chrome,
                density: 0.45,
                radius: _radius,
                padding: const EdgeInsets.symmetric(horizontal: _pad),
                child: SizedBox(
                  height: _barH,
                  child: Row(
                    children: [
                      for (final a in actions)
                        Expanded(child: _ActionItem(action: a)),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionItem extends StatelessWidget {
  const _ActionItem({required this.action});

  final SelectionAction action;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final on = action.onTap != null;
    // Dimmed rather than greyed: the palette has no disabled ink, and mixing
    // one here would be a colour the theme does not know about.
    final tone = p.ink.withValues(alpha: on ? 1 : 0.3);
    return Tap(
      key: Key('batch-${action.id}'),
      onTap: action.onTap,
      radius: Rad.md,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(action.icon, size: 21, color: tone),
          const SizedBox(height: 4),
          Text(
            action.label,
            maxLines: 1,
            style: TextStyle(
              fontSize: 11,
              height: 1,
              fontWeight: FontWeight.w500,
              color: tone,
            ),
          ),
        ],
      ),
    );
  }
}
