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
import 'ledger_days.dart';
import 'src/rust/api/budget.dart' as budget;

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
    this.next,
    this.nextAt = 0,
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

  /// What the widget should say once the next cycle has begun, worked out
  /// now, and the instant that is — local midnight, epoch milliseconds.
  ///
  /// The launcher redraws the widget hourly from what it was last handed, and
  /// a new cycle is not a change anybody makes: nothing pushes at midnight on
  /// the 1st. So the page is turned in advance and the Kotlin is trusted with
  /// one comparison against the clock. It does no arithmetic, and it is never
  /// asked to work out which day a cycle starts on.
  final WidgetData? next;
  final int nextAt;

  Map<String, Object?> toMap() => {
        'title': title,
        'spent': spent,
        'left': left,
        'pct': pct,
        'over': over,
        'hasBudget': hasBudget,
        if (next case final n?) ...{
          'nextAt': nextAt,
          'nextTitle': n.title,
          'nextSpent': n.spent,
          'nextLeft': n.left,
          'nextPct': n.pct,
          'nextOver': n.over,
          'nextHasBudget': n.hasBudget,
        },
      };
}

/// Build what the widget should show from the ledger as it stands, for the
/// cycle containing `now` and for the one after it.
///
/// The cycle is a calendar question and the days come from Dart, as
/// everywhere — from `LedgerDays`, which the screens share, rather than from
/// a fresh read of the whole ledger on every push.
WidgetData widgetData({required bool zh, DateTime? now}) {
  final at = now ?? DateTime.now();
  final ledger = LedgerDays.current();
  // `y-m-d`, the day the next cycle starts on; the core says which day,
  // and its midnight is this phone's.
  final p = budget.nextCycle(today: dayKey(at)).split('-').map(int.parse).toList();
  final turns = DateTime(p[0], p[1], p[2]);
  return _face(
    zh,
    ledger,
    at,
    next: _face(zh, ledger, turns),
    nextAt: turns.millisecondsSinceEpoch,
  );
}

/// The six things the widget shows, for the cycle containing `day`.
WidgetData _face(
  bool zh,
  LedgerDays ledger,
  DateTime day, {
  WidgetData? next,
  int nextAt = 0,
}) {
  final ids = budget.cycleIds(
    ids: ledger.ids,
    daysOf: ledger.days,
    today: dayKey(day),
  );

  final s = budget.settings();
  final status = budget.monthlyStatus(ids: ids, budget: s.budget);
  final sym = amounts.baseSymbol();

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
    next: next,
    nextAt: nextAt,
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
/// Called whenever the ledger or the budget changes, and on every launch and
/// return to the foreground — the cycle can turn with nothing changed, and
/// the widget's own page-turn is only as good as the last time it was told
/// where the next cycle starts. Cheap enough not to
/// debounce: it is one channel call and a preferences write, and a widget that
/// lags the app by a few seconds is the thing being avoided.
Future<void> refreshWidget({required bool zh, WidgetHost? host}) async {
  await (host ?? const AndroidWidgetHost()).update(widgetData(zh: zh));
}
