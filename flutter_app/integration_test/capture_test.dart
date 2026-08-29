// 自动记账, on a device, with a fake listener.
//
// The listener itself cannot be tested from here: notification access is
// granted by hand in system settings and an emulator has not granted it. What
// CAN be tested is everything the app does with what the listener hands over,
// which is where every decision lives — the parsing and dedup in Rust, the
// order of operations in `inbox.dart`, and the three states the screen has to
// tell apart.
//
// The notification strings are real wording, not invented. A rule written
// against text nobody has seen is a rule that works on nobody's phone.

import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_app/capture_screen.dart';
import 'package:flutter_app/inbox.dart';
import 'package:flutter_app/notif_capture.dart';
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';

const alipay = 'com.eg.android.AlipayGphone';
const wechat = 'com.tencent.mm';

/// A listener that never existed, holding whatever a test puts in it.
class FakeNative implements NotifCapture {
  FakeNative({
    this.supported = true,
    this.granted = true,
    this.capturing = true,
    List<CapturedNotif>? queue,
  }) : queue = queue ?? [];

  @override
  final bool supported;
  bool granted;
  bool capturing;
  List<CapturedNotif> queue;

  /// Every id the app said it had taken responsibility for.
  final List<String> consumed = [];
  int settingsOpened = 0;

  /// How many entries were in the ledger at the moment the queue was
  /// acknowledged. The ORDER is the thing worth checking and it is invisible
  /// from the outside — a drain that acknowledged first and crashed would look
  /// identical afterwards to one that never ran.
  int? ledgerAtConsume;

  @override
  Future<bool> isEnabled() async => supported && granted;

  @override
  Future<bool> isCapturing() async => supported && capturing;

  @override
  Future<void> setCapturing(bool on) async => capturing = on;

  @override
  Future<void> openSettings() async => settingsOpened++;

  @override
  Future<int> pendingCount() async => queue.length;

  @override
  Future<List<CapturedNotif>> getPending({int limit = 200}) async =>
      queue.take(limit).toList();

  @override
  Future<void> markConsumed(List<String> ids) async {
    ledgerAtConsume ??= store.entryCount();
    consumed.addAll(ids);
    queue = queue.where((n) => !ids.contains(n.id)).toList();
  }

  @override
  Future<void> clearPending() async => queue = [];

  @override
  Future<List<String>> watchedPackages() async => const [alipay, wechat];
}

/// A native side whose acknowledgement fails, which is the state a drain has to
/// survive without losing or double-counting a payment.
class ThrowingConsume extends FakeNative {
  ThrowingConsume({super.queue});

  @override
  Future<void> markConsumed(List<String> ids) async =>
      throw PlatformException(code: 'no-service');
}

int _nextId = 0;

CapturedNotif notif({
  String pkg = alipay,
  String? title,
  String? text,
  String? bigText,
  int? postedAt,
}) =>
    CapturedNotif(
      id: 'q${_nextId++}',
      pkg: pkg,
      title: title,
      text: text,
      bigText: bigText,
      postedAt: postedAt ?? DateTime.now().millisecondsSinceEpoch,
    );

late Directory tmp;

Future<Inbox> freshInbox(FakeNative native) async {
  final f = File('${tmp.path}/inbox.json');
  if (await f.exists()) await f.delete();
  final i = Inbox(native: native, dir: tmp);
  await i.load();
  return i;
}

Future<void> show(
  WidgetTester tester, {
  required FakeNative native,
  required Inbox inbox,
  bool zh = true,
  VoidCallback? onChanged,
}) async {
  await tester.pumpWidget(MaterialApp(
    home: CaptureScreen(
      zh: zh,
      native: native,
      inbox: inbox,
      onChanged: onChanged,
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    await RustLib.init();
    tmp = Directory(
        '${(await getApplicationDocumentsDirectory()).path}/capture_test');
    if (!await tmp.exists()) await tmp.create(recursive: true);
  });
  setUp(() => store.reset());

  group('draining', () {
    testWidgets('a payment with a merchant posts to the ledger unattended',
        (tester) async {
      final native = FakeNative(queue: [
        notif(title: '支付宝', text: '向星巴克(国贸店)付款35.00元'),
      ]);
      final inbox = await freshInbox(native);

      final r = await inbox.drain();

      expect(r.posted, 1);
      expect(r.queued, 0);
      expect(store.entryCount(), 1);
      final e = store.liveEntries().single;
      expect(e.amt, 35.0);
      expect(e.note, contains('星巴克'));
    });

    testWidgets('a payment with no merchant waits instead of guessing',
        (tester) async {
      final native = FakeNative(queue: [
        notif(title: '支付宝', text: '付款成功12.00元'),
      ]);
      final inbox = await freshInbox(native);

      final r = await inbox.drain();

      expect(r.posted, 0);
      expect(r.queued, 1);
      expect(store.entryCount(), 0, reason: 'nothing was written');
      expect(inbox.pending.single.amt, 12.0);
    });

    testWidgets('a notification nothing understands is kept, not discarded',
        (tester) async {
      final native = FakeNative(queue: [
        notif(pkg: wechat, title: '微信', text: '你有一条新消息'),
      ]);
      final inbox = await freshInbox(native);

      final r = await inbox.drain();

      expect(r.unparsed, 1);
      expect(inbox.unparsed.single.raw, contains('新消息'));
      expect(store.entryCount(), 0);
    });

    testWidgets('the same payment pushed twice is recorded once',
        (tester) async {
      // 支付宝 posts 付款成功 and then a 账单 push seconds later.
      final t = DateTime.now().millisecondsSinceEpoch;
      final native = FakeNative(queue: [
        notif(title: '支付宝', text: '向星巴克(国贸店)付款35.00元', postedAt: t),
        notif(title: '支付宝', text: '交易成功 支出35.00元', postedAt: t + 4000),
      ]);
      final inbox = await freshInbox(native);

      final r = await inbox.drain();

      expect(r.posted, 1);
      expect(store.entryCount(), 1);
      // And the follow-up produced NOTHING — not a second entry, and not an
      // item waiting for confirmation either. Checking `posted` alone would
      // pass with the dedup deleted: the follow-up carries no merchant, so it
      // would queue rather than post, and the count would look right.
      expect(r.queued, 0);
      expect(r.unparsed, 0);
      expect(inbox.pending, isEmpty);
    });

    testWidgets('a follow-up push arriving in a LATER drain is still caught',
        (tester) async {
      final t = DateTime.now().millisecondsSinceEpoch;
      final native = FakeNative(queue: [
        notif(title: '支付宝', text: '向星巴克(国贸店)付款35.00元', postedAt: t),
      ]);
      final inbox = await freshInbox(native);
      await inbox.drain();
      expect(store.entryCount(), 1);

      // The second push is drained separately — the app was opened twice.
      native.queue = [notif(title: '支付宝', text: '交易成功 支出35.00元', postedAt: t + 5000)];
      final r = await inbox.drain();

      expect(r.posted, 0, reason: 'the ledger already stands for this payment');
      expect(store.entryCount(), 1);
      expect(r.queued, 0, reason: 'nor is it waiting to be confirmed');
      expect(inbox.pending, isEmpty);
    });

    testWidgets('the queue is acknowledged only after the rows are in',
        (tester) async {
      final native = FakeNative(queue: [
        notif(title: '支付宝', text: '向星巴克(国贸店)付款35.00元'),
        notif(pkg: wechat, title: '微信', text: '你有一条新消息'),
      ]);
      final inbox = await freshInbox(native);

      await inbox.drain();

      // Both, including the one that became nothing: leaving it queued would
      // re-examine it on every drain forever.
      expect(native.consumed.length, 2);
      expect(native.queue, isEmpty);
      // And the row was already in the ledger when that happened. Acknowledging
      // first would lose the payment to any crash in between.
      expect(native.ledgerAtConsume, 1);
    });

    testWidgets('a queue that refuses the acknowledgement keeps the entry',
        (tester) async {
      final native = ThrowingConsume(queue: [
        notif(title: '支付宝', text: '向星巴克(国贸店)付款35.00元'),
      ]);
      final inbox = Inbox(native: native, dir: tmp);
      await inbox.load();

      await inbox.drain();

      // The row stands. The capture will be handed over again on the next
      // drain and the dedup will recognise it — which is what `src: notif` on
      // the ledger row is for.
      expect(store.entryCount(), 1);
    });

    testWidgets('capture switched off drains nothing', (tester) async {
      final native = FakeNative(
        capturing: false,
        queue: [notif(title: '支付宝', text: '向星巴克(国贸店)付款35.00元')],
      );
      final inbox = await freshInbox(native);

      expect((await inbox.drain()).isEmpty, isTrue);
      expect(store.entryCount(), 0);
      expect(native.consumed, isEmpty, reason: 'the queue is left alone');
    });

    testWidgets('access revoked in system settings drains nothing',
        (tester) async {
      final native = FakeNative(
        granted: false,
        queue: [notif(title: '支付宝', text: '向星巴克(国贸店)付款35.00元')],
      );
      final inbox = await freshInbox(native);

      expect((await inbox.drain()).isEmpty, isTrue);
      expect(native.queue, isNotEmpty);
    });

    testWidgets('what is waiting survives a restart', (tester) async {
      final native = FakeNative(queue: [
        notif(title: '支付宝', text: '付款成功12.00元'),
      ]);
      final inbox = await freshInbox(native);
      await inbox.drain();
      expect(inbox.pending, hasLength(1));

      final reopened = Inbox(native: native, dir: tmp);
      await reopened.load();

      expect(reopened.pending, hasLength(1));
      expect(reopened.pending.single.amt, 12.0);
    });

    testWidgets('a corrupt inbox file starts empty rather than refusing to open',
        (tester) async {
      await File('${tmp.path}/inbox.json').writeAsString('{not json');
      final inbox = Inbox(native: FakeNative(), dir: tmp);

      await inbox.load();

      expect(inbox.pending, isEmpty);
      expect(inbox.unparsed, isEmpty);
    });

    testWidgets('the unparsed list is bounded', (tester) async {
      final inbox = await freshInbox(FakeNative());
      for (var i = 0; i < Inbox.maxUnparsed + 8; i++) {
        inbox.unparsed = [
          ...inbox.unparsed,
          UnparsedItem(id: 'u$i', pkg: wechat, raw: 'noise $i', postedAt: i),
        ];
      }
      // A drain is what enforces the bound, so run one over a fresh capture.
      final native = FakeNative(queue: [
        notif(pkg: wechat, title: '微信', text: '你有一条新消息'),
      ]);
      final bounded = Inbox(native: native, dir: tmp);
      await bounded.load();
      bounded.unparsed = inbox.unparsed;
      await bounded.drain();

      expect(bounded.unparsed.length, Inbox.maxUnparsed);
      expect(bounded.unparsed.last.raw, contains('新消息'),
          reason: 'the newest is the one kept');
    });
  });

  group('the screen', () {
    testWidgets('says access is missing, and that only settings can grant it',
        (tester) async {
      final native = FakeNative(granted: false);
      await show(tester, native: native, inbox: await freshInbox(native));

      expect(find.byKey(const Key('capture-not-granted')), findsOneWidget);
      expect(find.byKey(const Key('capture-toggle')), findsNothing);

      await tester.tap(find.byKey(const Key('open-notif-settings')));
      await tester.pumpAndSettle();
      expect(native.settingsOpened, 1);
    });

    testWidgets('granted but off is a state of its own, not "no permission"',
        (tester) async {
      final native = FakeNative(capturing: false);
      await show(tester, native: native, inbox: await freshInbox(native));

      expect(find.byKey(const Key('capture-not-granted')), findsNothing);
      expect(find.byKey(const Key('capture-toggle')), findsOneWidget);
      expect(find.text('权限有了,还没开'), findsOneWidget);
    });

    testWidgets('turning it on drains what was already queued', (tester) async {
      final native = FakeNative(
        capturing: false,
        queue: [notif(title: '支付宝', text: '向星巴克(国贸店)付款35.00元')],
      );
      await show(tester, native: native, inbox: await freshInbox(native));

      await tester.tap(find.byKey(const Key('capture-toggle')));
      await tester.pumpAndSettle();

      expect(native.capturing, isTrue);
      expect(store.entryCount(), 1);
    });

    testWidgets('a waiting payment is shown with what the notification said',
        (tester) async {
      final native = FakeNative(queue: [
        notif(title: '支付宝', text: '付款成功12.00元'),
      ]);
      final inbox = await freshInbox(native);
      await show(tester, native: native, inbox: inbox);

      expect(find.textContaining('付款成功12.00元'), findsOneWidget,
          reason: 'the evidence for the guess is on screen');
      expect(find.text('12.00'), findsOneWidget);
    });

    testWidgets('accepting one records it and clears it from the list',
        (tester) async {
      var told = 0;
      final native = FakeNative(queue: [
        notif(title: '支付宝', text: '付款成功12.00元'),
      ]);
      final inbox = await freshInbox(native);
      await show(
          tester, native: native, inbox: inbox, onChanged: () => told++);

      final id = inbox.pending.single.id;
      await tester.tap(find.byKey(Key('accept-$id')));
      await tester.pumpAndSettle();

      expect(store.entryCount(), 1);
      expect(inbox.pending, isEmpty);
      expect(find.byKey(Key('pending-$id')), findsNothing);
      expect(told, greaterThan(0));
    });

    testWidgets('discarding one records nothing', (tester) async {
      final native = FakeNative(queue: [
        notif(title: '支付宝', text: '付款成功12.00元'),
      ]);
      final inbox = await freshInbox(native);
      await show(tester, native: native, inbox: inbox);

      final id = inbox.pending.single.id;
      await tester.tap(find.byKey(Key('reject-$id')));
      await tester.pumpAndSettle();

      expect(store.entryCount(), 0);
      expect(inbox.pending, isEmpty);
    });

    testWidgets('a discarded payment stays discarded across a restart',
        (tester) async {
      final native = FakeNative(queue: [
        notif(title: '支付宝', text: '付款成功12.00元'),
      ]);
      final inbox = await freshInbox(native);
      await show(tester, native: native, inbox: inbox);
      await tester.tap(find.byKey(Key('reject-${inbox.pending.single.id}')));
      await tester.pumpAndSettle();

      final reopened = Inbox(native: native, dir: tmp);
      await reopened.load();
      expect(reopened.pending, isEmpty);
    });

    testWidgets('the unparsed list can be cleared', (tester) async {
      final native = FakeNative(queue: [
        notif(pkg: wechat, title: '微信', text: '你有一条新消息'),
      ]);
      final inbox = await freshInbox(native);
      await show(tester, native: native, inbox: inbox);
      expect(find.textContaining('新消息'), findsOneWidget);

      await tester.tap(find.byKey(const Key('clear-unparsed')));
      await tester.pumpAndSettle();

      expect(inbox.unparsed, isEmpty);
      expect(find.textContaining('新消息'), findsNothing);
    });

    testWidgets('a platform with no listener says so instead of offering a switch',
        (tester) async {
      final native = FakeNative(supported: false);
      await show(tester, native: native, inbox: await freshInbox(native));

      expect(find.byKey(const Key('capture-unsupported')), findsOneWidget);
      expect(find.byKey(const Key('capture-toggle')), findsNothing);
      expect(find.byKey(const Key('open-notif-settings')), findsNothing);
    });

    testWidgets('English throughout when the app is in English',
        (tester) async {
      final native = FakeNative(capturing: false);
      await show(
          tester, zh: false, native: native, inbox: await freshInbox(native));

      expect(find.text('Capture payments'), findsOneWidget);
      expect(find.text('Granted, but not on'), findsOneWidget);
    });
  });

  group('what crosses to the native side', () {
    testWidgets('a captured row survives the channel encoding it would use',
        (tester) async {
      // The channel hands maps across; this is the shape the Kotlin side sends
      // and the one `CapturedNotif.fromMap` has to read.
      final m = jsonDecode(jsonEncode({
        'id': '7',
        'pkg': alipay,
        'title': '支付宝',
        'text': '向星巴克(国贸店)付款35.00元',
        'bigText': null,
        'postedAt': 1756400000000,
      })) as Map<String, Object?>;

      final c = CapturedNotif.fromMap(m);

      expect(c.id, '7');
      expect(c.pkg, alipay);
      expect(c.text, contains('星巴克'));
      expect(c.bigText, isNull);
      expect(c.postedAt, 1756400000000);
    });

    testWidgets('a row missing every field does not throw', (tester) async {
      final c = CapturedNotif.fromMap(const {});
      expect(c.id, '');
      expect(c.postedAt, 0);
    });
  });
}
