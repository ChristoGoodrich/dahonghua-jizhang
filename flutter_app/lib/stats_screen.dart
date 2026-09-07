// Statistics, in Dart over the Rust totals and the Rust geometry.
//
// The first non-text drawing in this build, and the interesting part is that
// the painters do no arithmetic. `chart_points` hands back coordinates in a
// 300×96 box and the painter scales that box to its canvas; `category_slices`
// hands back a start and a fraction per arc. Neither painter knows what a
// maximum is, what an empty series should do, or how a total divides.
//
// That matters more here than on the other screens. A chart is the easiest
// place in an app to be confidently wrong: a line is drawn either way, and
// nothing about a wrong one looks wrong.

import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'src/rust/api/money.dart' as money;
import 'src/rust/api/period.dart' as period;
import 'src/rust/api/stats.dart' as stats;
import 'src/rust/api/store.dart' as store;
import 'tap.dart';
import 'theme.dart';

/// `y-m-d` for a local calendar day — the one conversion that needs a timezone,
/// and therefore the one this side does.
String _day(DateTime d) => '${d.year}-${d.month}-${d.day}';

class StatsScreen extends StatefulWidget {
  const StatsScreen({super.key, this.zh = true});

  final bool zh;

  @override
  State<StatsScreen> createState() => _StatsScreenState();
}

class _StatsScreenState extends State<StatsScreen> {
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

  late stats.OverviewView _overview;
  List<stats.TrendPointView> _points = const [];
  late stats.ChartView _chart;
  List<stats.SliceView> _slices = const [];

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    final live = store.liveEntries();
    final ids = live.map((e) => e.id).toList();
    final days = live
        .map((e) => _day(DateTime.fromMillisecondsSinceEpoch(e.ts)))
        .toList();

    final win = period.periodWindow(anchor: _anchor, period: _period);
    // Everything on this screen is about the window, so the window is what the
    // ids are narrowed to before anything is counted. Passing the whole ledger
    // to the totals and the donut — which is what this screen used to do — made
    // them say something different from the chart above them.
    final inWin = period
        .idsInPeriod(ids: ids, daysOf: days, anchor: _anchor, period: _period)
        .toSet();
    final kept = [
      for (var i = 0; i < ids.length; i++)
        if (inWin.contains(ids[i])) i,
    ];
    final winIds = [for (final i in kept) ids[i]];
    final winDays = [for (final i in kept) days[i]];

    // The trend counts back from a day, so it counts back from the END of the
    // window rather than from today — otherwise stepping to last month would
    // move the totals and leave the chart where it was.
    //
    // Except for the window we are still inside, which stops at today. A chart
    // that ran to the end of the month would end in a flat tail of days that
    // have not happened, and a flat tail reads as spending having stopped.
    final (axisEnd, span) = _clampToToday(win);
    final points = stats.dailyTrend(
      ids: winIds,
      daysOf: winDays,
      days: span,
      today: axisEnd,
    );
    setState(() {
      _win = win;
      _overview = stats.overview(ids: winIds);
      _points = points;
      _chart = stats.chartPoints(points: points, series: 'both');
      _slices = stats.categorySlices(ids: winIds, io: _io, zh: widget.zh);
    });
  }

  void _step(int dir) {
    setState(
      () => _anchor = period.stepPeriod(
        anchor: _anchor,
        period: _period,
        dir: dir,
      ),
    );
    _reload();
  }

  void _setPeriod(String p) {
    setState(() {
      _period = p;
      // Back to now when the window changes: the anchor was chosen inside a
      // window that no longer exists, and landing in an arbitrary month is
      // harder to explain than landing in this one.
      _anchor = _day(DateTime.now());
    });
    _reload();
  }

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

  /// The window's axis end, and how many days of it to draw.
  ///
  /// A window entirely in the future is left alone: there is nothing to clamp
  /// to and a negative span would be worse than an empty chart.
  (String, int) _clampToToday(period.WindowView w) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final start = _parse(w.start);
    final last = _parse(w.last);
    if (!today.isBefore(last) || today.isBefore(start)) {
      return (w.last, w.days);
    }
    return (_day(today), today.difference(start).inDays + 1);
  }

  static DateTime _parse(String ymd) {
    final p = ymd.split('-').map(int.parse).toList();
    return DateTime(p[0], p[1], p[2]);
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return Scaffold(
      backgroundColor: palette.paper,
      appBar: AppBar(
        backgroundColor: palette.paper,
        surfaceTintColor: Colors.transparent,
        title: Text(
          zh ? '统计' : 'Stats',
          style: TextStyle(
            color: palette.ink,
            fontSize: 20,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(22, 6, 22, 120),
        children: [
          _totals(zh),
          const SizedBox(height: 16),
          _windowPicker(zh),
          const SizedBox(height: 10),
          _trendCard(zh),
          const SizedBox(height: 18),
          _directionPicker(zh),
          const SizedBox(height: 10),
          _donutCard(zh),
        ],
      ),
    );
  }

  Widget _totals(bool zh) {
    final sym = zh ? '￥' : '\$';
    // keyed: the same amount can legitimately appear in the donut legend below,
    // and a finder that goes by text cannot say which one it means
    Widget cell(String key, String label, double v, Color c) => Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(fontSize: 12, color: palette.inkSoft)),
          const SizedBox(height: 3),
          Text(
            money.fmt(n: v, symbol: sym),
            key: Key('total-$key'),
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              fontFeatures: tabular,
              color: c,
            ),
          ),
        ],
      ),
    );
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: palette.card,
        borderRadius: BorderRadius.circular(Rad.lg),
        border: Border.all(color: palette.line),
      ),
      child: Row(
        children: [
          cell('exp', zh ? '支出' : 'Expense', _overview.exp, palette.hibiscus),
          cell('inc', zh ? '收入' : 'Income', _overview.inc, palette.leafDeep),
          cell('bal', zh ? '结余' : 'Balance', _overview.balance, palette.ink),
        ],
      ),
    );
  }

  static const _periods = ['day', 'week', 'month', 'halfyear', 'year'];

  String _periodName(String p, bool zh) => switch (p) {
    'day' => zh ? '日' : 'Day',
    'week' => zh ? '周' : 'Week',
    'halfyear' => zh ? '半年' : 'Half',
    'year' => zh ? '年' : 'Year',
    _ => zh ? '月' : 'Month',
  };

  Widget _windowPicker(bool zh) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Wrap(
        spacing: 8,
        runSpacing: 6,
        children: [
          for (final p in _periods)
            Tap(
              radius: Rad.pill,
              key: Key('period-$p'),
              onTap: () => _setPeriod(p),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 13,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: _period == p ? palette.card : Colors.transparent,
                  borderRadius: BorderRadius.circular(Rad.pill),
                  border: Border.all(
                    color: _period == p ? palette.stamen : palette.line,
                  ),
                ),
                child: Text(
                  _periodName(p, zh),
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: _period == p
                        ? FontWeight.w700
                        : FontWeight.w500,
                    color: palette.ink,
                  ),
                ),
              ),
            ),
        ],
      ),
      const SizedBox(height: 8),
      Row(
        children: [
          IconButton(
            key: const Key('period-prev'),
            visualDensity: VisualDensity.compact,
            icon: Icon(Icons.chevron_left, color: palette.inkSoft, size: 20),
            onPressed: () => _step(-1),
          ),
          Expanded(
            child: Text(
              _windowLabel(zh),
              key: const Key('period-label'),
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: palette.ink),
            ),
          ),
          IconButton(
            key: const Key('period-next'),
            visualDensity: VisualDensity.compact,
            icon: Icon(Icons.chevron_right, color: palette.inkSoft, size: 20),
            onPressed: () => _step(1),
          ),
        ],
      ),
    ],
  );

  Widget _trendCard(bool zh) => Container(
    padding: const EdgeInsets.fromLTRB(6, 12, 6, 8),
    decoration: BoxDecoration(
      color: palette.card,
      borderRadius: BorderRadius.circular(Rad.lg),
      border: Border.all(color: palette.line),
    ),
    child: Column(
      children: [
        SizedBox(
          height: 120,
          child: CustomPaint(
            key: const Key('trend'),
            size: Size.infinite,
            painter: _TrendPainter(
              chart: _chart,
              expColor: palette.hibiscus,
              incColor: palette.leafDeep,
            ),
          ),
        ),
        _axis(),
        const SizedBox(height: 6),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _legend(palette.hibiscus, zh ? '支出' : 'Expense'),
            const SizedBox(width: 16),
            _legend(palette.leafDeep, zh ? '收入' : 'Income'),
          ],
        ),
      ],
    ),
  );

  /// The ends of the range, and nothing between them.
  ///
  /// The React Native chart labels every point, which reads at seven and does
  /// not at ninety. The days come from Rust — one per bucket including the
  /// empty ones — so what is chosen here is how many of them to print, not
  /// which days exist.
  Widget _axis() {
    if (_points.isEmpty) return const SizedBox.shrink();
    String md(String ymd) {
      final p = ymd.split('-');
      return '${p[1]}/${p[2]}';
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            md(_points.first.day),
            key: const Key('axis-first'),
            style: TextStyle(
              fontSize: 10,
              fontFeatures: tabular,
              color: palette.inkSoft,
            ),
          ),
          Text(
            md(_points.last.day),
            key: const Key('axis-last'),
            style: TextStyle(
              fontSize: 10,
              fontFeatures: tabular,
              color: palette.inkSoft,
            ),
          ),
        ],
      ),
    );
  }

  Widget _legend(Color c, String label) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(width: 14, height: 3, color: c),
      const SizedBox(width: 5),
      Text(label, style: TextStyle(fontSize: 11, color: palette.inkSoft)),
    ],
  );

  Widget _directionPicker(bool zh) => Row(
    children: [
      for (final io in ['exp', 'inc'])
        Padding(
          padding: const EdgeInsets.only(right: 8),
          child: GestureDetector(
            key: Key('io-$io'),
            onTap: () {
              setState(() => _io = io);
              _reload();
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 6),
              decoration: BoxDecoration(
                color: _io == io ? palette.card : Colors.transparent,
                borderRadius: BorderRadius.circular(Rad.pill),
                border: Border.all(
                  color: _io == io ? palette.stamen : palette.line,
                ),
              ),
              child: Text(
                io == 'exp'
                    ? (zh ? '支出构成' : 'Expense')
                    : (zh ? '收入构成' : 'Income'),
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: _io == io ? FontWeight.w700 : FontWeight.w500,
                  color: palette.ink,
                ),
              ),
            ),
          ),
        ),
    ],
  );

  Widget _donutCard(bool zh) {
    if (_slices.isEmpty) {
      return Container(
        padding: const EdgeInsets.symmetric(vertical: 34),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: palette.card,
          borderRadius: BorderRadius.circular(Rad.lg),
          border: Border.all(color: palette.line),
        ),
        child: Text(
          zh ? '这段时间没有记录' : 'Nothing in this range',
          key: const Key('donut-empty'),
          style: TextStyle(fontSize: 13, color: palette.inkSoft),
        ),
      );
    }
    final sym = zh ? '￥' : '\$';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: palette.card,
        borderRadius: BorderRadius.circular(Rad.lg),
        border: Border.all(color: palette.line),
      ),
      child: Column(
        children: [
          SizedBox(
            width: 168,
            height: 168,
            child: CustomPaint(
              key: const Key('donut'),
              painter: _DonutPainter(slices: _slices, track: palette.line),
            ),
          ),
          const SizedBox(height: 14),
          for (final sl in _slices.take(6))
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                children: [
                  Container(
                    width: 9,
                    height: 9,
                    decoration: BoxDecoration(
                      color: parseHex(sl.color),
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '${sl.emoji} ${sl.name}',
                    style: TextStyle(fontSize: 13, color: palette.ink),
                  ),
                  const Spacer(),
                  Text(
                    '${(sl.frac * 100).round()}%',
                    style: TextStyle(
                      fontSize: 12,
                      fontFeatures: tabular,
                      color: palette.inkSoft,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    money.fmt(n: sl.amt, symbol: sym),
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      fontFeatures: tabular,
                      color: palette.ink,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Draws the trend line from coordinates Rust computed.
///
/// The only arithmetic here is the scale from the core's 300×96 box to this
/// canvas — everything that decides *where a point goes* happened on the other
/// side of the boundary.
class _TrendPainter extends CustomPainter {
  _TrendPainter({
    required this.chart,
    required this.expColor,
    required this.incColor,
  });

  final stats.ChartView chart;
  final Color expColor;
  final Color incColor;

  @override
  void paint(Canvas canvas, Size size) {
    final sx = size.width / chart.width;
    final sy = size.height / chart.height;

    void line(List<stats.ChartPoint> pts, Color c) {
      if (pts.isEmpty) return;
      final path = Path();
      for (var i = 0; i < pts.length; i++) {
        final x = pts[i].x * sx;
        final y = pts[i].y * sy;
        // a NaN coordinate is what a NaN in the data looks like by the time it
        // reaches here; drawing nothing is honest, drawing a line is not
        if (x.isNaN || y.isNaN) return;
        i == 0 ? path.moveTo(x, y) : path.lineTo(x, y);
      }
      canvas.drawPath(
        path,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.2
          ..strokeJoin = StrokeJoin.round
          ..color = c,
      );
      for (final p in pts) {
        canvas.drawCircle(Offset(p.x * sx, p.y * sy), 2.6, Paint()..color = c);
      }
    }

    line(chart.inc, incColor);
    line(chart.exp, expColor);
  }

  @override
  bool shouldRepaint(_TrendPainter old) => old.chart != chart;
}

/// Draws the category donut from the fractions Rust computed.
class _DonutPainter extends CustomPainter {
  _DonutPainter({required this.slices, required this.track});

  final List<stats.SliceView> slices;
  final Color track;

  static const double stroke = 24;

  @override
  void paint(Canvas canvas, Size size) {
    final r = (size.width - stroke) / 2;
    final c = Offset(size.width / 2, size.height / 2);
    final rect = Rect.fromCircle(center: c, radius: r);

    canvas.drawCircle(
      c,
      r,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..color = track.withValues(alpha: 0.4),
    );

    // −90° so the first slice starts at twelve o'clock, which is the rotation
    // the SVG version applies to the whole group
    for (final sl in slices) {
      canvas.drawArc(
        rect,
        -math.pi / 2 + sl.start * 2 * math.pi,
        sl.frac * 2 * math.pi,
        false,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = stroke
          ..color = parseHex(sl.color),
      );
    }
  }

  @override
  bool shouldRepaint(_DonutPainter old) => old.slices != slices;
}
