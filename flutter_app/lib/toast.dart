// 小提示 — the app's one-line notices, in the phone's own shape.
//
// They were Material snackbars: a dark slab the width of the screen with the
// action at its far end, which on HyperOS reads as another platform's
// furniture. The phone's own notice is a small capsule low on the screen with
// the app's icon and a few words, and that is the shape asked for — "直接接入
// 小米系统的那个下方的小通知".
//
// Not the system's own. Android's `Toast` carries text and nothing else — the
// custom views that could hold a button were withdrawn in Android 11 — and 撤销
// is the whole reason 已删除 is said at all. So the capsule is drawn here, in
// the system's proportions: content-sized and centred, the flower where the
// system puts the icon, the action at the end in the accent.
//
// Carried by the `ScaffoldMessenger` all the same, on a transparent floating
// snackbar: that is what already knows where the bottom bar is, queues one
// notice behind another, keeps a notice alive across a route popping, and
// times it out.

import 'package:flutter/material.dart';

import 'bloom.dart';
import 'tap.dart';
import 'theme.dart';

/// The action at the end of a notice.
class ToastAction {
  const ToastAction({required this.label, required this.onPressed, this.key});

  final String label;
  final VoidCallback onPressed;
  final Key? key;
}

/// Show `text` as the current notice, replacing any that is up.
///
/// A notice with an action stays long enough to reach it; one without is the
/// system's short toast.
void showToast(
  BuildContext context, {
  required String text,
  Key? key,
  ToastAction? action,
  Duration? duration,
}) {
  final messenger = ScaffoldMessenger.of(context);
  messenger
    ..clearSnackBars()
    ..showSnackBar(
      SnackBar(
        key: key,
        behavior: SnackBarBehavior.floating,
        backgroundColor: Colors.transparent,
        elevation: 0,
        padding: EdgeInsets.zero,
        // Nothing below it: the scaffold already floats it over the bottom
        // bar's whole slot, the ground above the glass included, and the
        // system's toast sits that close to the dock.
        margin: const EdgeInsets.fromLTRB(24, 0, 24, 0),
        duration:
            duration ??
            (action == null
                ? const Duration(milliseconds: 2000)
                : const Duration(milliseconds: 4000)),
        content: Center(
          child: ToastCapsule(
            text: text,
            action: action == null
                ? null
                : ToastAction(
                    key: action.key,
                    label: action.label,
                    onPressed: () {
                      messenger.hideCurrentSnackBar();
                      action.onPressed();
                    },
                  ),
          ),
        ),
      ),
    );
}

/// The capsule itself. Public so a test can find it by type.
class ToastCapsule extends StatelessWidget {
  const ToastCapsule({super.key, required this.text, this.action});

  final String text;
  final ToastAction? action;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    return Container(
      constraints: const BoxConstraints(minHeight: 44),
      padding: EdgeInsets.fromLTRB(14, 6, action == null ? 18 : 6, 6),
      decoration: BoxDecoration(
        // The system's toast is a lit capsule in a lit room and a lifted grey
        // one at night: the card, lifted toward the ink when dark so it stands
        // off the dark paper it floats over.
        color: p.isDark
            ? Color.alphaBlend(p.ink.withValues(alpha: 0.12), p.card)
            : p.card,
        borderRadius: BorderRadius.circular(Rad.pill),
        border: Border.all(color: p.line.withValues(alpha: p.isDark ? 1 : 0.7)),
        boxShadow: [
          BoxShadow(
            color: parseHex(
              p.shadowHex,
            ).withValues(alpha: p.isDark ? 0.4 : 0.14),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Bloom(size: 18, petal: p.hibiscus),
          const SizedBox(width: 9),
          Flexible(
            child: Text(
              text,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 14,
                height: 1.3,
                fontWeight: FontWeight.w500,
                color: p.ink,
              ),
            ),
          ),
          if (action != null) ...[
            const SizedBox(width: 6),
            Tap(
              key: action!.key,
              radius: Rad.pill,
              onTap: action!.onPressed,
              semanticLabel: action!.label,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                child: Text(
                  action!.label,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: p.hibiscus,
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// 删除之前问一句 — a delete asks first.
///
/// A swipe is the easiest gesture in the list and the one most often made by
/// accident, and a row deleted on the way to scrolling was only recoverable if
/// the notice was noticed. So every delete of an entry asks, and says what it
/// is about to take; the notice with 撤销 still follows, for the one that was
/// meant and then regretted.
Future<bool> confirmDelete(
  BuildContext context, {
  required bool zh,
  required String what,
  int count = 1,
}) async {
  final p = palette;
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      key: const Key('entry-delete-confirm'),
      backgroundColor: p.card,
      title: Text(
        count == 1
            ? (zh ? '删除这笔记录？' : 'Delete this entry?')
            : (zh ? '删除选中的 $count 笔？' : 'Delete $count entries?'),
        style: TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w700,
          color: p.ink,
        ),
      ),
      content: Text(
        zh ? '$what\n删掉后可以马上撤销。' : '$what\nYou can undo it right after.',
        style: TextStyle(fontSize: 14, height: 1.5, color: p.inkSoft),
      ),
      actions: [
        TextButton(
          key: const Key('entry-delete-cancel'),
          onPressed: () => Navigator.pop(ctx, false),
          child: Text(zh ? '取消' : 'Cancel', style: TextStyle(color: p.ink)),
        ),
        TextButton(
          key: const Key('entry-delete-ok'),
          onPressed: () => Navigator.pop(ctx, true),
          style: TextButton.styleFrom(foregroundColor: p.warn),
          child: Text(
            zh ? '删除' : 'Delete',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ),
      ],
    ),
  );
  return ok ?? false;
}
