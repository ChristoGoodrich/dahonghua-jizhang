// 左滑操作 — a row that swipes open on its actions, the way an iPhone's do.
//
// The list used to swipe a row straight off the screen (`Dismissible`) and
// then ask whether that was meant. A swipe is the cheapest gesture in the
// list and the one most often made on the way to scrolling, so the question
// was needed — and it was a question asked about something the screen had
// already done. Apple's guidance is the other way round: a delete that can be
// undone is not confirmed, and the swipe itself is not the delete. It opens
// the row on a 删除 button, and pressing that is the decision. An accidental
// swipe costs nothing; a deliberate one costs one more tap, not a dialog.
//
// Only one row is open at a time, and a scroll or a tap on the open row
// closes it — the two things an iPhone's own lists do, and the two a finger
// expects when it has moved on.

import 'package:flutter/material.dart';

import 'accessibility.dart';

/// One button behind a row.
class SwipeAction {
  const SwipeAction({
    required this.key,
    required this.label,
    required this.icon,
    required this.color,
    required this.onPressed,
  });

  final Key key;
  final String label;
  final IconData icon;
  final Color color;
  final VoidCallback onPressed;
}

/// A row that opens on [actions] when it is swiped toward the start.
///
/// The actions sit behind the trailing edge and are drawn only while some of
/// them shows, so a closed row has nothing extra in its tree — or in what a
/// screen reader reads. The row gives a screen reader the same actions
/// itself, as custom actions on its own node (see `entry_list.dart`), because
/// a swipe is a gesture VoiceOver users do not make.
class SwipeActions extends StatefulWidget {
  const SwipeActions({
    super.key,
    required this.child,
    required this.actions,
    this.enabled = true,
    this.radius = BorderRadius.zero,
    this.gap = 0,
  });

  final Widget child;
  final List<SwipeAction> actions;

  /// Off while a selection is being made: a drag across a row is how a
  /// finger scrolls a list it is also ticking, and a row that opened under
  /// it would be in the way.
  final bool enabled;

  /// The row's own corners, so the actions behind it are its shape.
  final BorderRadius radius;

  /// Space under the row that belongs to the gap between rows, not to it.
  final double gap;

  /// Each button's width when the row is open. Apple's own is a little over
  /// 70pt; a Chinese label of two characters with its icon above fits 76.
  static const double actionWidth = 76;

  @override
  State<SwipeActions> createState() => _SwipeActionsState();
}

class _SwipeActionsState extends State<SwipeActions>
    with SingleTickerProviderStateMixin {
  /// The one open row, wherever it is. Opening another closes it.
  static _SwipeActionsState? _open;

  /// How far the row has moved, in dp: 0 closed, negative toward the start.
  late final AnimationController _x = AnimationController.unbounded(vsync: this)
    ..addListener(_moved);

  ScrollPosition? _scroll;

  double get _width => SwipeActions.actionWidth * widget.actions.length;
  bool get _isOpen => _x.value < 0;

  void _moved() => setState(() {});

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final pos = Scrollable.maybeOf(context)?.position;
    if (pos != _scroll) {
      _scroll?.isScrollingNotifier.removeListener(_scrolled);
      _scroll = pos;
      _scroll?.isScrollingNotifier.addListener(_scrolled);
    }
  }

  @override
  void didUpdateWidget(SwipeActions old) {
    super.didUpdateWidget(old);
    if (!widget.enabled && _isOpen) _close(animate: false);
  }

  @override
  void dispose() {
    if (identical(_open, this)) _open = null;
    _scroll?.isScrollingNotifier.removeListener(_scrolled);
    _x.dispose();
    super.dispose();
  }

  void _scrolled() {
    if (_scroll?.isScrollingNotifier.value == true && _isOpen) _close();
  }

  bool get _still => lessMotion(context);

  void _settle(double to) {
    if (_still) {
      _x.value = to;
    } else {
      _x.animateTo(
        to,
        duration: const Duration(milliseconds: 240),
        curve: Curves.easeOutCubic,
      );
    }
  }

  void _openUp() {
    _open = this;
    _settle(-_width);
  }

  void _close({bool animate = true}) {
    if (identical(_open, this)) _open = null;
    if (animate) {
      _settle(0);
    } else {
      _x.value = 0;
    }
  }

  /// A finger on another row shuts the open one, whether or not this row
  /// goes on to open: the finger has moved on.
  void _dragStart(DragStartDetails _) {
    _x.stop();
    if (!identical(_open, this)) _open?._close();
  }

  void _dragUpdate(DragUpdateDetails d) {
    var next = _x.value + d.primaryDelta!;
    if (next > 0) next = 0;
    // Past fully open it gives, rather than stopping dead: the row is still
    // under the finger, only heavier.
    if (next < -_width) next = -_width + (next + _width) * 0.35;
    _x.value = next;
  }

  void _dragEnd(DragEndDetails d) {
    final v = d.primaryVelocity ?? 0;
    if (v < -300) return _openUp();
    if (v > 300) return _close();
    if (_x.value < -_width / 2) {
      _openUp();
    } else {
      _close();
    }
  }

  void _press(SwipeAction a) {
    _close(animate: false);
    a.onPressed();
  }

  @override
  Widget build(BuildContext context) {
    final shown = -_x.value;
    return GestureDetector(
      onHorizontalDragStart: widget.enabled ? _dragStart : null,
      onHorizontalDragUpdate: widget.enabled ? _dragUpdate : null,
      onHorizontalDragEnd: widget.enabled ? _dragEnd : null,
      child: Stack(
        children: [
          if (shown > 0)
            Positioned(
              top: 0,
              bottom: widget.gap,
              right: 0,
              width: shown,
              child: ClipRRect(
                borderRadius: BorderRadius.only(
                  topRight: widget.radius.topRight,
                  bottomRight: widget.radius.bottomRight,
                ),
                child: Row(
                  children: [
                    for (final a in widget.actions)
                      Expanded(child: _ActionButton(a, onTap: () => _press(a))),
                  ],
                ),
              ),
            ),
          Transform.translate(offset: Offset(_x.value, 0), child: widget.child),
          // Open, a tap on the row closes it rather than opening the entry:
          // the finger was answering the row that is open, not starting over.
          if (shown > 0)
            Positioned(
              top: 0,
              bottom: 0,
              left: 0,
              right: shown,
              child: GestureDetector(
                key: const Key('swipe-close'),
                behavior: HitTestBehavior.opaque,
                excludeFromSemantics: true,
                onTap: _close,
              ),
            ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton(this.action, {required this.onTap});

  final SwipeAction action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      key: action.key,
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: ColoredBox(
        color: action.color,
        // The label stays at the button's leading edge while the row is still
        // opening, so it slides in with the row rather than squeezing.
        child: OverflowBox(
          alignment: Alignment.centerLeft,
          minWidth: SwipeActions.actionWidth,
          maxWidth: SwipeActions.actionWidth,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(action.icon, size: 22, color: Colors.white),
              const SizedBox(height: 4),
              Text(
                action.label,
                maxLines: 1,
                style: const TextStyle(
                  fontSize: 13,
                  height: 1.1,
                  fontWeight: FontWeight.w600,
                  color: Colors.white,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
