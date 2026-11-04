// 预算提醒 — the notice after an entry, when the budget needs saying.
//
// The shipping app checked two seconds after a new entry was saved: the
// cycle's cap spent or four-fifths gone, and only then a category's. The port
// rewarded the entry with flowers and said nothing about the budget it had
// just pushed over. Which notice, if any, is `core::budget::warning`; this is
// its words.

import 'amounts.dart';
import 'entry_list.dart' show localDay;
import 'ledger_days.dart';
import 'src/rust/api/budget.dart' as budget;

/// How long after the save the notice comes: once the flower's 「贴上一朵花」
/// has had its say, as the shipping app waited.
const budgetWarnDelay = Duration(seconds: 2);

/// The notice for the ledger as it stands, or null when nothing is near a
/// cap. Amounts go through [shownBaseShort], so 隐藏金额 hides them here too.
String? budgetWarningText({required bool zh}) {
  final l = LedgerDays.current();
  final w = budget.budgetWarning(
    ids: l.ids,
    daysOf: l.days,
    today: localDay(DateTime.now()),
    zh: zh,
  );
  if (w == null) return null;
  final amount = shownBaseShort(w.amount);
  final pct = w.pct.round();
  return switch (w.kind) {
    'over' => zh ? '本月预算已超 $amount' : 'This cycle is $amount over budget',
    'near' =>
      zh
          ? '本月预算已花 $pct%，还剩 $amount'
          : '$pct% of the budget spent, $amount left',
    'cat_over' =>
      zh ? '${w.name}预算已超 $amount' : '${w.name} is $amount over its cap',
    'cat_near' =>
      zh ? '${w.name}预算已花 $pct%' : '${w.name} is at $pct% of its cap',
    _ => null,
  };
}
