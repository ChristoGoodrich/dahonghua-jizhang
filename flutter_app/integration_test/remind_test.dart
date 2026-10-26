// 提醒, on a device, with a notifier that answers to a test.
//
// The times, the ids and what counts as a time are the core's, with 16 unit
// tests of their own. What only a device shows is which schedules the app
// actually hands over — and the one thing this port deliberately does
// differently from the shipping app: turning the daily reminder on must not
// cancel the weekly and monthly reports.
//
// A real notification schedule cannot be driven from a test, so the notifier
// is an interface and these answer for it.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_app/reminders.dart';
import 'package:flutter_app/settings_screen.dart';
import 'package:flutter_app/src/rust/api/remind.dart' as remind;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:timezone/timezone.dart' as tz;
import 'rust_init.dart';
import 'scroll.dart';

/// Records what it was asked to do, and answers however a test wants.
class FakeNotifier implements Notifier {
  FakeNotifier({this.permitted = true});

  bool permitted;
  int permissionAsks = 0;

  /// Ids scheduled, in order, with what each was told to say.
  final List<({int id, String kind, int hour, int minute, String title})>
  scheduled = [];

  /// Ids cancelled, in order.
  final List<int> cancelled = [];

  @override
  Future<bool> requestPermission() async {
    permissionAsks++;
    return permitted;
  }

  @override
  Future<void> schedule(
    remind.ScheduleView s,
    String title,
    String body,
  ) async {
    scheduled.add((
      id: s.id,
      kind: s.kind,
      hour: s.hour,
      minute: s.minute,
      title: title,
    ));
  }

  @override
  Future<void> cancel(int id) async => cancelled.add(id);

  Set<int> get scheduledIds => scheduled.map((e) => e.id).toSet();
}

Future<void> showSettings(
  WidgetTester tester, {
  required FakeNotifier notifier,
  bool zh = true,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: SettingsScreen(zh: zh, notifier: notifier),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> tapSetting(WidgetTester tester, Key key) async {
  // Not `ensureVisible`: that needs the widget in the tree already, and a
  // ListView has not built what is off screen. And not `scrollUntilVisible`
  // alone either — the body runs behind the header now, so "visible" includes
  // "under the title bar", where the bar takes the tap. See scroll.dart.
  await scrollAndTap(tester, find.byKey(key));
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() {
    store.reset();
    // Reminder settings are process-global, so one test's are another's
    // fixture unless this is here.
    remind.resetReminders();
  });

  group('what is switched on', () {
    testWidgets('nothing, to begin with', (tester) async {
      expect(remind.activeSchedules(), isEmpty);
      expect(remind.dailyReminderAt(), isEmpty);
    });

    testWidgets('a daily time becomes a daily schedule', (tester) async {
      expect(remind.setDailyReminder(at: '21:30'), isTrue);

      final s = remind.activeSchedules().single;
      expect(s.kind, 'daily');
      expect([s.hour, s.minute], [21, 30]);
    });

    testWidgets('a time that is not one is refused and stores nothing', (
      tester,
    ) async {
      expect(remind.setDailyReminder(at: '25:00'), isFalse);
      expect(remind.dailyReminderAt(), isEmpty);
      expect(remind.activeSchedules(), isEmpty);
    });

    testWidgets('an empty time turns it off', (tester) async {
      remind.setDailyReminder(at: '08:00');
      remind.setDailyReminder(at: '');

      expect(remind.activeSchedules(), isEmpty);
    });

    testWidgets('the reports are their own schedules', (tester) async {
      remind.setWeeklyReport(enabled: true);
      remind.setMonthlyReport(enabled: true);

      final kinds = remind.activeSchedules().map((s) => s.kind).toList();
      expect(kinds, containsAll(['weekly', 'monthly']));
    });

    testWidgets('every schedule has its own id', (tester) async {
      remind.setDailyReminder(at: '08:00');
      remind.setWeeklyReport(enabled: true);
      remind.setMonthlyReport(enabled: true);

      final ids = remind.activeSchedules().map((s) => s.id).toSet();
      expect(ids, hasLength(3), reason: 'or one would replace another');
    });
  });

  group('handing them over', () {
    testWidgets('nothing on cancels ours and asks for no permission', (
      tester,
    ) async {
      final n = FakeNotifier();

      expect(await syncReminders(zh: true, notifier: n), isTrue);

      expect(n.scheduled, isEmpty);
      expect(n.cancelled.toSet(), remind.allIds().toSet());
      expect(
        n.permissionAsks,
        0,
        reason: 'do not ask for permission we are not about to use',
      );
    });

    testWidgets('what is on is scheduled, with words', (tester) async {
      remind.setDailyReminder(at: '21:00');
      final n = FakeNotifier();

      await syncReminders(zh: true, notifier: n);

      final s = n.scheduled.single;
      expect(s.kind, 'daily');
      expect([s.hour, s.minute], [21, 0]);
      expect(s.title, '记账提醒');
    });

    /// The defect this port does not reproduce. In the shipping app, setting
    /// the daily reminder called `cancelAllScheduledNotificationsAsync`, so
    /// whether the reports survived depended on the order three unrelated
    /// switches were toggled.
    testWidgets('a daily reminder does not cancel the reports', (tester) async {
      remind.setWeeklyReport(enabled: true);
      remind.setMonthlyReport(enabled: true);
      remind.setDailyReminder(at: '21:00');
      final n = FakeNotifier();

      await syncReminders(zh: true, notifier: n);

      expect(
        n.scheduledIds,
        remind.allIds().toSet(),
        reason: 'all three survive, whatever order they were set in',
      );
    });

    testWidgets('only ours are cancelled, never everything', (tester) async {
      // "Cancel all" is a claim over notifications this app never posted.
      remind.setDailyReminder(at: '08:00');
      final n = FakeNotifier();

      await syncReminders(zh: true, notifier: n);

      expect(n.cancelled.toSet(), remind.allIds().toSet());
    });

    testWidgets('turning one off cancels its id and leaves the rest', (
      tester,
    ) async {
      remind.setWeeklyReport(enabled: true);
      remind.setDailyReminder(at: '08:00');
      final n = FakeNotifier();
      await syncReminders(zh: true, notifier: n);
      expect(n.scheduledIds, hasLength(2));

      remind.setDailyReminder(at: '');
      final n2 = FakeNotifier();
      await syncReminders(zh: true, notifier: n2);

      expect(n2.scheduled.map((e) => e.kind), ['weekly']);
    });

    testWidgets('a refused permission says so rather than lying', (
      tester,
    ) async {
      remind.setDailyReminder(at: '08:00');
      final n = FakeNotifier(permitted: false);

      expect(await syncReminders(zh: true, notifier: n), isFalse);
      expect(
        n.scheduled,
        isEmpty,
        reason: 'nothing was scheduled, so nothing may claim it was',
      );
    });

    testWidgets('English words when the app is in English', (tester) async {
      remind.setWeeklyReport(enabled: true);
      final n = FakeNotifier();

      await syncReminders(zh: false, notifier: n);

      expect(n.scheduled.single.title, 'Weekly report');
    });
  });

  group('the settings screen', () {
    testWidgets('offers times and both reports', (tester) async {
      await showSettings(tester, notifier: FakeNotifier());

      expect(find.byKey(const Key('remind-21:00')), findsOneWidget);
      expect(find.byKey(const Key('weekly-toggle')), findsOneWidget);
      expect(find.byKey(const Key('monthly-toggle')), findsOneWidget);
    });

    testWidgets('picking a time schedules it', (tester) async {
      final n = FakeNotifier();
      await showSettings(tester, notifier: n);

      await tapSetting(tester, const Key('remind-21:00'));

      expect(remind.dailyReminderAt(), '21:00');
      expect(n.scheduled.single.kind, 'daily');
    });

    testWidgets('tapping the chosen time again turns it off', (tester) async {
      // Off is a real state and needs a way back to it.
      final n = FakeNotifier();
      await showSettings(tester, notifier: n);
      await tapSetting(tester, const Key('remind-08:00'));
      expect(remind.dailyReminderAt(), '08:00');

      await tapSetting(tester, const Key('remind-08:00'));

      expect(remind.dailyReminderAt(), isEmpty);
      expect(find.text('现在：关着'), findsOneWidget);
    });

    testWidgets('a refusal is said on the screen', (tester) async {
      final n = FakeNotifier(permitted: false);
      await showSettings(tester, notifier: n);

      await tapSetting(tester, const Key('remind-12:00'));

      expect(find.textContaining('通知权限'), findsOneWidget);
    });

    testWidgets('the weekly switch schedules the weekly report', (
      tester,
    ) async {
      final n = FakeNotifier();
      await showSettings(tester, notifier: n);

      await tapSetting(tester, const Key('weekly-toggle'));

      expect(remind.weeklyReportOn(), isTrue);
      expect(n.scheduled.single.kind, 'weekly');
    });
  });

  group('across a restart', () {
    testWidgets('the settings survive a snapshot and a reload', (tester) async {
      remind.setDailyReminder(at: '07:15');
      remind.setWeeklyReport(enabled: true);
      final blob = store.snapshotConfig();

      remind.resetReminders();
      expect(store.loadConfig(json: blob), isTrue);

      expect(remind.dailyReminderAt(), '07:15');
      expect(remind.weeklyReportOn(), isTrue);
      expect(remind.monthlyReportOn(), isFalse);
    });

    testWidgets('a config from before reminders existed has none on', (
      tester,
    ) async {
      remind.setDailyReminder(at: '07:15');
      remind.setWeeklyReport(enabled: true);

      expect(store.loadConfig(json: '{}'), isTrue);

      expect(remind.activeSchedules(), isEmpty);
    });

    testWidgets('a stored time that is not one comes back as off', (
      tester,
    ) async {
      expect(store.loadConfig(json: '{"remindAt":"nonsense"}'), isTrue);

      expect(remind.dailyReminderAt(), isEmpty);
    });
  });

  // The fakes above say which schedules the app asks for. These two are the
  // only tests that hand one to Android, because both failures live there:
  // the alarm went to a receiver the manifest never declared, and the time
  // was built in UTC — so had it arrived, 21:00 would have been 05:00 in
  // China. Neither was visible to a test that never reached the plugin.
  group('on the device', () {
    testWidgets('a due schedule reaches the app', (tester) async {
      final plugin = FlutterLocalNotificationsPlugin();
      // Through the app's own notifier, so the plugin is set up as it is in
      // use. The id is not one of ours, and nothing is under it.
      const probe = 9901;
      expect(remind.allIds(), isNot(contains(probe)));
      await DeviceNotifier().cancel(probe);

      // One-shot: when the receiver runs it drops the request from the
      // plugin's pending list, which is the only trace of delivery a test
      // can see without the notification permission a test cannot grant.
      await plugin.zonedSchedule(
        id: probe,
        title: 'probe',
        body: 'probe',
        scheduledDate: tz.TZDateTime.now(tz.UTC).add(const Duration(seconds: 3)),
        notificationDetails: const NotificationDetails(
          android: AndroidNotificationDetails('dahonghua_reminders', '记账提醒'),
        ),
        androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      );
      Future<bool> waiting() async => (await plugin.pendingNotificationRequests())
          .any((r) => r.id == probe);
      // otherwise the wait below would pass for a schedule never made
      expect(await waiting(), isTrue);

      // Inexact: Android may hold a short alarm back by a few seconds.
      final deadline = DateTime.now().add(const Duration(seconds: 90));
      while (await waiting() && DateTime.now().isBefore(deadline)) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 1)),
        );
      }
      final arrived = !await waiting();
      await plugin.cancel(id: probe);
      expect(arrived, isTrue, reason: 'the alarm never reached the receiver');
    });

    testWidgets('a schedule is built in the phone\'s own zone', (tester) async {
      await DeviceNotifier().cancel(9902);

      // What the schedule's clock says now against what the phone's says.
      // UTC gave 0 here, which on a phone in China is eight hours out.
      expect(
        tz.TZDateTime.now(tz.local).timeZoneOffset,
        DateTime.now().timeZoneOffset,
      );
      // And by name, which is the half that can fail on a phone set to UTC:
      // the offset agreeing there proves nothing about where it came from.
      final id = await const MethodChannel(
        'com.dahonghua/zone',
      ).invokeMethod<String>('id');
      expect(tz.local.name, id);
    });
  });
}
