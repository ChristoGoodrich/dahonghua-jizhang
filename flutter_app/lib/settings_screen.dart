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

import 'ai.dart';
import 'src/rust/api/ai.dart' as ai;
import 'src/rust/api/budget.dart' as budget;
// `export` is a reserved word in Dart, so the prefix cannot be the module name.
import 'src/rust/api/export.dart' as exporter;
import 'src/rust/api/lock.dart' as lock;
import 'src/rust/api/remind.dart' as remind;
import 'src/rust/api/store.dart' as store;
import 'src/rust/api/theme.dart' as theme;
import 'prompt.dart';
import 'reminders.dart';
import 'tap.dart';
import 'glass.dart';
import 'theme.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    this.zh = true,
    this.onChanged,
    this.share,
    this.notifier,
  });

  final bool zh;

  /// A preference changed. The language one rebuilds the whole app, so the
  /// shell rather than this screen decides what that means.
  final VoidCallback? onChanged;

  /// Where the exported file goes. A test cannot drive a share sheet, and the
  /// part worth testing is the file — that it exists, and what is in it.
  final Future<void> Function(String path)? share;

  /// Who receives the schedules. A test cannot drive the notification
  /// service; what is worth testing is which schedules it is handed.
  final Notifier? notifier;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late int _cycleStart;
  late String _themeKey;
  late bool _dark;
  late bool _lock;
  late String _remindAt;
  late bool _weekly;
  late bool _monthly;

  late bool _ai = ai.aiSettings().enabled;

  /// The key as it may be shown — its prefix and last four — or null.
  String? _aiKey;
  late final _aiBase = TextEditingController(text: ai.aiSettings().baseUrl);
  late final _aiModel = TextEditingController(text: ai.aiSettings().model);
  late final _aiVision = TextEditingController(
    text: ai.aiSettings().visionModel,
  );
  String? _aiResult;
  bool _aiResultBad = false;
  bool _aiTesting = false;

  @override
  void dispose() {
    _aiBase.dispose();
    _aiModel.dispose();
    _aiVision.dispose();
    super.dispose();
  }

  void _saveAi() {
    ai.setAiSettings(
      view: ai.AiSettingsView(
        enabled: _ai,
        baseUrl: _aiBase.text,
        model: _aiModel.text,
        visionModel: _aiVision.text,
      ),
    );
    widget.onChanged?.call();
  }

  Future<void> _editKey() async {
    final zh = widget.zh;
    final key = await prompt(
      context,
      title: zh ? 'API Key' : 'API key',
      ok: zh ? '保存' : 'Save',
      cancel: zh ? '取消' : 'Cancel',
      hint: zh ? '粘贴你的 Key' : 'Paste your key',
      note: zh
          ? '只加密存在这台手机上，不进备份、同步和导出。'
          : 'Kept encrypted on this phone only — never in a backup, a sync file or an export.',
      obscure: true,
      fieldKey: const Key('ai-key-field'),
      okKey: const Key('ai-key-ok'),
    );
    if (key == null || key.trim().isEmpty || !mounted) return;
    await AiKey.write(key);
    setState(() {
      _aiKey = AiKey.masked(key.trim());
      _aiResult = null;
    });
  }

  Future<void> _clearKey() async {
    await AiKey.clear();
    if (mounted) setState(() => _aiKey = null);
  }

  Future<void> _ping() async {
    _saveAi();
    setState(() {
      _aiTesting = true;
      _aiResult = null;
    });
    final f = await Ai.ping();
    if (!mounted) return;
    setState(() {
      _aiTesting = false;
      _aiResultBad = f != null;
      _aiResult = f == null
          ? (widget.zh ? '连上了，可以用了' : 'Connected')
          : [
              failureText(f, widget.zh),
              if (f.detail.isNotEmpty) f.detail,
            ].join('\n');
    });
  }

  /// Hand the operating system whatever is switched on, and say so if it
  /// refuses. A switch left on that schedules nothing is worse than no switch.
  Future<void> _syncReminders() async {
    final ok = await syncReminders(zh: widget.zh, notifier: widget.notifier);
    if (!mounted) return;
    setState(
      () => _flash = ok
          ? null
          : (widget.zh
                ? '系统没给通知权限，提醒发不出来'
                : 'Notifications are not permitted, so nothing will arrive'),
    );
    widget.onChanged?.call();
  }

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
      final name =
          'dahonghua-${stamp.year}'
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
        setState(
          () => _flash = widget.zh
              ? '已导出 ${live.length} 条'
              : 'Exported ${live.length}',
        );
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _flash = widget.zh ? '导出失败了' : 'The export did not go through',
        );
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
    _remindAt = remind.dailyReminderAt();
    _weekly = remind.weeklyReportOn();
    _monthly = remind.monthlyReportOn();
    AiKey.read().then((k) {
      if (mounted && k != null) setState(() => _aiKey = AiKey.masked(k));
    });
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
    return ScrimScaffold(
      title: Text(
        zh ? '设置' : 'Settings',
        style: TextStyle(
          color: palette.ink,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),
      body: ListView(
        padding: EdgeInsets.fromLTRB(22, headerInset(context) + 6, 22, 120),
        children: [
          _group(zh ? '语言' : 'Language', [
            Row(
              children: [
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
              ],
            ),
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
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        zh ? '夜间模式' : 'Dark',
                        style: TextStyle(fontSize: 15, color: palette.ink),
                      ),
                      Text(
                        zh
                            ? '花还是那朵花，只是灯关了'
                            : 'The flower keeps its colour; the room does not',
                        style: TextStyle(fontSize: 12, color: palette.inkSoft),
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
              ],
            ),
          ]),
          const SizedBox(height: 20),
          _group(zh ? '提醒' : 'Reminders', [
            Text(
              zh
                  ? '每天一次，加上周报和月报。时间是手机的本地时间，跟着手机走。'
                  : 'A daily nudge, plus a weekly and a monthly summary. The '
                        'times are this phone\u2019s local time and travel with it.',
              style: TextStyle(fontSize: 12, color: palette.inkSoft),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Text(
                  zh ? '每日提醒' : 'Daily',
                  style: TextStyle(fontSize: 15, color: palette.ink),
                ),
                const Spacer(),
                // Off is a real state, so the row of times includes a way back to
                // it: tapping the chosen one again turns the reminder off.
                Wrap(
                  spacing: 6,
                  children: [
                    for (final t in const ['08:00', '12:00', '21:00', '22:00'])
                      GestureDetector(
                        key: Key('remind-$t'),
                        onTap: () async {
                          final next = _remindAt == t ? '' : t;
                          remind.setDailyReminder(at: next);
                          setState(() => _remindAt = remind.dailyReminderAt());
                          await _syncReminders();
                        },
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 9,
                            vertical: 5,
                          ),
                          decoration: BoxDecoration(
                            color: _remindAt == t
                                ? palette.stamen.withValues(alpha: 0.18)
                                : Colors.transparent,
                            borderRadius: BorderRadius.circular(Rad.pill),
                            border: Border.all(
                              color: _remindAt == t
                                  ? palette.stamen
                                  : palette.line,
                            ),
                          ),
                          child: Text(
                            t,
                            style: TextStyle(
                              fontSize: 11.5,
                              color: palette.ink,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              _remindAt.isEmpty
                  ? (zh ? '现在：关着' : 'Currently: off')
                  : (zh ? '现在：$_remindAt' : 'Currently: $_remindAt'),
              key: const Key('remind-current'),
              style: TextStyle(fontSize: 12, color: palette.inkSoft),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: Text(
                    zh ? '周报（周日晚上）' : 'Weekly report (Sunday evening)',
                    style: TextStyle(fontSize: 14, color: palette.ink),
                  ),
                ),
                Switch(
                  key: const Key('weekly-toggle'),
                  value: _weekly,
                  onChanged: (v) async {
                    remind.setWeeklyReport(enabled: v);
                    setState(() => _weekly = v);
                    await _syncReminders();
                  },
                  activeThumbColor: palette.hibiscus,
                ),
              ],
            ),
            Row(
              children: [
                Expanded(
                  child: Text(
                    zh ? '月报（1 号早上）' : 'Monthly report (1st, morning)',
                    style: TextStyle(fontSize: 14, color: palette.ink),
                  ),
                ),
                Switch(
                  key: const Key('monthly-toggle'),
                  value: _monthly,
                  onChanged: (v) async {
                    remind.setMonthlyReport(enabled: v);
                    setState(() => _monthly = v);
                    await _syncReminders();
                  },
                  activeThumbColor: palette.hibiscus,
                ),
              ],
            ),
          ]),
          const SizedBox(height: 20),
          _group(zh ? '安全' : 'Security', [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        zh ? '打开时验证' : 'Lock the app',
                        style: TextStyle(fontSize: 15, color: palette.ink),
                      ),
                      Text(
                        zh
                            ? '用手机自己的指纹或密码。没设过的手机不会被挡在门外。'
                            : "Uses the phone's own fingerprint or passcode. A "
                                  'phone with neither set is not shut out.',
                        style: TextStyle(fontSize: 12, color: palette.inkSoft),
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
              ],
            ),
          ]),
          const SizedBox(height: 20),
          _group(zh ? 'AI 助手' : 'AI', [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        zh ? '开启 AI' : 'Use AI',
                        style: TextStyle(fontSize: 15, color: palette.ink),
                      ),
                      Text(
                        zh
                            ? '一句话记账读得更准、能看小票和截图，问账本能听懂更多问法。关着也能用，在本机识别。'
                            : 'Reads sentences better, reads receipts and screenshots, and understands more questions. Off, both still work on the phone.',
                        style: TextStyle(fontSize: 12, color: palette.inkSoft),
                      ),
                    ],
                  ),
                ),
                Switch(
                  key: const Key('ai-toggle'),
                  value: _ai,
                  onChanged: (v) {
                    setState(() => _ai = v);
                    _saveAi();
                  },
                  activeThumbColor: palette.hibiscus,
                ),
              ],
            ),
            if (_ai) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  Text(
                    'API Key',
                    style: TextStyle(fontSize: 14, color: palette.ink),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      _aiKey ?? (zh ? '未设置' : 'Not set'),
                      key: const Key('ai-key-state'),
                      style: TextStyle(
                        fontSize: 13,
                        fontFeatures: tabular,
                        color: _aiKey == null
                            ? palette.warnDeep
                            : palette.inkSoft,
                      ),
                    ),
                  ),
                  TextButton(
                    key: const Key('ai-key-edit'),
                    onPressed: _editKey,
                    child: Text(
                      _aiKey == null
                          ? (zh ? '填写' : 'Add')
                          : (zh ? '更换' : 'Change'),
                    ),
                  ),
                  if (_aiKey != null)
                    TextButton(
                      key: const Key('ai-key-clear'),
                      onPressed: _clearKey,
                      style: TextButton.styleFrom(
                        foregroundColor: palette.warn,
                      ),
                      child: Text(zh ? '清除' : 'Remove'),
                    ),
                ],
              ),
              const SizedBox(height: 6),
              for (final (key, ctrl, label, hint) in [
                (
                  'ai-base',
                  _aiBase,
                  zh ? '服务地址' : 'Address',
                  zh ? '默认：小米 MiMo' : 'Default: Xiaomi MiMo',
                ),
                (
                  'ai-model',
                  _aiModel,
                  zh ? '模型' : 'Model',
                  ai.aiDefaultModel(),
                ),
                (
                  'ai-vision',
                  _aiVision,
                  zh ? '识图模型' : 'Picture model',
                  ai.aiDefaultVisionModel(),
                ),
              ])
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: TextField(
                    key: Key(key),
                    controller: ctrl,
                    autocorrect: false,
                    onChanged: (_) => _saveAi(),
                    style: TextStyle(fontSize: 13.5, color: palette.ink),
                    decoration: InputDecoration(
                      isDense: true,
                      labelText: label,
                      hintText: hint,
                      hintStyle: TextStyle(color: palette.inkSoft),
                    ),
                  ),
                ),
              const SizedBox(height: 12),
              Row(
                children: [
                  OutlinedButton(
                    key: const Key('ai-ping'),
                    onPressed: _aiTesting ? null : _ping,
                    child: Text(
                      _aiTesting
                          ? (zh ? '正在连…' : 'Testing…')
                          : (zh ? '测试连接' : 'Test'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  if (_aiResult != null)
                    Expanded(
                      child: Text(
                        _aiResult!,
                        key: const Key('ai-ping-result'),
                        style: TextStyle(
                          fontSize: 12.5,
                          color: _aiResultBad
                              ? palette.warnDeep
                              : palette.leafDeep,
                        ),
                      ),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 12),
            Text(
              zh
                  ? '只在你按下时联网，发出去的只有：一句话记账——你输入的那句话；拍小票——你选的那张图；问账本——你的问题。账本本身从不离开手机，问账本也是在手机上算的。'
                  : 'The network is used only when you press something, and all that is sent is: for quick entry, the sentence you typed; for a receipt, the picture you chose; for a question, the question. The ledger never leaves the phone — questions are counted on it.',
              key: const Key('ai-privacy'),
              style: TextStyle(
                fontSize: 12,
                color: palette.inkSoft,
                height: 1.5,
              ),
            ),
          ]),
          const SizedBox(height: 20),
          _group(zh ? '账单周期' : 'Budget cycle', [
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
          ]),
          const SizedBox(height: 20),
          _group(zh ? '数据' : 'Data', [
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
              label: Text(zh ? '导出 CSV' : 'Export CSV'),
            ),
            if (_flash != null)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text(
                  _flash!,
                  key: const Key('export-flash'),
                  style: TextStyle(fontSize: 12.5, color: palette.leafDeep),
                ),
              ),
          ]),
          const SizedBox(height: 24),
          Text(
            zh
                ? '表格导出（xlsx）不做 — CSV 表格软件都认得，而写 xlsx 要给核心加一堆依赖。'
                : 'Spreadsheet (xlsx) export is deliberately absent: CSV opens '
                      'in every spreadsheet, and writing xlsx would cost the core '
                      'a pile of dependencies.',
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
        child: Text(
          title,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: palette.inkSoft,
          ),
        ),
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
          crossAxisAlignment: CrossAxisAlignment.start,
          children: children,
        ),
      ),
    ],
  );

  Widget _chip({
    required String key,
    required String label,
    required bool on,
    required VoidCallback onTap,
  }) => Tap(
    radius: Rad.pill,
    key: Key(key),
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 7),
      decoration: BoxDecoration(
        color: on ? palette.stamen.withValues(alpha: 0.18) : Colors.transparent,
        borderRadius: BorderRadius.circular(Rad.pill),
        border: Border.all(color: on ? palette.stamen : palette.line),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 13,
          fontWeight: on ? FontWeight.w700 : FontWeight.w500,
          color: palette.ink,
        ),
      ),
    ),
  );
}
