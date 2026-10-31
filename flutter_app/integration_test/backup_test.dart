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

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_app/backup_screen.dart';
import 'package:flutter_app/folders.dart';
import 'package:flutter_app/photos.dart';
import 'package:flutter_app/record_sheet.dart' show FormEdit;
import 'package:flutter_app/src/rust/api/backup.dart' as backup;
import 'package:flutter_app/src/rust/api/record.dart' as record;
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

/// An entry with a receipt, written the way the sheet writes one, and the
/// receipt's bytes where the sheet would have put them.
Future<void> spendWithReceipt(String id, String photo) async {
  final dir = await attachmentsDir();
  final f = File('${dir.path}/$photo');
  final existed = await f.exists();
  await f.writeAsString('the receipt for $id');
  // Not an image, and the attachments directory outlives this file: a later
  // test that opens the sheet on a receipt of the same name finds it and
  // fails decoding it, which is how this was found.
  if (!existed) {
    addTearDown(() async {
      if (await f.exists()) await f.delete();
    });
  }
  final r = record.saveForm(
    form: record
        .initialForm(sourceId: '', editing: false, ledger: '')
        .copyWith(amt: '35', photo: photo),
    editId: '',
    id: id,
    now: now,
    rateWasCached: false,
  );
  expect(r.rejected, isNull);
  expect(store.getEntry(id: id)!.photo, photo);
}

/// The folder a snapshot's receipts travel in.
Future<Directory> packOf(File snapshot) async {
  final stem = snapshot.uri.pathSegments.last.replaceAll('.json', '');
  return Directory('${(await backupDir()).path}/${stem}_files');
}

/// Two snapshots taken in one millisecond share a name, and the second
/// overwrites the first — which is not what a test of two snapshots means.
Future<File> nextBackup({int? keep, String? password}) async {
  await Future<void>.delayed(const Duration(milliseconds: 5));
  return createBackup(keep: keep, password: password);
}

/// Start from an empty backup directory, so one test's files are not another's
/// fixture. Folders too: a receipt pack left by one test is exactly what
/// another one counts.
Future<void> clearBackups() async {
  final dir = await backupDir();
  for (final f in dir.listSync()) {
    f.deleteSync(recursive: true);
  }
}

Future<void> writeRaw(String name, String body) async {
  final dir = await backupDir();
  await File('${dir.path}/$name').writeAsString(body);
}

Future<List<String>> namesOnDisk() async {
  final dir = await backupDir();
  return dir
      .listSync()
      .whereType<File>()
      .map((f) => f.uri.pathSegments.last)
      .toList()
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

    testWidgets('the document carries the ledger and the config', (
      tester,
    ) async {
      spend('e1', 35, note: '午饭');
      final f = await createBackup();
      final body = await f.readAsString();

      expect(body, contains('dahonghua'));
      expect(body, contains('午饭'));
      expect(body, contains('"version":8')); // the APP's schema version
      expect(body, contains('"config"'));
    });

    testWidgets('an empty ledger still produces a real document', (
      tester,
    ) async {
      // "I could not assemble this" is an empty string and the caller
      // refuses it. "There is nothing in the ledger" is still a document —
      // conflating the two is how a backup of nothing gets written when
      // the snapshot failed to parse.
      final json = backup.buildBackup(ts: now.toDouble());
      expect(json, isNotEmpty);
      expect(json, startsWith('{'));
      expect(json, contains('"entries"'));
      expect(json, contains('"config"'));
    });

    testWidgets('createBackup never leaves an empty file behind', (
      tester,
    ) async {
      spend('e1', 35);
      final f = await createBackup();
      expect(await f.readAsString(), isNotEmpty);
    });

    testWidgets('a sealed snapshot hides its contents and reopens', (
      tester,
    ) async {
      spend('e1', 35, note: '午饭');
      final f = await createBackup(password: 'correct horse');
      final body = await f.readAsString();

      expect(f.path, contains('.enc.json'));
      expect(body, isNot(contains('午饭')));
      expect(body, contains('"enc"'));
      expect(backup.isEncryptedDoc(json: body), isTrue);

      final out = await backup.decryptBackup(
        envelope: body,
        password: 'correct horse',
      );
      expect(out.ok, isTrue);
      expect(out.json, contains('午饭'));
    });

    testWidgets('the wrong password restores nothing', (tester) async {
      spend('e1', 35, note: '午饭');
      final f = await createBackup(password: 'correct horse');
      final body = await f.readAsString();

      final out = await backup.decryptBackup(envelope: body, password: 'nope');
      expect(out.ok, isFalse);
      expect(out.json, isEmpty);

      // and a refused decrypt is never fed to the restorer
      final before = store.entryCount();
      expect(before, greaterThan(0));
    });

    testWidgets('two sealed snapshots of the same ledger differ', (
      tester,
    ) async {
      spend('e1', 35);
      final a = await createBackup(password: 'pw');
      final b = await createBackup(password: 'pw');
      expect(await a.readAsString(), isNot(equals(await b.readAsString())));
    });

    /// Sealing is 600,000 rounds of PBKDF2 — about 47ms on a desktop and
    /// more on a phone — and it ran as a sync call on the UI thread, so the
    /// screen froze for as long as it took. Wrapped in `Future.value` so the
    /// test reads the same whichever way the call is shaped: a call that
    /// blocks has finished before the first frame can be asked for.
    Future<int> framesWhile(
      WidgetTester tester,
      FutureOr<Object?> Function() work,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: CircularProgressIndicator())),
      );
      var done = false;
      final pending = Future<Object?>.value(work()).whenComplete(
        () => done = true,
      );
      var frames = 0;
      while (!done) {
        await tester.pump(const Duration(milliseconds: 16));
        if (!done) frames++;
      }
      await pending;
      return frames;
    }

    testWidgets('sealing leaves the screen drawing', (tester) async {
      final doc = backup.buildBackup(ts: now.toDouble());
      final frames = await framesWhile(
        tester,
        () => backup.encryptBackup(plaintext: doc, password: 'pw'),
      );
      expect(frames, greaterThan(0), reason: 'no frame while it sealed');
    });

    testWidgets('and so does unlocking', (tester) async {
      spend('e1', 35);
      final body = await (await createBackup(password: 'pw')).readAsString();
      final frames = await framesWhile(
        tester,
        () => backup.decryptBackup(envelope: body, password: 'pw'),
      );
      expect(frames, greaterThan(0), reason: 'no frame while it unlocked');
    });

    testWidgets('a plain snapshot is still plain', (tester) async {
      spend('e1', 35, note: '午饭');
      final f = await createBackup();
      final body = await f.readAsString();
      expect(f.path, isNot(contains('.enc.')));
      expect(body, contains('午饭'));
      expect(backup.isEncryptedDoc(json: body), isFalse);
    });

    testWidgets('prunes to the newest, oldest first', (tester) async {
      // written by hand so the times are known rather than milliseconds apart
      for (final ts in [100, 200, 300, 400]) {
        await writeRaw('backup_$ts.json', '[]');
      }
      final gone = backup.pruneBackups(names: await namesOnDisk(), keep: 2);

      expect(gone, ['backup_200.json', 'backup_100.json']);
    });

    testWidgets('a listing in any order still prunes the right files', (
      tester,
    ) async {
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
      expect(gone, ['backup_300.json', 'backup_200.json', 'backup_100.json']);
    });

    testWidgets('leaves files that are not backups alone', (tester) async {
      await writeRaw('entries.json', '[]');
      await writeRaw('backup_100.json', '[]');
      expect(backup.pruneBackups(names: await namesOnDisk(), keep: 0), [
        'backup_100.json',
      ]);
    });
  });

  group('the receipts beside a snapshot', () {
    testWidgets('a plain snapshot carries them', (tester) async {
      await spendWithReceipt('e1', 'r1.jpg');
      final f = await createBackup();
      final pack = await packOf(f);
      expect(await File('${pack.path}/r1.jpg').readAsString(), 'the receipt for e1');
    });

    testWidgets('pruning a snapshot takes its receipts with it', (tester) async {
      // Every snapshot copies every receipt, and the prune deleted only the
      // `.json` — so the folders piled up one per snapshot ever taken, each
      // a full copy of the receipts, for as long as the app was installed.
      await spendWithReceipt('e1', 'r1.jpg');
      final old = await createBackup(keep: 1);
      final oldPack = await packOf(old);
      expect(await oldPack.exists(), isTrue);

      final kept = await nextBackup(keep: 1);
      expect(await old.exists(), isFalse, reason: 'the prune has to have run');
      expect(await oldPack.exists(), isFalse);
      expect(await (await packOf(kept)).exists(), isTrue);
    });

    testWidgets('a folder whose snapshot is already gone is swept too', (
      tester,
    ) async {
      // what every build before this one left behind
      final dir = await backupDir();
      final orphan = Directory('${dir.path}/backup_100_files');
      await orphan.create();
      await File('${orphan.path}/r1.jpg').writeAsString('old');
      final sealed = Directory('${dir.path}/backup_200.enc_files');
      await sealed.create();
      // and the plain copies an older build put beside a sealed snapshot,
      // which the snapshot itself outlives
      await writeRaw('backup_300.enc.json', 'ciphertext');
      final leak = Directory('${dir.path}/backup_300.enc_files');
      await leak.create();
      await File('${leak.path}/r1.jpg').writeAsString('plain');

      await spendWithReceipt('e1', 'r1.jpg');
      final kept = await createBackup();

      expect(await orphan.exists(), isFalse);
      expect(await sealed.exists(), isFalse);
      expect(await leak.exists(), isFalse);
      expect(await File('${dir.path}/backup_300.enc.json').exists(), isTrue);
      expect(await (await packOf(kept)).exists(), isTrue);
    });

    testWidgets('a folder is never taken for a snapshot', (tester) async {
      // `_names` lists files only. A directory that happens to be named like
      // a snapshot is not one, and handing it to the prune would ask Dart to
      // delete a folder as a file.
      final dir = await backupDir();
      await Directory('${dir.path}/backup_300.json').create();
      expect(await listBackups(), isEmpty);
      await createBackup(keep: 1);
      expect((await listBackups()).length, 1);
    });

    testWidgets('a sealed snapshot does not carry them in the clear', (
      tester,
    ) async {
      // The JSON was sealed and the photos beside it were plain copies, which
      // 导出 then handed to the share sheet with it — the most private thing
      // in the ledger, sent out under a password that did not cover it.
      await spendWithReceipt('e1', 'r1.jpg');
      final f = await createBackup(password: 'correct horse');
      expect(f.path, contains('.enc.json'));

      final dir = await backupDir();
      final name = f.uri.pathSegments.last;
      final list = backup.receiptsName(name: name)!;
      final everything = dir.listSync(recursive: true).whereType<File>();
      expect(everything.map((e) => e.uri.pathSegments.last).toList()..sort(), [
        name,
        list,
      ]);
      // Beside it, the names of what its restore will look for — which keeps
      // them from the receipt sweep — and not the photos.
      expect(await File('${dir.path}/$list').readAsString(), '["r1.jpg"]');
    });

    testWidgets('exporting a sealed one hands out the document alone', (
      tester,
    ) async {
      // A sealed snapshot from an older build still has its plain folder on
      // disk. The export is where that would leave the phone.
      final dir = await backupDir();
      await writeRaw('backup_100.enc.json', 'ciphertext');
      final pack = Directory('${dir.path}/backup_100.enc_files');
      await pack.create();
      await File('${pack.path}/r1.jpg').writeAsString('plain');
      await writeRaw('backup_200.json', '{}');
      final plain = Directory('${dir.path}/backup_200_files');
      await plain.create();
      await File('${plain.path}/r2.jpg').writeAsString('plain');

      final sealed = await filesToExport('backup_100.enc.json');
      expect(sealed.map((f) => f.uri.pathSegments.last), [
        'backup_100.enc.json',
      ]);
      final open = await filesToExport('backup_200.json');
      expect(open.map((f) => f.uri.pathSegments.last).toList()..sort(), [
        'backup_200.json',
        'r2.jpg',
      ]);
    });

    testWidgets('the seal dialog says the receipts stay behind', (
      tester,
    ) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('take-backup')));
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: find.byKey(const Key('password-dialog')),
          matching: find.textContaining('小票'),
        ),
        findsOneWidget,
      );
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

    testWidgets('an unreadable name sorts last rather than first', (
      tester,
    ) async {
      // `Number('draft')` is NaN, and a NaN comparator is not a total order —
      // ranking it explicitly is what stops it being pruned ahead of a real
      // backup
      await writeRaw('backup_draft.json', '[]');
      await writeRaw('backup_300.json', '[]');
      final list = await listBackups();
      expect(list.first.time, 300.0);
      expect(list.last.time.isNaN, isTrue);
    });

    testWidgets('an empty number is epoch zero, not unreadable', (
      tester,
    ) async {
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

    testWidgets('refuses a document it cannot read, and changes nothing', (
      tester,
    ) async {
      spend('e1', 35);
      final r = backup.restoreBackup(json: 'not json at all');

      expect(r.ok, isFalse);
      expect(r.entries, 0);
      expect(store.entryCount(), 1); // untouched
      expect(store.getEntry(id: 'e1'), isNotNull);
    });

    testWidgets('refuses a truncated document rather than loading half of it', (
      tester,
    ) async {
      // the same reason `load_entries` answers -1 instead of loading the rows
      // it managed to parse
      spend('e1', 35);
      final good = backup.buildBackup(ts: now.toDouble());
      final r = backup.restoreBackup(json: good.substring(0, good.length ~/ 2));

      expect(r.ok, isFalse);
      expect(store.entryCount(), 1);
    });

    testWidgets('takes a bare array, which is what an older export was', (
      tester,
    ) async {
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
    testWidgets("says how long since the last one", (tester) async {
      await show(tester);
      expect(find.byKey(const Key("backup-age")), findsOneWidget);
      expect(await daysSinceLastBackup(), isNull);

      spend("e1", 35);
      await createBackup();
      expect(await daysSinceLastBackup(), 0);

      await show(tester);
      // the strip is on the screen; the number is pinned by the helper above
      expect(find.byKey(const Key("backup-age")), findsOneWidget);
    });


    testWidgets('says so when there is nothing', (tester) async {
      await show(tester);
      expect(find.byKey(const Key('no-backups')), findsOneWidget);
    });

    testWidgets('takes one and lists it', (tester) async {
      spend('e1', 35);
      await show(tester);

      await tester.tap(find.byKey(const Key('take-backup')));
      await tester.pumpAndSettle();
      // The seal dialog is up. Empty password is a deliberate plain snapshot.
      expect(find.byKey(const Key('password-dialog')), findsOneWidget);
      await tester.tap(find.byKey(const Key('password-ok')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('backup-flash')), findsOneWidget);
      expect(find.byKey(const Key('no-backups')), findsNothing);
      expect((await listBackups()).length, 1);
    });

    testWidgets('restoring asks first, and cancelling changes nothing', (
      tester,
    ) async {
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

    testWidgets('confirming restores, and snapshots what it replaced first', (
      tester,
    ) async {
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

    testWidgets('an encrypted snapshot offers a restore that asks for a password', (
      tester,
    ) async {
      // It used to disable the button, because nothing here could decrypt.
      // Now restore is live and the password dialog is the gate — a disabled
      // button would be a feature that looks broken rather than locked.
      spend('e1', 35, note: '午饭');
      await createBackup(password: 'correct horse');
      store.reset();
      await show(tester);

      final name = (await listBackups()).single.name;
      final btn = tester.widget<TextButton>(
        find.byKey(Key('backup-$name-restore')),
      );
      expect(btn.onPressed, isNotNull);

      await tester.tap(find.textContaining('恢复').first);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('restore-ok')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('password-dialog')), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('password-field')),
        'correct horse',
      );
      await tester.tap(find.byKey(const Key('password-ok')));
      await tester.pumpAndSettle();
      expect(store.entryCount(), 1);
    });

    testWidgets('and a wrong password restores nothing', (tester) async {
      spend('e1', 35, note: '午饭');
      await createBackup(password: 'correct horse');
      store.reset();
      spend('keep', 1);
      await show(tester);

      await tester.tap(find.textContaining('恢复').first);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('restore-ok')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('password-field')), 'nope');
      await tester.tap(find.byKey(const Key('password-ok')));
      await tester.pumpAndSettle();

      expect(store.getEntry(id: 'keep'), isNotNull);
      expect(store.getEntry(id: 'e1'), isNull);
    });

    /// Unlocking takes long enough to see, and the screen said nothing while
    /// it ran — it could not, frozen under a sync call. Now it says it is
    /// working, and nothing has been replaced until the work is done.
    testWidgets('says it is unlocking while it unlocks', (tester) async {
      spend('e1', 35, note: '午饭');
      await createBackup(password: 'correct horse');
      store.reset();
      await show(tester);

      await tester.tap(find.textContaining('恢复').first);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('restore-ok')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('password-field')),
        'correct horse',
      );
      await tester.tap(find.byKey(const Key('password-ok')));
      await tester.pump();
      await tester.pump();

      expect(find.byKey(const Key('backup-busy')), findsOneWidget);
      expect(store.entryCount(), 0, reason: 'nothing replaced mid-unlock');
      expect(
        tester
            .widget<TextButton>(find.byKey(Key(
              'backup-${(await listBackups()).last.name}-restore',
            )))
            .onPressed,
        isNull,
        reason: 'a second restore cannot start under the first',
      );

      // An indeterminate spinner never settles, so wait on the work instead.
      for (var i = 0; i < 600 && store.entryCount() == 0; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }
      await tester.pumpAndSettle();
      expect(store.entryCount(), 1);
      expect(find.byKey(const Key('backup-busy')), findsNothing);
    });

    testWidgets('says what is deliberately absent', (tester) async {
      await show(tester);
      expect(find.byKey(const Key('backup-note')), findsOneWidget);
    });

    /// The note used to say export elsewhere needed "a sharing plugin".
    /// `share_plus` arrived for the sync screen and nobody came back here, so
    /// the screen went on claiming a gap it no longer had. Any sentence that
    /// still names something absent has to name something actually absent.
    testWidgets('and does not still claim exporting is missing', (
      tester,
    ) async {
      await show(tester);
      final note = tester.widget<Text>(find.byKey(const Key('backup-note')));
      expect(note.data, isNot(contains('分享插件')));
      expect(note.data, contains('导出'));
    });

    /// The point of the button: a snapshot in the app's own storage does not
    /// survive the uninstall that installing a signed build requires.
    testWidgets('every snapshot can be handed out of the app', (tester) async {
      await writeRaw('backup_100.json', '{}');
      await show(tester);
      expect(
        find.byKey(const Key('backup-backup_100.json-export')),
        findsOneWidget,
      );
    });

    /// Unlike restore, which needs the password, exporting a sealed snapshot
    /// is just moving bytes — and a snapshot nothing here can open without
    /// the password is exactly the one worth getting off the phone.
    testWidgets('including a sealed one', (tester) async {
      await writeRaw('backup_100.enc.json', 'ciphertext');
      await show(tester);
      final export = tester.widget<TextButton>(
        find.byKey(const Key('backup-backup_100.enc.json-export')),
      );
      expect(export.onPressed, isNotNull);
    });
  });
}
