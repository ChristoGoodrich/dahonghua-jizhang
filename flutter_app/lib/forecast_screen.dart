// 下月预测 — the next cycle's spending, from the three before this one.
//
// The shipping app had this as 洞察 (`src/app/insights.tsx`), and the README
// went on listing it after the port dropped it. The arithmetic is
// `core::forecast`: a straight line through the last three cycles' totals,
// read one cycle on, and the same per category. This screen draws it and
// says, in the shipping words, what the trend suggests.
//
// Not called AI, as the shipping title had it: nothing here asks a model.

import 'package:flutter/material.dart';

import 'amounts.dart';
import 'entry_list.dart' show localDay;
import 'glass.dart';
import 'ledger_days.dart';
import 'src/rust/api/forecast.dart' as fc;
import 'theme.dart';

class ForecastScreen extends StatelessWidget {
  const ForecastScreen({super.key, this.zh = true});

  final bool zh;

  @override
  Widget build(BuildContext context) {
    final l = LedgerDays.current();
    final f = fc.nextCycleForecast(
      ids: l.ids,
      daysOf: l.days,
      today: localDay(DateTime.now()),
      zh: zh,
    );
    final p = palette;
    return ScrimScaffold(
      title: Text(
        zh ? '下月预测' : 'Next cycle',
        style: TextStyle(
          color: p.ink,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),
      body: ListView(
        padding: EdgeInsets.fromLTRB(22, headerInset(context) + 6, 22, 120),
        children: [
          if (!f.enough)
            _card(
              Text(
                zh
                    ? '前三个周期还没有支出，多记几笔再来看'
                    : 'No spending in the three cycles before this one yet — '
                          'keep recording',
                key: const Key('forecast-empty'),
                style: TextStyle(fontSize: 13, color: p.inkSoft),
              ),
            )
          else ...[
            _headline(f),
            if (f.breakdown.isNotEmpty) ...[
              const SizedBox(height: 18),
              _heading(zh ? '分类预测' : 'By category'),
              _card(
                Column(children: [for (final c in f.breakdown) _catRow(c)]),
              ),
            ],
            const SizedBox(height: 18),
            _heading(zh ? '建议' : 'Tips'),
            _card(
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final t in _tips(f.trend))
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Text(
                        '· $t',
                        style: TextStyle(fontSize: 13, color: p.ink),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _headline(fc.ForecastView f) {
    final p = palette;
    // Rising is the warning, in `warn` rather than the flower: in 森林 the
    // flower is the leaf's green, and spending more is not "on track".
    final (trendWord, tone) = switch (f.trend) {
      'increasing' => (zh ? '上升 ↑' : 'Rising ↑', p.warnDeep),
      'decreasing' => (zh ? '下降 ↓' : 'Falling ↓', p.leafDeep),
      _ => (zh ? '持平 →' : 'Flat →', p.inkSoft),
    };
    return _card(
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            zh ? '下个周期预计花' : 'Next cycle, expected',
            style: TextStyle(fontSize: 12, color: p.inkSoft),
          ),
          const SizedBox(height: 4),
          Text(
            shownBase(f.predicted),
            key: const Key('forecast-amount'),
            style: TextStyle(
              fontSize: 30,
              fontWeight: FontWeight.w800,
              fontFeatures: tabular,
              color: p.ink,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            zh ? '根据前三个周期的花销趋势' : 'From the trend of the last three cycles',
            style: TextStyle(fontSize: 11.5, color: p.inkSoft),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Text(
                zh ? '趋势' : 'Trend',
                style: TextStyle(fontSize: 12, color: p.inkSoft),
              ),
              const SizedBox(width: 8),
              Text(
                trendWord,
                key: const Key('forecast-trend'),
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: tone,
                ),
              ),
              const Spacer(),
              Text(
                zh ? '可信度' : 'Confidence',
                style: TextStyle(fontSize: 12, color: p.inkSoft),
              ),
              const SizedBox(width: 8),
              Text(
                '${(f.confidence * 100).round()}%',
                key: const Key('forecast-confidence'),
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  fontFeatures: tabular,
                  color: p.ink,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _catRow(fc.CatForecastView c) {
    final p = palette;
    return Padding(
      key: Key('forecast-cat-${c.cat}'),
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${c.emoji} ${c.name}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 13.5, color: p.ink),
                ),
              ),
              Text(
                shownBase(c.predicted),
                style: TextStyle(
                  fontSize: 12.5,
                  fontFeatures: tabular,
                  color: p.inkSoft,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(Rad.pill),
            child: LinearProgressIndicator(
              value: c.share,
              minHeight: 6,
              backgroundColor: p.paperWarm,
              valueColor: AlwaysStoppedAnimation(parseHex(c.color)),
            ),
          ),
        ],
      ),
    );
  }

  /// The shipping screen's two tips for each trend.
  List<String> _tips(String trend) => switch (trend) {
    'increasing' =>
      zh
          ? ['支出有上升趋势，看看大额分类有没有压缩的空间', '试试给重点分类设上限，在「预算」里']
          : [
              'Spending is rising — look at the large categories for room',
              'Try a cap on the key categories, in Budget',
            ],
    'decreasing' =>
      zh
          ? ['支出在下降，继续保持', '可以把省下来的存起来']
          : ['Spending is falling — keep it up', 'Put what it saves aside'],
    _ =>
      zh
          ? ['花销很稳定，适合定一个固定预算', '翻翻分类明细，看看有没有可以优化的地方']
          : [
              'Spending is steady — a good time for a fixed budget',
              'Look through the categories for what could be trimmed',
            ],
  };

  Widget _heading(String text) => Padding(
    padding: const EdgeInsets.only(left: 2, bottom: 8),
    child: Text(
      text,
      style: TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w700,
        color: palette.inkSoft,
      ),
    ),
  );

  Widget _card(Widget child) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: palette.card,
      borderRadius: BorderRadius.circular(Rad.lg),
      border: Border.all(color: palette.line),
    ),
    child: child,
  );
}
