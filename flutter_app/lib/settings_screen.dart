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

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import 'src/rust/api/budget.dart' as budget;
// `export` is a reserved word in Dart, so the prefix cannot be the module name.
import 'src/rust/api/export.dart' as exporter;
import 'src/rust/api/lock.dart' as lock;
import 'src/rust/api/store.dart' as store;
import 'src/rust/api/theme.dart' as theme;
import 'theme.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    this.zh = true,
    this.onChanged,
    this.share,
  });

  final bool zh;

  /// A preference changed. The language one rebuilds the whole app, so the
  /// shell rather than this screen decides what that means.
  final VoidCallback? onChanged;

  /// Where the exported file goes. A test cannot drive a share sheet, and the
  /// part worth testing is the file — that it exists, and what is in it.
  final Future<void> Function(String path)? share;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late int _cycleStart;
  late String _themeKey;
  late bool _dark;
  late bool _lock;

  /// Change the palette, then throw away the cached one so the next read
  /// rebuilds it. The shell rebuilds too — a theme that only repainted the
  /// screen that changed it would be the language bug all over again.
  void _setTheme(String key, bool dark) {
    theme.setTheme(key: key, dark: dark);
    refreshPalette();
    setState(() {
      _themeKey = key;
      _dark = dark;
    });
    widget.onChanged?.call();
  }
  bool _busy = false;
  String? _flash;

  /// Write the ledger to a file and hand it to whatever the user picks.
  ///
  /// A file, not a string: a share sheet passes a path, and the CSV of a
  /// long-running ledger is far past what a text intent will carry. It goes to
  /// a temporary directory rather than to documents, because this is a copy on
  /// its way out and not a second ledger to keep in step.
  Future<void> _export() async {
    setState(() {
      _busy = true;
      _flash = null;
    });
    try {
      final live = store.liveEntries();
      // Bytes, because the BOM Excel needs does not survive being a Dart
      // string — `Utf8Decoder` strips a leading one.
      final csv = exporter.exportCsv(
        ids: live.map((e) => e.id).toList(),
        daysOf: live.map((e) {
          final d = DateTime.fromMillisecondsSinceEpoch(e.ts);
          return '${d.year}-${d.month}-${d.day}';
        }).toList(),
      );
      final dir = await getTemporaryDirectory();
      final stamp = DateTime.now();
      final name = 'dahonghua-${stamp.year}'
          '${stamp.month.toString().padLeft(2, '0')}'
          '${stamp.day.toString().padLeft(2, '0')}.csv';
      final file = File('${dir.path}/$name');
      await file.writeAsBytes(csv);

      if (widget.share != null) {
        await widget.share!(file.path);
      } else {
        await SharePlus.instance.share(
          ShareParams(files: [XFile(file.path)], fileNameOverrides: [name]),
        );
      }
      if (mounted) {
        setState(() => _flash =
            widget.zh ? '已导出 ${live.length} 条' : 'Exported ${live.length}');
      }
    } catch (_) {
      if (mounted) {
        setState(() =>
            _flash = widget.zh ? '导出失败了' : 'The export did not go through');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void initState() {
    super.initState();
    _cycleStart = budget.settings().cycleStart;
    _themeKey = theme.themeKey();
    _dark = theme.isDark();
    _lock = lock.lockEnabled();
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
          _group(zh ? '主题' : 'Theme', [
            Text(
              zh
                  ? '七种花，各有白天和夜里。颜色都是算出来的，不是写死在界面里的。'
                  : 'Seven flowers, each with a day and a night. The colours '
                      'are computed, not written into the screens.',
              style: TextStyle(fontSize: 12, color: palette.inkSoft),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final o in theme.themeOptions())
                  GestureDetector(
                    key: Key('theme-${o.key}'),
                    onTap: () => _setTheme(o.key, _dark),
                    child: Container(
                      width: 34,
                      height: 34,
                      decoration: BoxDecoration(
                        color: parseHex(o.swatch),
                        shape: BoxShape.circle,
                        // The chosen one is ringed rather than ticked: a tick
                        // in the middle of a swatch hides the colour being
                        // chosen.
                        border: Border.all(
                          color: _themeKey == o.key
                              ? palette.ink
                              : palette.line,
                          width: _themeKey == o.key ? 2.5 : 1,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            // A row rather than a `SwitchListTile`: a ListTile inside a
            // decorated box cannot paint its own ink, and Flutter says so
            // loudly. The rest of this screen is rows and chips anyway.
            Row(children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(zh ? '夜间模式' : 'Dark',
                        style: TextStyle(fontSize: 15, color: palette.ink)),
                    Text(
                      zh
                          ? '花还是那朵花，只是灯关了'
                          : 'The flower keeps its colour; the room does not',
                      style:
                          TextStyle(fontSize: 12, color: palette.inkSoft),
                    ),
                  ],
                ),
              ),
              Switch(
                key: const Key('dark-toggle'),
                value: _dark,
                onChanged: (v) => _setTheme(_themeKey, v),
                activeThumbColor: palette.hibiscus,
              ),
            ]),
          ]),
          const SizedBox(height: 20),
          _group(zh ? '安全' : 'Security', [
            Row(children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(zh ? '打开时验证' : 'Lock the app',
                        style: TextStyle(fontSize: 15, color: palette.ink)),
                    Text(
                      zh
                          ? '用手机自己的指纹或密码。没设过的手机不会被挡在门外。'
                          : "Uses the phone's own fingerprint or passcode. A "
                              'phone with neither set is not shut out.',
                      style:
                          TextStyle(fontSize: 12, color: palette.inkSoft),
                    ),
                  ],
                ),
              ),
              Switch(
                key: const Key('lock-toggle'),
                value: _lock,
                onChanged: (v) {
                  lock.lockSetEnabled(enabled: v);
                  setState(() => _lock = v);
                  widget.onChanged?.call();
                },
                activeThumbColor: palette.hibiscus,
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
          const SizedBox(height: 20),
          _group(
            zh ? '数据' : 'Data',
            [
              Text(
                zh
                    ? '导出成 CSV,Excel 和别的记账 app 都读得了。日期是本机的日期,不是格林威治的。'
                    : 'Export as CSV, which Excel and other ledgers can read. '
                        'The dates are the ones this phone shows, not UTC.',
                style: TextStyle(fontSize: 12, color: palette.inkSoft),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                key: const Key('export-csv'),
                onPressed: _busy ? null : _export,
                icon: const Icon(Icons.ios_share, size: 18),
                style: FilledButton.styleFrom(
                  backgroundColor: palette.hibiscus,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
                label: Text(zh ? '导出 CSV' : 'Export CSV'),
              ),
              if (_flash != null)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Text(_flash!,
                      key: const Key('export-flash'),
                      style:
                          TextStyle(fontSize: 12.5, color: palette.leafDeep)),
                ),
            ],
          ),
          const SizedBox(height: 24),
          Text(
            zh
                ? '提醒和周报月报还没做 — 它们要等通知插件。'
                : 'Reminders and scheduled reports are not here yet: both need '
                    'a notification plugin this build does not have.',
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
