// 桌面小组件 — the budget, on a home screen.
//
// Three layers, and the split is the same one everything else here takes.
// `core::budget::tier_status` decides what the numbers are (4,210 parity
// cases). This file renders them into strings, because a currency and a label
// are locale text and that has belonged to the UI since `money.rs`. The Kotlin
// draws, and does nothing else.
//
// The React Native build put the arithmetic AND the formatting in the Kotlin,
// which is how it ended up with two defects nobody chose — see below.
//
// A widget process is not the app's process. The launcher spins it up long
// after the app has been killed, so it can only read what was left behind;
// everything here is about leaving the right thing behind.

import 'package:flutter/services.dart';

import 'amounts.dart' as amounts;
import 'src/rust/api/budget.dart' as budget;
import 'src/rust/api/store.dart' as store;

/// What the widget is told. Everything is already decided and already
/// formatted — the Kotlin has no way to disagree with the app because it is
/// given nothing to disagree with.
class WidgetData {
  const WidgetData({
    required this.title,
    required this.spent,
    required this.left,
    required this.pct,
    required this.over,
    required this.hasBudget,
  });

  final String title;
  final String spent;
  final String left;

  /// Rounded, and NOT clamped. The Kotlin clamps for the progress bar; `over`
  /// carries what a clamp would destroy, since 100% and 140% both draw a full
  /// bar and mean different things.
  final int pct;

  final bool over;

  /// False when no budget is set, which is not the same as a budget of zero.
  /// The widget shows a dash rather than claiming 0%.
  final bool hasBudget;

  Map<String, Object?> toMap() => {
        'title': title,
        'spent': spent,
        'left': left,
        'pct': pct,
        'over': over,
        'hasBudget': hasBudget,
      };
}

/// Build what the widget should show from the ledger as it stands.
///
/// `ids` are the entries in the current cycle, which the budget screen works
/// out the same way — the cycle is a calendar question and the days come from
/// Dart, as everywhere.
WidgetData widgetData({required bool zh}) {
  final live = store.liveEntries();
  final now = DateTime.now();
  final ids = budget.cycleIds(
    ids: live.map((e) => e.id).toList(),
    daysOf: live.map((e) {
      final d = DateTime.fromMillisecondsSinceEpoch(e.ts);
      return '${d.year}-${d.month}-${d.day}';
    }).toList(),
    today: '${now.year}-${now.month}-${now.day}',
  );

  final s = budget.settings();
  final status = budget.monthlyStatus(ids: ids, budget: s.budget);
  final sym = zh ? '￥' : '\$';

  return WidgetData(
    title: zh ? '本月预算' : 'This month',
    // `shownAmount`, not `money.fmt`: the home screen is a surface a
    // shoulder can read as easily as the phone, and the eye that hides
    // 明细's totals has to hide these or it hides nothing that matters.
    spent: zh
        ? '已花 ${amounts.shownAmount(status.used, sym)}'
        : 'Spent ${amounts.shownAmount(status.used, sym)}',
    // Over budget, "剩余 -200" is arithmetic rather than language. What a
    // person wants to read at that point is how far over they are.
    left: status.over
        ? (zh
            ? '超支 ${amounts.shownAmount(-status.left, sym)}'
            : 'Over by ${amounts.shownAmount(-status.left, sym)}')
        : (zh
            ? '剩余 ${amounts.shownAmount(status.left, sym)}'
            : '${amounts.shownAmount(status.left, sym)} left'),
    pct: status.pct.isFinite ? status.pct.round() : 0,
    over: status.over,
    hasBudget: status.limit > 0,
  );
}

/// The platform side, as an interface so a test can answer for it: there is no
/// home screen in a test, and the part worth testing is what gets sent.
abstract class WidgetHost {
  Future<void> update(WidgetData data);
}

class AndroidWidgetHost implements WidgetHost {
  const AndroidWidgetHost();

  static const _channel = MethodChannel('com.dahonghua/widget');

  @override
  Future<void> update(WidgetData data) async {
    try {
      await _channel.invokeMethod<void>('update', data.toMap());
    } on MissingPluginException {
      // No widget on this platform. Not a failure — the app runs in tests and
      // on desktop, and neither has a launcher to draw one.
    } on PlatformException {
      // A widget that failed to redraw is a stale widget, which is worth
      // strictly less than the app continuing to work.
    }
  }
}

/// Push the current budget to the home screen.
///
/// Called whenever the ledger or the budget changes. Cheap enough not to
/// debounce: it is one channel call and a preferences write, and a widget that
/// lags the app by a few seconds is the thing being avoided.
Future<void> refreshWidget({required bool zh, WidgetHost? host}) async {
  await (host ?? const AndroidWidgetHost()).update(widgetData(zh: zh));
}
