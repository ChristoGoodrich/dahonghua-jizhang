// 提醒 — handing three schedules to the operating system.
//
// Which reminders exist, when each fires, and what counts as a time are the
// core's. This file asks for permission, converts a schedule into whatever
// `flutter_local_notifications` wants, and carries the words — a title and a
// body are locale strings, and this crate has said since `money.rs` that ICU
// text belongs to the UI.
//
// Everything is scheduled BY ID and cancelled by id. The shipping app called
// `cancelAllScheduledNotificationsAsync()` before setting the daily reminder,
// which silently wiped the weekly and monthly reports depending on the order
// three unrelated switches were toggled. "Cancel all" is also a claim over
// notifications this app never posted.

import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import 'src/rust/api/remind.dart' as remind;

/// What the platform can be asked to do, as an interface so a test can answer
/// for it: a real notification schedule cannot be driven from a test, and the
/// part worth testing is which schedules the app asks for.
abstract class Notifier {
  Future<bool> requestPermission();

  /// Schedule one reminder, replacing anything already under `id`.
  Future<void> schedule(remind.ScheduleView s, String title, String body);

  Future<void> cancel(int id);
}

class DeviceNotifier implements Notifier {
  DeviceNotifier();

  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _ready = false;

  static const _details = NotificationDetails(
    android: AndroidNotificationDetails(
      'dahonghua_reminders',
      '记账提醒',
      channelDescription: '每日提醒和周报月报',
      importance: Importance.defaultImportance,
      priority: Priority.defaultPriority,
    ),
  );

  Future<void> _init() async {
    if (_ready) return;
    // The zone database has to be loaded before a zoned schedule can be built,
    // and a repeating local-time schedule is a zoned one by definition.
    tzdata.initializeTimeZones();
    await _plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      ),
    );
    _ready = true;
  }

  @override
  Future<bool> requestPermission() async {
    await _init();
    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    if (android == null) return false;
    return await android.requestNotificationsPermission() ?? false;
  }

  @override
  Future<void> schedule(
      remind.ScheduleView s, String title, String body) async {
    await _init();
    await _plugin.zonedSchedule(
      id: s.id,
      title: title,
      body: body,
      scheduledDate: _nextOccurrence(s),
      notificationDetails: _details,
      androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      matchDateTimeComponents: switch (s.kind) {
        'weekly' => DateTimeComponents.dayOfWeekAndTime,
        // A monthly rule is a day-of-month match, which is why the schedule
        // carries a day rather than a date.
        'monthly' => DateTimeComponents.dayOfMonthAndTime,
        _ => DateTimeComponents.time,
      },
    );
  }

  /// The first time this schedule is due, at or after now.
  ///
  /// Local time throughout: a reminder set for 21:00 means 21:00 where the
  /// phone is, and stays 21:00 when the phone moves.
  tz.TZDateTime _nextOccurrence(remind.ScheduleView s) {
    final now = tz.TZDateTime.now(tz.local);
    var next = tz.TZDateTime(
        tz.local, now.year, now.month, now.day, s.hour, s.minute);

    switch (s.kind) {
      case 'weekly':
        // The core numbers Sunday as 1; Dart numbers Monday as 1 and Sunday
        // as 7. Converted here rather than in the core, because it is this
        // platform's numbering that differs.
        final target = s.weekday == 1 ? DateTime.sunday : s.weekday! - 1;
        while (next.weekday != target || !next.isAfter(now)) {
          next = next.add(const Duration(days: 1));
        }
      case 'monthly':
        while (next.day != s.day || !next.isAfter(now)) {
          next = next.add(const Duration(days: 1));
        }
      default:
        if (!next.isAfter(now)) next = next.add(const Duration(days: 1));
    }
    return next;
  }

  @override
  Future<void> cancel(int id) async {
    await _init();
    await _plugin.cancel(id: id);
  }
}

/// What each reminder says.
///
/// Here rather than in the core because a title and a body are locale text.
({String title, String body}) wordsFor(String kind, bool zh) =>
    switch (kind) {
      'weekly' => (
          title: zh ? '每周消费报告' : 'Weekly report',
          body: zh ? '这一周花在哪儿了，看一眼 🌺' : 'Where the week went 🌺',
        ),
      'monthly' => (
          title: zh ? '每月消费报告' : 'Monthly report',
          body: zh ? '上个月的账已经出来了 🌺' : 'Last month is ready 🌺',
        ),
      _ => (
          title: zh ? '记账提醒' : 'Time to record',
          body: zh ? '别忘了记一笔 🌺' : "Don't forget to log today 🌺",
        ),
    };

/// Hand the operating system whatever is currently switched on.
///
/// Cancels every id first and re-schedules what should exist, so the OS ends
/// up holding exactly the set the app believes in. By id, never "cancel all".
///
/// Returns false when permission was refused — the settings screen says so
/// rather than leaving switches on that do nothing.
Future<bool> syncReminders({
  required bool zh,
  Notifier? notifier,
}) async {
  final n = notifier ?? DeviceNotifier();
  final wanted = remind.activeSchedules();

  // Nothing on: cancel what we own and do not ask for permission we are not
  // about to use.
  if (wanted.isEmpty) {
    for (final id in remind.allIds()) {
      await n.cancel(id);
    }
    return true;
  }

  if (!await n.requestPermission()) return false;

  for (final id in remind.allIds()) {
    await n.cancel(id);
  }
  for (final s in wanted) {
    final w = wordsFor(s.kind, zh);
    await n.schedule(s, w.title, w.body);
  }
  return true;
}
