// 锁屏, on a device, with an authenticator that answers to a test.
//
// The rules — when to prompt, what an answer means, which attempt owns an
// outcome — are the core's and have 26 unit tests of their own. What only a
// device shows is the wiring: that a lifecycle callback reaches the right
// event, that an exception from the plugin becomes `errored` rather than a
// refusal, and that the cover goes over the app instead of replacing it.
//
// A real biometric prompt cannot be driven from a test. The authenticator is
// an interface for exactly that reason, and the tests answer for it.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_app/lock_gate.dart';
import 'package:flutter_app/src/rust/api/lock.dart' as lock;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

/// A device that says whatever a test tells it to.
class FakeAuth implements Authenticator {
  FakeAuth({
    this.hardware = true,
    this.enrolled = true,
    this.result = true,
    this.throws = false,
  });

  bool hardware;
  bool enrolled;

  /// What `authenticate` returns: true accepts, false refuses.
  bool result;

  /// Throw instead — the device could not be asked at all.
  bool throws;

  int prompts = 0;
  int cancels = 0;

  /// Leave every prompt hanging, to model one that is still up.
  bool hold = false;

  /// One completer per prompt, in the order they were asked.
  ///
  /// Per prompt, not one shared: handing the same future to both attempts
  /// would mean completing the abandoned one also settles the live one, and
  /// the test that says a stale answer cannot open the gate would be proving
  /// nothing.
  final List<Completer<bool>> held = [];

  /// Settle anything still hanging, so teardown has nothing to wait on. A
  /// future nobody completes is an async operation outliving its test.
  void settle() {
    for (final c in held) {
      if (!c.isCompleted) c.complete(false);
    }
  }

  @override
  Future<bool> hasHardware() async => hardware;

  @override
  Future<bool> isEnrolled() async => enrolled;

  @override
  Future<bool> authenticate(String reason) {
    prompts++;
    if (throws) return Future.error(StateError('no'));
    if (hold) {
      final c = Completer<bool>();
      held.add(c);
      return c.future;
    }
    return Future.value(result);
  }

  @override
  Future<void> cancel() async => cancels++;
}

Future<void> show(
  WidgetTester tester, {
  required FakeAuth auth,
  bool zh = true,
}) async {
  addTearDown(auth.settle);
  await tester.pumpWidget(MaterialApp(
    home: LockGate(
      zh: zh,
      auth: auth,
      child: const Scaffold(body: Center(child: Text('账本内容'))),
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async => await RustLib.init());
  setUp(() {
    store.reset();
    // The lock is process-global, so one test's state is another's fixture.
    lock.lockReset();
  });

  group('with the lock off', () {
    testWidgets('there is no cover and nothing is asked', (tester) async {
      final auth = FakeAuth();
      await show(tester, auth: auth);

      expect(find.byKey(const Key('lock-cover')), findsNothing);
      expect(find.text('账本内容'), findsOneWidget);
      expect(auth.prompts, 0);
    });
  });

  group('with the lock on', () {
    setUp(() => lock.lockLoad(enabled: true));

    testWidgets('the app is covered and the device is asked', (tester) async {
      final auth = FakeAuth(result: false);
      await show(tester, auth: auth);

      expect(find.byKey(const Key('lock-cover')), findsOneWidget);
      expect(auth.prompts, 1);
    });

    testWidgets('the content is covered, not torn down', (tester) async {
      // Replacing it would lose wherever the user was; unlocking has to come
      // back to the same place.
      final auth = FakeAuth(result: false);
      await show(tester, auth: auth);

      expect(find.text('账本内容', skipOffstage: false), findsOneWidget);
    });

    testWidgets('a success opens the gate', (tester) async {
      await show(tester, auth: FakeAuth(result: true));

      expect(find.byKey(const Key('lock-cover')), findsNothing);
    });

    testWidgets('a refusal keeps it shut and says so', (tester) async {
      await show(tester, auth: FakeAuth(result: false));

      expect(find.byKey(const Key('lock-cover')), findsOneWidget);
      expect(find.byKey(const Key('lock-notice')), findsOneWidget);
      expect(find.textContaining('没通过'), findsOneWidget);
    });

    testWidgets('an exception is not a refusal, and does not let anyone in',
        (tester) async {
      // The rule that was wrong first: some Android devices throw after
      // repeated failures, and treating that as "open" is no lock at all.
      await show(tester, auth: FakeAuth(throws: true));

      expect(find.byKey(const Key('lock-cover')), findsOneWidget);
      expect(find.textContaining('没法验证'), findsOneWidget);
    });

    testWidgets('a device with nothing enrolled is let through',
        (tester) async {
      final auth = FakeAuth(hardware: false, enrolled: false);
      await show(tester, auth: auth);

      expect(find.byKey(const Key('lock-cover')), findsNothing,
          reason: 'gating here would lock a user out of their own ledger');
      expect(auth.prompts, 0, reason: 'there was nothing to ask');
    });

    testWidgets('pressing retry asks again', (tester) async {
      final auth = FakeAuth(result: false);
      await show(tester, auth: auth);
      expect(auth.prompts, 1);

      auth.result = true;
      await tester.tap(find.byKey(const Key('lock-unlock')));
      await tester.pumpAndSettle();

      expect(auth.prompts, 2);
      expect(find.byKey(const Key('lock-cover')), findsNothing);
    });

    testWidgets('retrying clears what the last attempt said', (tester) async {
      final auth = FakeAuth(result: false);
      await show(tester, auth: auth);
      expect(find.byKey(const Key('lock-notice')), findsOneWidget);

      auth.hold = true; // the retry's prompt stays up
      await tester.tap(find.byKey(const Key('lock-unlock')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('lock-notice')), findsNothing);
    });

    testWidgets('a prompt still up is cancelled before a new one',
        (tester) async {
      final auth = FakeAuth()..hold = true;
      await show(tester, auth: auth);
      expect(auth.prompts, 1);

      await tester.tap(find.byKey(const Key('lock-unlock')));
      await tester.pumpAndSettle();

      expect(auth.cancels, 1, reason: 'the hung prompt is torn down');
      expect(auth.prompts, 2);

      // The abandoned FIRST prompt now succeeds. It must not open the gate:
      // this is the whole reason attempts are numbered.
      auth.held.first.complete(true);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('lock-cover')), findsOneWidget);
    });

    // The three lifecycle rules — the gate closing behind you, an `inactive`
    // under our own dialog not counting, and a real departure superseding a
    // live prompt — are NOT tested here, and cannot be. Sending `paused` to an
    // app running on a device does not simulate a pause; it causes one, and
    // the test driver loses the app it was driving. The rules have unit tests
    // in the core, where a lifecycle is an enum rather than an operating
    // system. What is checked below is the only part this side owns: that each
    // callback reaches the right event.

    testWidgets('each lifecycle callback reaches the right event',
        (tester) async {
      await show(tester, auth: FakeAuth(result: true));
      expect(lock.lockGated(), isFalse);

      // A real departure closes the gate.
      expect(
        lock.lockBackgrounded().map((a) => a.kind),
        contains('relock'),
      );
      expect(lock.lockGated(), isTrue);

      // Coming back after one supersedes whatever was up.
      expect(
        lock.lockResumed().map((a) => a.kind),
        contains('runAuth'),
      );
    });

    testWidgets('inactive spares a prompt that is actually up', (tester) async {
      final auth = FakeAuth(result: true);
      await show(tester, auth: auth);
      auth.hold = true;
      lock.lockUnlockPressed(); // a prompt is up again

      // This is what the system's own dialog looks like from here. Re-locking
      // under it would fight the question the user is answering.
      expect(lock.lockInactive(), isEmpty);
      expect(lock.lockGated(), isFalse);
    });

    testWidgets('inactive with nothing up does close the gate', (tester) async {
      // The rule is narrower than "inactive never re-locks". Nothing is being
      // answered, so leaving the foreground is leaving the foreground.
      await show(tester, auth: FakeAuth(result: true));

      expect(lock.lockInactive().map((a) => a.kind), contains('relock'));
      expect(lock.lockGated(), isTrue);
    });

    testWidgets('English on the cover when the app is in English',
        (tester) async {
      await show(tester, auth: FakeAuth(result: false), zh: false);

      expect(find.text('Red Blossom is locked'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
    });
  });

  group('the setting', () {
    testWidgets('turning it on prompts straight away', (tester) async {
      final auth = FakeAuth(result: false);
      await show(tester, auth: auth);
      expect(auth.prompts, 0);

      final actions = lock.lockSetEnabled(enabled: true);

      expect(actions.map((a) => a.kind), contains('runAuth'));
      expect(lock.lockGated(), isTrue);
    });

    testWidgets('turning it off opens the gate', (tester) async {
      lock.lockLoad(enabled: true);
      await show(tester, auth: FakeAuth(result: false));
      expect(find.byKey(const Key('lock-cover')), findsOneWidget);

      lock.lockSetEnabled(enabled: false);

      expect(lock.lockGated(), isFalse);
    });

    testWidgets('it survives a snapshot and a reload', (tester) async {
      lock.lockSetEnabled(enabled: true);
      final blob = store.snapshotConfig();

      lock.lockReset();
      expect(lock.lockEnabled(), isFalse);
      expect(store.loadConfig(json: blob), isTrue);

      expect(lock.lockEnabled(), isTrue);
    });

    testWidgets('loading a config does not prompt', (tester) async {
      // A file read is not a user turning the lock on, and there is no screen
      // to ask over yet.
      lock.lockLoad(enabled: true);

      expect(lock.lockGated(), isTrue);
      expect(lock.lockNotice(), isNull);
    });

    testWidgets('a config from before the lock existed is unlocked',
        (tester) async {
      lock.lockLoad(enabled: true);

      expect(store.loadConfig(json: '{}'), isTrue);

      expect(lock.lockEnabled(), isFalse);
    });
  });
}
