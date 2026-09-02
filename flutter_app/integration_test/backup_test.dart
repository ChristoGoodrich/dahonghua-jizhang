// 备份 on a device, with real files.
//
// The naming, ordering and pruning are Rust's and pinned by a 2,200-case parity
// corpus, so these tests are about the half the corpus cannot reach: files that
// actually exist, a restore that actually replaces the ledger, and the refusal
// that leaves it alone.
//
// The ordering is the part worth being careful about. Pruning keeps the FIRST
// `keep` of the list, so a directory listing in the wrong order deletes the
// wrong files — and which order a listing comes back in is not something a
// filesystem promises.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_app/backup_screen.dart';
import 'package:flutter_app/src/rust/api/backup.dart' as backup;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

void spend(String id, double amt, {String? note}) {
  final t = now;
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: 'food', amt: amt, note: note, ts: t),
    id: id,
    now: t,
  );
}

/// Start from an empty backup directory, so one test's files are not another's
/// fixture.
Future<void> clearBackups() async {
  final dir = await backupDir();
  for (final f in dir.listSync().whereType<File>()) {
    f.deleteSync();
  }
}

Future<void> writeRaw(String name, String body) async {
  final dir = await backupDir();
  await File('${dir.path}/$name').writeAsString(body);
}

Future<List<String>> namesOnDisk() async {
  final dir = await backupDir();
  return dir.listSync().whereType<File>().map((f) => f.uri.pathSegments.last).toList()
    ..sort();
}

Future<void> show(WidgetTester tester, {bool zh = true}) async {
  await tester.pumpWidget(MaterialApp(home: BackupScreen(zh: zh)));
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() async {
    store.reset();
    await clearBackups();
  });

  group('taking one', () {
    testWidgets('writes a file named for the moment', (tester) async {
      spend('e1', 35);
      final f = await createBackup();

      expect(await f.exists(), isTrue);
      final name = f.uri.pathSegments.last;
      expect(name, startsWith('backup_'));
      expect(name, endsWith('.json'));
      expect(name, isNot(contains('.enc.')));
    });

    testWidgets('the document carries the ledger and the config',
        (tester) async {
      spend('e1', 35, note: '午饭');
      final f = await createBackup();
      final body = await f.readAsString();

      expect(body, contains('dahonghua'));
      expect(body, contains('午饭'));
      expect(body, contains('"version":8')); // the APP's schema version
      expect(body, contains('"config"'));
    });

    testWidgets('prunes to the newest, oldest first', (tester) async {
      // written by hand so the times are known rather than milliseconds apart
      for (final ts in [100, 200, 300, 400]) {
        await writeRaw('backup_$ts.json', '[]');
      }
      final gone = backup.pruneBackups(names: await namesOnDisk(), keep: 2);

      expect(gone, ['backup_200.json', 'backup_100.json']);
    });

    testWidgets('a listing in any order still prunes the right files',
        (tester) async {
      // the reason the sort lives in Rust rather than in whatever order the
      // directory came back in
      final gone = backup.pruneBackups(
        names: const [
          'backup_200.json',
          'backup_400.json',
          'backup_100.json',
          'backup_300.json',
        ],
        keep: 1,
      );
      expect(gone, [
        'backup_300.json',
        'backup_200.json',
        'backup_100.json',
      ]);
    });

    testWidgets('leaves files that are not backups alone', (tester) async {
      await writeRaw('entries.json', '[]');
      await writeRaw('backup_100.json', '[]');
      expect(backup.pruneBackups(names: await namesOnDisk(), keep: 0),
          ['backup_100.json']);
    });
  });

  group('the listing', () {
    testWidgets('is newest first', (tester) async {
      for (final ts in [100, 300, 200]) {
        await writeRaw('backup_$ts.json', '[]');
      }
      final list = await listBackups();
      expect(list.map((b) => b.time).toList(), [300.0, 200.0, 100.0]);
    });

    testWidgets('an unreadable name sorts last rather than first',
        (tester) async {
      // `Number('draft')` is NaN, and a NaN comparator is not a total order —
      // ranking it explicitly is what stops it being pruned ahead of a real
      // backup
      await writeRaw('backup_draft.json', '[]');
      await writeRaw('backup_300.json', '[]');
      final list = await listBackups();
      expect(list.first.time, 300.0);
      expect(list.last.time.isNaN, isTrue);
    });

    testWidgets('an empty number is epoch zero, not unreadable',
        (tester) async {
      // `Number('')` is 0 — the JavaScript fact the corpus caught
      await writeRaw('backup_.json', '[]');
      final list = await listBackups();
      expect(list.single.time, 0.0);
    });
  });

  group('restoring', () {
    testWidgets('replaces the ledger wholesale', (tester) async {
      spend('old1', 10);
      spend('old2', 20);
      final f = await createBackup();

      store.reset();
      spend('new1', 999);
      expect(store.entryCount(), 1);

      final r = backup.restoreBackup(json: await f.readAsString());
      expect(r.ok, isTrue);
      expect(r.entries, 2);
      expect(store.getEntry(id: 'old1'), isNotNull);
      expect(store.getEntry(id: 'new1'), isNull); // replaced, not merged
    });

    testWidgets('brings the config back too', (tester) async {
      store.setLanguage(lang: 'en');
      final f = await createBackup();

      store.reset();
      expect(store.language(), 'zh');

      final r = backup.restoreBackup(json: await f.readAsString());
      expect(r.config, isTrue);
      expect(store.language(), 'en');
    });

    testWidgets('refuses a document it cannot read, and changes nothing',
        (tester) async {
      spend('e1', 35);
      final r = backup.restoreBackup(json: 'not json at all');

      expect(r.ok, isFalse);
      expect(r.entries, 0);
      expect(store.entryCount(), 1); // untouched
      expect(store.getEntry(id: 'e1'), isNotNull);
    });

    testWidgets('refuses a truncated document rather than loading half of it',
        (tester) async {
      // the same reason `load_entries` answers -1 instead of loading the rows
      // it managed to parse
      spend('e1', 35);
      final good = backup.buildBackup(ts: now.toDouble());
      final r = backup.restoreBackup(
        json: good.substring(0, good.length ~/ 2),
      );

      expect(r.ok, isFalse);
      expect(store.entryCount(), 1);
    });

    testWidgets('takes a bare array, which is what an older export was',
        (tester) async {
      // refusing it would be refusing the files this feature exists to read
      spend('e1', 35);
      final entries = store.snapshotEntries();
      store.reset();

      final r = backup.restoreBackup(json: entries);
      expect(r.ok, isTrue);
      expect(r.entries, 1);
      expect(r.config, isFalse);
    });
  });

  group('the screen', () {
    testWidgets('says so when there is nothing', (tester) async {
      await show(tester);
      expect(find.byKey(const Key('no-backups')), findsOneWidget);
    });

    testWidgets('takes one and lists it', (tester) async {
      spend('e1', 35);
      await show(tester);

      await tester.tap(find.byKey(const Key('take-backup')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('backup-flash')), findsOneWidget);
      expect(find.byKey(const Key('no-backups')), findsNothing);
      expect((await listBackups()).length, 1);
    });

    testWidgets('restoring asks first, and cancelling changes nothing',
        (tester) async {
      spend('old', 10);
      await createBackup();
      store.reset();
      spend('new', 999);
      await show(tester);

      await tester.tap(find.textContaining('恢复').first);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('restore-dialog')), findsOneWidget);

      await tester.tap(find.byKey(const Key('restore-cancel')));
      await tester.pumpAndSettle();
      expect(store.getEntry(id: 'new'), isNotNull);
      expect(store.getEntry(id: 'old'), isNull);
    });

    testWidgets('confirming restores, and snapshots what it replaced first',
        (tester) async {
      // restoring is the one action here with no undo, and the cheapest undo
      // is another backup
      spend('old', 10);
      await createBackup();
      store.reset();
      spend('new', 999);
      await show(tester);
      final before = (await listBackups()).length;

      await tester.tap(find.textContaining('恢复').first);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('restore-ok')));
      await tester.pumpAndSettle();

      expect(store.getEntry(id: 'old'), isNotNull);
      expect(store.getEntry(id: 'new'), isNull);
      // the pre-restore state is on disk
      expect((await listBackups()).length, before + 1);
    });

    testWidgets('an encrypted snapshot offers no restore it cannot do',
        (tester) async {
      await writeRaw('backup_100.enc.json', 'ciphertext');
      await show(tester);

      final btn = tester.widget<TextButton>(
        find.byKey(const Key('backup-backup_100.enc.json-restore')),
      );
      expect(btn.onPressed, isNull);
    });

    testWidgets('says what is deliberately absent', (tester) async {
      await show(tester);
      expect(find.byKey(const Key('backup-note')), findsOneWidget);
    });
  });
}
