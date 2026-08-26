// 设置 — the preferences that need nothing but the store.
//
// Deliberately short. The shipping settings screen also carries an app lock,
// daily reminders, weekly and monthly reports, a theme picker, and CSV/XLSX
// export — every one of which needs a platform plugin this build does not have
// yet, and a row that does nothing when pressed is worse than no row. They
// arrive with their plugins.
//
// What is here is the two preferences that are pure store: which language the
// app speaks, and which day of the month the budget cycle turns over.

import 'package:flutter/material.dart';

import 'src/rust/api/budget.dart' as budget;
import 'src/rust/api/store.dart' as store;
import 'theme.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, this.zh = true, this.onChanged});

  final bool zh;

  /// A preference changed. The language one rebuilds the whole app, so the
  /// shell rather than this screen decides what that means.
  final VoidCallback? onChanged;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late int _cycleStart;

  @override
  void initState() {
    super.initState();
    _cycleStart = budget.settings().cycleStart;
  }

  void _setCycle(int day) {
    final s = budget.settings();
    budget.setSettings(
      view: budget.SettingsView(
        budget: s.budget,
        dailyBudget: s.dailyBudget,
        // The core clamps to 1..=28; a cycle starting on the 31st would skip
        // the months that have no such day. Clamped here too so the chip that
        // is drawn as selected is the one that was actually stored.
        cycleStart: day,
        capCats: s.capCats,
        capAmounts: s.capAmounts,
      ),
    );
    setState(() => _cycleStart = budget.settings().cycleStart);
    widget.onChanged?.call();
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    final lang = store.language();
    return Scaffold(
      backgroundColor: palette.paper,
      appBar: AppBar(
        backgroundColor: palette.paper,
        surfaceTintColor: Colors.transparent,
        title: Text(zh ? '设置' : 'Settings',
            style: TextStyle(
                color: palette.ink, fontSize: 20, fontWeight: FontWeight.w700)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(22, 6, 22, 120),
        children: [
          _group(zh ? '语言' : 'Language', [
            Row(children: [
              for (final l in const ['zh', 'en'])
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: _chip(
                    key: 'lang-$l',
                    label: l == 'zh' ? '中文' : 'English',
                    on: lang == l,
                    onTap: () {
                      store.setLanguage(lang: l);
                      widget.onChanged?.call();
                      setState(() {});
                    },
                  ),
                ),
            ]),
          ]),
          const SizedBox(height: 20),
          _group(
            zh ? '账单周期' : 'Budget cycle',
            [
              Text(
                zh
                    ? '每月从这一天翻页。周期不是自然月 — 从 15 号起算的周期跑 15 号到 14 号。'
                    : 'The cycle turns over on this day. It is not the calendar '
                        'month: one starting on the 15th runs the 15th to the 14th.',
                style: TextStyle(fontSize: 12, color: palette.inkSoft),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  // 1..28 and no further: the months that have no 29th, 30th or
                  // 31st would skip a cycle entirely.
                  for (final d in const [1, 5, 10, 15, 20, 25, 28])
                    _chip(
                      key: 'cycle-$d',
                      label: '$d',
                      on: _cycleStart == d,
                      onTap: () => _setCycle(d),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                zh ? '当前:$_cycleStart 号' : 'Currently: day $_cycleStart',
                key: const Key('cycle-current'),
                style: TextStyle(fontSize: 12.5, color: palette.inkSoft),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Text(
            zh
                ? '锁屏、提醒、周报月报、主题和导出还没做 — 它们要等各自的平台插件。'
                : 'App lock, reminders, reports, themes and export are not here '
                    'yet: each needs a platform plugin this build does not have.',
            key: const Key('settings-note'),
            style: TextStyle(fontSize: 11.5, color: palette.inkSoft),
          ),
        ],
      ),
    );
  }

  Widget _group(String title, List<Widget> children) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 2, bottom: 10),
            child: Text(title,
                style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: palette.inkSoft)),
          ),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: palette.card,
              borderRadius: BorderRadius.circular(Rad.lg),
              border: Border.all(color: palette.line),
            ),
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.start, children: children),
          ),
        ],
      );

  Widget _chip({
    required String key,
    required String label,
    required bool on,
    required VoidCallback onTap,
  }) =>
      GestureDetector(
        key: Key(key),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 7),
          decoration: BoxDecoration(
            color: on ? palette.stamen.withValues(alpha: 0.18) : Colors.transparent,
            borderRadius: BorderRadius.circular(Rad.pill),
            border: Border.all(color: on ? palette.stamen : palette.line),
          ),
          child: Text(label,
              style: TextStyle(
                  fontSize: 13,
                  fontWeight: on ? FontWeight.w700 : FontWeight.w500,
                  color: palette.ink)),
        ),
      );
}
