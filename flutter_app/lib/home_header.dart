// 明细's head — what this cycle came to, how the budget is holding, and the
// one sentence worth saying about it.
//
// The shipping list opened on three things above the rows: `SummaryCard`,
// `BudgetPot` and `InsightBanner`. The port kept the rows. Every number here
// is `api::home`'s — the cycle, the totals, the share for the bar, the pots,
// which way the flower is leaning, and the sentence — so this file lays them
// out and picks colours.

import 'package:flutter/material.dart';

import 'amounts.dart';
import 'bloom.dart';
import 'src/rust/api/catalog.dart' as catalog;
import 'src/rust/api/home.dart' as home;
import 'src/rust/api/money.dart' as money;
import 'tap.dart';
import 'theme.dart';

class HomeHeader extends StatelessWidget {
  const HomeHeader({
    super.key,
    required this.view,
    required this.hidden,
    required this.onToggleHidden,
    this.zh = true,
    this.onOpenBudget,
    this.onOpenStats,
    this.templates = const [],
    this.onTemplate,
  });

  final home.HomeView view;

  /// The saved templates, as one-press chips under the head — the shipping
  /// list's `TemplateChips`.
  final List<catalog.TemplateView> templates;
  final ValueChanged<String>? onTemplate;

  /// 隐藏金额: the totals read as [hiddenAmount].
  final bool hidden;
  final VoidCallback onToggleHidden;
  final bool zh;
  final VoidCallback? onOpenBudget;
  final VoidCallback? onOpenStats;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SummaryCard(
          view: view,
          hidden: hidden,
          zh: zh,
          onToggleHidden: onToggleHidden,
          onTap: onOpenStats,
        ),
        if (view.monthly != null || view.daily != null) ...[
          const SizedBox(height: 10),
          _BudgetPot(view: view, hidden: hidden, zh: zh, onTap: onOpenBudget),
        ],
        if (view.insight != null) ...[
          const SizedBox(height: 10),
          _Insight(icon: view.insight!.icon, text: view.insight!.text),
        ],
        if (templates.isNotEmpty && onTemplate != null) ...[
          const SizedBox(height: 12),
          TemplateChips(templates: templates, zh: zh, onTap: onTemplate!),
        ],
      ],
    ),
  );
}

String _cycleLabel(home.HomeView v, bool zh) {
  List<int> p(String ymd) => ymd.split('-').map(int.parse).toList();
  final a = p(v.start);
  final b = p(v.last);
  return zh
      ? '${a[1]}月${a[2]}日 – ${b[1]}月${b[2]}日'
      : '${a[1]}/${a[2]} – ${b[1]}/${b[2]}';
}

/// 本月攒下的, on the one heavy slab on the screen.
class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.view,
    required this.hidden,
    required this.zh,
    required this.onToggleHidden,
    this.onTap,
  });

  final home.HomeView view;
  final bool hidden;
  final bool zh;
  final VoidCallback onToggleHidden;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    // The same slab 资产's net worth stands on, chosen the same way: ink in a
    // lit room, the card warmed toward the flower in a dark one — ink is the
    // light colour there, and a cream slab with paper text is a blank one.
    final slab = p.isDark
        ? Color.alphaBlend(p.hibiscus.withValues(alpha: 0.14), p.card)
        : p.ink;
    final on = p.isDark ? p.ink : p.paper;
    // The slab is dark in both rooms, so a tone that reads on it is lifted
    // toward `on`, the light colour, in both. The night version used the deep
    // tones instead and 花掉 stood at 2.4:1.
    //
    // The numbers follow the rows below: spent in the slab's ink, in in the
    // leaf. The flower's own colour is kept for the dot and the bar, because
    // in 森林 and 茉莉 the flower is green — as green as the leaf — and two
    // numbers told apart only by that hue were not told apart.
    final flower = Color.lerp(p.hibiscus, on, 0.3)!;
    final spent = on.withValues(alpha: 0.92);
    final incTone = Color.lerp(p.leaf, on, 0.3)!;
    final sym = zh ? '￥' : '\$';
    String m(double v) => hidden ? hiddenAmount : money.fmt(n: v, symbol: sym);
    final share = view.expShare;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                _cycleLabel(view, zh),
                key: const Key('home-cycle'),
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.2,
                  fontFeatures: tabular,
                  color: p.ink,
                ),
              ),
            ),
            IconButton(
              key: const Key('hide-amounts'),
              tooltip: hidden
                  ? (zh ? '显示金额' : 'Show amounts')
                  : (zh ? '隐藏金额' : 'Hide amounts'),
              visualDensity: VisualDensity.compact,
              icon: Icon(
                hidden
                    ? Icons.visibility_off_outlined
                    : Icons.visibility_outlined,
                size: 20,
                color: p.inkSoft,
              ),
              onPressed: onToggleHidden,
            ),
          ],
        ),
        const SizedBox(height: 6),
        Tap(
          key: const Key('home-summary'),
          radius: Rad.lg,
          onTap: onTap,
          child: Container(
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: slab,
              borderRadius: BorderRadius.circular(Rad.lg),
              boxShadow: [
                BoxShadow(
                  color: parseHex(
                    p.shadowHex,
                  ).withValues(alpha: p.isDark ? 0.3 : 0.16),
                  blurRadius: 20,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Stack(
              children: [
                // A diagonal wash of the theme's own gradient, for depth
                // without costing the numbers any contrast.
                Positioned.fill(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          p.gradFrom.withValues(alpha: p.isDark ? 0.09 : 0.18),
                          p.gradTo.withValues(alpha: 0.0),
                        ],
                      ),
                    ),
                  ),
                ),
                // The flower, large and faint, off the corner.
                Positioned(
                  right: -24,
                  bottom: -36,
                  child: Opacity(
                    opacity: 0.1,
                    child: Bloom(size: 132, petal: on, core: on),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(22, 20, 22, 18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        zh ? '本月攒下的' : 'SAVED THIS MONTH',
                        style: TextStyle(
                          fontSize: 11,
                          letterSpacing: zh ? 2 : 1.6,
                          fontWeight: FontWeight.w600,
                          color: on.withValues(alpha: 0.62),
                        ),
                      ),
                      const SizedBox(height: 4),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text(
                          m(view.net),
                          key: const Key('home-net'),
                          style: TextStyle(
                            fontSize: 38,
                            height: 1.15,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.8,
                            fontFeatures: tabular,
                            color: on,
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          _flow(
                            zh ? '花掉' : 'Spent',
                            m(view.exp),
                            flower,
                            spent,
                            on,
                            'home-exp',
                          ),
                          const SizedBox(width: 28),
                          _flow(
                            zh ? '进账' : 'In',
                            m(view.inc),
                            incTone,
                            incTone,
                            on,
                            'home-inc',
                          ),
                        ],
                      ),
                      if (share != null && !hidden) ...[
                        const SizedBox(height: 14),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(2),
                          child: SizedBox(
                            height: 4,
                            child: Stack(
                              fit: StackFit.expand,
                              children: [
                                ColoredBox(color: on.withValues(alpha: 0.15)),
                                FractionallySizedBox(
                                  key: const Key('home-share'),
                                  alignment: Alignment.centerLeft,
                                  widthFactor: share,
                                  child: ColoredBox(color: flower),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _flow(
    String label,
    String value,
    Color dot,
    Color ink,
    Color on,
    String key,
  ) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: on.withValues(alpha: 0.75),
            ),
          ),
        ],
      ),
      const SizedBox(height: 2),
      Text(
        value,
        key: Key(key),
        style: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w700,
          fontFeatures: tabular,
          color: ink,
        ),
      ),
    ],
  );
}

/// The budget, as a flower that wilts as it goes — 本月预算 and 今日预算.
class _BudgetPot extends StatelessWidget {
  const _BudgetPot({
    required this.view,
    required this.hidden,
    required this.zh,
    this.onTap,
  });

  final home.HomeView view;
  final bool hidden;
  final bool zh;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final sym = zh ? '￥' : '\$';
    String s(double v) =>
        hidden ? hiddenAmount : money.fmtShort(n: v, symbol: sym);
    // The shipping card's three states. The dry browns are not the theme's:
    // a wilted flower is the same colour in every garden.
    const dryPetal = Color(0xFFB79A86);
    const dryCore = Color(0xFFC8B79C);
    final (petal, core, fill) = switch (view.mood) {
      'wilted' => (dryPetal, dryCore, dryPetal),
      'wary' => (p.stamen, p.stamen, p.stamen),
      _ => (p.hibiscus, p.stamen, p.leaf),
    };
    final monthly = view.monthly;
    final daily = view.daily;

    return Tap(
      key: const Key('home-pot'),
      radius: Rad.lg,
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.fromLTRB(14, 14, 10, 14),
        decoration: BoxDecoration(
          color: p.card,
          borderRadius: BorderRadius.circular(Rad.lg),
          border: Border.all(color: p.line),
        ),
        child: Row(
          children: [
            Bloom(
              key: Key('pot-${view.mood ?? 'none'}'),
              size: 44,
              petal: petal,
              core: core,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (monthly != null) ...[
                    Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(
                            text: zh ? '本月预算' : 'Monthly budget',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: p.ink,
                            ),
                          ),
                          TextSpan(
                            text: '  ·  ${s(monthly.limit)}',
                            style: TextStyle(
                              fontSize: 12.5,
                              fontFeatures: tabular,
                              color: p.inkSoft,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      monthly.over
                          ? (zh
                                ? '超了 ${s(-monthly.left)},下月再争取小红花'
                                : '${s(-monthly.left)} over — aim for more flowers next month')
                          : (zh
                                ? '已花 ${s(monthly.used)},还剩 ${s(monthly.left)}'
                                : '${s(monthly.used)} spent, ${s(monthly.left)} left'),
                      key: const Key('pot-month-line'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        fontFeatures: tabular,
                        color: monthly.over ? p.warnDeep : p.inkSoft,
                      ),
                    ),
                    const SizedBox(height: 8),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: SizedBox(
                        height: 7,
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            ColoredBox(color: p.isDark ? p.line : p.paperWarm),
                            FractionallySizedBox(
                              alignment: Alignment.centerLeft,
                              widthFactor: monthly.fill,
                              child: DecoratedBox(
                                decoration: BoxDecoration(
                                  color: fill,
                                  borderRadius: BorderRadius.circular(4),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                  if (daily != null) ...[
                    if (monthly != null) const SizedBox(height: 8),
                    Text(
                      daily.over
                          ? (zh
                                ? '今日预算 · 今天超了 ${s(-daily.left)}'
                                : "Today's budget · ${s(-daily.left)} over today")
                          : (zh
                                ? '今日预算 · 今天还能花 ${s(daily.left)}'
                                : "Today's budget · ${s(daily.left)} left to spend today"),
                      key: const Key('pot-day-line'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: monthly == null ? 14 : 12,
                        fontWeight: monthly == null
                            ? FontWeight.w700
                            : FontWeight.w400,
                        fontFeatures: tabular,
                        color: daily.over
                            ? p.warnDeep
                            : (monthly == null ? p.ink : p.inkSoft),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded, size: 20, color: p.inkSoft),
          ],
        ),
      ),
    );
  }
}

/// The one sentence — `core::insight`'s choice, in the report's words.
class _Insight extends StatelessWidget {
  const _Insight({required this.icon, required this.text});

  final String icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    return Container(
      key: const Key('home-insight'),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      decoration: BoxDecoration(
        color: Color.alphaBlend(p.stamen.withValues(alpha: 0.14), p.card),
        borderRadius: BorderRadius.circular(Rad.md),
        border: Border.all(color: p.stamen.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Text(icon, style: const TextStyle(fontSize: 16)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: TextStyle(fontSize: 13, height: 1.3, color: p.ink),
            ),
          ),
        ],
      ),
    );
  }
}

/// The templates, one press each. Scrolls sideways: there may be more of them
/// than a phone is wide, and a wrapped block of chips would push the rows
/// down by as many lines as there are templates.
class TemplateChips extends StatelessWidget {
  const TemplateChips({
    super.key,
    required this.templates,
    required this.zh,
    required this.onTap,
  });

  final List<catalog.TemplateView> templates;
  final bool zh;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 6),
          child: Text(
            zh ? '一按就记' : 'One press',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: p.inkSoft,
            ),
          ),
        ),
        SizedBox(
          height: 40,
          child: ListView.separated(
            key: const Key('home-templates'),
            scrollDirection: Axis.horizontal,
            itemCount: templates.length,
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemBuilder: (context, i) {
              final t = templates[i];
              final label = catalog.catLabel(
                io: t.io,
                key: t.cat,
                zh: zh,
                custom: const [],
              );
              final tone = parseHex(label.color);
              return Tap(
                key: Key('tpl-chip-${t.id}'),
                radius: Rad.pill,
                onTap: () => onTap(t.id),
                semanticLabel: zh
                    ? '一按记一笔 ${t.name.isEmpty ? label.name : t.name}'
                    : 'Log ${t.name.isEmpty ? label.name : t.name}',
                child: Container(
                  padding: const EdgeInsets.fromLTRB(5, 5, 12, 5),
                  decoration: BoxDecoration(
                    color: p.card,
                    borderRadius: BorderRadius.circular(Rad.pill),
                    border: Border.all(color: p.line),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 28,
                        height: 28,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: tone.withValues(alpha: p.isDark ? 0.19 : 0.12),
                          shape: BoxShape.circle,
                        ),
                        child: Text(
                          label.emoji,
                          style: const TextStyle(fontSize: 14),
                        ),
                      ),
                      const SizedBox(width: 7),
                      Text(
                        t.name.isEmpty ? label.name : t.name,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: p.ink,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        money.fmtShort(n: t.amt, symbol: ''),
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          fontFeatures: tabular,
                          color: t.io == 'inc' ? p.leafDeep : p.inkSoft,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}
