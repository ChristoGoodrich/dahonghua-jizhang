// The app shell.
//
// Four tabs and a record button, which is the shipping app's shape and is a
// shape rather than a preference: 明细 and 统计 are the two ways of reading the
// ledger, 资产 and 我的 are hubs, and recording is the one thing frequent enough
// to deserve an object of its own rather than a slot in a row.
//
// Everything else is a route pushed from a hub. A bottom bar runs out of room
// at about five slots and this app has twenty screens; the previous six-tab
// arrangement had already stopped being able to grow.
//
// Editing an entry pushes the record sheet rather than switching to it, which
// is what makes "save" mean "go back to what I was looking at" without the
// shell having to remember where that was.

import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'assets_screen.dart';
import 'backup_screen.dart';
import 'budget_screen.dart';
import 'currency_screen.dart';
import 'entry_list.dart';
import 'library_screen.dart';
import 'me_screen.dart';
import 'import_screen.dart';
import 'persistence.dart';
import 'record_sheet.dart' as sheet;
import 'reimburse_screen.dart';
import 'settings_screen.dart';
import 'report_screen.dart';
import 'stats_screen.dart';
import 'subs_screen.dart';
import 'theme.dart';
import 'src/rust/api/calc.dart' as calc;
import 'src/rust/api/glass.dart' as glass;
import 'src/rust/api/store.dart' as store;
import 'src/rust/frb_generated.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await RustLib.init();
  final store = await Persistence.open();
  // Seeding writes rows, and rows that are never written to disk are seeded
  // again on the next launch — which looks exactly like persistence working
  // while nothing is being saved at all. That is what a screenshot showed and
  // an `ls` of the app directory disproved.
  if (_seedIfEmpty()) await store.flush();
  // Catch up any subscription charges that came due while the app was closed.
  // Before the first frame, so the list does not visibly gain rows a moment
  // after it is drawn.
  if (runDueCharges().isNotEmpty) await store.flush();
  runApp(App(store: store));
}

/// A few rows on a genuinely empty ledger, so a fresh install has something to
/// look at. Written through the ordinary commands — there is no back door into
/// the store, and this is not one.
///
/// It runs after the load, so it can tell "nothing saved yet" from "saved, and
/// empty" — a user who deleted their last entry does not get it handed back.
/// True when it actually seeded, so the caller knows there is something to
/// write.
bool _seedIfEmpty() {
  if (store.entryCount() > 0) return false;
  final now = DateTime.now().millisecondsSinceEpoch;
  const day = 86400000;
  final rows = <(String, String, double, String?, int)>[
    ('exp', 'food', 35.5, '午饭', now),
    ('exp', 'trans', 12, '打车', now - 3600 * 1000),
    ('inc', 'salary', 9000, null, now - day),
    ('exp', 'shop', 218.4, '毛衣', now - day),
    ('exp', 'home', 1800, '房租', now - day * 3),
  ];
  for (var i = 0; i < rows.length; i++) {
    final (io, cat, amt, note, ts) = rows[i];
    store.addEntry(
      entry: store.NewEntry(io: io, cat: cat, amt: amt, note: note, ts: ts),
      id: 'seed-$i',
      now: now + i,
    );
  }
  return true;
}

/// `rgba(r, g, b, a)` from Rust → a Flutter colour.
///
/// The mix, the ambient pull and the readability curve all happened on the
/// other side of the boundary; this only parses the answer.
Color parseRgba(String s) {
  final n = RegExp(
    r'[-0-9.eE+]+',
  ).allMatches(s).map((m) => double.parse(m.group(0)!)).toList();
  return Color.fromRGBO(
    n[0].toInt(),
    n[1].toInt(),
    n[2].toInt(),
    n.length > 3 ? n[3] : 1,
  );
}

const paper = '#FBF7F0';
const card = '#FFFFFF';
const ink = '#2B2622';

class App extends StatelessWidget {
  const App({super.key, this.store});

  final Persistence? store;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: '大红花记账',
    debugShowCheckedModeBanner: false,
    theme: appTheme(),
    home: Home(store: store),
  );
}

/// The shell: four tabs, a record button, and routes behind the hubs.
class Home extends StatefulWidget {
  const Home({super.key, this.store});

  final Persistence? store;

  @override
  State<Home> createState() => _HomeState();
}

class _HomeState extends State<Home> with WidgetsBindingObserver {
  int _tab = 0;

  /// Which language the app speaks, read from the store rather than assumed.
  ///
  /// Threaded down rather than read at each screen: a screen that fetched it
  /// itself would keep the old one until it happened to rebuild, so switching
  /// language would translate the app a screen at a time.
  bool _zh = store.language() != 'en';

  /// Bumped whenever the ledger or the config changes, and used as a key so
  /// every screen re-reads the store instead of holding a stale copy of it.
  int _listVersion = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Write everything out before the process can be killed.
  ///
  /// `paused` is the last moment Android promises to give an app. A debounce
  /// still counting when the process is reclaimed loses exactly the work it was
  /// holding, so this is where the trade stops being worth making.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      widget.store?.flush();
    }
  }

  void _entriesChanged() {
    widget.store?.touchEntries();
    setState(() => _listVersion++);
  }

  void _configChanged() {
    widget.store?.touchConfig();
    setState(() {
      _zh = store.language() != 'en';
      _listVersion++;
    });
  }

  void _bothChanged() {
    widget.store?.touchEntries();
    widget.store?.touchConfig();
    setState(() => _listVersion++);
  }

  /// Open the record sheet. `editId` null records a new entry.
  ///
  /// A route rather than a tab: saving pops back to whatever was underneath,
  /// which is the behaviour without the shell having to track it.
  Future<void> _record({String? editId}) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => sheet.RecordSheet(
          editId: editId,
          zh: _zh,
          onSaved: ({required staleRate}) => _entriesChanged(),
        ),
      ),
    );
    // the sheet may have written rows while it was up
    setState(() {});
  }

  Future<void> _push(Widget screen) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => screen),
    );
    setState(() {});
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: palette.paper,
    body: IndexedStack(
      index: _tab,
      children: [
        EntryListScreen(
          key: ValueKey(_listVersion),
          zh: _zh,
          onEdit: (id) => _record(editId: id),
          onChanged: _entriesChanged,
        ),
        StatsScreen(key: ValueKey(_listVersion), zh: _zh),
        AssetsScreen(
          key: ValueKey(_listVersion),
          zh: _zh,
          onChanged: _bothChanged,
        ),
        MeScreen(
          key: ValueKey(_listVersion),
          zh: _zh,
          groups: _meGroups(),
        ),
      ],
    ),
    bottomNavigationBar: _bar(),
  );

  List<(String, List<MeRow>)> _meGroups() {
    final zh = _zh;
    return [
      (
        zh ? '记账工具' : 'Tools',
        [
          MeRow(
            id: 'report',
            icon: Icons.insights_outlined,
            title: zh ? '回顾' : 'Report',
            desc: zh ? '这个周期和这一周,过得怎么样' : 'How the cycle and the week are going',
            onTap: () => _push(ReportScreen(zh: zh)),
          ),
          MeRow(
            id: 'reimburse',
            icon: Icons.receipt_long_outlined,
            title: zh ? '报销' : 'Reimbursements',
            desc: zh ? '垫的钱,和收回来的' : 'What you fronted, and what came back',
            onTap: () => _push(ReimburseScreen(zh: zh, onChanged: _entriesChanged)),
          ),
          MeRow(
            id: 'budget',
            icon: Icons.savings_outlined,
            title: zh ? '预算' : 'Budgets',
            desc: zh ? '每月、每天和分类的上限' : 'Monthly, daily and per-category caps',
            onTap: () => _push(BudgetScreen(zh: zh, onChanged: _configChanged)),
          ),
          MeRow(
            id: 'subs',
            icon: Icons.autorenew_outlined,
            title: zh ? '订阅' : 'Subscriptions',
            desc: zh ? '到期自动记一笔' : 'Charges that post themselves',
            onTap: () => _push(SubsScreen(zh: zh, onChanged: _bothChanged)),
          ),
          MeRow(
            id: 'templates',
            icon: Icons.bolt_outlined,
            title: zh ? '模板' : 'Templates',
            desc: zh ? '一按就记的常用笔' : 'One-tap entries you make often',
            onTap: () => _push(TemplatesScreen(zh: zh, onChanged: _configChanged)),
          ),
          MeRow(
            id: 'currency',
            icon: Icons.currency_exchange,
            title: zh ? '币种与汇率' : 'Currencies',
            desc: zh ? '记账单位,和别的币种怎么换' : 'The base unit, and the rates',
            onTap: () => _push(CurrencyScreen(
              zh: zh,
              onChanged: ({required ledgerToo}) =>
                  ledgerToo ? _bothChanged() : _configChanged(),
            )),
          ),
          MeRow(
            id: 'tags',
            icon: Icons.label_outline,
            title: zh ? '标签与账本' : 'Tags and ledgers',
            desc: zh ? '给记录分组,或者分成几本账' : 'Group entries, or split the books',
            onTap: () => _push(TagsScreen(zh: zh, onChanged: _configChanged)),
          ),
        ],
      ),
      (
        zh ? '更多' : 'More',
        [
          MeRow(
            id: 'import',
            icon: Icons.file_upload_outlined,
            title: zh ? '导入账单' : 'Import bills',
            desc: zh ? '支付宝或微信导出的 CSV' : 'A CSV from Alipay or WeChat',
            onTap: () => _push(ImportScreen(zh: zh, onImported: _entriesChanged)),
          ),
          MeRow(
            id: 'backup',
            icon: Icons.archive_outlined,
            title: zh ? '备份' : 'Backups',
            desc: zh ? '存一份现在的样子,随时回去' : 'Snapshots you can go back to',
            onTap: () => _push(BackupScreen(
              zh: zh,
              // a restore replaces both files and every screen's contents
              onRestored: _bothChanged,
            )),
          ),
          MeRow(
            id: 'settings',
            icon: Icons.tune,
            title: zh ? '设置' : 'Settings',
            desc: zh ? '语言和账单周期' : 'Language and the budget cycle',
            onTap: () => _push(SettingsScreen(zh: zh, onChanged: _configChanged)),
          ),
        ],
      ),
    ];
  }

  /// Material 3's default NavigationBar paints itself lavender, which against
  /// this palette's warm paper reads as a different application's chrome. The
  /// colours are the theme's, not the framework's.
  ///
  /// The record button sits beside the bar rather than inside it: the bar stays
  /// one uninterrupted surface, and the primary action gets its own weight.
  Widget _bar() => Container(
    decoration: BoxDecoration(
      color: palette.card,
      border: Border(top: BorderSide(color: palette.line)),
    ),
    child: SafeArea(
      top: false,
      child: SizedBox(
        height: 64,
        child: Row(
          children: [
            _tabItem(0, Icons.receipt_long, _zh ? '明细' : 'Entries'),
            _tabItem(1, Icons.pie_chart_outline, _zh ? '统计' : 'Stats'),
            _recordButton(),
            _tabItem(2, Icons.account_balance_wallet_outlined,
                _zh ? '资产' : 'Assets'),
            _tabItem(3, Icons.person_outline, _zh ? '我的' : 'Me'),
          ],
        ),
      ),
    ),
  );

  Widget _tabItem(int i, IconData icon, String label) {
    final on = _tab == i;
    return Expanded(
      child: InkWell(
        key: Key('tab-$label'),
        onTap: () {
          HapticFeedback.selectionClick();
          setState(() => _tab = i);
        },
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 22, color: on ? palette.hibiscus : palette.inkSoft),
            const SizedBox(height: 3),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: on ? palette.hibiscus : palette.inkSoft,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _recordButton() => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 6),
    child: Semantics(
      button: true,
      label: _zh ? '记一笔' : 'Record',
      child: GestureDetector(
        key: const Key('record-button'),
        onTap: () {
          HapticFeedback.selectionClick();
          _record();
        },
        child: Container(
          width: 52,
          height: 52,
          decoration: BoxDecoration(
            color: palette.hibiscus,
            borderRadius: BorderRadius.circular(Rad.md),
          ),
          child: const Icon(Icons.add, color: Colors.white, size: 26),
        ),
      ),
    ),
  );
}

/// The throwaway prototype, kept.
///
/// It is not a screen the app uses any more — the real record sheet is
/// record_sheet.dart. This is what answered the three questions the
/// architecture had to settle on a device before Flutter was chosen: does a
/// Chinese IME compose, does 柔光玻璃 render, do accessibility labels reach
/// Android. It still demonstrates the fourth: every colour on it is computed in
/// Rust. Renamed because two classes called RecordSheet is one too many.
class MaterialProbe extends StatefulWidget {
  const MaterialProbe({super.key});

  @override
  State<MaterialProbe> createState() => _MaterialProbeState();
}

class _MaterialProbeState extends State<MaterialProbe> {
  final _note = TextEditingController();
  String _expr = '';

  @override
  void initState() {
    super.initState();
    _note.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  void _key(String k) =>
      setState(() => _expr = calc.applyKey(expr: _expr, key: k));

  @override
  Widget build(BuildContext context) {
    // Every one of these is a Rust call.
    final tier = glass.resolveTier(reduceTransparency: false, isWeb: false);
    final spec = glass.glassSpec(isDark: false, level: glass.GlassLevel.card);
    final alpha = glass.readabilityAlpha(
      isDark: false,
      level: glass.GlassLevel.card,
      density: 0.6,
      tier: tier,
    );
    final wash = glass.washColor(
      isDark: false,
      card: card,
      paper: paper,
      level: glass.GlassLevel.card,
      under: paper,
      alpha: alpha,
    );
    final total = calc.evalExpr(expr: _expr);
    final showsTotal = calc.hasOperator(expr: _expr);

    return Scaffold(
      backgroundColor: parseRgba(
        glass.washColor(
          isDark: false,
          card: paper,
          paper: paper,
          level: glass.GlassLevel.card,
          alpha: 1,
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                '记一笔',
                style: TextStyle(
                  fontSize: 30,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF2B2622),
                ),
              ),
              const SizedBox(height: 16),
              // Detailed content *behind* the glass, so a real backdrop blur is
              // distinguishable from a flat translucent slab.
              _behind(),
              const SizedBox(height: -60 + 60),
              Transform.translate(
                offset: const Offset(0, -46),
                child: _glassCard(spec, wash, showsTotal ? total : null),
              ),
              const Text(
                '备注（在这里用中文输入法打字）',
                style: TextStyle(fontSize: 14, color: Color(0xFF8A8178)),
              ),
              const SizedBox(height: 8),
              Semantics(
                label: '备注',
                textField: true,
                child: TextField(
                  controller: _note,
                  decoration: InputDecoration(
                    hintText: '午饭、打车、房租…',
                    filled: true,
                    fillColor: Colors.white,
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: Color(0xFFEADFCF)),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(
                        color: Color(0xFFE0A93C),
                        width: 2,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                '读回：「${_note.text}」 长度 ${_note.text.length}',
                style: const TextStyle(fontSize: 14, color: Color(0xFFB83A48)),
              ),
              const SizedBox(height: 16),
              _keypad(),
              const SizedBox(height: 10),
              Text(
                'tier=${tier.name}  intensity=${spec.intensity}  alpha=$alpha\n$wash',
                style: const TextStyle(fontSize: 12, color: Color(0xFF8A8178)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Busy content the glass sits over, so the blur has something to blur.
  Widget _behind() => Container(
    height: 150,
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(20),
      gradient: const LinearGradient(
        colors: [Color(0xFFE8AB80), Color(0xFF8DC0E0), Color(0xFF94C494)],
      ),
    ),
    padding: const EdgeInsets.all(14),
    child: const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '餐饮 · 现金 · -35.00',
          style: TextStyle(color: Colors.white, fontSize: 17),
        ),
        Text(
          '交通 · 支付宝 · -12.00',
          style: TextStyle(color: Colors.white, fontSize: 17),
        ),
        Text(
          '工资 · 招行 · +9,000.00',
          style: TextStyle(color: Colors.white, fontSize: 17),
        ),
        Text(
          '购物 · 微信 · -218.40',
          style: TextStyle(color: Colors.white, fontSize: 17),
        ),
      ],
    ),
  );

  /// The material itself: a real backdrop blur behind a wash Rust computed.
  Widget _glassCard(glass.GlassSpec spec, String wash, double? total) {
    // `intensity` is an expo-blur 0–100; Flutter's sigma is a radius in
    // logical pixels. The shipping tuning treats them as the same curve.
    final sigma = spec.intensity / 3.5;
    final hairline = spec.edgeWidth < 0
        ? 1 / MediaQuery.devicePixelRatioOf(context)
        : spec.edgeWidth;
    return ClipRRect(
      borderRadius: BorderRadius.circular(26),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: sigma, sigmaY: sigma),
        child: Container(
          height: 132,
          decoration: BoxDecoration(
            color: parseRgba(wash),
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: parseRgba(spec.edge), width: hairline),
          ),
          alignment: Alignment.center,
          child: Semantics(
            label: '金额',
            child: Text(
              total != null
                  ? total.toStringAsFixed(2)
                  : (_expr.isEmpty ? '0' : _expr),
              style: const TextStyle(
                fontSize: 44,
                fontWeight: FontWeight.w700,
                color: Color(0xFF2B2622),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _keypad() {
    const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'];
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      childAspectRatio: 2.1,
      children: [
        for (final k in keys)
          Semantics(
            label: k == '⌫' ? '退格' : k,
            button: true,
            child: Material(
              color: const Color(0xFFF6EEE2),
              borderRadius: BorderRadius.circular(16),
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () {
                  HapticFeedback.selectionClick();
                  _key(k == '⌫' ? 'back' : k);
                },
                child: Center(
                  child: Text(
                    k,
                    style: const TextStyle(
                      fontSize: 24,
                      color: Color(0xFF2B2622),
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
