// The home-screen widget's numbers.
//
// There is no launcher in a test, so the host is faked and what gets checked
// is what would have been sent. That is the whole of the Dart side's job: the
// arithmetic is `core::budget` with 4,210 parity cases, and the Kotlin draws
// what it is handed without deciding anything.
//
// Which is the point of the rewrite. The React Native build did the arithmetic
// AND the formatting in Kotlin, where nothing could reach it — and it shipped
// two defects as a result. Both are asserted against here.

import 'package:flutter_app/budget_widget.dart';
import 'package:flutter_app/src/rust/api/budget.dart' as budget;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

class FakeHost implements WidgetHost {
  WidgetData? last;
  int calls = 0;

  @override
  Future<void> update(WidgetData data) async {
    last = data;
    calls++;
  }
}

void spend(String id, double amt) {
  store.addEntry(
    entry: store.NewEntry(
      io: 'exp',
      cat: 'food',
      amt: amt,
      ts: DateTime.now().millisecondsSinceEpoch,
    ),
    id: id,
    now: DateTime.now().millisecondsSinceEpoch,
  );
}

void setBudget(double monthly) {
  final s = budget.settings();
  budget.setSettings(
    view: budget.SettingsView(
      budget: monthly,
      dailyBudget: s.dailyBudget,
      cycleStart: s.cycleStart,
      capCats: s.capCats,
      capAmounts: s.capAmounts,
    ),
  );
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('the numbers', () {
    testWidgets('spent and left come from the budget the app uses',
        (tester) async {
      setBudget(1000);
      spend('a', 300);

      final d = widgetData(zh: true);
      expect(d.spent, contains('300'));
      expect(d.left, contains('700'));
      expect(d.pct, 30);
      expect(d.over, isFalse);
      expect(d.hasBudget, isTrue);
    });

    testWidgets('no budget set is not a budget of zero', (tester) async {
      setBudget(0);
      spend('a', 300);

      final d = widgetData(zh: true);
      expect(d.hasBudget, isFalse,
          reason: 'the widget shows a dash rather than claiming 0%');
      expect(d.over, isFalse, reason: 'you cannot exceed a cap that is unset');
    });

    testWidgets('over budget says how far over, not a negative remainder',
        (tester) async {
      setBudget(1000);
      spend('a', 1200);

      final d = widgetData(zh: true);
      expect(d.over, isTrue);
      expect(d.left, contains('超支'));
      expect(d.left, isNot(contains('-')),
          reason: '"剩余 -200" is arithmetic, not language');
      expect(d.left, contains('200'));
    });

    /// The percentage is rounded but NOT clamped here — the Kotlin clamps for
    /// the progress bar, and `over` carries what the clamp destroys.
    testWidgets('a percentage past 100 survives as far as the host',
        (tester) async {
      setBudget(1000);
      spend('a', 1400);

      final d = widgetData(zh: true);
      expect(d.pct, 140);
      expect(d.over, isTrue);
    });

    testWidgets('income does not count against the budget', (tester) async {
      setBudget(1000);
      spend('a', 300);
      store.addEntry(
        entry: store.NewEntry(
          io: 'inc',
          cat: 'salary',
          amt: 9000,
          ts: DateTime.now().millisecondsSinceEpoch,
        ),
        id: 'pay',
        now: DateTime.now().millisecondsSinceEpoch,
      );

      expect(widgetData(zh: true).spent, contains('300'));
    });

    testWidgets('a deleted entry stops counting', (tester) async {
      setBudget(1000);
      spend('a', 300);
      store.removeEntry(id: 'a', now: DateTime.now().millisecondsSinceEpoch);

      expect(widgetData(zh: true).pct, 0);
    });
  });

  group('the words', () {
    /// The shipping widget hardcoded Chinese in the Kotlin, so it stayed
    /// Chinese when the app was in English. It cannot now, because the Kotlin
    /// has no words of its own.
    testWidgets('follow the app into English', (tester) async {
      setBudget(1000);
      spend('a', 300);

      final en = widgetData(zh: false);
      expect(en.title, 'This month');
      expect(en.spent, contains('Spent'));
      expect(en.left, contains('left'));
      expect(en.spent, isNot(contains('已花')));
    });

    testWidgets('and are Chinese when the app is', (tester) async {
      setBudget(1000);
      spend('a', 300);

      final zh = widgetData(zh: true);
      expect(zh.title, '本月预算');
      expect(zh.spent, contains('已花'));
    });

    testWidgets('over budget in English too', (tester) async {
      setBudget(1000);
      spend('a', 1200);
      expect(widgetData(zh: false).left, contains('Over by'));
    });
  });

  group('what crosses to the platform', () {
    testWidgets('is the finished text, not the raw numbers', (tester) async {
      setBudget(1000);
      spend('a', 300);

      final host = FakeHost();
      await refreshWidget(zh: true, host: host);

      final map = host.last!.toMap();
      expect(map['title'], isA<String>());
      expect(map['spent'], isA<String>());
      expect(map['left'], isA<String>());
      // Only these two are values, and both are things a string cannot carry
      // without the Kotlin parsing it back.
      expect(map['pct'], isA<int>());
      expect(map['over'], isA<bool>());
      expect(map['hasBudget'], isA<bool>());
      expect(map.length, 6, reason: 'nothing else needs to cross');
    });

    testWidgets('happens once per refresh', (tester) async {
      final host = FakeHost();
      await refreshWidget(zh: true, host: host);
      expect(host.calls, 1);
    });
  });
}
