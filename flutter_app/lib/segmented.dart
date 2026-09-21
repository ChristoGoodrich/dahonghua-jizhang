// A segmented control: a track, and a thumb that slides to the choice.
//
// The one control this app has for "which of these few". It started on 统计
// for the window and the direction, and 记一笔's 支出/收入/转账 were three
// outlined boxes beside it — two languages for one question, on screens a
// thumb moves between a dozen times a day.

import 'package:flutter/material.dart';

import 'tap.dart';
import 'theme.dart';

/// A segmented control: a track with a thumb that slides to the choice.
class Segmented extends StatelessWidget {
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
  final ValueChanged<String> onChanged;

  /// Each segment is keyed `<prefix>-<value>`.
  final String keyPrefix;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final n = items.length;
    final i = items.indexWhere((e) => e.$1 == value).clamp(0, n - 1);
    return Container(
      height: compact ? 30 : 38,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: p.paperWarm,
        borderRadius: BorderRadius.circular(Rad.pill),
        border: Border.all(color: p.line.withValues(alpha: 0.6)),
      ),
      child: Stack(
        children: [
          AnimatedAlign(
            alignment: Alignment(n == 1 ? 0 : -1 + 2 * i / (n - 1), 0),
            duration: const Duration(milliseconds: 260),
            curve: Curves.easeOutCubic,
            child: FractionallySizedBox(
              widthFactor: 1 / n,
              heightFactor: 1,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  // On paper the card is lighter than the track by itself; in
                  // the dark the two are a shade apart, so the thumb is lifted
                  // toward the ink until it reads as the one that is on.
                  color: p.isDark
                      ? Color.alphaBlend(p.ink.withValues(alpha: 0.1), p.card)
                      : p.card,
                  borderRadius: BorderRadius.circular(Rad.pill),
                  boxShadow: [
                    BoxShadow(
                      color: parseHex(
                        p.shadowHex,
                      ).withValues(alpha: p.isDark ? 0.3 : 0.1),
                      blurRadius: 6,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Row(
            children: [
              for (final (k, label) in items)
                Expanded(
                  child: Tap(
                    key: Key('$keyPrefix-$k'),
                    filled: false,
                    radius: Rad.pill,
                    semanticLabel: label,
                    onTap: () => onChanged(k),
                    child: Center(
                      child: Text(
                        label,
                        style: TextStyle(
                          fontSize: compact ? 12 : 13.5,
                          fontWeight: k == value
                              ? FontWeight.w700
                              : FontWeight.w500,
                          color: k == value ? p.ink : p.inkSoft,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
