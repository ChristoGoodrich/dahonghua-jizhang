// The ledger survives, on a device, through real files.
//
// A temporary directory rather than the app's own, so a test never reads or
// writes what a person's install would. Everything else is the real thing: the
// real Rust snapshot, the real JSON, the real atomic rename.

import 'dart:io';

import 'package:flutter_app/persistence.dart';
import 'package:flutter_app/src/rust/api/record.dart' as record;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

const t0 = 1787000000000;

late Directory dir;

Future<Persistence> open() => Persistence.open(dir: dir);

void add(String id, double amt, {String cat = 'food'}) {
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: cat, amt: amt, ts: t0),
    id: id,
    now: t0,
  );
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async => await RustLib.init());

  setUp(() async {
    store.reset();
    dir = await Directory.systemTemp.createTemp('dhh-persist');
  });
  tearDown(() async {
    if (await dir.exists()) await dir.delete(recursive: true);
  });

  group('a first launch', () {
    testWidgets('finds no files and does not mind', (tester) async {
      final p = await open();
      expect(store.entryCount(), 0);
      p.dispose();
    });
  });

  group('the ledger', () {
    testWidgets('is there after a restart', (tester) async {
      final p = await open();
      add('e1', 35.5);
      await p.saveEntries();
      p.dispose();

      // a new process: the store is empty until the files are read
      store.reset();
      expect(store.entryCount(), 0);
      final p2 = await open();

      expect(store.entryCount(), 1);
      expect(store.getEntry(id: 'e1')!.amt, 35.5);
      p2.dispose();
    });

    testWidgets('keeps tombstones, or a restart resurrects them',
        (tester) async {
      final p = await open();
      add('e1', 10);
      store.removeEntry(id: 'e1', now: t0 + 1);
      await p.saveEntries();
      p.dispose();

      store.reset();
      final p2 = await open();
      expect(store.entryCount(), 1); // still known
      expect(store.liveEntries(), isEmpty); // still deleted
      p2.dispose();
    });

    testWidgets('survives a note that needs escaping', (tester) async {
      final p = await open();
      store.addEntry(
        entry: store.NewEntry(
            io: 'exp', cat: 'food', amt: 1, note: '午饭 "a"\n\\b', ts: t0),
        id: 'e1',
        now: t0,
      );
      await p.saveEntries();
      p.dispose();

      store.reset();
      final p2 = await open();
      expect(store.getEntry(id: 'e1')!.note, '午饭 "a"\n\\b');
      p2.dispose();
    });
  });

  group('the config', () {
    testWidgets('keeps the currency table', (tester) async {
      final p = await open();
      record.setCurrencies(base: 'CNY', codes: ['USD', 'JPY'], rates: [7.2, 0.048]);
      await p.saveConfig();
      p.dispose();

      store.reset();
      expect(record.cachedRate(code: 'USD'), isNull);
      final p2 = await open();

      expect(record.baseCurrency(), 'CNY');
      expect(record.cachedRate(code: 'USD'), 7.2);
      expect(record.cachedRate(code: 'JPY'), 0.048);
      p2.dispose();
    });

    testWidgets('keeps the current account', (tester) async {
      final p = await open();
      store.setCurrentAccount(id: 'card-a');
      await p.saveConfig();
      p.dispose();

      store.reset();
      final p2 = await open();
      expect(store.currentAccount(), 'card-a');
      p2.dispose();
    });

    testWidgets('is a separate file from the ledger', (tester) async {
      final p = await open();
      add('e1', 1);
      await p.flush();
      p.dispose();

      expect(await File('${dir.path}/entries.json').exists(), isTrue);
      expect(await File('${dir.path}/config.json').exists(), isTrue);
      // and the ledger is not in the config file
      final config = await File('${dir.path}/config.json').readAsString();
      expect(config.contains('e1'), isFalse);
    });
  });

  group('a bad file', () {
    testWidgets('does not empty a good one next to it', (tester) async {
      final p = await open();
      add('e1', 1);
      await p.flush();
      p.dispose();

      await File('${dir.path}/config.json').writeAsString('{ not json');
      store.reset();
      final p2 = await open();

      // the config could not be read; the ledger could, which is the point of
      // two files
      expect(p2.configUnreadable, isTrue);
      expect(p2.entriesUnreadable, isFalse);
      expect(store.entryCount(), 1);
      p2.dispose();
    });

    testWidgets('a truncated ledger is refused, not partly recovered',
        (tester) async {
      // reading it leniently recovers whichever rows happen to be complete,
      // and writing those back loses the rest
      await File('${dir.path}/entries.json')
          .writeAsString('[{"id":"e1","ts":1,"io":"exp","cat":"food","amt":1},{"id":"e2"');
      final p = await open();

      expect(p.entriesUnreadable, isTrue);
      expect(store.entryCount(), 0); // the store is left alone, not half-filled
      p.dispose();
    });

    testWidgets('a file it could not read is not written over', (tester) async {
      // the step that turns "unreadable" into "gone"
      const broken = '[{"id":"e1","ts":1';
      await File('${dir.path}/entries.json').writeAsString(broken);
      final p = await open();
      expect(p.entriesUnreadable, isTrue);

      add('new', 5);
      await p.flush();

      expect(await File('${dir.path}/entries.json').readAsString(), broken);
      p.dispose();
    });

    testWidgets('an empty file is refused too, rather than read as an empty ledger',
        (tester) async {
      // "" is not a JSON document, and treating it as [] would let a
      // zero-length write erase a ledger on the next save
      await File('${dir.path}/entries.json').writeAsString('');
      final p = await open();
      expect(p.entriesUnreadable, isTrue);
      p.dispose();
    });

    testWidgets('a genuinely empty ledger is read as one', (tester) async {
      await File('${dir.path}/entries.json').writeAsString('[]');
      final p = await open();
      expect(p.entriesUnreadable, isFalse);
      expect(store.entryCount(), 0);
      p.dispose();
    });
  });

  group('the write is atomic', () {
    testWidgets('leaves no temporary file behind', (tester) async {
      final p = await open();
      add('e1', 1);
      await p.flush();
      p.dispose();

      final left = dir.listSync().map((f) => f.path.split(RegExp(r'[\\/]')).last).toList();
      expect(left, containsAll(['entries.json', 'config.json']));
      expect(left.where((f) => f.endsWith('.tmp')), isEmpty);
    });

    testWidgets('a rename replaces the previous contents entirely',
        (tester) async {
      // a shorter file written over a longer one must not leave the tail of
      // the old one behind, which an in-place write would
      final p = await open();
      for (var i = 0; i < 50; i++) {
        add('e$i', 1);
      }
      await p.saveEntries();
      final long = await File('${dir.path}/entries.json').length();

      store.reset();
      add('only', 1);
      await p.saveEntries();
      final short = await File('${dir.path}/entries.json').length();
      expect(short, lessThan(long));

      store.reset();
      final p2 = await open();
      expect(store.entryCount(), 1);
      p2.dispose();
      p.dispose();
    });
  });

  group('the debounce', () {
    testWidgets('is the same number both builds use', (tester) async {
      expect(store.persistDebounceMs(), 400);
    });

    testWidgets('writes after it elapses, not before', (tester) async {
      final p = await open();
      add('e1', 1);
      p.touchEntries();
      expect(await File('${dir.path}/entries.json').exists(), isFalse);

      await Future<void>.delayed(const Duration(milliseconds: 600));
      expect(await File('${dir.path}/entries.json').exists(), isTrue);
      p.dispose();
    });

    testWidgets('a flush does not wait for it', (tester) async {
      final p = await open();
      add('e1', 1);
      p.touchEntries();
      await p.flush();
      expect(await File('${dir.path}/entries.json').exists(), isTrue);
      p.dispose();
    });
  });
}
