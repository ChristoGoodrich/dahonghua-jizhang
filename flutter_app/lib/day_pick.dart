// A day of the month: any of the 28 that every month has.
//
// A card's statement and due days, and the budget cycle's first day, offered
// seven presets — 1, 5, 10, 15, 20, 25, 28 — and nothing else. A card that
// bills on the 7th could not be set up, so its statement and its 要还款了
// banner came out wrong; the shipping app took any day. The presets stay, as
// the quick choices, and 其他 opens this.
//
// 28 and no further: a month without a 29th, 30th or 31st would skip that day,
// and with it a whole cycle. The core clamps to the same range.

import 'package:flutter/material.dart';

import 'tap.dart';
import 'theme.dart';

/// The quick choices, shown as chips before 其他.
const dayPresets = [1, 5, 10, 15, 20, 25, 28];

/// The days on offer, 1 to 28.
final monthDays = List<int>.generate(28, (i) => i + 1);

/// Ask for a day of the month. Null when cancelled.
Future<int?> pickMonthDay(
  BuildContext context, {
  int? current,
  required bool zh,
}) => showDialog<int>(
  context: context,
  builder: (ctx) => AlertDialog(
    key: const Key('day-pick'),
    backgroundColor: palette.card,
    title: Text(
      zh ? '每月几号' : 'Day of the month',
      style: TextStyle(fontSize: 16, color: palette.ink),
    ),
    content: Wrap(
      spacing: 4,
      runSpacing: 4,
      children: [
        for (final d in monthDays)
          Tap(
            key: Key('day-$d'),
            radius: Rad.md,
            onTap: () => Navigator.pop(ctx, d),
            semanticLabel: zh ? '$d 号' : 'Day $d',
            child: Container(
              width: 36,
              height: 36,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: d == current
                    ? palette.stamen.withValues(alpha: 0.18)
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(Rad.md),
                border: Border.all(
                  color: d == current ? palette.stamen : palette.line,
                ),
              ),
              child: Text(
                '$d',
                style: TextStyle(
                  fontSize: 13,
                  fontFeatures: tabular,
                  color: palette.ink,
                ),
              ),
            ),
          ),
      ],
    ),
    actions: [
      TextButton(
        key: const Key('day-pick-cancel'),
        onPressed: () => Navigator.pop(ctx),
        style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
        child: Text(zh ? '取消' : 'Cancel'),
      ),
    ],
  ),
);

/// The presets, with `current` among them when it is a day they do not
/// name — so a day chosen through 其他 still shows as the one chosen.
List<int> dayChoices(List<int> presets, int? current) => [
  ...{...presets, ?current}.toList()..sort(),
];
