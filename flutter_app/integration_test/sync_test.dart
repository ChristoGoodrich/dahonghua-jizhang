// The sync loop on a device, over the real Rust engine.
//
// The engine's decisions are pinned by a 2,600-script parity corpus against the
// shipping TypeScript, so these tests are not about them. They are about the
// half the corpus cannot reach: real timers, real awaits, and a bridge that
// applies the two store-writing effects itself instead of handing them to Dart.
//
// The transport is a fake, and not as a shortcut — there is no Supabase project
// configured, so a live client could not be exercised here at all. The shipping
// app's own engine tests fake it at the same boundary for the same reason.

import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/api/sync.dart' as rust;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_app/sync.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

void add(String id, double amt, {int? updated}) {
  final t = updated ?? now;
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: 'food', amt: amt, ts: t),
    id: id,
    now: t,
  );
}

/// A server row, as the table holds it.
String serverRow(String id, int updated, {double amt = 1}) =>
    '{"id":"$id","ts":1000,"io":"exp","cat":"food","amt":$amt,"updatedAt":$updated}';

class MemStamps implements StampStore {
  String? saved;
  int writes = 0;
  @override
  Future<String?> load() async => saved;
  @override
  Future<void> save(String json) async {
    saved = json;
    writes++;
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async => await RustLib.init());
  setUp(() {
    store.reset();
    rust.syncReset();
  });

  group('signing in', () {
    testWidgets('pulls, merges into the Rust ledger, and reaches synced',
        (tester) async {
      final t = FakeTransport();
      t.entries['remote1'] = {'id': 'remote1', 'updatedAt': 5000};
      final loop = SyncLoop(transport: t);

      await loop.signIn('u1');

      expect(store.entryCount(), 1);
      expect(store.getEntry(id: 'remote1'), isNotNull);
      expect(loop.status.value, 'synced');
      loop.dispose();
    });

    testWidgets('pushes the rows the server does not have', (tester) async {
      add('local1', 5, updated: 9);
      final t = FakeTransport();
      final loop = SyncLoop(transport: t);

      await loop.signIn('u1');

      expect(t.log, contains('push[local1]'));
      expect(t.entries.containsKey('local1'), isTrue);
      loop.dispose();
    });

    testWidgets('opens both channels, and only after the config lands',
        (tester) async {
      final t = FakeTransport();
      final loop = SyncLoop(transport: t);
      await loop.signIn('u1');

      expect(t.channels, {'entries', 'config'});
      // the order is the engine's: nothing is subscribed until the config
      // upload has succeeded
      expect(t.log.indexOf('config'), lessThan(t.log.indexOf('sub:entries')));
      loop.dispose();
    });

    testWidgets('a failed pull stops the sequence and reports error',
        (tester) async {
      final t = FakeTransport()..failPull = true;
      final loop = SyncLoop(transport: t);

      await loop.signIn('u1');

      expect(loop.status.value, 'error');
      expect(t.channels, isEmpty);
      expect(t.log, isNot(contains('pullConfig')));
      loop.dispose();
    });

    testWidgets('a failed config READ does not push over the cloud copy',
        (tester) async {
      // a failed read is indistinguishable from "no config yet" unless the two
      // are kept apart, and collapsing them wipes an existing account
      final t = FakeTransport()
        ..failConfigRead = true
        ..profile = '{"accounts":[{"id":"cloud","name":"云端","balance":0}]}';
      final loop = SyncLoop(transport: t);

      await loop.signIn('u1');

      expect(loop.status.value, 'error');
      expect(t.profile, contains('cloud')); // untouched
      loop.dispose();
    });

    testWidgets('adopts the cloud config into the Rust store', (tester) async {
      final t = FakeTransport()
        ..profile =
            '{"accounts":[{"id":"a1","name":"云端账户","balance":250}],"curAccount":"a1"}';
      final loop = SyncLoop(transport: t);

      await loop.signIn('u1');

      final accounts = store.accounts();
      expect(accounts.any((a) => a.id == 'a1'), isTrue);
      expect(store.currentAccount(), 'a1');
      loop.dispose();
    });
  });

  group('the debounce', () {
    testWidgets('coalesces a burst of edits into one upload', (tester) async {
      final t = FakeTransport();
      final loop = SyncLoop(transport: t);
      await loop.signIn('u1');
      final before = t.log.length;

      add('e1', 10);
      await loop.localEdit();
      add('e2', 20);
      await loop.localEdit();
      add('e3', 30);
      await loop.localEdit();
      // nothing yet — the deadline keeps being pushed back
      expect(t.log.length, before);

      await tester.pump(const Duration(milliseconds: 900));
      await tester.pumpAndSettle();

      final sent = t.log.skip(before).where((l) => l.startsWith('push[')).toList();
      expect(sent.length, 1);
      expect(sent.single, contains('e1'));
      expect(sent.single, contains('e3'));
      loop.dispose();
    });

    testWidgets('an accounts-only change still uploads the config',
        (tester) async {
      // no dirty rows at all, and this is the path that used to upload nothing
      final t = FakeTransport();
      final loop = SyncLoop(transport: t);
      await loop.signIn('u1');
      final before = t.log.length;

      await loop.localEdit(sections: ['accounts']);
      await tester.pump(const Duration(milliseconds: 900));
      await tester.pumpAndSettle();

      expect(t.log.skip(before), contains('config'));
      loop.dispose();
    });

    testWidgets('the watermark keeps a pushed row from going up twice',
        (tester) async {
      final t = FakeTransport();
      final loop = SyncLoop(transport: t);
      await loop.signIn('u1');

      add('e1', 10);
      await loop.localEdit();
      await tester.pump(const Duration(milliseconds: 900));
      await tester.pumpAndSettle();
      final after = t.log.length;

      // a second edit that changes no row is still a store change
      await loop.localEdit(sections: ['tags']);
      await tester.pump(const Duration(milliseconds: 900));
      await tester.pumpAndSettle();

      final sent = t.log.skip(after).where((l) => l.startsWith('push[')).toList();
      expect(sent, isEmpty); // e1 is below the watermark now
      loop.dispose();
    });
  });

  group('failure and retry', () {
    testWidgets('a failed push reports error and retries with backoff',
        (tester) async {
      final t = FakeTransport();
      final loop = SyncLoop(transport: t);
      await loop.signIn('u1');

      t.failPush = true;
      add('e1', 10);
      await loop.localEdit();
      await tester.pump(const Duration(milliseconds: 900));
      await tester.pumpAndSettle();
      expect(loop.status.value, 'error');

      // the first backoff is two seconds, and it is not shorter
      t.failPush = false;
      await tester.pump(const Duration(milliseconds: 1500));
      await tester.pumpAndSettle();
      expect(loop.status.value, 'error');

      await tester.pump(const Duration(milliseconds: 700));
      await tester.pumpAndSettle();
      expect(loop.status.value, 'synced');
      expect(t.entries.containsKey('e1'), isTrue);
      loop.dispose();
    });

    testWidgets('retryNow flushes at once, without waiting out the backoff',
        (tester) async {
      final t = FakeTransport();
      final loop = SyncLoop(transport: t);
      await loop.signIn('u1');

      t.failPush = true;
      add('e1', 10);
      await loop.localEdit();
      await tester.pump(const Duration(milliseconds: 900));
      await tester.pumpAndSettle();
      expect(loop.status.value, 'error');

      t.failPush = false;
      await loop.retryNow();
      expect(loop.status.value, 'synced');
      expect(t.entries.containsKey('e1'), isTrue);
      loop.dispose();
    });

    testWidgets('rows that landed are not re-sent when only the config failed',
        (tester) async {
      // the branch the watermark rule exists for: the upload succeeded, the
      // config after it did not, and a retry must not repeat the rows
      final t = FakeTransport();
      final loop = SyncLoop(transport: t);
      // signed in cleanly first: a config push that fails during START-UP
      // aborts the sign-in, so nothing afterwards would schedule at all
      await loop.signIn('u1');
      t.failConfigPush = true;

      add('e1', 10);
      await loop.localEdit();
      await tester.pump(const Duration(milliseconds: 900));
      await tester.pumpAndSettle();
      expect(loop.status.value, 'error');
      expect(t.entries.containsKey('e1'), isTrue);
      final after = t.log.length;

      t.failConfigPush = false;
      await loop.retryNow();

      final sent = t.log.skip(after).where((l) => l.startsWith('push[')).toList();
      expect(sent, isEmpty);
      expect(loop.status.value, 'synced');
      loop.dispose();
    });
  });

  group('realtime', () {
    testWidgets('a row the device lacks lands in the ledger', (tester) async {
      final t = FakeTransport();
      final loop = SyncLoop(transport: t);
      await loop.signIn('u1');

      await loop.onRealtimeEntry(serverRow('new1', 8000, amt: 42));

      expect(store.getEntry(id: 'new1')!.amt, 42);
      loop.dispose();
    });

    testWidgets('a stale message does not overwrite a newer local row',
        (tester) async {
      add('r1', 10, updated: 9999);
      final t = FakeTransport();
      final loop = SyncLoop(transport: t);
      await loop.signIn('u1');

      await loop.onRealtimeEntry(serverRow('r1', 5, amt: 1));

      expect(store.getEntry(id: 'r1')!.amt, 10);
      loop.dispose();
    });

    testWidgets('a malformed payload is shrugged off', (tester) async {
      final t = FakeTransport();
      final loop = SyncLoop(transport: t);
      await loop.signIn('u1');
      final before = store.entryCount();

      await loop.onRealtimeEntry('not json at all');
      await loop.onRealtimeEntry('{}');

      expect(store.entryCount(), before);
      loop.dispose();
    });

    testWidgets('a remote config is adopted without being pushed back',
        (tester) async {
      final t = FakeTransport();
      final loop = SyncLoop(transport: t);
      await loop.signIn('u1');
      final before = t.log.length;

      await loop.onRealtimeConfig(
        '{"accounts":[{"id":"a2","name":"远端","balance":0}]}',
      );
      await tester.pump(const Duration(milliseconds: 900));
      await tester.pumpAndSettle();

      expect(store.accounts().any((a) => a.id == 'a2'), isTrue);
      // no echo: adopting a section is not a local edit
      expect(t.log.skip(before), isNot(contains('config')));
      loop.dispose();
    });

    testWidgets('a stale remote section does not clobber a newer local edit',
        (tester) async {
      final t = FakeTransport();
      final loop = SyncLoop(transport: t);
      await loop.signIn('u1');

      await loop.localEdit(sections: ['accounts']); // stamped now
      await tester.pump(const Duration(milliseconds: 900));
      await tester.pumpAndSettle();

      await loop.onRealtimeConfig(
        '{"accounts":[{"id":"stale","name":"远端旧","balance":0}],"configTs":{"accounts":1}}',
      );
      await tester.pump(const Duration(milliseconds: 900));
      await tester.pumpAndSettle();

      expect(store.accounts().any((a) => a.id == 'stale'), isFalse);
      loop.dispose();
    });
  });

  group('signing out', () {
    testWidgets('closes both channels and stops pushing', (tester) async {
      final t = FakeTransport();
      final loop = SyncLoop(transport: t);
      await loop.signIn('u1');

      await loop.signOut();
      expect(t.channels, isEmpty);
      expect(loop.status.value, 'off');

      final after = t.log.length;
      add('later', 10);
      await loop.localEdit();
      await tester.pump(const Duration(seconds: 2));
      await tester.pumpAndSettle();
      expect(t.log.length, after);
      loop.dispose();
    });

    testWidgets('a pending retry does not fire after sign-out', (tester) async {
      final t = FakeTransport();
      final loop = SyncLoop(transport: t);
      await loop.signIn('u1');

      t.failPush = true;
      add('e1', 10);
      await loop.localEdit();
      await tester.pump(const Duration(milliseconds: 900));
      await tester.pumpAndSettle();

      await loop.signOut();
      final after = t.log.length;
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();

      expect(t.log.length, after);
      loop.dispose();
    });
  });

  group('the section stamps', () {
    testWidgets('are written when an edit stamps one', (tester) async {
      final s = MemStamps();
      final loop = SyncLoop(transport: FakeTransport(), stamps: s);
      await loop.signIn('u1');

      await loop.localEdit(sections: ['tags']);
      expect(s.saved, contains('tags'));
      loop.dispose();
    });

    testWidgets('survive a restart and still beat a stale cloud section',
        (tester) async {
      // an edit made offline has to win after the next sign-in, which it can
      // only do if its stamp was on disk
      final s = MemStamps();
      final first = SyncLoop(transport: FakeTransport(), stamps: s);
      await first.localEdit(sections: ['accounts']); // signed out, still stamps
      expect(s.saved, contains('accounts'));
      first.dispose();

      rust.syncReset();
      final t = FakeTransport();
      final second = SyncLoop(transport: t, stamps: s);
      await second.restore();
      await second.signIn('u1');

      await second.onRealtimeConfig(
        '{"accounts":[{"id":"stale","name":"远端旧","balance":0}],"configTs":{"accounts":1}}',
      );
      expect(store.accounts().any((a) => a.id == 'stale'), isFalse);
      second.dispose();
    });
  });
}
