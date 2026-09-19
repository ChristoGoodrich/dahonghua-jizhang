// 空状态 — what a screen says when it has nothing to show.
//
// Six screens had one, and no two agreed: a line centred in the page, a line
// pushed 40dp down, a line flush left at 12.5px, a line at 13, 13.5 and 14. On
// a screen whose whole content is "nothing yet", that line IS the screen, and
// a single grey sentence floating in cream reads as unfinished rather than as
// empty. The entry list had already been given a proper one — the mark in a
// soft circle and a sentence under it — and every other screen fell visibly
// short of it.
//
// So there is one shape: the screen's own icon, the same glyph the 我的 hub
// shows for it, in a soft circle; what is missing; and optionally how to make
// one. The icon is the hub's so the empty screen is recognisably the place the
// user just tapped into, rather than a generic illustration.

import 'package:flutter/material.dart';

import 'theme.dart';

class EmptyNote extends StatelessWidget {
  const EmptyNote({
    super.key,
    required this.icon,
    required this.text,
    this.hint,
  });

  /// The glyph the 我的 hub uses for this screen.
  final IconData icon;

  /// What is missing. Short: 还没有订阅.
  final String text;

  /// How to make one, if that is not obvious from the screen. Optional,
  /// because a screen with a large + in its header has already said it.
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    return Padding(
      padding: const EdgeInsets.only(top: 48, bottom: 24),
      child: Center(
        child: ConstrainedBox(
          // A hint wider than this is a paragraph, and a paragraph in an
          // empty state is the screen explaining itself instead of inviting.
          constraints: const BoxConstraints(maxWidth: 260),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 64,
                height: 64,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: p.paperWarm,
                  shape: BoxShape.circle,
                  border: Border.all(color: p.hibiscus.withValues(alpha: 0.10)),
                ),
                child: Icon(icon, size: 28, color: p.hibiscus),
              ),
              const SizedBox(height: 14),
              Text(
                text,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w600,
                  color: p.ink.withValues(alpha: 0.72),
                ),
              ),
              if (hint != null) ...[
                const SizedBox(height: 6),
                Text(
                  hint!,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 12.5,
                    height: 1.45,
                    color: p.inkSoft,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
