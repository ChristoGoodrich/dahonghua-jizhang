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

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'assets_screen.dart';
import 'backup_screen.dart';
import 'bottom_nav.dart';
import 'budget_screen.dart';
import 'petal_burst.dart';
import 'budget_widget.dart';
import 'currency_screen.dart';
import 'entry_list.dart';
import 'library_screen.dart';
import 'me_screen.dart';
import 'capture_screen.dart';
import 'inbox.dart';
import 'lock_gate.dart';
import 'import_screen.dart';
import 'persistence.dart';
import 'record_sheet.dart' as sheet;
import 'reimburse_screen.dart';
import 'settings_screen.dart';
import 'sync_screen.dart';
import 'report_screen.dart';
import 'stats_screen.dart';
import 'subs_screen.dart';
import 'theme.dart';
import 'toast.dart';
import 'src/rust/api/budget.dart' as budget;
import 'src/rust/api/history.dart' as history;
import 'src/rust/api/store.dart' as store;
import 'src/rust/api/theme.dart' as theme;
import 'src/rust/frb_generated.dart';
import 'ledger_days.dart';

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

const paper = '#FBF7F0';
const card = '#FFFFFF';
const ink = '#2B2622';

/// The root, and the only thing that can rebuild `MaterialApp.theme`.
///
/// Stateful for exactly one reason: a theme change has to reach `appTheme()`,
/// and a `StatelessWidget` computes it once. Every widget below reads
/// `palette` and follows on its own rebuild, but the Material defaults —
/// dialogs, menus, the switch this very setting is toggled with — come from
/// here.
class App extends StatefulWidget {
  const App({super.key, this.store});

  final Persistence? store;

  @override
  State<App> createState() => _AppState();
}

class _AppState extends State<App> {
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: '大红花记账',
    debugShowCheckedModeBanner: false,
    theme: appTheme(),
    // The gate wraps the shell rather than replacing it: covering the app
    // keeps the navigator mounted, so unlocking returns to wherever the user
    // was rather than to the first tab.
    // The outermost declaration of the system bars' colours. An `AppBar` puts
    // its own region deeper in the tree and wins where there is one; this is
    // what answers for the two tabs that have no header at all, and it
    // rebuilds with the root when the flower or the room changes.
    home: AnnotatedRegion<SystemUiOverlayStyle>(
      value: systemOverlay,
      child: LockGate(
        zh: store.language() != 'en',
        child: Home(store: widget.store, onThemeChanged: () => setState(() {})),
      ),
    ),
  );
}

/// The shell: four tabs, a record button, and routes behind the hubs.
class Home extends StatefulWidget {
  const Home({super.key, this.store, this.onThemeChanged});

  final Persistence? store;

  /// The palette changed, so the root has to rebuild for the Material
  /// defaults to follow. Null when the shell is shown without a root above
  /// it, which is how most tests pump it.
  final VoidCallback? onThemeChanged;

  @override
  State<Home> createState() => _HomeState();
}

class _HomeState extends State<Home> with WidgetsBindingObserver {
  int _tab = 0;

  /// The + button, which a burst of flowers comes out of.
  final _addKey = GlobalKey(debugLabel: 'add');

  /// The entry list is in 批量处理. The shell's nav bar stands down while it
  /// is, because the selection bar takes the same slot — two bars in one slot
  /// is the kind of thing that looks fine in a widget test and stacks on a
  /// phone.
  bool _selecting = false;

  /// Which language the app speaks, read from the store rather than assumed.
  ///
  /// Threaded down rather than read at each screen: a screen that fetched it
  /// itself would keep the old one until it happened to rebuild, so switching
  /// language would translate the app a screen at a time.
  bool _zh = store.language() != 'en';

  /// One number per tab, bumped when the ledger or the config changes and
  /// used as that tab's key, so it re-reads the store instead of holding a
  /// stale copy of it.
  ///
  /// Per tab rather than one for all four, because recreating all four is
  /// expensive and almost never urgent: at 3,000 entries it was 89ms on an
  /// emulator, a phone is slower, and it ran on every change a screen pushed
  /// from 我的 reported — under the finger of whoever was using that screen.
  /// See [_invalidate].
  final _versions = [0, 0, 0, 0];

  /// How many routes are over the shell right now.
  int _covered = 0;

  /// A change arrived while a route covered the tabs it did not refresh.
  bool _stale = false;

  /// Which refresh is current, so an older one's remaining steps stand down.
  int _generation = 0;

  /// The flower, the room and the language — the part of the config the root
  /// has to rebuild for. See [_configChanged].
  (String, bool, String) _look = _lookNow();

  static (String, bool, String) _lookNow() =>
      (theme.themeKey(), theme.isDark(), store.language());

  /// 我的's streak, and the version of 我的 it was worked out for.
  (int, int)? _streakKept;
  int _streakAt = -1;

  /// The capture inbox, drained on every return to the foreground.
  ///
  /// The listener writes to a native queue whether this app is running or not,
  /// so the queue is what carries a payment across a killed process. Resuming
  /// is the moment the Dart side is guaranteed to be alive to read it — and
  /// waiting for the user to open one screen would mean the feature only worked
  /// when watched.
  final Inbox _inbox = Inbox();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_drain());
  }

  Future<void> _drain() async {
    await _inbox.load();
    final r = await _inbox.drain();
    // Only a row that reached the ledger needs the file written; a queued or
    // unparsed capture is the inbox's own business and it has saved itself.
    if (r.posted > 0 && mounted) _entriesChanged();
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
    if (state == AppLifecycleState.resumed) unawaited(_drain());
  }

  /// The home-screen widget shows the budget, and the budget is a function of
  /// the ledger and the settings — so every path that changes either pushes it.
  /// Not awaited: a home screen redrawing is not something a tap should wait
  /// on, and a failure there is handled by leaving the widget stale.
  void _pushWidget() {
    unawaited(refreshWidget(zh: _zh));
  }

  void _entriesChanged() {
    widget.store?.touchEntries();
    _pushWidget();
    _invalidate();
  }

  void _configChanged() {
    widget.store?.touchConfig();
    _pushWidget();
    _zh = store.language() != 'en';
    _invalidate();
    // The flower and the language live in the config too, and only the root
    // can carry them into `MaterialApp`. Only when one of them moved: this
    // used to fire on every setting, and a new `ThemeData` rebuilds every
    // widget that reads the theme — which is all of them, the screen being
    // used included — to add a tag.
    final look = _lookNow();
    if (look != _look) {
      _look = look;
      widget.onThemeChanged?.call();
    }
  }

  void _bothChanged() {
    widget.store?.touchEntries();
    widget.store?.touchConfig();
    _pushWidget();
    _invalidate();
  }

  /// The store changed: the tabs have to read it again.
  ///
  /// The one showing reads now — it is what a route over it will reveal when
  /// it goes, and 明细 has to have the entry the record sheet just saved by
  /// the time the sheet slides off it. The other three are nobody's to look
  /// at: they wait for the routes to go, and then read one a frame, so no
  /// frame carries all four.
  void _invalidate() {
    final gen = ++_generation;
    setState(() => _versions[_tab]++);
    final rest = [
      for (var i = 0; i < _versions.length; i++)
        if (i != _tab) i,
    ];
    if (_covered > 0) {
      _stale = true;
      return;
    }
    _stagger(gen, rest);
  }

  void _stagger(int gen, List<int> tabs) {
    if (tabs.isEmpty) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || gen != _generation) return;
      setState(() => _versions[tabs.first]++);
      _stagger(gen, tabs.sublist(1));
    });
  }

  /// Push `route` over the shell, and hold the tabs it hides until it is gone.
  ///
  /// Returns when the route pops, which is when its exit animation *starts* —
  /// so a caller can react at once. The held refresh waits for the animation
  /// to finish: reading three tabs' worth of ledger in the first frame of it
  /// is what made going back stutter.
  Future<T?> _cover<T>(Route<T> route) async {
    _covered++;
    try {
      return await Navigator.of(context).push(route);
    } finally {
      unawaited(_uncover(route));
    }
  }

  Future<void> _uncover(Route<dynamic> route) async {
    final a = route is ModalRoute ? route.animation : null;
    if (a != null && a.status != AnimationStatus.dismissed) {
      final gone = Completer<void>();
      void listen(AnimationStatus s) {
        if (s == AnimationStatus.dismissed && !gone.isCompleted) {
          gone.complete();
        }
      }

      a.addStatusListener(listen);
      // A route removed without an exit animation never reaches dismissed,
      // and a shell waiting on it forever would never refresh again.
      await gone.future.timeout(
        const Duration(milliseconds: 800),
        onTimeout: () {},
      );
      a.removeStatusListener(listen);
    }
    _covered--;
    if (_covered == 0 && _stale && mounted) {
      _stale = false;
      final gen = ++_generation;
      _stagger(gen, [
        for (var i = 0; i < _versions.length; i++)
          if (i != _tab) i,
      ]);
    }
  }

  /// Open the record sheet. `editId` null records a new entry.
  ///
  /// A route rather than a tab: saving pops back to whatever was underneath,
  /// which is the behaviour without the shell having to track it.
  Future<void> _record({String? editId, int? at}) async {
    var saved = 0;
    await _cover(
      MaterialPageRoute<void>(
        builder: (_) => sheet.RecordSheet(
          editId: editId,
          initialTs: at,
          zh: _zh,
          onSaved: ({required staleRate}) {
            saved++;
            _entriesChanged();
          },
        ),
      ),
    );
    // A flower for each new entry, the shipping app's reward — played once
    // the sheet has gone, where the + button it comes out of can be seen.
    // Not for an edit, which planted nothing.
    if (saved > 0 && editId == null && mounted) {
      _celebrate(toast: _zh ? '贴上一朵花' : 'One more flower');
    }
  }

  /// 贴上一朵花: flowers out of the + button, and a word to say why.
  ///
  /// The burst is skipped under reduced motion, and the word is not — it is
  /// the part that says the entry landed.
  void _celebrate({String? toast}) {
    final still = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    final box = _addKey.currentContext?.findRenderObject() as RenderBox?;
    if (!still && box != null && box.attached) {
      final at = box.localToGlobal(box.size.center(Offset.zero));
      late final OverlayEntry entry;
      entry = OverlayEntry(
        builder: (_) => Positioned(
          left: at.dx,
          top: at.dy,
          child: PetalBurst(
            key: const Key('petal-burst'),
            seed: DateTime.now().microsecondsSinceEpoch,
            onDone: () => entry.remove(),
          ),
        ),
      );
      Overlay.of(context).insert(entry);
    }
    if (toast != null) {
      showToast(
        context,
        key: const Key('bloom-toast'),
        text: toast,
        duration: const Duration(milliseconds: 1600),
      );
    }
  }

  /// A screen from a hub. Nothing to do when it comes back: whatever it
  /// changed, it reported, and the tabs it hid refresh once it has gone.
  Future<void> _push(Widget screen) =>
      _cover(MaterialPageRoute<void>(builder: (_) => screen));

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: palette.paper,
    body: IndexedStack(
      index: _tab,
      children: [
        for (final (i, tab) in _tabs().indexed)
          // A tab that is not showing does not tick. `IndexedStack` keeps all
          // four alive, and a chart's reveal or a lens's spring running on one
          // nobody can see was a frame scheduled for nothing — while a screen
          // pushed over the lot was trying to have that frame.
          TickerMode(enabled: i == _tab, child: tab),
      ],
    ),
    // The bar floats over the content rather than sitting under it, which is
    // the shipping app's shape: `position: absolute` with the content running
    // behind it. `extendBody` is what lets the blur have something to blur —
    // a bar in the `bottomNavigationBar` slot has only the scaffold's
    // background behind it, and blurring a flat colour produces a flat colour.
    extendBody: true,
    bottomNavigationBar: _selecting ? null : _bar(),
  );

  List<Widget> _tabs() => [
    EntryListScreen(
      key: ValueKey(_versions[0]),
      zh: _zh,
      onEdit: (id) => _record(editId: id),
      onChanged: _entriesChanged,
      onSelecting: (v) => setState(() => _selecting = v),
      onOpenBudget: () =>
          _push(BudgetScreen(zh: _zh, onChanged: _configChanged)),
      onOpenStats: () => setState(() => _tab = 1),
      onRecordAt: (ts) => _record(at: ts),
      onLogged: () => _celebrate(),
      onPrivacy: _configChanged,
    ),
    StatsScreen(
      key: ValueKey(_versions[1]),
      zh: _zh,
      onEdit: (id) => _record(editId: id),
    ),
    AssetsScreen(key: ValueKey(_versions[2]), zh: _zh, onChanged: _bothChanged),
    MeScreen(
      key: ValueKey(_versions[3]),
      zh: _zh,
      groups: _meGroups(),
      streak: _streakFor(_versions[3]),
    ),
  ];

  /// The streak, worked out once per version of 我的 rather than on every
  /// build of the shell — which is every tab switch.
  (int, int)? _streakFor(int version) {
    if (version != _streakAt) {
      _streakKept = _streak();
      _streakAt = version;
    }
    return _streakKept;
  }

  /// How many entries this cycle, and how many days in a row.
  ///
  /// Both are the core's arithmetic over days Dart resolved — "consecutive" is
  /// a claim about calendar days, and which day an instant falls on is the
  /// device's zone to answer. Null before there is anything to say.
  (int, int)? _streak() {
    final l = LedgerDays.current();
    if (l.ids.isEmpty) return null;
    final todayKey = dayKey(DateTime.now());
    final inCycle = budget.cycleIds(
      ids: l.ids,
      daysOf: l.days,
      today: todayKey,
    );
    return (
      inCycle.length,
      history.streak(days: l.days, today: todayKey).toInt(),
    );
  }

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
            desc: zh
                ? '这个周期和这一周,过得怎么样'
                : 'How the cycle and the week are going',
            onTap: () => _push(ReportScreen(zh: zh)),
          ),
          MeRow(
            id: 'reimburse',
            icon: Icons.receipt_long_outlined,
            title: zh ? '报销' : 'Reimbursements',
            desc: zh ? '垫的钱,和收回来的' : 'What you fronted, and what came back',
            onTap: () =>
                _push(ReimburseScreen(zh: zh, onChanged: _entriesChanged)),
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
            onTap: () =>
                _push(TemplatesScreen(zh: zh, onChanged: _configChanged)),
          ),
          MeRow(
            id: 'currency',
            icon: Icons.currency_exchange,
            title: zh ? '币种与汇率' : 'Currencies',
            desc: zh ? '记账单位,和别的币种怎么换' : 'The base unit, and the rates',
            onTap: () => _push(
              CurrencyScreen(
                zh: zh,
                onChanged: ({required ledgerToo}) =>
                    ledgerToo ? _bothChanged() : _configChanged(),
              ),
            ),
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
            id: 'capture',
            icon: Icons.notifications_active_outlined,
            title: zh ? '自动记账' : 'Auto-capture',
            desc: zh ? '支付通知一到就记下' : 'A payment push becomes an entry',
            onTap: () =>
                _push(CaptureScreen(zh: zh, onChanged: _entriesChanged)),
          ),
          MeRow(
            id: 'import',
            icon: Icons.file_upload_outlined,
            title: zh ? '导入账单' : 'Import bills',
            desc: zh ? '支付宝或微信导出的 CSV' : 'A CSV from Alipay or WeChat',
            onTap: () =>
                _push(ImportScreen(zh: zh, onImported: _entriesChanged)),
          ),
          MeRow(
            id: 'backup',
            icon: Icons.archive_outlined,
            title: zh ? '备份' : 'Backups',
            desc: zh ? '存一份现在的样子,随时回去' : 'Snapshots you can go back to',
            onTap: () => _push(
              BackupScreen(
                zh: zh,
                // a restore replaces both files and every screen's contents
                onRestored: _bothChanged,
              ),
            ),
          ),
          MeRow(
            id: 'sync',
            icon: Icons.sync_alt,
            title: zh ? '同步' : 'Sync',
            desc: zh
                ? '通过一个文件,和另一台设备合并'
                : 'Merge with another device, through a file',
            onTap: () => _push(
              SyncScreen(
                zh: zh,
                // a merge rewrites the ledger and may add accounts
                onChanged: _bothChanged,
              ),
            ),
          ),
          MeRow(
            id: 'settings',
            icon: Icons.tune,
            title: zh ? '设置' : 'Settings',
            desc: zh ? '语言和账单周期' : 'Language and the budget cycle',
            onTap: () =>
                _push(SettingsScreen(zh: zh, onChanged: _configChanged)),
          ),
        ],
      ),
    ];
  }

  /// The bar and the record button beside it: see bottom_nav.dart.
  ///
  /// Nothing about how it looks is decided here. What lives in this class is
  /// which tab is showing and what the record button does.
  Widget _bar() => BottomNav(
    addKey: _addKey,
    active: _tab,
    onChange: (i) => setState(() => _tab = i),
    onAdd: () => _record(),
    labels: _zh
        ? const ['明细', '统计', '资产', '我的']
        : const ['Entries', 'Stats', 'Assets', 'Me'],
  );
}
