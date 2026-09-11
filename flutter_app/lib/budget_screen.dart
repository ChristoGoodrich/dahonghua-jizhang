// Budgets, in Dart over the Rust comparisons.
//
// Every number here is a spend total against a cap, and the edges of that
// comparison are the whole substance of the screen:
//
//   * a cap of **zero** means unset, not "nothing allowed" — a different
//     screen, not a full bar;
//   * a percentage over 100 is **not clamped**, because being 140% of the way
//     through a budget is the thing worth saying;
//   * a cap that cannot be parsed reads as unset rather than poisoning the tier.
//
// None of that is decided here. `tier_status` decides it, a 4,210-case corpus
// pins it, and this file draws bars.

import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'src/rust/api/budget.dart' as budget;
import 'src/rust/api/money.dart' as money;
import 'src/rust/api/store.dart' as store;
import 'tap.dart';
import 'glass.dart';
import 'theme.dart';

String _day(DateTime d) => '${d.year}-${d.month}-${d.day}';

class BudgetScreen extends StatefulWidget {
  const BudgetScreen({super.key, this.zh = true, this.onChanged});

  final bool zh;

  /// The settings changed and the config should be written.
  final VoidCallback? onChanged;

  @override
  State<BudgetScreen> createState() => _BudgetScreenState();
}

class _BudgetScreenState extends State<BudgetScreen> {
  late budget.SettingsView _settings;
  late budget.TierView _monthly;
  late budget.TierView _daily;
  List<budget.CatBudgetView> _cats = const [];

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
    final today = _day(DateTime.now());

    // the cycle is not the calendar month — it turns over on `cycleStart`, and
    // which entries are inside it is Rust's answer, not a date comparison here
    final inCycle = budget.cycleIds(ids: ids, daysOf: days, today: today);
    final s = budget.settings();

    setState(() {
      _settings = s;
      _monthly = budget.monthlyStatus(ids: inCycle, budget: s.budget);
      _daily = budget.dailyStatus(
        ids: ids,
        daysOf: days,
        dailyBudget: s.dailyBudget,
        today: today,
      );
      _cats = budget.catBudgetRows(
        ids: inCycle,
        capCats: s.capCats,
        capAmounts: s.capAmounts,
        zh: widget.zh,
      );
    });
  }

  Future<void> _editCap(
    String title,
    double current,
    void Function(double) set,
  ) async {
    final v = await showDialog<double>(
      context: context,
      builder: (ctx) =>
          _CapDialog(title: title, current: current, zh: widget.zh),
    );
    if (v == null) return;
    set(v);
    widget.onChanged?.call();
    _reload();
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return ScrimScaffold(
      title: Text(
        zh ? '预算' : 'Budget',
        style: TextStyle(
          color: palette.ink,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),
      body: ListView(
        padding: EdgeInsets.fromLTRB(22, headerInset(context) + 6, 22, 120),
        children: [
          _tierCard(
            key: 'monthly',
            title: zh ? '本周期预算' : 'This cycle',
            sub: zh
                ? '每月 ${_settings.cycleStart} 号起'
                : 'from day ${_settings.cycleStart}',
            tier: _monthly,
            onTap: () => _editCap(
              zh ? '本周期预算' : 'Cycle budget',
              _settings.budget,
              (v) => budget.setSettings(view: _replace(_settings, budget_: v)),
            ),
          ),
          const SizedBox(height: 12),
          _tierCard(
            key: 'daily',
            title: zh ? '今日预算' : 'Today',
            sub: zh ? '今天花掉的' : 'spent today',
            tier: _daily,
            onTap: () => _editCap(
              zh ? '今日预算' : 'Daily budget',
              _settings.dailyBudget,
              (v) => budget.setSettings(view: _replace(_settings, daily: v)),
            ),
          ),
          const SizedBox(height: 20),
          Text(
            zh ? '分类预算' : 'By category',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: palette.inkSoft,
            ),
          ),
          const SizedBox(height: 8),
          if (_cats.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Text(
                zh ? '还没有设置分类上限' : 'No category caps yet',
                key: const Key('no-caps'),
                style: TextStyle(fontSize: 13, color: palette.inkSoft),
              ),
            ),
          for (final c in _cats) _catRow(c, zh),
        ],
      ),
    );
  }

  /// A copy with one field changed. The generated view has no copier, for the
  /// same reason the form's did not: it mirrors a Rust struct.
  budget.SettingsView _replace(
    budget.SettingsView s, {
    double? budget_,
    double? daily,
    List<String>? cats,
    // Float64List, not List<double>: flutter_rust_bridge maps a Vec<f64> to the
    // typed list, which crosses without boxing every element
    Float64List? amounts,
  }) => budget.SettingsView(
    budget: budget_ ?? s.budget,
    dailyBudget: daily ?? s.dailyBudget,
    cycleStart: s.cycleStart,
    capCats: cats ?? s.capCats,
    capAmounts: amounts ?? s.capAmounts,
  );

  Widget _tierCard({
    required String key,
    required String title,
    required String sub,
    required budget.TierView tier,
    required VoidCallback onTap,
  }) {
    final zh = widget.zh;
    final sym = zh ? '￥' : '\$';
    // over is its own colour; under is the leaf, because a budget you are
    // inside is not a warning
    final tone = tier.over ? palette.hibiscus : palette.leafDeep;
    return Tap(
      radius: Rad.lg,
      key: Key('tier-$key'),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: palette.card,
          borderRadius: BorderRadius.circular(Rad.lg),
          border: Border.all(color: palette.line),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: palette.ink,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  sub,
                  style: TextStyle(fontSize: 11, color: palette.inkSoft),
                ),
                const Spacer(),
                Icon(Icons.edit_outlined, size: 16, color: palette.inkSoft),
              ],
            ),
            const SizedBox(height: 10),
            if (tier.unset)
              Text(
                zh
                    ? '未设上限 · 已花 ${money.fmt(n: tier.used, symbol: sym)}'
                    : 'No cap · spent ${money.fmt(n: tier.used, symbol: sym)}',
                key: Key('tier-$key-text'),
                style: TextStyle(fontSize: 14, color: palette.inkSoft),
              )
            else ...[
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text(
                    money.fmt(n: tier.used, symbol: sym),
                    key: Key('tier-$key-used'),
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                      fontFeatures: tabular,
                      color: tone,
                    ),
                  ),
                  Text(
                    ' / ${money.fmt(n: tier.limit, symbol: sym)}',
                    style: TextStyle(
                      fontSize: 13,
                      fontFeatures: tabular,
                      color: palette.inkSoft,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    '${tier.pct.round()}%',
                    key: Key('tier-$key-pct'),
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      fontFeatures: tabular,
                      color: tone,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              _bar(tier, tone),
              const SizedBox(height: 6),
              Text(
                tier.over
                    ? (zh
                          ? '超出 ${money.fmt(n: -tier.left, symbol: sym)}'
                          : '${money.fmt(n: -tier.left, symbol: sym)} over')
                    : (zh
                          ? '还剩 ${money.fmt(n: tier.left, symbol: sym)}'
                          : '${money.fmt(n: tier.left, symbol: sym)} left'),
                key: Key('tier-$key-text'),
                style: TextStyle(fontSize: 12, color: palette.inkSoft),
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// The bar is clamped; the number above it is not.
  ///
  /// A bar cannot be 140% long, but the figure can say 140% — so the clamp
  /// lives here, in the drawing, and never in the arithmetic.
  Widget _bar(budget.TierView tier, Color tone) => ClipRRect(
    borderRadius: BorderRadius.circular(Rad.pill),
    child: LinearProgressIndicator(
      value: (tier.pct / 100).clamp(0.0, 1.0),
      minHeight: 8,
      backgroundColor: palette.paperWarm,
      valueColor: AlwaysStoppedAnimation(tone),
    ),
  );

  Widget _catRow(budget.CatBudgetView c, bool zh) {
    final sym = zh ? '￥' : '\$';
    final tone = c.status.over ? palette.hibiscus : parseHex(c.color);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: palette.card,
          borderRadius: BorderRadius.circular(Rad.md),
          border: Border.all(color: palette.line),
        ),
        child: Column(
          children: [
            Row(
              children: [
                Text(
                  '${c.emoji} ${c.name}',
                  style: TextStyle(fontSize: 13.5, color: palette.ink),
                ),
                const Spacer(),
                Text(
                  '${money.fmt(n: c.status.used, symbol: sym)} / ${money.fmt(n: c.status.limit, symbol: sym)}',
                  key: Key('cap-${c.cat}'),
                  style: TextStyle(
                    fontSize: 12,
                    fontFeatures: tabular,
                    color: palette.inkSoft,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  '${c.status.pct.round()}%',
                  key: Key('cap-${c.cat}-pct'),
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    fontFeatures: tabular,
                    color: tone,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            _bar(c.status, tone),
          ],
        ),
      ),
    );
  }
}

/// The cap editor.
///
/// A widget of its own so it can own its controller and dispose it in
/// `dispose()`. Disposing one at the `showDialog` call site instead — which is
/// where it started — tears it down while the route is still animating out and
/// the `TextField` still depends on it, and Flutter asserts
/// `_dependents.isEmpty`. Thirteen tests passed over that, because not one of
/// them opened the dialog.
class _CapDialog extends StatefulWidget {
  const _CapDialog({
    required this.title,
    required this.current,
    required this.zh,
  });

  final String title;
  final double current;
  final bool zh;

  @override
  State<_CapDialog> createState() => _CapDialogState();
}

class _CapDialogState extends State<_CapDialog> {
  late final TextEditingController _controller = TextEditingController(
    // an unset cap opens empty rather than as "0", because those are different
    // things and the field should not suggest otherwise
    text: widget.current > 0 ? money.fmtNum(n: widget.current) : '',
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    key: const Key('cap-dialog'),
    backgroundColor: palette.card,
    title: Text(
      widget.title,
      style: TextStyle(fontSize: 16, color: palette.ink),
    ),
    content: TextField(
      key: const Key('cap-field'),
      controller: _controller,
      autofocus: true,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      cursorColor: palette.stamen,
      decoration: InputDecoration(
        hintText: widget.zh ? '留空表示不设上限' : 'Leave empty for no cap',
        focusedBorder: UnderlineInputBorder(
          borderSide: BorderSide(color: palette.stamen, width: 2),
        ),
      ),
    ),
    actions: [
      TextButton(
        key: const Key('cap-cancel'),
        onPressed: () => Navigator.pop(context),
        style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
        child: Text(widget.zh ? '取消' : 'Cancel'),
      ),
      TextButton(
        key: const Key('cap-ok'),
        // an empty field is zero, which is *unset* — the same number and
        // the same meaning the core already gives it
        onPressed: () => Navigator.pop(
          context,
          double.tryParse(_controller.text.replaceAll(',', '')) ?? 0,
        ),
        style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
        child: Text(widget.zh ? '确定' : 'OK'),
      ),
    ],
  );
}
