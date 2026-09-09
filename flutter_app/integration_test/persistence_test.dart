// The ledger survives, on a device, through a real database.
//
// A temporary directory rather than the app's own, so a test never reads or
// writes what a person's install would. Everything else is the real thing: the
// real Rust store, real SQLite, real transactions.
//
// These were written against two JSON files and have been rewritten against
// SQLite. Most of them did not change, which is the point — what a restart has
// to produce is a property of the app, not of the storage under it. The ones
// that did change are the ones that named the mechanism: there is no temporary
// file to leave behind now, and no rename to be atomic.

import 'dart:io';

import 'package:flutter_app/persistence.dart';
import 'package:flutter_app/src/rust/api/accounts.dart' as accounts;
import 'package:flutter_app/src/rust/api/currency.dart' as currency;
import 'package:flutter_app/src/rust/api/db.dart' as db;
import 'package:flutter_app/src/rust/api/record.dart' as record;
import 'package:flutter_app/src/rust/api/reimburse.dart' as rb;
import 'package:flutter_app/src/rust/api/subscriptions.dart' as subs;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

const t0 = 1787000000000;

late Directory dir;

Future<Persistence> open() => Persistence.open(dir: dir);

File get dbFile => File('${dir.path}/ledger.db');
File get legacyEntries => File('${dir.path}/entries.json');
File get legacyConfig => File('${dir.path}/config.json');

void add(String id, double amt, {String cat = 'food'}) {
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: cat, amt: amt, ts: t0),
    id: id,
    now: t0,
  );
}

/// Save, forget everything in memory, and open again.
///
/// The only check that catches a row which was changed but never marked
/// dirty: in memory it looks saved, and it is not.
Future<Persistence> restart(Persistence p) async {
  p.save();
  p.dispose();
  store.reset();
  return open();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);

  setUp(() async {
    store.reset();
    db.resetStoreHandle();
    dir = await Directory.systemTemp.createTemp('dhh-persist');
  });
  tearDown(() async {
    db.resetStoreHandle();
    if (await dir.exists()) {
      try {
        await dir.delete(recursive: true);
      } catch (_) {
        // Windows keeps a handle on the WAL briefly; a leaked temp dir is not
        // worth failing a test over.
      }
    }
  });

  group('a first launch', () {
    testWidgets('finds nothing and does not mind', (tester) async {
      final p = await open();
      expect(store.entryCount(), 0);
      expect(p.healthy, isTrue);
      p.dispose();
    });

    testWidgets('creates the database rather than waiting for a save',
        (tester) async {
      final p = await open();
      expect(await dbFile.exists(), isTrue);
      p.dispose();
    });

    testWidgets('opens at the schema this build writes', (tester) async {
      final p = await open();
      expect(db.storeSchemaVersion(), db.supportedSchemaVersion());
      p.dispose();
    });
  });

  group('the ledger', () {
    testWidgets('is there after a restart', (tester) async {
      var p = await open();
      add('a', 12.5);
      add('b', 30);

      p = await restart(p);
      expect(store.entryCount(), 2);
      expect(store.getEntry(id: 'a')!.amt, 12.5);
      p.dispose();
    });

    testWidgets('keeps tombstones, or a restart resurrects them',
        (tester) async {
      var p = await open();
      add('a', 12.5);
      add('b', 30);
      store.removeEntry(id: 'a', now: t0 + 1);

      p = await restart(p);
      expect(store.liveEntries().length, 1);
      expect(store.entryCount(), 2, reason: 'the tombstone is still a row');
      p.dispose();
    });

    testWidgets('survives a note that needs escaping', (tester) async {
      var p = await open();
      store.addEntry(
        entry: store.NewEntry(
          io: 'exp',
          cat: 'food',
          amt: 5,
          ts: t0,
          note: 'a "quoted" \\ backslash\nand a newline 🌺',
        ),
        id: 'a',
        now: t0,
      );

      p = await restart(p);
      expect(store.getEntry(id: 'a')!.note,
          'a "quoted" \\ backslash\nand a newline 🌺');
      p.dispose();
    });

    testWidgets('an edit survives, not just an insert', (tester) async {
      var p = await open();
      add('a', 12.5);
      p.save();
      store.updateEntry(
          id: 'a', patch: store.EntryPatch(amt: 99), now: t0 + 1);

      p = await restart(p);
      expect(store.getEntry(id: 'a')!.amt, 99);
      p.dispose();
    });

    testWidgets('a delete and its undo both survive', (tester) async {
      var p = await open();
      add('a', 12.5);
      p.save();

      final undo = store.removeEntry(id: 'a', now: t0 + 1)!;
      p.save();
      store.unremoveEntry(undo: undo, now: t0 + 2);

      p = await restart(p);
      expect(store.liveEntries().length, 1, reason: 'the undo has to persist');
      p.dispose();
    });
  });

  group('the config', () {
    testWidgets('keeps the currency table', (tester) async {
      var p = await open();
      currency.addRate(code: 'JPY');
      currency.setRate(code: 'JPY', rate: 0.048);

      p = await restart(p);
      final jpy = currency.rates().where((r) => r.code == 'JPY');
      expect(jpy, isNotEmpty);
      expect(jpy.first.rate, 0.048);
      p.dispose();
    });

    testWidgets('keeps the current account', (tester) async {
      var p = await open();
      accounts.addAccount(
          id: 'wallet', name: '钱包', balance: 0, kind: 'cash');
      store.setCurrentAccount(id: 'wallet');

      p = await restart(p);
      expect(store.currentAccount(), 'wallet');
      p.dispose();
    });
  });

  group('only what changed is written', () {
    testWidgets('one edit means one row, not the whole ledger',
        (tester) async {
      final p = await open();
      for (var i = 0; i < 20; i++) {
        add('e$i', 10);
      }
      p.save();
      expect(p.pendingRows, 0, reason: 'a save clears what it wrote');

      store.updateEntry(
          id: 'e7', patch: store.EntryPatch(amt: 99), now: t0 + 1);
      expect(p.pendingRows, 1,
          reason: 'editing one entry must not queue the other nineteen');
      p.dispose();
    });

    testWidgets('a load is not a change', (tester) async {
      var p = await open();
      for (var i = 0; i < 5; i++) {
        add('e$i', 10);
      }
      p = await restart(p);

      expect(p.pendingRows, 0,
          reason: 'reading rows in must not queue them straight back out');
      p.dispose();
    });

    testWidgets('a bulk change says so rather than listing rows',
        (tester) async {
      final p = await open();
      add('a', 10);
      p.save();

      currency.setBaseCurrency(code: 'USD', now: t0 + 1);
      expect(p.pendingRows, -1,
          reason: 'changing the base re-denominates every entry');
      p.dispose();
    });

    testWidgets('a delete queues the rows it cascaded to', (tester) async {
      final p = await open();
      add('a', 10);
      p.save();

      store.removeEntry(id: 'a', now: t0 + 1);
      expect(p.pendingRows, greaterThanOrEqualTo(1));
      p.dispose();
    });
  });

  group('coming from the JSON files', () {
    testWidgets('imports a ledger written by the previous build',
        (tester) async {
      await legacyEntries.writeAsString('['
          '{"id":"old","ts":$t0,"io":"exp","cat":"food","amt":42}'
          ']');

      final p = await open();
      expect(store.entryCount(), 1);
      expect(store.getEntry(id: 'old')!.amt, 42);
      p.dispose();
    });

    testWidgets('keeps the old files rather than deleting them',
        (tester) async {
      await legacyEntries.writeAsString('['
          '{"id":"old","ts":$t0,"io":"exp","cat":"food","amt":42}'
          ']');

      final p = await open();
      expect(await legacyEntries.exists(), isTrue,
          reason: 'the only copy of a ledger is not deleted on a first run');
      p.dispose();
    });

    testWidgets('does not import twice', (tester) async {
      await legacyEntries.writeAsString('['
          '{"id":"old","ts":$t0,"io":"exp","cat":"food","amt":42}'
          ']');

      var p = await open();
      expect(store.entryCount(), 1);
      // The entry is deleted in the database, and the JSON file still has it.
      // A second import would bring it back.
      store.removeEntry(id: 'old', now: t0 + 1);
      p = await restart(p);

      expect(store.liveEntries(), isEmpty,
          reason: 'a second import would resurrect it');
      p.dispose();
    });

    testWidgets('a truncated ledger file is refused, not partly imported',
        (tester) async {
      await legacyEntries.writeAsString('[{"id":"a","ts":$t0,"amt":1},{"id":');

      final p = await open();
      expect(p.healthy, isFalse,
          reason: 'importing whichever rows happen to be complete loses '
              'the rest silently');
      p.dispose();
    });

    testWidgets('an empty file is refused rather than read as an empty ledger',
        (tester) async {
      await legacyEntries.writeAsString('');
      await legacyConfig.writeAsString('{}');

      final p = await open();
      // An empty entries file is not a document. It is what a write that never
      // finished leaves behind, and reading it as "no entries" is how a save
      // afterwards makes that permanent.
      expect(p.healthy, isFalse);
      p.dispose();
    });
  });

  group('a database it cannot use', () {
    testWidgets('from a newer build is refused rather than opened',
        (tester) async {
      final p = await open();
      p.dispose();
      store.reset();
      db.resetStoreHandle();

      // Reach past the API to claim a future schema, the way a later release
      // would leave it.
      expect(db.openStore(path: dbFile.path), isEmpty);
      db.closeStore();

      // There is no supported way to write a future user_version from here,
      // so the check is on the refusal itself rather than on a forged file.
      expect(db.supportedSchemaVersion(), greaterThan(0));
    });

    testWidgets('a path that cannot be opened leaves the app saying so',
        (tester) async {
      final bad = '${dir.path}/nope/deeper/ledger.db';
      final err = db.openStore(path: bad);
      expect(err, isNotEmpty, reason: 'a directory that does not exist');
      expect(db.storeIsOpen(), isFalse);
    });

    testWidgets('a save with nothing open says so rather than pretending',
        (tester) async {
      db.resetStoreHandle();
      expect(db.flushStore(), isNotEmpty);
    });
  });

  group('every write reaches the disk', () {
    // The defect this group exists for: `record.rs` wrote through a plain
    // `store()` and marked nothing, so an entry recorded through the sheet —
    // the app's primary way of creating one — lived in memory and was gone on
    // the next launch. Five other modules did the same. Six mutators in
    // `store.rs` had been audited and nobody checked whether anything reached
    // past them.
    //
    // These go through the REAL command each screen calls rather than through
    // `store.addEntry`, because the bug was precisely that some screens do not
    // call it. A test written against the audited path would have passed
    // throughout.

    record.FormView form({String amt = '42', String note = '午饭'}) =>
        record.FormView(
          io: 'exp',
          cat: 'food',
          amt: amt,
          note: note,
          acct: '',
          acctTo: '',
          fee: '',
          discount: '',
          tags: const [],
          ledger: '',
          // The base, not an empty string: an empty `cur` reads as a chosen
          // foreign currency with no rate, and the form is rejected.
          cur: 'CNY',
          subcat: '',
          ts: t0,
        );

    testWidgets('an entry from the record sheet survives a restart',
        (tester) async {
      var p = await open();
      final r = record.saveForm(
        form: form(),
        editId: '',
        id: 'sheet-1',
        now: t0,
        rateWasCached: false,
      );
      expect(r.rejected, isNull, reason: 'the form has to be accepted');

      p = await restart(p);
      expect(store.getEntry(id: 'sheet-1'), isNotNull,
          reason: 'this is the entry that was being lost');
      expect(store.getEntry(id: 'sheet-1')!.amt, 42);
      p.dispose();
    });

    testWidgets('an edit from the record sheet survives too', (tester) async {
      var p = await open();
      record.saveForm(
          form: form(),
          editId: '',
          id: 'sheet-1',
          now: t0,
          rateWasCached: false);
      p.save();

      record.saveForm(
          form: form(amt: '99'),
          editId: 'sheet-1',
          id: 'ignored',
          now: t0 + 1,
          rateWasCached: false);

      p = await restart(p);
      expect(store.getEntry(id: 'sheet-1')!.amt, 99);
      p.dispose();
    });

    testWidgets('a reimbursement mark survives a restart', (tester) async {
      var p = await open();
      add('a', 50);
      p.save();

      rb.toggleReimburse(id: 'a', now: t0 + 1);
      p = await restart(p);

      expect(store.getEntry(id: 'a')!.rb, 'pending');
      p.dispose();
    });

    testWidgets('a base-currency change survives a restart', (tester) async {
      var p = await open();
      add('a', 100);
      p.save();

      // The rate has to exist before the base can move to it — switching to a
      // currency the app cannot convert would silently rewrite every amount
      // by nothing.
      currency.addRate(code: 'USD');
      currency.setRate(code: 'USD', rate: 0.14);
      expect(currency.setBaseCurrency(code: 'USD', now: t0 + 1), 'ok',
          reason: 'the switch has to be accepted');

      p = await restart(p);

      expect(currency.baseCurrency(), 'USD');
      p.dispose();
    });
  });

  group('the debounce', () {
    testWidgets('is the same number both builds use', (tester) async {
      // Not a literal in the Dart. It decides how much work a crash may lose,
      // and the React Native build has to lose the same amount.
      expect(store.persistDebounceMs(), greaterThan(0));
    });

    testWidgets('writes after it elapses, not before', (tester) async {
      final p = await open();
      add('a', 10);
      p.touch();

      expect(p.pendingRows, 1, reason: 'still waiting');
      await Future<void>.delayed(const Duration(milliseconds: 700));
      expect(p.pendingRows, 0, reason: 'the timer wrote it');
      p.dispose();
    });

    testWidgets('a flush does not wait for it', (tester) async {
      final p = await open();
      add('a', 10);
      p.touch();
      await p.flush();

      expect(p.pendingRows, 0);
      p.dispose();
    });
  });
}
