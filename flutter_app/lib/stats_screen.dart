// 统计 — what a window came to, where it went, and how it compares.
//
// The port kept three of the shipping screen's nine sections: the totals, one
// line, one donut. `StatsView.tsx` at `rn-final` also had the entry count,
// every category rather than six, the last six windows, the largest entries,
// spending by weekday and by time of day, and this month against the same
// days of the last — and the core already had the arithmetic for all of it,
// pinned by the corpus. What was missing was a way across and a drawing.
//
// The way across is one call, `stats_page`, because every section redraws on
// every window and every direction and each would otherwise carry the whole
// ledger over the boundary to answer one question about it. What goes over is
// what only this side knows — each entry's local day, weekday and hour — and
// what comes back is finished: totals, shares, coordinates, the curve, the
// gridlines, the peak, and the verdict on this month. The painters in
// `charts.dart` scale a box and choose colours; they do no arithmetic.
//
// A chart is the easiest place in an app to be confidently wrong: a line is
// drawn either way, and nothing about a wrong one looks wrong.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'charts.dart';
import 'glass.dart';
import 'segmented.dart';
import 'src/rust/api/money.dart' as money;
import 'src/rust/api/period.dart' as period;
import 'src/rust/api/stats.dart' as stats;
import 'src/rust/api/store.dart' as store;
import 'tap.dart';
import 'theme.dart';

/// `y-m-d` for a local calendar day — the one conversion that needs a timezone,
/// and therefore the one this side does.
String _day(DateTime d) => '${d.year}-${d.month}-${d.day}';

DateTime _parse(String ymd) {
  final p = ymd.split('-').map(int.parse).toList();
  return DateTime(p[0], p[1], p[2]);
}

const _enMonth = [
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

class StatsScreen extends StatefulWidget {
  const StatsScreen({super.key, this.zh = true, this.onEdit});

  final bool zh;

  /// Opens an entry — from the list of the largest ones.
  final ValueChanged<String>? onEdit;

  @override
  State<StatsScreen> createState() => _StatsScreenState();
}

class _StatsScreenState extends State<StatsScreen>
    with SingleTickerProviderStateMixin {
  /// Which window: day, week, month, halfyear or year.
  ///
  /// `month` is not the calendar month — it is the accounting cycle, so a
  /// ledger that turns over on the 15th gets the 15th to the 14th here too.
  String _period = 'month';

  /// A day inside the window being shown. Stepping moves this, and the window
  /// is re-derived from it rather than tracked alongside it.
  String _anchor = _day(DateTime.now());

  String _io = 'exp';

  late period.WindowView _win;
  late stats.StatsPage _page;

  /// The category picked in the list, which the ring then shows.
  String? _picked;

  /// Habits by time of day rather than by weekday.
  bool _byHour = false;

  /// Draws the charts in, left to right and up from zero, whenever what they
  /// show changes. A chart that snaps from one month to the next reads as a
  /// glitch; one that grows reads as the new month arriving.
  late final AnimationController _reveal = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 650),
  );

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _reveal.dispose();
    super.dispose();
  }

  void _reload() {
    final ids = <String>[];
    final days = <String>[];
    final dows = <int>[];
    final hours = <int>[];
    for (final e in store.liveEntries()) {
      final d = DateTime.fromMillisecondsSinceEpoch(e.ts);
      ids.add(e.id);
      days.add(_day(d));
      // `getDay()`: Sunday is 0, which is what the core's buckets expect
      dows.add(d.weekday % 7);
      hours.add(d.hour);
    }
    final win = period.periodWindow(anchor: _anchor, period: _period);
    final page = stats.statsPage(
      ids: ids,
      daysOf: days,
      dows: dows,
      hours: hours,
      anchor: _anchor,
      period: _period,
      io: _io,
      today: _day(DateTime.now()),
      zh: widget.zh,
    );
    setState(() {
      _win = win;
      _page = page;
      _picked = null;
    });
    final still = WidgetsBinding
        .instance
        .platformDispatcher
        .accessibilityFeatures
        .disableAnimations;
    if (still) {
      _reveal.value = 1;
    } else {
      _reveal.forward(from: 0);
    }
  }

  void _step(int dir) {
    _anchor = period.stepPeriod(anchor: _anchor, period: _period, dir: dir);
    _reload();
  }

  void _setPeriod(String p) {
    _period = p;
    // Back to now when the window changes: the anchor was chosen inside a
    // window that no longer exists, and landing in an arbitrary month is
    // harder to explain than landing in this one.
    _anchor = _day(DateTime.now());
    _reload();
  }

  void _setIo(String io) {
    _io = io;
    _reload();
  }

  Color get _accent => _io == 'exp' ? palette.hibiscus : palette.leafDeep;
  String get _sym => widget.zh ? '￥' : '\$';
  String _money(double n) => money.fmt(n: n, symbol: _sym);
  String _short(double n) => money.fmtShort(n: n, symbol: _sym);

  /// What window is on screen, in words.
  ///
  /// Rendered here rather than in Rust: a month name is ICU text, and the core
  /// says so — the same reason currency symbols stayed on this side.
  String _windowLabel(bool zh) {
    final from = _parse(_win.start);
    final to = _parse(_win.last);
    switch (_period) {
      case 'day':
        return zh ? '${from.month}月${from.day}日' : '${from.month}/${from.day}';
      case 'year':
        return zh ? '${from.year} 年' : '${from.year}';
      case 'halfyear':
        final first = from.month <= 6;
        return zh
            ? '${from.year} 年${first ? '上' : '下'}半年'
            : '${from.year} H${first ? 1 : 2}';
      default:
        return zh
            ? '${from.month}月${from.day}日 – ${to.month}月${to.day}日'
            : '${from.month}/${from.day} – ${to.month}/${to.day}';
    }
  }

  /// The short label under one of the six bars — `bucketLabel`.
  String _bucketLabel(String ymd, bool zh) {
    final d = _parse(ymd);
    switch (_period) {
      case 'day':
      case 'week':
        return '${d.month}/${d.day}';
      case 'month':
        return zh ? '${d.month}月' : _enMonth[d.month - 1];
      case 'halfyear':
        final first = d.month <= 6;
        return zh
            ? '${first ? '上' : '下'}${d.year % 100}'
            : '${first ? 'H1' : 'H2'} ${d.year % 100}';
      default:
        return '${d.year}';
    }
  }

  static String _md(String ymd) {
    final p = ymd.split('-');
    return '${p[1]}/${p[2]}';
  }

  String _dayWords(String ymd, bool zh) {
    final d = _parse(ymd);
    return zh ? '${d.month}月${d.day}日' : '${_enMonth[d.month - 1]} ${d.day}';
  }

  static const _periods = ['day', 'week', 'month', 'halfyear', 'year'];

  String _periodName(String p, bool zh) => switch (p) {
    'day' => zh ? '日' : 'Day',
    'week' => zh ? '周' : 'Week',
    'halfyear' => zh ? '半年' : 'Half',
    'year' => zh ? '年' : 'Year',
    _ => zh ? '月' : 'Month',
  };

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    final c = _page.compare;
    final showCompare =
        _io == 'exp' && c != null && (c.thisTotal > 0 || c.lastTotal > 0);
    final habits = _byHour ? _page.hours : _page.weekday;
    final hasHabits =
        _page.weekday.any((b) => b.count > 0) ||
        _page.hours.any((b) => b.count > 0);
    const gap = SizedBox(height: 12);
    return TitledScaffold(
      title: zh ? '统计' : 'Stats',
      body: (context, b) => ListView(
        key: const Key('stats-list'),
        controller: b.controller,
        padding: EdgeInsets.fromLTRB(22, b.top, 22, 120),
        children: [
          b.header,
          _periodPicker(zh),
          const SizedBox(height: 12),
          _summary(zh),
          const SizedBox(height: 18),
          Segmented(
            keyPrefix: 'io',
            value: _io,
            onChanged: _setIo,
            items: [
              ('exp', zh ? '支出' : 'Expense'),
              ('inc', zh ? '收入' : 'Income'),
            ],
          ),
          gap,
          _TrendCard(
            key: ValueKey('trend-$_period-$_anchor-$_io'),
            trend: _page.trend,
            color: _accent,
            reveal: _reveal,
            title: _trendTitle(zh),
            money: _money,
            tickLabel: (v) => v == 0 ? '' : money.fmtShort(n: v, symbol: ''),
            pointLabel: (i) {
              final day = _dayWords(_page.trend.points[i].day, zh);
              if (!_page.trend.weekly) return day;
              return zh ? '$day起一周' : 'Week of $day';
            },
            peakWord: zh ? '最高' : 'Peak',
            empty: _io == 'exp'
                ? (zh ? '这段时间没有支出' : 'Nothing spent in this range')
                : (zh ? '这段时间没有收入' : 'No income in this range'),
          ),
          gap,
          _categoryCard(zh),
          gap,
          _periodCard(zh),
          if (showCompare) ...[gap, _compareCard(c, zh)],
          if (_page.top.length >= 2) ...[gap, _topCard(zh)],
          if (hasHabits) ...[gap, _habitCard(habits, zh)],
        ],
      ),
    );
  }

  String _trendTitle(bool zh) {
    if (_period == 'day') return zh ? '近7天' : 'Last 7 days';
    if (_page.trend.weekly) return zh ? '每周趋势' : 'Weekly';
    return zh ? '每日趋势' : 'Daily';
  }

  Widget _periodPicker(bool zh) => Column(
    children: [
      Segmented(
        keyPrefix: 'period',
        value: _period,
        onChanged: _setPeriod,
        items: [for (final p in _periods) (p, _periodName(p, zh))],
      ),
      const SizedBox(height: 4),
      Row(
        children: [
          IconButton(
            key: const Key('period-prev'),
            icon: Icon(Icons.chevron_left_rounded, color: palette.inkSoft),
            onPressed: () => _step(-1),
          ),
          Expanded(
            child: Text(
              _windowLabel(zh),
              key: const Key('period-label'),
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 14.5,
                fontWeight: FontWeight.w600,
                fontFeatures: tabular,
                color: palette.ink,
              ),
            ),
          ),
          IconButton(
            key: const Key('period-next'),
            icon: Icon(Icons.chevron_right_rounded, color: palette.inkSoft),
            onPressed: () => _step(1),
          ),
        ],
      ),
    ],
  );

  Widget _summary(bool zh) {
    final p = palette;
    final o = _page.overview;
    final c = _page.compare;
    // keyed: the same amount can legitimately appear further down, and a
    // finder that goes by text cannot say which one it means
    Widget figure(String key, String label, String value, Color color) =>
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: TextStyle(fontSize: 12, color: p.inkSoft)),
              const SizedBox(height: 3),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(
                  value,
                  key: Key('total-$key'),
                  style: TextStyle(
                    fontSize: 15.5,
                    fontWeight: FontWeight.w600,
                    fontFeatures: tabular,
                    color: color,
                  ),
                ),
              ),
            ],
          ),
        );
    return _Card(
      tint: p.hibiscus,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            zh ? '支出' : 'Spent',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: p.inkSoft,
            ),
          ),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              _money(o.exp),
              key: const Key('total-exp'),
              style: TextStyle(
                fontSize: 32,
                height: 1.2,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.5,
                fontFeatures: tabular,
                color: p.ink,
              ),
            ),
          ),
          if (c != null && c.verdict != 'none') ...[
            const SizedBox(height: 8),
            _verdictPill(c, zh),
          ],
          const SizedBox(height: 16),
          Container(height: 1, color: p.line.withValues(alpha: 0.7)),
          const SizedBox(height: 14),
          Row(
            children: [
              figure('inc', zh ? '收入' : 'Income', _money(o.inc), p.leafDeep),
              figure('bal', zh ? '结余' : 'Balance', _money(o.balance), p.ink),
              figure('count', zh ? '笔数' : 'Entries', '${o.count}', p.ink),
            ],
          ),
        ],
      ),
    );
  }

  /// 比上月同期多 ¥x — the verdict is the core's, the words are these.
  String _verdictWords(stats.CompareView c, bool zh) => switch (c.verdict) {
    'more' =>
      zh
          ? '比上月同期多 ${_short(c.diff)}'
          : '${_short(c.diff)} more than this time last month',
    'less' =>
      zh
          ? '比上月同期少 ${_short(c.diff)}'
          : '${_short(c.diff)} less than this time last month',
    _ => zh ? '和上月同期差不多' : 'About the same as last month',
  };

  Widget _verdictPill(stats.CompareView c, bool zh) {
    final p = palette;
    final (icon, fg, bg) = switch (c.verdict) {
      'more' => (
        Icons.arrow_upward_rounded,
        p.hibiscusDeep,
        p.hibiscus.withValues(alpha: 0.1),
      ),
      'less' => (
        Icons.arrow_downward_rounded,
        p.leafDeep,
        p.leaf.withValues(alpha: 0.16),
      ),
      _ => (Icons.drag_handle_rounded, p.inkSoft, p.line.withValues(alpha: .5)),
    };
    return Container(
      key: const Key('compare-verdict'),
      padding: const EdgeInsets.fromLTRB(8, 4, 10, 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(Rad.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: fg),
          const SizedBox(width: 4),
          Text(
            _verdictWords(c, zh),
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              fontFeatures: tabular,
              color: fg,
            ),
          ),
        ],
      ),
    );
  }

  Widget _categoryCard(bool zh) {
    final p = palette;
    final slices = _page.slices;
    final title = _io == 'exp'
        ? (zh ? '花在哪儿了' : 'Where it went')
        : (zh ? '钱从哪儿来' : 'Where it came from');
    if (slices.isEmpty) {
      return _Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _Title(title),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 30),
              child: Center(
                child: Text(
                  zh ? '这段时间没有记录' : 'Nothing in this range',
                  key: const Key('donut-empty'),
                  style: TextStyle(fontSize: 13, color: p.inkSoft),
                ),
              ),
            ),
          ],
        ),
      );
    }
    final total = _io == 'exp' ? _page.overview.exp : _page.overview.inc;
    stats.SliceView? picked;
    for (final s in slices) {
      if (s.cat == _picked) picked = s;
    }
    final centre = picked == null
        ? [
            Text(
              _io == 'exp' ? (zh ? '总支出' : 'Total') : (zh ? '总收入' : 'Total'),
              style: TextStyle(fontSize: 12, color: p.inkSoft),
            ),
            const SizedBox(height: 2),
            Text(
              _money(total),
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                fontFeatures: tabular,
                color: p.ink,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              zh ? '${slices.length} 个分类' : '${slices.length} categories',
              style: TextStyle(fontSize: 11.5, color: p.inkSoft),
            ),
          ]
        : [
            Text(
              '${picked.emoji} ${picked.name}',
              style: TextStyle(fontSize: 12.5, color: p.ink),
            ),
            const SizedBox(height: 2),
            Text(
              _money(picked.amt),
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                fontFeatures: tabular,
                color: parseHex(picked.color),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              '${(picked.frac * 100).round()}%',
              key: const Key('donut-picked'),
              style: TextStyle(fontSize: 11.5, color: p.inkSoft),
            ),
          ];
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Title(title),
          const SizedBox(height: 14),
          Center(
            child: SizedBox(
              width: 184,
              height: 184,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Positioned.fill(
                    child: AnimatedBuilder(
                      animation: _reveal,
                      builder: (_, _) => CustomPaint(
                        key: const Key('donut'),
                        painter: DonutPainter(
                          slices: slices,
                          track: p.line,
                          progress: Curves.easeOutCubic.transform(
                            _reveal.value,
                          ),
                          selected: _picked,
                        ),
                      ),
                    ),
                  ),
                  Column(mainAxisSize: MainAxisSize.min, children: centre),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          for (final sl in slices) _catRow(sl),
        ],
      ),
    );
  }

  Widget _catRow(stats.SliceView sl) {
    final p = palette;
    final color = parseHex(sl.color);
    final dim = _picked != null && _picked != sl.cat;
    return AnimatedOpacity(
      opacity: dim ? 0.45 : 1,
      duration: const Duration(milliseconds: 180),
      child: Tap(
        key: Key('cat-row-${sl.cat}'),
        radius: Rad.md,
        onTap: () =>
            setState(() => _picked = _picked == sl.cat ? null : sl.cat),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.14),
                  shape: BoxShape.circle,
                ),
                child: Text(sl.emoji, style: const TextStyle(fontSize: 17)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        // The name and its share take what the amount leaves.
                        // A `Flexible` beside a `Spacer` split the slack
                        // between them, and the amount landed mid-row.
                        Expanded(
                          child: Row(
                            children: [
                              Flexible(
                                child: Text(
                                  sl.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w600,
                                    color: p.ink,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                '${(sl.frac * 100).round()}%',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontFeatures: tabular,
                                  color: p.inkSoft,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          _money(sl.amt),
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            fontFeatures: tabular,
                            color: p.ink,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 7),
                    AnimatedBuilder(
                      animation: _reveal,
                      builder: (_, _) => Meter(
                        frac: sl.frac,
                        color: color,
                        progress: Curves.easeOutCubic.transform(_reveal.value),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _periodCard(bool zh) {
    final title = switch (_period) {
      'day' => zh ? '近6天' : 'Last 6 days',
      'week' => zh ? '近6周' : 'Last 6 weeks',
      'halfyear' => zh ? '近6个半年' : 'Last 6 halves',
      'year' => zh ? '近6年' : 'Last 6 years',
      _ => zh ? '近6个月' : 'Last 6 months',
    };
    final bars = _page.periods;
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Title(title),
          const SizedBox(height: 14),
          AnimatedBuilder(
            animation: _reveal,
            builder: (_, _) => Columns(
              key: const Key('period-bars'),
              color: _accent,
              progress: Curves.easeOutCubic.transform(_reveal.value),
              items: [
                for (var i = 0; i < bars.length; i++)
                  ColumnItem(
                    label: _bucketLabel(bars[i].start, zh),
                    value: bars[i].total > 0
                        ? money.fmtShort(n: bars[i].total, symbol: '')
                        : '',
                    frac: bars[i].frac,
                    // the window on screen is the last of the six
                    strong: i == bars.length - 1,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _compareCard(stats.CompareView c, bool zh) {
    final p = palette;
    Widget key(Color color, String label, {bool dashed = false}) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 14,
          height: 3,
          decoration: BoxDecoration(
            color: dashed ? null : color,
            border: dashed ? Border.all(color: color, width: 1) : null,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 6),
        Text(
          label,
          style: TextStyle(
            fontSize: 11.5,
            fontFeatures: tabular,
            color: p.inkSoft,
          ),
        ),
      ],
    );
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Title(zh ? '本月 vs 上月同期' : 'This month vs last'),
          if (c.verdict != 'none') ...[
            const SizedBox(height: 4),
            Text(
              _verdictWords(c, zh),
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: switch (c.verdict) {
                  'more' => p.hibiscusDeep,
                  'less' => p.leafDeep,
                  _ => p.inkSoft,
                },
              ),
            ),
          ],
          const SizedBox(height: 14),
          SizedBox(
            height: 120,
            child: AnimatedBuilder(
              animation: _reveal,
              builder: (_, _) => CustomPaint(
                key: const Key('compare'),
                size: Size.infinite,
                painter: LineChartPainter(
                  boxW: c.width,
                  boxH: c.height,
                  zero: c.zero,
                  grid: p.line,
                  ring: p.card,
                  progress: Curves.easeOutCubic.transform(_reveal.value),
                  mark: c.thisLine.isEmpty ? null : c.thisLine.length - 1,
                  series: [
                    Series(
                      line: c.thisLine,
                      curve: c.thisCurve,
                      color: p.hibiscus,
                      fill: true,
                    ),
                    Series(
                      line: c.lastLine,
                      curve: c.lastCurve,
                      color: p.inkSoft.withValues(alpha: 0.55),
                      dashed: true,
                      width: 1.8,
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              key(
                p.hibiscus,
                '${zh ? '本月' : 'This month'} ${_short(c.thisTotal)}',
              ),
              const SizedBox(width: 18),
              key(
                p.inkSoft,
                '${zh ? '上月同期' : 'Last month'} ${_short(c.lastTotal)}',
                dashed: true,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _topCard(bool zh) {
    final p = palette;
    final top = _page.top;
    return _Card(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Title(
            _io == 'exp'
                ? (zh ? '最大支出' : 'Largest expenses')
                : (zh ? '最大收入' : 'Largest income'),
          ),
          const SizedBox(height: 8),
          for (var i = 0; i < top.length; i++)
            Tap(
              key: Key('top-${top[i].id}'),
              radius: Rad.md,
              onTap: widget.onEdit == null
                  ? null
                  : () => widget.onEdit!(top[i].id),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    SizedBox(
                      width: 22,
                      child: Text(
                        '${i + 1}',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          fontFeatures: tabular,
                          color: i == 0 ? _accent : p.inkSoft,
                        ),
                      ),
                    ),
                    Container(
                      width: 34,
                      height: 34,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: parseHex(top[i].color).withValues(alpha: 0.14),
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        top[i].emoji,
                        style: const TextStyle(fontSize: 16),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            top[i].note.trim().isEmpty
                                ? top[i].catName
                                : top[i].note.trim(),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: p.ink,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '${top[i].catName} · ${_dayWords(top[i].day, zh)}',
                            style: TextStyle(fontSize: 11.5, color: p.inkSoft),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      _money(top[i].amt),
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        fontFeatures: tabular,
                        color: p.ink,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _habitCard(List<stats.BarView> bars, bool zh) {
    const zhDay = {
      '1': '周一',
      '2': '周二',
      '3': '周三',
      '4': '周四',
      '5': '周五',
      '6': '周六',
      '0': '周日',
    };
    const enDay = {
      '1': 'Mon',
      '2': 'Tue',
      '3': 'Wed',
      '4': 'Thu',
      '5': 'Fri',
      '6': 'Sat',
      '0': 'Sun',
    };
    const zhTime = {
      'dawn': '凌晨',
      'earlyMorning': '清晨',
      'morning': '上午',
      'noon': '中午',
      'afternoon': '下午',
      'dusk': '傍晚',
      'night': '晚上',
    };
    const enTime = {
      'dawn': 'Dawn',
      'earlyMorning': 'Early',
      'morning': 'Morn',
      'noon': 'Noon',
      'afternoon': 'Aftn',
      'dusk': 'Dusk',
      'night': 'Night',
    };
    // The core buckets weekdays Sunday-first, as `getDay()` counts; the week
    // this app draws everywhere else runs Monday to Sunday.
    final shown = _byHour
        ? bars
        : [
            for (final k in ['1', '2', '3', '4', '5', '6', '0'])
              ...bars.where((b) => b.key == k),
          ];
    final names = _byHour ? (zh ? zhTime : enTime) : (zh ? zhDay : enDay);
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: _Title(
                  _io == 'exp'
                      ? (zh ? '什么时候花的' : 'When it was spent')
                      : (zh ? '什么时候进账' : 'When it came in'),
                ),
              ),
              SizedBox(
                width: 132,
                child: Segmented(
                  keyPrefix: 'habit',
                  compact: true,
                  value: _byHour ? 'hour' : 'weekday',
                  onChanged: (v) => setState(() => _byHour = v == 'hour'),
                  items: [
                    ('weekday', zh ? '星期' : 'Day'),
                    ('hour', zh ? '时段' : 'Time'),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          AnimatedBuilder(
            animation: _reveal,
            builder: (_, _) => Columns(
              key: const Key('habit-bars'),
              color: _accent,
              height: 124,
              progress: Curves.easeOutCubic.transform(_reveal.value),
              items: [
                for (final b in shown)
                  ColumnItem(
                    label: names[b.key] ?? b.key,
                    value: b.amt > 0
                        ? money.fmtShort(n: b.amt, symbol: '')
                        : '',
                    frac: b.frac,
                    // the busiest is the one at full height
                    strong: b.frac >= 1,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The trend, with a finger that can read it.
class _TrendCard extends StatefulWidget {
  const _TrendCard({
    super.key,
    required this.trend,
    required this.color,
    required this.reveal,
    required this.title,
    required this.money,
    required this.tickLabel,
    required this.pointLabel,
    required this.peakWord,
    required this.empty,
  });

  final stats.TrendView trend;
  final Color color;
  final Animation<double> reveal;
  final String title;
  final String Function(double) money;
  final String Function(double) tickLabel;
  final String Function(int) pointLabel;
  final String peakWord;
  final String empty;

  @override
  State<_TrendCard> createState() => _TrendCardState();
}

class _TrendCardState extends State<_TrendCard> {
  /// The point under the finger, or the last one touched.
  int? _at;

  void _touch(Offset local, double width) {
    final t = widget.trend;
    if (t.points.isEmpty || width <= 0) return;
    // the finger in the core's box, which is the only scale this side knows
    final i = stats.indexAt(x: local.dx / width * t.width, n: t.points.length);
    if (i == null || i == _at) return;
    HapticFeedback.selectionClick();
    setState(() => _at = i);
  }

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final t = widget.trend;
    final at = _at;
    final readout = at != null
        ? '${widget.pointLabel(at)}  ${widget.money(t.values[at])}'
        : t.peak != null
        ? '${widget.peakWord} ${widget.money(t.values[t.peak!])} · '
              '${widget.pointLabel(t.peak!)}'
        : '';
    final labels = [for (final k in t.ticks) widget.tickLabel(k.value)];
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _Title(widget.title),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  readout,
                  key: const Key('trend-readout'),
                  textAlign: TextAlign.right,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    fontFeatures: tabular,
                    fontWeight: at != null ? FontWeight.w600 : FontWeight.w400,
                    color: at != null ? widget.color : p.inkSoft,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          LayoutBuilder(
            builder: (context, c) => GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTapDown: (d) => _touch(d.localPosition, c.maxWidth),
              onHorizontalDragStart: (d) => _touch(d.localPosition, c.maxWidth),
              onHorizontalDragUpdate: (d) =>
                  _touch(d.localPosition, c.maxWidth),
              child: SizedBox(
                height: 150,
                child: Stack(
                  children: [
                    Positioned.fill(
                      child: AnimatedBuilder(
                        animation: widget.reveal,
                        builder: (_, _) => CustomPaint(
                          key: const Key('trend'),
                          painter: LineChartPainter(
                            boxW: t.width,
                            boxH: t.height,
                            zero: t.zero,
                            ticks: t.ticks,
                            tickLabels: labels,
                            labelStyle: TextStyle(
                              fontSize: 10,
                              fontFeatures: tabular,
                              color: p.inkSoft.withValues(alpha: 0.8),
                            ),
                            grid: p.line,
                            ring: p.card,
                            progress: Curves.easeOutCubic.transform(
                              widget.reveal.value,
                            ),
                            mark: at ?? t.peak,
                            guide: at != null,
                            series: [
                              Series(
                                line: t.line,
                                curve: t.curve,
                                color: widget.color,
                                fill: true,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    if (t.peak == null)
                      Center(
                        child: Text(
                          widget.empty,
                          style: TextStyle(fontSize: 12.5, color: p.inkSoft),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          // The ends of the range, and nothing between them: every day
          // labelled reads at seven and does not at ninety.
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                _StatsScreenState._md(t.from),
                key: const Key('axis-first'),
                style: TextStyle(
                  fontSize: 10.5,
                  fontFeatures: tabular,
                  color: p.inkSoft,
                ),
              ),
              Text(
                _StatsScreenState._md(t.end),
                key: const Key('axis-last'),
                style: TextStyle(
                  fontSize: 10.5,
                  fontFeatures: tabular,
                  color: p.inkSoft,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A card on this screen: the app's card, lifted a little off the paper.
class _Card extends StatelessWidget {
  const _Card({
    required this.child,
    this.padding = const EdgeInsets.fromLTRB(18, 16, 18, 16),
    this.tint,
  });

  final Widget child;
  final EdgeInsets padding;

  /// A wash of colour from the top corner, for the one card that leads.
  final Color? tint;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: tint == null ? p.card : null,
        gradient: tint == null
            ? null
            : LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Color.alphaBlend(tint!.withValues(alpha: 0.08), p.card),
                  p.card,
                ],
              ),
        borderRadius: BorderRadius.circular(Rad.lg),
        border: Border.all(color: p.line.withValues(alpha: 0.8)),
        boxShadow: [
          BoxShadow(
            // the theme's shadow is an opaque brown; the alpha is the shadow
            color: parseHex(
              p.shadowHex,
            ).withValues(alpha: p.isDark ? 0.28 : 0.05),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: child,
    );
  }
}

class _Title extends StatelessWidget {
  const _Title(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: TextStyle(
      fontSize: 15,
      fontWeight: FontWeight.w700,
      color: palette.ink,
    ),
  );
}
