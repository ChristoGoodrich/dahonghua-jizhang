// 日期 — the day an entry is on, and how to put it on another.
//
// The shipping app's record sheet had this and the Flutter port dropped it:
// every entry was stamped "now", so the taxi forgotten yesterday could only
// ever be recorded as today's. The form had kept a `ts` all along, and the
// core had a test for a pre-picked date on a new entry; what was missing was
// the one control that set it.
//
// Rebuilt from `src/features/record/DateField.tsx` at `rn-final`, with one
// deliberate change in where it lives. That version was a row that expanded
// in place into chips and a month. Here the sheet's fields already fill the
// space above the keypad exactly — tags and ledger sit under it — so a row
// that grew would push more of the form out of sight. The chip lives in the
// amount card instead, whose left half was empty, and the month opens as a
// sheet of its own.
//
// Which name a day gets, which days can be picked, and where the month may
// page to are `core::record`'s. Turning an instant into a day, and a day back
// into an instant at the same time of day, is the timezone's — so here.

import 'package:flutter/material.dart';

import 'src/rust/api/record.dart' as record;
import 'tap.dart';
import 'theme.dart';

/// `y-m-d`, month 1-based: an instant as the local calendar day it falls on.
String _day(DateTime d) => '${d.year}-${d.month}-${d.day}';

/// The same moment of the day, on another day.
///
/// Keeps the hour and minute of whatever the entry already had — or of now,
/// for a new one. Moving yesterday's lunch to the day before should not also
/// move it to midnight, which would reorder it against everything else logged
/// that day.
int onDay(DateTime base, DateTime day) => DateTime(
  day.year,
  day.month,
  day.day,
  base.hour,
  base.minute,
  base.second,
  base.millisecond,
).millisecondsSinceEpoch;

/// The day's name as the sheet says it.
String dayLabel(DateTime d, bool zh, {DateTime? now}) {
  final today = now ?? DateTime.now();
  switch (record.dayName(day: _day(d), today: _day(today))) {
    case 'today':
      return zh ? '今天' : 'Today';
    case 'yesterday':
      return zh ? '昨天' : 'Yesterday';
    case 'day_before':
      return zh ? '前天' : '2 days ago';
  }
  const zhWeek = ['一', '二', '三', '四', '五', '六', '日'];
  const enWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const enMonth = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  // The year only when it is not this one: 9月14日 is unambiguous in
  // September, and 2025年12月31日 is not something to make anyone work out.
  final year = d.year == today.year ? '' : (zh ? '${d.year}年' : ', ${d.year}');
  return zh
      ? '$year${d.month}月${d.day}日 周${zhWeek[d.weekday - 1]}'
      : '${enWeek[d.weekday - 1]}, ${enMonth[d.month - 1]} ${d.day}$year';
}

/// The chip in the amount card. Tap it to move the entry to another day.
class DateChip extends StatelessWidget {
  const DateChip({
    super.key,
    required this.ts,
    required this.onChanged,
    required this.accent,
    this.zh = true,
  });

  /// Epoch ms, or null for a new entry that has not been backdated — which
  /// is "now", and which is why the chip then says 今天.
  final int? ts;
  final ValueChanged<int> onChanged;
  final Color accent;
  final bool zh;

  DateTime get _when =>
      ts == null ? DateTime.now() : DateTime.fromMillisecondsSinceEpoch(ts!);

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final label = dayLabel(_when, zh);
    // Tinted once it is not today, so a backdated entry says so from across
    // the sheet — the case where the date is worth noticing is the one where
    // it is not the default.
    final moved =
        record.dayName(day: _day(_when), today: _day(DateTime.now())) !=
        'today';
    return Tap(
      key: const Key('date-chip'),
      radius: Rad.pill,
      semanticLabel: zh ? '日期:$label' : 'Date: $label',
      onTap: () async {
        final picked = await showModalBottomSheet<DateTime>(
          context: context,
          backgroundColor: p.card,
          showDragHandle: true,
          builder: (_) => _DatePicker(selected: _when, accent: accent, zh: zh),
        );
        if (picked != null) onChanged(onDay(_when, picked));
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
        decoration: BoxDecoration(
          color: moved ? accent.withValues(alpha: 0.12) : p.paperWarm,
          borderRadius: BorderRadius.circular(Rad.pill),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.calendar_today_outlined,
              size: 14,
              color: moved ? accent : p.inkSoft,
            ),
            const SizedBox(width: 6),
            Text(
              label,
              key: const Key('date-label'),
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: moved ? accent : p.ink,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The month, and the three days anyone actually reaches back to.
class _DatePicker extends StatefulWidget {
  const _DatePicker({
    required this.selected,
    required this.accent,
    required this.zh,
  });

  final DateTime selected;
  final Color accent;
  final bool zh;

  @override
  State<_DatePicker> createState() => _DatePickerState();
}

class _DatePickerState extends State<_DatePicker> {
  late int _y = widget.selected.year;
  late int _m = widget.selected.month;

  void _page(int dir) => setState(() {
    final d = DateTime(_y, _m + dir);
    _y = d.year;
    _m = d.month;
  });

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final zh = widget.zh;
    final now = DateTime.now();
    final today = _day(now);
    final cells = record.dateGrid(y: _y, m: _m, today: today);
    final forward = record.canPageForward(y: _y, m: _m, today: today);
    final sel = widget.selected;
    const zhWeek = ['一', '二', '三', '四', '五', '六', '日'];
    const enWeek = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    Widget quick(String label, int back) {
      final d = DateTime(now.year, now.month, now.day - back);
      final on = _day(d) == _day(sel);
      return Padding(
        padding: const EdgeInsets.only(right: 8),
        child: Tap(
          key: Key('date-quick-$back'),
          radius: Rad.pill,
          onTap: () => Navigator.pop(context, d),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: on ? widget.accent.withValues(alpha: 0.12) : p.paperWarm,
              borderRadius: BorderRadius.circular(Rad.pill),
              border: Border.all(
                color: on
                    ? widget.accent.withValues(alpha: 0.5)
                    : Colors.transparent,
              ),
            ),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w600,
                color: on ? widget.accent : p.ink,
              ),
            ),
          ),
        ),
      );
    }

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                quick(zh ? '今天' : 'Today', 0),
                quick(zh ? '昨天' : 'Yesterday', 1),
                quick(zh ? '前天' : '2 days ago', 2),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                IconButton(
                  key: const Key('date-prev'),
                  icon: Icon(Icons.chevron_left, color: widget.accent),
                  onPressed: () => _page(-1),
                ),
                Expanded(
                  child: Text(
                    zh ? '$_y年$_m月' : '$_m / $_y',
                    key: const Key('date-month'),
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 15.5,
                      fontWeight: FontWeight.w700,
                      color: p.ink,
                    ),
                  ),
                ),
                IconButton(
                  key: const Key('date-next'),
                  icon: Icon(
                    Icons.chevron_right,
                    color: forward ? widget.accent : p.line,
                  ),
                  onPressed: forward ? () => _page(1) : null,
                ),
              ],
            ),
            const SizedBox(height: 6),
            GridView.count(
              crossAxisCount: 7,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              childAspectRatio: 1.15,
              children: [
                for (final w in zh ? zhWeek : enWeek)
                  Center(
                    child: Text(
                      w,
                      style: TextStyle(fontSize: 12, color: p.inkSoft),
                    ),
                  ),
                for (final c in cells) _cell(c, sel),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _cell(record.DayCell c, DateTime sel) {
    final p = palette;
    final day = c.day;
    if (day == null) return const SizedBox.shrink();
    final on = sel.year == _y && sel.month == _m && sel.day == day;
    final fg = !c.pickable
        ? p.inkSoft.withValues(alpha: 0.4)
        : on
        ? Colors.white
        : p.ink;
    final cell = Center(
      child: Container(
        width: 36,
        height: 36,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: on ? widget.accent : Colors.transparent,
          // today is ringed, so it can be found when something else is picked
          border: c.today && !on
              ? Border.all(color: widget.accent.withValues(alpha: 0.6))
              : null,
        ),
        child: Text(
          '$day',
          style: TextStyle(
            fontSize: 14,
            fontWeight: on || c.today ? FontWeight.w700 : FontWeight.w500,
            fontFeatures: tabular,
            color: fg,
          ),
        ),
      ),
    );
    if (!c.pickable) return cell;
    return Tap(
      key: Key('date-day-$day'),
      filled: false,
      onTap: () => Navigator.pop(context, DateTime(_y, _m, day)),
      child: cell,
    );
  }
}
