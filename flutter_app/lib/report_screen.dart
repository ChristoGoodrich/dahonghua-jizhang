// 回顾 — what the cycle came to, how the week is going, and the one sentence
// worth putting at the top.
//
// Three core modules behind one screen. None of the arithmetic is here; what is
// here is the reader's language, which the core deliberately does not carry —
// the insight sentences arrive as templates with markers, and Rust fills them.
//
// Two shapes the screen reproduces rather than tidies. The recap's `count`
// includes transfers though neither total does, because it answers "how many
// rows are in this cycle" and not "how many moved money one way". And the
// insight is usually ABSENT: fewer than three expenses produces nothing, since
// a sentence about two rows is noise.

import 'package:flutter/material.dart';

import 'src/rust/api/budget.dart' as budget;
import 'src/rust/api/catalog.dart' as catalog;
import 'src/rust/api/money.dart' as money;
import 'src/rust/api/report.dart' as report;
import 'src/rust/api/store.dart' as store;
import 'theme.dart';

/// `YYYY-M-D`, a **1-indexed** month — the spelling `parse_day` on the other
/// side expects, and not the 0-indexed one the subscription cursor uses.
String reportDay(DateTime d) => '${d.year}-${d.month}-${d.day}';

/// The sentences the banner is built from.
///
/// Intl, so they live here rather than in the core. Each marker is filled once,
/// left to right: `%s` a name, `%d` a whole number, `%a` and `%b` amounts, `%w`
/// a timing phrase.
report.InsightCopyView insightCopy(bool zh) => zh
    ? const report.InsightCopyView(
        overBudget: '预算已经花完了',
        nearBudget: '预算用掉 %d%,悠着点',
        dailyOver: '今天超了 %s',
        catOver: '%s 花了 %a,超过 %b 的上限',
        topCat: '%s 占了这个周期的 %d%',
        creditDue: '%s %w 要还 %a',
        daysLeft: '还有 %d 天',
        dueToday: '今天',
        overdue: '已逾期 %d 天',
      )
    : const report.InsightCopyView(
        overBudget: 'The budget is spent',
        nearBudget: '%d% of the budget is gone',
        dailyOver: '%s over today',
        catOver: '%s is at %a, past its %b cap',
        topCat: '%s is %d% of this cycle',
        creditDue: '%s: %a due %w',
        daysLeft: 'in %d days',
        dueToday: 'today',
        overdue: '%d days overdue',
      );

class ReportScreen extends StatefulWidget {
  const ReportScreen({super.key, this.zh = true});

  final bool zh;

  @override
  State<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends State<ReportScreen> {
  late report.RecapView _recap;
  late report.WeeklyView _week;
  report.InsightView? _insight;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    final all = store.liveEntries();
    final ids = all.map((e) => e.id).toList();
    final days = all
        .map((e) => reportDay(DateTime.fromMillisecondsSinceEpoch(e.ts)))
        .toList();
    final today = reportDay(DateTime.now());

    // The cycle is not the calendar month — it turns over on `cycleStart` — so
    // which entries count is the core's answer, not a date range built here.
    final cycle = budget.cycleIds(ids: ids, daysOf: days, today: today);
    final cycleDays = [
      for (var i = 0; i < ids.length; i++)
        if (cycle.contains(ids[i])) days[i],
    ];

    setState(() {
      _recap = report.recap(ids: cycle, daysOf: cycleDays);
      // The week is Sunday to Sunday and is NOT the cycle, so it reads the
      // whole ledger rather than the cycle's slice.
      _week = report.weekly(
        ids: ids,
        daysOf: days,
        weeklyBudget: budget.settings().dailyBudget * 7,
        today: today,
      );
      _insight = report.insight(
        ids: cycle,
        daysOf: cycleDays,
        today: today,
        zh: widget.zh,
        copy: insightCopy(widget.zh),
      );
    });
  }

  String _m(double v) => money.fmt(n: v, symbol: widget.zh ? '￥' : '\$');

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return Scaffold(
      backgroundColor: palette.paper,
      appBar: AppBar(
        backgroundColor: palette.paper,
        surfaceTintColor: Colors.transparent,
        title: Text(zh ? '回顾' : 'Report',
            style: TextStyle(
                color: palette.ink, fontSize: 20, fontWeight: FontWeight.w700)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(22, 6, 22, 120),
        children: [
          if (_insight != null) _banner(_insight!),
          _recapCard(zh),
          const SizedBox(height: 16),
          _weekCard(zh),
        ],
      ),
    );
  }

  /// One sentence, when there is one worth saying.
  Widget _banner(report.InsightView i) => Container(
        key: const Key('insight'),
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: palette.stamen.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(Rad.md),
          border: Border.all(color: palette.stamen.withValues(alpha: 0.4)),
        ),
        child: Row(children: [
          Text(i.icon, style: const TextStyle(fontSize: 18)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(i.text,
                key: const Key('insight-text'),
                style: TextStyle(fontSize: 13.5, color: palette.ink)),
          ),
        ]),
      );

  Widget _recapCard(bool zh) {
    final top = _recap.topCat;
    final topName = top == null
        ? null
        : catalog.catName(
            cat: catalog.catOf(io: 'exp', key: top, custom: const []),
            zh: zh,
          );
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
      decoration: BoxDecoration(
        color: palette.card,
        borderRadius: BorderRadius.circular(Rad.lg),
        border: Border.all(color: palette.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(zh ? '这个周期' : 'This cycle',
              style: TextStyle(fontSize: 12, color: palette.inkSoft)),
          const SizedBox(height: 4),
          Text(
            _m(_recap.net),
            key: const Key('recap-net'),
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.w700,
              fontFeatures: tabular,
              // a negative net is the ordinary case for most months, so it is
              // coloured rather than alarmed about
              color: _recap.net < 0 ? palette.ink : palette.leafDeep,
            ),
          ),
          const SizedBox(height: 14),
          Row(children: [
            Expanded(child: _stat(zh ? '支出' : 'Spent', _m(_recap.exp), 'recap-exp')),
            Expanded(child: _stat(zh ? '收入' : 'Earned', _m(_recap.inc), 'recap-inc')),
          ]),
          const SizedBox(height: 12),
          Row(children: [
            // `count` includes transfers though neither total does — it is how
            // many rows there are, not how many moved money one way
            Expanded(
                child: _stat(zh ? '笔数' : 'Entries', '${_recap.count}',
                    'recap-count')),
            Expanded(
                child: _stat(zh ? '有记录的天' : 'Active days',
                    '${_recap.activeDays}', 'recap-days')),
          ]),
          if (topName != null) ...[
            const SizedBox(height: 12),
            _stat(
              zh ? '花得最多' : 'Biggest',
              '$topName · ${_m(_recap.topCatAmt)}',
              'recap-top',
            ),
          ],
        ],
      ),
    );
  }

  Widget _weekCard(bool zh) {
    final unset = _week.dailyBudget <= 0;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      decoration: BoxDecoration(
        color: palette.card,
        borderRadius: BorderRadius.circular(Rad.lg),
        border: Border.all(color: palette.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(zh ? '这一周' : 'This week',
              style: TextStyle(fontSize: 12, color: palette.inkSoft)),
          const SizedBox(height: 4),
          Text(
            _m(_week.spent),
            key: const Key('week-spent'),
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              fontFeatures: tabular,
              color: palette.ink,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            unset
                // A weekly budget of zero is UNSET, not "nothing allowed" —
                // the same rule the budget screen is built on.
                ? (zh ? '未设每周上限' : 'No weekly budget set')
                : _week.over
                    ? (zh
                        ? '超出 ${_m(-_week.remaining)} · 还剩 ${_week.daysLeft} 天'
                        : '${_m(-_week.remaining)} over · ${_week.daysLeft} days left')
                    : (zh
                        ? '还剩 ${_m(_week.remaining)} · ${_week.daysLeft} 天'
                        : '${_m(_week.remaining)} left · ${_week.daysLeft} days'),
            key: const Key('week-text'),
            style: TextStyle(
              fontSize: 12.5,
              color: _week.over ? palette.hibiscus : palette.inkSoft,
            ),
          ),
        ],
      ),
    );
  }

  Widget _stat(String label, String value, String key) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(fontSize: 11.5, color: palette.inkSoft)),
          const SizedBox(height: 1),
          Text(value,
              key: Key(key),
              style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  fontFeatures: tabular,
                  color: palette.ink)),
        ],
      );
}
