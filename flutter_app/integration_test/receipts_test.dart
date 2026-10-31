// 小票 on a device: the files the launch sweep takes, and the ones it must not.
//
// The rule is `core::receipts`, and its tests state it. These are the half
// those cannot reach: real files in the real attachments folder, real
// snapshots beside them, a restart between the ledger that named a receipt and
// the sweep that asks about it, and the restores that have to find the file
// afterwards.
//
// The folders are the app's own, as they are for backup_test, so every test
// starts and ends with both of them empty.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_app/backup_screen.dart';
import 'package:flutter_app/persistence.dart';
import 'package:flutter_app/photos.dart';
import 'package:flutter_app/record_sheet.dart' show FormEdit;
import 'package:flutter_app/src/rust/api/backup.dart' as backup;
import 'package:flutter_app/src/rust/api/db.dart' as db;
import 'package:flutter_app/src/rust/api/record.dart' as record;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

const day = 86400000;

int get now => DateTime.now().millisecondsSinceEpoch;

late Directory dbDir;

Future<Persistence> open() => Persistence.open(dir: dbDir);

/// Save, forget everything in memory, and open again — what a launch finds.
Future<Persistence> restart(Persistence p) async {
  p.save();
  p.dispose();
  store.reset();
  return open();
}

Future<void> empty(Directory dir) async {
  for (final f in dir.listSync()) {
    f.deleteSync(recursive: true);
  }
}

/// A receipt's bytes, where the sheet would have put them.
Future<void> receipt(String name) async {
  final dir = await attachmentsDir();
  await File('${dir.path}/$name').writeAsString('the receipt $name');
}

Future<Set<String>> onDisk() async => {
  for (final f in (await attachmentsDir()).listSync().whereType<File>())
    f.uri.pathSegments.last,
};

/// An entry with a receipt, saved the way the sheet saves one.
void spendWith(String id, String photo) {
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

/// The sheet opened on `id` and saved with another receipt, or with none.
void edit(String id, String photo) {
  final r = record.saveForm(
    form: record
        .initialForm(sourceId: id, editing: true, ledger: '')
        .copyWith(photo: photo),
    editId: id,
    id: '',
    now: now,
    rateWasCached: false,
  );
  expect(r.rejected, isNull);
  expect(store.getEntry(id: id)!.photo, photo.isEmpty ? isNull : photo);
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);

  setUp(() async {
    store.reset();
    db.resetStoreHandle();
    dbDir = await Directory.systemTemp.createTemp('dhh-receipts');
    await empty(await attachmentsDir());
    await empty(await backupDir());
  });
  tearDown(() async {
    db.resetStoreHandle();
    await empty(await attachmentsDir());
    await empty(await backupDir());
    try {
      await dbDir.delete(recursive: true);
    } catch (_) {
      // a handle on the WAL, briefly; a leaked temp dir is not a failure
    }
  });

  group('the launch sweep', () {
    testWidgets(
      'takes what nothing names, and a restart keeps what a row does',
      (tester) async {
        var p = await open();
        await receipt('keep.jpg');
        spendWith('keep', 'keep.jpg');
        // an edit that puts another receipt on
        await receipt('old.jpg');
        await receipt('new.jpg');
        spendWith('swapped', 'old.jpg');
        edit('swapped', 'new.jpg');
        // an edit that takes it off
        await receipt('off.jpg');
        spendWith('cleared', 'off.jpg');
        edit('cleared', '');
        // a delete long enough ago that nothing brings it back
        await receipt('gone.jpg');
        spendWith('deleted', 'gone.jpg');
        expect(
          store.removeEntry(id: 'deleted', now: now - 40 * day),
          isNotNull,
        );
        // a sheet closed after the photo was picked: a file and no row
        await receipt('closed.jpg');

        p = await restart(p);
        expect((await sweepReceipts(p)).toSet(), {
          'old.jpg',
          'off.jpg',
          'gone.jpg',
          'closed.jpg',
        });
        expect(await onDisk(), {'keep.jpg', 'new.jpg'});

        // and the next launch finds both still named and still there
        p = await restart(p);
        expect(await sweepReceipts(p), isEmpty);
        expect(await onDisk(), {'keep.jpg', 'new.jpg'});
        expect(store.getEntry(id: 'keep')!.photo, 'keep.jpg');
        expect(await attachmentFile('keep.jpg'), isNotNull);
        expect(
          await attachmentFile(store.getEntry(id: 'swapped')!.photo),
          isNotNull,
        );
        p.dispose();
      },
    );

    testWidgets('keeps a deleted row\'s receipt while it can come back', (
      tester,
    ) async {
      final p = await open();
      await receipt('r1.jpg');
      spendWith('e1', 'r1.jpg');
      final undo = store.removeEntry(id: 'e1', now: now)!;

      expect(await sweepReceipts(p), isEmpty);
      // 撤销: the row is back, and so is the picture on it
      store.unremoveEntry(undo: undo, now: now);
      expect(store.getEntry(id: 'e1')!.deletedAt, isNull);
      expect(await attachmentFile(store.getEntry(id: 'e1')!.photo), isNotNull);

      // deleted again, and asked about after the grace is over
      store.removeEntry(id: 'e1', now: now);
      expect(await sweepReceipts(p, now: now + 31 * day), ['r1.jpg']);
      p.dispose();
    });

    testWidgets('keeps a receipt this run saved and no row names yet', (
      tester,
    ) async {
      // the sheet that picked it may still be open
      final p = await open();
      final picked = File('${dbDir.path}/picked.jpg');
      await picked.writeAsString('from the gallery');
      final name = await saveAttachment(XFile(picked.path), 'r$now');
      await receipt('closed.jpg');

      expect(await sweepReceipts(p), ['closed.jpg']);
      expect(await onDisk(), {name});
      p.dispose();
    });

    testWidgets('sweeps nothing when the ledger did not load', (tester) async {
      // to a sweep, a ledger that could not be read names no receipt at all
      await File('${dbDir.path}/entries.json').writeAsString('');
      await File('${dbDir.path}/config.json').writeAsString('{}');
      final p = await open();
      expect(p.healthy, isFalse, reason: 'it has to have failed to load');
      await receipt('r1.jpg');

      expect(await sweepReceipts(p), isEmpty);
      expect(await onDisk(), {'r1.jpg'});
      p.dispose();
    });
  });

  group('beside a snapshot', () {
    testWidgets('a sealed one keeps what it names, and its restore finds it', (
      tester,
    ) async {
      final p = await open();
      await receipt('r1.jpg');
      spendWith('e1', 'r1.jpg');
      final sealed = await createBackup(password: 'correct horse');
      store.removeEntry(id: 'e1', now: now - 40 * day);

      expect(await sweepReceipts(p), isEmpty);
      expect(await onDisk(), {'r1.jpg'});

      final unlocked = await backup.decryptBackup(
        envelope: await sealed.readAsString(),
        password: 'correct horse',
      );
      expect(backup.restoreBackup(json: unlocked.json).ok, isTrue);
      expect(store.getEntry(id: 'e1')!.deletedAt, isNull);
      expect(await attachmentFile(store.getEntry(id: 'e1')!.photo), isNotNull);
      p.dispose();
    });

    testWidgets('a sealed one stops holding once the prune takes it', (
      tester,
    ) async {
      final p = await open();
      await receipt('r1.jpg');
      spendWith('e1', 'r1.jpg');
      final sealed = await createBackup(password: 'correct horse');
      final list = File(
        '${(await backupDir()).path}/'
        '${backup.receiptsName(name: sealed.uri.pathSegments.last)}',
      );
      expect(await list.exists(), isTrue);
      store.removeEntry(id: 'e1', now: now - 40 * day);

      await Future<void>.delayed(const Duration(milliseconds: 5));
      await createBackup(keep: 1);
      expect(
        await sealed.exists(),
        isFalse,
        reason: 'the prune has to have run',
      );
      expect(await list.exists(), isFalse);
      expect(await sweepReceipts(p), ['r1.jpg']);
      p.dispose();
    });

    testWidgets('a sealed one that never wrote a list stops the sweep', (
      tester,
    ) async {
      // what the builds before the list wrote: it could name anything
      final p = await open();
      final old = File('${(await backupDir()).path}/backup_100.enc.json');
      await old.writeAsString('ciphertext');
      await receipt('r1.jpg');

      expect(await sweepReceipts(p), isEmpty);
      expect(await onDisk(), {'r1.jpg'});

      await old.delete();
      expect(await sweepReceipts(p), ['r1.jpg']);
      p.dispose();
    });

    testWidgets(
      'a plain one holds nothing here, and its restore puts it back',
      (tester) async {
        final p = await open();
        await receipt('r1.jpg');
        spendWith('e1', 'r1.jpg');
        await createBackup();
        store.removeEntry(id: 'e1', now: now - 40 * day);

        expect(await sweepReceipts(p), ['r1.jpg']);
        expect(await onDisk(), isEmpty);

        await tester.pumpWidget(const MaterialApp(home: BackupScreen()));
        await tester.pumpAndSettle();
        await tester.tap(find.textContaining('恢复').first);
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('restore-ok')));
        await tester.pumpAndSettle();

        expect(store.getEntry(id: 'e1')!.deletedAt, isNull);
        expect(
          await attachmentFile(store.getEntry(id: 'e1')!.photo),
          isNotNull,
        );
        p.dispose();
      },
    );
  });
}
