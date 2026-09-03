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
import 'package:flutter/services.dart';

import 'glass.dart';
import 'src/rust/api/glass.dart' as g;
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

/// The sliding indicator behind the active tab.
const double _pillW = 46;
const double _pillH = 30;

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

class BottomNav extends StatelessWidget {
  const BottomNav({
    super.key,
    required this.active,
    required this.onChange,
    required this.onAdd,
    required this.labels,
  });

  /// 0..3 — 明细 / 统计 / 资产 / 我的.
  final int active;
  final ValueChanged<int> onChange;
  final VoidCallback onAdd;
  final List<String> labels;

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
    final indicatorX = _pad + active * itemW + itemW / 2 - _pillW / 2;

    return Padding(
      padding: EdgeInsets.only(bottom: navBottomPad(context)),
      // A `SizedBox` with the bar's height rather than a `Center`. The
      // `bottomNavigationBar` slot passes loose constraints whose maxHeight is
      // the whole screen, and `Center` takes all of it — which put the bar in
      // the middle of the display. Same shape as the Stack bug before it: a
      // widget with nothing to size it from expands, and in this slot that is
      // never what is wanted.
      child: SizedBox(
        height: _barH,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: rowW,
              child: Row(
                children: [
                  SizedBox(
                    width: barW,
                    child: _bar(context, p, barW, itemW, indicatorX),
                  ),
                  const SizedBox(width: _addGap),
                  _AddButton(onTap: onAdd),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _bar(
    BuildContext context,
    Palette p,
    double barW,
    double itemW,
    double indicatorX,
  ) {
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
            color: parseHex(p.shadowHex)
                .withValues(alpha: p.isDark ? 0.32 : 0.06),
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
        child: SizedBox(
          height: _barH,
          child: Stack(
            children: [
              // The indicator slides rather than appearing: a tab that lights
              // up in place reads as four separate buttons, and one that
              // travels reads as one control with a position.
              AnimatedPositioned(
                duration: const Duration(milliseconds: 320),
                curve: Curves.easeOutBack,
                left: indicatorX,
                // 10 from the top, not centred. The indicator sits behind the
                // ICON; centring it in a 64-tall bar puts it straddling the
                // gap between icon and label, which reads as a stray pill
                // rather than as the icon being lit.
                top: 10,
                width: _pillW,
                height: _pillH,
                child: IgnorePointer(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: p.hibiscus.withValues(
                        alpha: p.isDark ? 0.18 : 0.12,
                      ),
                      borderRadius: BorderRadius.circular(_pillH / 2),
                      border: Border.all(
                        color: p.hibiscus.withValues(
                          alpha: p.isDark ? 0.30 : 0.22,
                        ),
                        width: 1 / MediaQuery.devicePixelRatioOf(context),
                      ),
                    ),
                  ),
                ),
              ),
              Row(
                children: [
                  for (var i = 0; i < 4; i++)
                    SizedBox(
                      width: itemW,
                      child: _NavItem(
                        index: i,
                        icon: _icons[i],
                        label: labels[i],
                        active: active == i,
                        onTap: () {
                          HapticFeedback.selectionClick();
                          onChange(i);
                        },
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.index,
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
  });

  final int index;
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
  const _AddButton({required this.onTap});

  final VoidCallback onTap;

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
                color: parseHex(p.glowHex)
                    .withValues(alpha: p.isDark ? 0.34 : 0.2),
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
