// 明细's calendar: the cycle as a grid of days, shaded by what each spent.
//
// The shipping list had this as its second face (`CalendarView.tsx`) and the
// port dropped it. The grid is `api::calendar`'s — which days, how many blanks
// before the first, what each day spent, which is today, which are ahead of
// it, and how deep each is shaded (`core::calendar::heat`, the root of the
// share, so the rent day does not wash out every lunch). This file lays the
// days in weeks and chooses colours.

import 'package:flutter/material.dart';

import 'src/rust/api/calendar.dart' as calendar;
import 'src/rust/api/money.dart' as money;
import 'tap.dart';
import 'theme.dart';

class CalendarGrid extends StatelessWidget {
  const CalendarGrid({
    super.key,
    required this.month,
    required this.picked,
    required this.onPick,
    this.zh = true,
  });

  final calendar.CalMonthView month;

  /// The day whose rows are listed below, `y-m-d`.
  final String? picked;
  final ValueChanged<String> onPick;
  final bool zh;

  /// The tint for a day, from its shade. A light wash at the shallow end so a
  /// day with anything at all reads as touched, deepening to a third of the
  /// flower at the most — past that the amount printed on it stops reading.
  static Color tint(double heat, Color hibiscus, Color card) =>
      Color.alphaBlend(hibiscus.withValues(alpha: 0.07 + 0.3 * heat), card);

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final week = zh
        ? const ['一', '二', '三', '四', '五', '六', '日']
        : const ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    final slots = <calendar.CalCellView?>[
      for (var i = 0; i < month.leading; i++) null,
      ...month.cells,
    ];
    while (slots.length % 7 != 0) {
      slots.add(null);
    }

    return Container(
      key: const Key('cal-grid'),
      padding: const EdgeInsets.fromLTRB(10, 12, 10, 12),
      decoration: BoxDecoration(
        color: p.card,
        borderRadius: BorderRadius.circular(Rad.lg),
        border: Border.all(color: p.line),
      ),
      child: Column(
        children: [
          Row(
            children: [
              for (var i = 0; i < 7; i++)
                Expanded(
                  child: Center(
                    child: Text(
                      week[i],
                      style: TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                        // the weekend, a shade toward the flower
                        color: i >= 5
                            ? Color.lerp(p.inkSoft, p.hibiscus, 0.45)
                            : p.inkSoft,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          for (var w = 0; w < slots.length ~/ 7; w++)
            Row(
              children: [
                for (var d = 0; d < 7; d++)
                  Expanded(
                    child: AspectRatio(
                      aspectRatio: 0.84,
                      child: slots[w * 7 + d] == null
                          ? const SizedBox.shrink()
                          : _cell(slots[w * 7 + d]!, p),
                    ),
                  ),
              ],
            ),
          const SizedBox(height: 10),
          _legend(p),
        ],
      ),
    );
  }

  Widget _cell(calendar.CalCellView c, Palette p) {
    final on = c.day == picked;
    final spent = c.exp > 0;
    final bg = c.future
        ? Colors.transparent
        : spent
        ? tint(c.heat, p.hibiscus, p.card)
        // a day with nothing on it is still a day: faint, but a tile —
        // paper-warm vanishes into a dark room, the line colour does not
        : p.isDark
        ? p.line.withValues(alpha: 0.45)
        : p.paperWarm.withValues(alpha: 0.7);
    final number = c.today
        ? Container(
            width: 22,
            height: 22,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: p.hibiscus,
              shape: BoxShape.circle,
            ),
            child: Text(
              '${c.dom}',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: Colors.white,
              ),
            ),
          )
        : Text(
            '${c.dom}',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              fontFeatures: tabular,
              color: c.future ? p.inkSoft.withValues(alpha: 0.4) : p.ink,
            ),
          );
    final below = spent
        ? FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              money.fmtShort(n: c.exp, symbol: ''),
              style: TextStyle(
                fontSize: 9.5,
                fontWeight: FontWeight.w600,
                fontFeatures: tabular,
                color: p.hibiscusDeep,
              ),
            ),
          )
        : c.inc > 0
        ? _dot(p.leafDeep)
        : c.count > 0
        ? _dot(p.inkSoft)
        : const SizedBox(height: 6);

    final body = Container(
      // The whole slot, not the width of what is written in it: `Tap` hands
      // its child loose constraints, and a cell that sized to its text came
      // out as a capsule as wide as "1,299" and no wider.
      constraints: const BoxConstraints.expand(),
      margin: const EdgeInsets.all(2),
      padding: const EdgeInsets.symmetric(horizontal: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(11),
        border: on
            ? Border.all(color: p.hibiscus, width: 1.6)
            : c.today
            ? Border.all(color: p.hibiscus.withValues(alpha: 0.35))
            : null,
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [number, const SizedBox(height: 3), below],
      ),
    );
    // A day ahead of today is drawn and not pressable: there is nothing on
    // it yet, and nothing may be recorded there.
    if (c.future) return KeyedSubtree(key: Key('cal-${c.day}'), child: body);
    return Tap(
      key: Key('cal-${c.day}'),
      radius: 11,
      semanticLabel: zh
          ? '${c.dom}日${c.count > 0 ? ',${c.count}笔' : ''}'
          : 'Day ${c.dom}${c.count > 0 ? ', ${c.count} entries' : ''}',
      onTap: () => onPick(c.day),
      child: body,
    );
  }

  static Widget _dot(Color c) => Container(
    width: 5,
    height: 5,
    decoration: BoxDecoration(color: c, shape: BoxShape.circle),
  );

  Widget _legend(Palette p) => Row(
    mainAxisAlignment: MainAxisAlignment.end,
    children: [
      Text(
        zh ? '花得少' : 'Less',
        style: TextStyle(fontSize: 10.5, color: p.inkSoft),
      ),
      const SizedBox(width: 6),
      for (final h in const [0.0, 0.25, 0.5, 0.75, 1.0])
        Container(
          width: 14,
          height: 10,
          margin: const EdgeInsets.symmetric(horizontal: 1.5),
          decoration: BoxDecoration(
            color: tint(h, p.hibiscus, p.card),
            borderRadius: BorderRadius.circular(3),
          ),
        ),
      const SizedBox(width: 6),
      Text(
        zh ? '花得多' : 'More',
        style: TextStyle(fontSize: 10.5, color: p.inkSoft),
      ),
      const SizedBox(width: 4),
    ],
  );
}
