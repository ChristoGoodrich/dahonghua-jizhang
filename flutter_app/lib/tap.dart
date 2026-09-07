// 按压反馈 — the app-wide touch feedback.
//
// Ported from `src/components/ui/Tap.tsx`, which every pressable in the
// shipping app went through and which nothing in this build did. There were 23
// bare `GestureDetector`s here: they fire, and they show you nothing, so you
// cannot tell a tap that landed from one that missed. On the entry list that
// is the whole list.
//
// Two behaviours, and the original's comment says why they differ:
//
//   Filled surfaces (rows, cards, buttons, chips) get an INK VEIL that follows
//   their own corner radius. Bare icons and text with no background DIM
//   instead — "a tint rectangle around a naked glyph reads as a stray shadow".
//
// Scaling is opt-in rather than default, for a reason worth keeping: shrinking
// a shadowed card drags its shadow with it, and that is the thing that looked
// cheap.
//
// This is also 点按有光 at the scale of a row. `Glass` answers a touch with a
// specular bloom; an opaque surface answers with the veil. Same idea, and both
// were missing.

import 'package:flutter/material.dart';

import 'theme.dart';

/// The veil's opacity at full press, and how far a bare glyph dims to.
const double _tint = 0.07;
const double _dim = 0.5;

/// `SPRING.snappy` — friction 6, tension 300. Fast enough that the surface is
/// already lit by the time a finger has finished landing.
const Duration _snappy = Duration(milliseconds: 110);

class Tap extends StatefulWidget {
  const Tap({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.filled = true,
    this.radius = 0,
    this.scaleTo,
    this.behavior = HitTestBehavior.opaque,
    this.semanticLabel,
  });

  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  /// Whether this sits on its own background. Filled surfaces take the veil;
  /// bare ones dim.
  final bool filled;

  /// The surface's corner radius, so the veil follows it rather than sitting
  /// square inside a rounded card.
  final double radius;

  /// Opt in to shrinking as well. Left off for anything carrying a shadow.
  final double? scaleTo;

  final HitTestBehavior behavior;
  final String? semanticLabel;

  @override
  State<Tap> createState() => _TapState();
}

class _TapState extends State<Tap> {
  bool _down = false;

  void _set(bool v) {
    if (_down != v) setState(() => _down = v);
  }

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final pressed = _down && (widget.onTap != null || widget.onLongPress != null);

    Widget content = widget.child;

    if (widget.filled) {
      content = Stack(
        children: [
          content,
          // Positioned.fill, and the child above is unpositioned so the Stack
          // still sizes to it. A Stack of only positioned children takes its
          // whole constraints, which is a mistake this codebase has now made
          // twice in two other places.
          Positioned.fill(
            child: IgnorePointer(
              child: AnimatedOpacity(
                opacity: pressed ? 1 : 0,
                duration: _snappy,
                curve: Curves.easeOut,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: p.ink.withValues(alpha: _tint),
                    borderRadius: BorderRadius.circular(widget.radius),
                  ),
                ),
              ),
            ),
          ),
        ],
      );
    } else {
      content = AnimatedOpacity(
        opacity: pressed ? _dim : 1,
        duration: _snappy,
        curve: Curves.easeOut,
        child: content,
      );
    }

    if (widget.scaleTo != null) {
      content = AnimatedScale(
        scale: pressed ? widget.scaleTo! : 1,
        duration: _snappy,
        curve: Curves.easeOut,
        child: content,
      );
    }

    final detector = GestureDetector(
      behavior: widget.behavior,
      onTap: widget.onTap,
      onLongPress: widget.onLongPress,
      onTapDown: (_) => _set(true),
      onTapUp: (_) => _set(false),
      onTapCancel: () => _set(false),
      onLongPressStart: (_) => _set(true),
      onLongPressEnd: (_) => _set(false),
      onLongPressCancel: () => _set(false),
      child: content,
    );

    if (widget.semanticLabel == null) return detector;
    return Semantics(
      button: true,
      label: widget.semanticLabel,
      child: detector,
    );
  }
}
