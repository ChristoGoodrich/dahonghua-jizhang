// The entry list, rendered on a device against the real Rust ledger.
//
// Not a mock in sight: rows are written through the store commands, the screen
// asks the store what to draw, and these read the pixels' worth of text that
// comes out. What is being checked is the seam — that a decision made in Rust
// arrives on screen intact — rather than the arithmetic, which the parity
// corpus already pinned against the shipping TypeScript.

import 'package:flutter/material.dart';
import 'package:flutter_app/bloom.dart';
import 'package:flutter_app/entry_list.dart';
import 'package:flutter_app/glass.dart';
import 'package:flutter_app/home_header.dart';
import 'package:flutter_app/src/rust/api/accounts.dart' as accounts;
import 'package:flutter_app/src/rust/api/catalog.dart' as catalog;
import 'package:flutter_app/src/rust/api/home.dart' as home;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';
import 'scroll.dart';

const day = 86400000;

/// Anchored to the device's own clock, because the screen asks it what "today"
/// is — the timezone is the platform's, which is the whole arrangement.
int get now => DateTime.now().millisecondsSinceEpoch;

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: EntryListScreen(zh: zh)));
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  testWidgets('an empty ledger says so rather than showing nothing', (
    tester,
  ) async {
    await show(tester);
    expect(find.text('还没有记账'), findsOneWidget);
  });

  testWidgets('a row shows its category, note and signed amount', (
    tester,
  ) async {
    store.addEntry(
      entry: store.NewEntry(
        io: 'exp',
        cat: 'food',
        amt: 35.5,
        note: '午饭',
        ts: now,
      ),
      id: 'e1',
      now: now,
    );
    await show(tester);

    expect(find.text('餐饮'), findsOneWidget); // the category name, from Rust
    expect(find.text('🍜'), findsOneWidget); // and its emoji
    expect(find.text('午饭'), findsOneWidget);
    expect(
      find.text('-35.50'),
      findsOneWidget,
    ); // signed, grouped, two decimals
  });

  testWidgets('income is signed the other way and coloured differently', (
    tester,
  ) async {
    store.addEntry(
      entry: store.NewEntry(io: 'inc', cat: 'salary', amt: 9000, ts: now),
      id: 'e1',
      now: now,
    );
    await show(tester);

    expect(find.text('+9,000.00'), findsOneWidget); // grouping, from Rust
    final amt = tester.widget<Text>(find.text('+9,000.00'));
    expect(amt.style!.color, palette.leafDeep, reason: 'leafDeep, not ink');
  });

  testWidgets('days are grouped and headed, newest first', (tester) async {
    store.addEntry(
      entry: store.NewEntry(io: 'exp', cat: 'food', amt: 30, ts: now),
      id: 'today',
      now: now,
    );
    store.addEntry(
      entry: store.NewEntry(io: 'exp', cat: 'food', amt: 7, ts: now - day),
      id: 'yesterday',
      now: now - day,
    );
    await show(tester);

    expect(find.text('今天'), findsOneWidget);
    expect(find.text('昨天'), findsOneWidget);
    // the day totals, which Rust summed
    expect(find.text('支出 ￥30.00'), findsOneWidget);
    expect(find.text('支出 ￥7.00'), findsOneWidget);

    // and today's header sits above yesterday's
    final headers = tester.widgetList<Text>(find.byType(Text)).toList();
    final iToday = headers.indexWhere((t) => t.data == '今天');
    final iYesterday = headers.indexWhere((t) => t.data == '昨天');
    expect(iToday, lessThan(iYesterday));
  });

  testWidgets('a day with income and no expense heads with the income', (
    tester,
  ) async {
    store.addEntry(
      entry: store.NewEntry(io: 'inc', cat: 'salary', amt: 100, ts: now),
      id: 'e1',
      now: now,
    );
    await show(tester);
    expect(find.text('收入 ￥100.00'), findsOneWidget);
  });

  testWidgets('a tombstone is not drawn', (tester) async {
    store.addEntry(
      entry: store.NewEntry(
        io: 'exp',
        cat: 'food',
        amt: 30,
        note: '午饭',
        ts: now,
      ),
      id: 'e1',
      now: now,
    );
    store.removeEntry(id: 'e1', now: now);
    await show(tester);

    expect(find.text('午饭'), findsNothing);
    expect(find.text('还没有记账'), findsOneWidget);
  });

  testWidgets('a reimbursement mark shows as a badge', (tester) async {
    store.addEntry(
      entry: store.NewEntry(io: 'exp', cat: 'food', amt: 30, ts: now),
      id: 'e1',
      now: now,
    );
    store.updateEntry(
      id: 'e1',
      patch: store.EntryPatch(rb: 'pending'),
      now: now,
    );
    await show(tester);
    expect(find.text('待报销'), findsOneWidget);
  });

  testWidgets('English names the same rows differently', (tester) async {
    store.addEntry(
      entry: store.NewEntry(io: 'exp', cat: 'food', amt: 35.5, ts: now),
      id: 'e1',
      now: now,
    );
    await show(tester, zh: false);

    expect(find.text('Food'), findsOneWidget);
    expect(find.text('Today'), findsOneWidget);
    // The symbol is the *base currency's*, not the language's: an English
    // UI keeping a CNY ledger still reads ￥35.50.
    expect(find.text('Exp ￥35.50'), findsOneWidget);
  });

  testWidgets('every row carries an accessibility label', (tester) async {
    // Slint reached 0 of 8 nodes on Android; this is the standard Flutter was
    // chosen against, so it is worth a test rather than an assumption.
    store.addEntry(
      entry: store.NewEntry(
        io: 'exp',
        cat: 'food',
        amt: 35.5,
        note: '午饭',
        ts: now,
      ),
      id: 'e1',
      now: now,
    );
    await show(tester);

    final handle = tester.ensureSemantics();
    expect(find.bySemanticsLabel('餐饮, -35.50, 午饭'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('a hundred rows draw without the ledger crossing per row', (
    tester,
  ) async {
    for (var i = 0; i < 100; i++) {
      store.addEntry(
        entry: store.NewEntry(
          io: 'exp',
          cat: 'food',
          amt: 1,
          ts: now - i * 3600 * 1000,
        ),
        id: 'e$i',
        now: now + i,
      );
    }
    await show(tester);
    // a builder only builds what is visible; the point is that it did not hang
    expect(find.byType(ListView), findsOneWidget);
    expect(store.entryCount(), 100);
  });

  group('press feedback', () {
    // The complaint that produced `tap.dart`: rows fired but showed nothing,
    // so a tap that landed looked exactly like one that missed. There were 23
    // bare `GestureDetector`s in the app and every one of them was silent.

    testWidgets('a row lights while it is held', (tester) async {
      store.addEntry(
        entry: store.NewEntry(
          io: 'exp',
          cat: 'food',
          amt: 35.5,
          note: '午饭',
          ts: now,
        ),
        id: 'e1',
        now: now,
      );
      await show(tester);

      final row = find.byKey(const Key('row-e1'));
      double veilOf() => tester
          .widgetList<AnimatedOpacity>(
            find.descendant(of: row, matching: find.byType(AnimatedOpacity)),
          )
          .map((w) => w.opacity)
          .fold(0.0, (a, b) => a > b ? a : b);

      expect(veilOf(), 0, reason: 'nothing is pressed yet');

      final press = await tester.startGesture(tester.getCenter(row));
      await tester.pump(const Duration(milliseconds: 200));
      expect(veilOf(), 1, reason: 'the veil is up while the finger is down');

      await press.up();
      await tester.pumpAndSettle();
      expect(veilOf(), 0, reason: 'and gone when it lifts');
    });

    testWidgets('a cancelled press puts the light back', (tester) async {
      // Dragging off a row is how a swipe starts, and a row left lit after the
      // finger has gone somewhere else is worse than one that never lit.
      store.addEntry(
        entry: store.NewEntry(
          io: 'exp',
          cat: 'food',
          amt: 35.5,
          note: '午饭',
          ts: now,
        ),
        id: 'e1',
        now: now,
      );
      await show(tester);

      final row = find.byKey(const Key('row-e1'));
      final press = await tester.startGesture(tester.getCenter(row));
      await tester.pump(const Duration(milliseconds: 200));
      await press.moveBy(const Offset(200, 0));
      await press.up();
      await tester.pumpAndSettle();

      final lit = tester
          .widgetList<AnimatedOpacity>(
            find.descendant(of: row, matching: find.byType(AnimatedOpacity)),
          )
          .map((w) => w.opacity)
          .fold(0.0, (a, b) => a > b ? a : b);
      expect(lit, 0);
    });
  });

  group('渐进模糊 and the mark', () {
    /// The scrim's whole job is to have something to dissolve. A list that
    /// starts below the header has nothing running under it, and the blur
    /// would be a blur of paper — which is paper.
    testWidgets('the list runs under the header rather than stopping at it', (
      tester,
    ) async {
      store.addEntry(
        entry: store.NewEntry(io: 'exp', cat: 'food', amt: 30, ts: now),
        id: 'e1',
        now: now,
      );
      await show(tester);

      final list = tester.widget<ListView>(find.byType(ListView));
      final pad = list.padding! as EdgeInsets;
      expect(
        pad.top,
        greaterThanOrEqualTo(kToolbarHeight),
        reason: 'the first row has to clear a header it scrolls beneath',
      );
      expect(find.byType(GlassScrim), findsOneWidget);
    });

    /// 🌺 was somebody else's drawing — Noto's on one phone, Samsung's on
    /// another — and it was not the flower on the launcher icon the user had
    /// just tapped.
    testWidgets('an empty ledger shows the app own mark, not an emoji', (
      tester,
    ) async {
      await show(tester);

      expect(find.byType(Bloom), findsOneWidget);
      expect(find.text('🌺'), findsNothing);
    });

    testWidgets('the mark takes the flower the user chose', (tester) async {
      await show(tester);
      final bloom = tester.widget<Bloom>(find.byType(Bloom));
      // Left to the palette rather than pinned to the icon's #D94E5C: the
      // launcher cannot follow a theme change and this can.
      expect(bloom.petal, isNull);
      expect(bloom.core, isNull);
    });
  });

  testWidgets('a transfer row is unsigned and names both accounts', (
    tester,
  ) async {
    // it read 转账 +100.00, like income, and named neither account
    accounts.addAccount(id: 'cmb', name: '招行', balance: 0, kind: 'cash');
    accounts.addAccount(id: 'ali', name: '支付宝', balance: 0, kind: 'cash');
    store.addTransfer(
      transfer: store.NewTransfer(from: 'cmb', to: 'ali', amt: 100, ts: now),
      id: 'x',
      now: now,
    );
    await show(tester);

    expect(find.text('100.00'), findsOneWidget);
    expect(find.text('+100.00'), findsNothing);
    expect(find.text('招行 → 支付宝'), findsOneWidget);
  });

  // 账本筛选 — the shipping list's `LedgerFilter`, which the port left out.
  // The bridge kept `current_ledger` the whole time and nothing ever set it,
  // so a second ledger could be made and filed into but never looked at alone.
  group('the ledger filter', () {
    void entry(String id, double amt, {String? ledger, String note = '午饭'}) =>
        store.addEntry(
          entry: store.NewEntry(
            io: 'exp',
            cat: 'food',
            amt: amt,
            note: note,
            ledger: ledger,
            ts: now,
          ),
          id: id,
          now: now,
        );

    home.HomeView head(WidgetTester tester) =>
        tester.widget<HomeHeader>(find.byType(HomeHeader)).view;

    // The page's own list: the bar and the templates scroll sideways, so
    // `Scrollable` alone names three.
    Future<void> pick(WidgetTester tester, String key) => scrollAndTap(
      tester,
      find.byKey(Key(key)),
      scrollable: pageList(tester),
    );

    testWidgets('is not there until there is a ledger to pick', (tester) async {
      entry('e1', 30);
      await show(tester);
      expect(find.byKey(const Key('ledger-bar')), findsNothing);
    });

    testWidgets('a ledger picked scopes the rows and the head to it', (
      tester,
    ) async {
      catalog.addTag(kind: 'ledger', name: '旅行');
      entry('trip', 30, ledger: '旅行');
      entry('home', 50);
      await show(tester);
      expect(head(tester).exp, 80);

      await pick(tester, 'ledger-filter-旅行');
      expect(catalog.currentLedger(), '旅行');
      expect(find.byKey(const Key('row-trip')), findsOneWidget);
      expect(find.byKey(const Key('row-home')), findsNothing);
      expect(head(tester).exp, 30, reason: 'the head counts the same slice');

      await pick(tester, 'ledger-all');
      expect(catalog.currentLedger(), '');
      expect(find.byKey(const Key('row-home')), findsOneWidget);
      expect(head(tester).exp, 80);
    });

    testWidgets('an empty ledger keeps the bar, so 全部 is one tap away', (
      tester,
    ) async {
      catalog.addTag(kind: 'ledger', name: '家用');
      entry('e1', 30);
      await show(tester);

      await pick(tester, 'ledger-filter-家用');
      expect(find.text('「家用」里还没有账'), findsOneWidget);
      expect(find.byKey(const Key('row-e1')), findsNothing);

      await pick(tester, 'ledger-all');
      expect(find.byKey(const Key('row-e1')), findsOneWidget);
    });

    testWidgets('a search stays inside the ledger', (tester) async {
      catalog.addTag(kind: 'ledger', name: '旅行');
      entry('trip', 30, ledger: '旅行');
      entry('home', 50);
      catalog.setCurrentLedger(name: '旅行');
      await show(tester);

      await tester.tap(find.byKey(const Key('search-toggle')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('search-field')), '午饭');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('row-trip')), findsOneWidget);
      expect(find.byKey(const Key('row-home')), findsNothing);
    });
  });
}
