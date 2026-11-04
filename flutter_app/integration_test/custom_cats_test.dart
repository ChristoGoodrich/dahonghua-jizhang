// A category of the user's own, everywhere a category is matched or named.
//
// The library can make a custom category and every picker offers one, but the
// bridge looked categories up with an empty custom list in nine places. Each
// place drew a custom category as the fallback one — the last in the list —
// or could not match it at all: a search for 猫粮 missed every 猫粮 entry, an
// imported bill the wallet filed under 宠物 went to `food`, and the CSV, a
// claim, a refund's note, 统计's slices and the insight all said the wrong
// name. One test per path, each one passing a custom category through it.
//
// And the one thing that must not change: an AI request still carries no
// custom category names. The readers on the phone use them; the wire does not.

import 'dart:convert';

import 'package:flutter_app/src/rust/api/ai.dart' as ai;
import 'package:flutter_app/src/rust/api/catalog.dart' as catalog;
import 'package:flutter_app/src/rust/api/export.dart' as csvexport;
import 'package:flutter_app/src/rust/api/imports.dart' as imports;
import 'package:flutter_app/src/rust/api/reimburse.dart' as reimburse;
import 'package:flutter_app/src/rust/api/report.dart' as report;
import 'package:flutter_app/src/rust/api/search.dart' as search;
import 'package:flutter_app/src/rust/api/stats.dart' as stats;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/report_screen.dart' show insightCopy;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

String day(DateTime d) => '${d.year}-${d.month}-${d.day}';

/// 猫粮, an expense category of the user's own. Added after a second one so
/// that it is not the last: the fallback for an unknown key is the last
/// category, and a lookup that missed would otherwise land on it by luck.
const pet = 'c1';

void addPet() {
  catalog.addCustomCat(io: 'exp', key: pet, name: '猫粮', emoji: '🐈');
  catalog.addCustomCat(io: 'exp', key: 'c9', name: '花店', emoji: '💐');
}

void spend(String id, double amt, {String cat = pet, String? note}) {
  store.addEntry(
    entry: store.NewEntry(io: 'exp', cat: cat, amt: amt, note: note, ts: now),
    id: id,
    now: now,
  );
}

List<String> ids() => store.liveEntries().map((e) => e.id).toList();

List<String> days() =>
    store.liveEntries().map((_) => day(DateTime.now())).toList();

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  testWidgets('a search finds an entry by its custom category name', (
    tester,
  ) async {
    addPet();
    spend('e1', 30); // no note: the category is the only thing to match
    spend('e2', 12, cat: 'food');

    final hits = search.searchIds(ids: ids(), text: '猫粮', zh: true);

    expect(hits, ['e1']);
  });

  testWidgets(
    'an imported bill labelled with a custom name is filed under it',
    (tester) async {
      addPet();
      catalog.addCustomCat(io: 'inc', key: 'c2', name: '红包', emoji: '🧧');
      final csv = utf8.encode(
        '支付宝交易记录明细查询\n'
        '账号:[test]\n'
        '---------------------交易记录明细列表---------------------\n'
        '交易时间,交易分类,交易对方,商品说明,收/支,金额,交易状态\n'
        '2026-08-02 12:30:00,猫粮,宠物店,冻干,支出,88.00,交易成功\n'
        '2026-08-03 09:00:00,红包,小明,生日,收入,66.00,交易成功\n'
        '2026-08-04 10:00:00,红包,小明,回礼,支出,66.00,交易成功\n',
      );

      final c = imports
          .previewBills(bytes: csv, ids: const [], daysOf: const [])
          .candidates;

      expect(c.map((x) => x.io).toList(), ['exp', 'inc', 'exp']);
      expect(c[0].cat, pet);
      expect(c[1].cat, 'c2');
      // 红包 is an income category of the user's, and this one is an expense:
      // each side is matched against its own categories only
      expect(c[2].cat, isNot('c2'));
    },
  );

  testWidgets('the CSV names it', (tester) async {
    addPet();
    spend('e1', 30);

    final csv = utf8.decode(csvexport.exportCsv(ids: ids(), daysOf: days()));

    expect(csv, contains('猫粮'));
  });

  testWidgets('a claim is named as it, and a refund says what was refunded', (
    tester,
  ) async {
    addPet();
    spend('e1', 30);
    reimburse.toggleReimburse(id: 'e1', now: now);

    expect(reimburse.claims(zh: true).items.single.name, '猫粮');

    reimburse.refundEntry(
      id: 'e1',
      amount: 10,
      zh: true,
      newId: 'r1',
      now: now,
    );
    expect(store.getEntry(id: 'r1')!.note, '退款·猫粮');
  });

  testWidgets('统计 names its slice and its largest entries', (tester) async {
    addPet();
    spend('e1', 30);
    spend('e2', 5, cat: 'food');

    final slices = stats.categorySlices(ids: ids(), io: 'exp', zh: true);
    expect(slices.firstWhere((s) => s.cat == pet).name, '猫粮');

    final t = DateTime.now();
    final page = stats.statsPage(
      ids: ids(),
      daysOf: days(),
      dows: [for (final _ in ids()) t.weekday % 7],
      hours: [for (final _ in ids()) t.hour],
      anchor: day(t),
      period: 'month',
      io: 'exp',
      today: day(t),
      zh: true,
    );
    expect(page.top.firstWhere((e) => e.id == 'e1').catName, '猫粮');
  });

  testWidgets('the insight names it', (tester) async {
    addPet();
    // three expenses is the least the banner speaks about, and with no
    // budget set it says which category took the most
    spend('e1', 30);
    spend('e2', 40);
    spend('e3', 5, cat: 'food');

    final i = report.insight(
      ids: ids(),
      daysOf: days(),
      today: day(DateTime.now()),
      zh: true,
      copy: insightCopy(true),
    );

    expect(i!.text, contains('猫粮'));
  });

  group('AI', () {
    testWidgets('a draft read on the phone is filed under it, and named', (
      tester,
    ) async {
      // what this user has called the same thing before
      addPet();
      spend('e1', 30, note: '冻干');

      final d = ai
          .quickOffline(text: '冻干 45', today: day(DateTime.now()), zh: true)
          .single;

      expect((d.cat, d.name), (pet, '猫粮'));
    });

    testWidgets('but no request carries its name', (tester) async {
      // A custom category can be a person's name. The phone's readers know it;
      // nothing sent says it.
      catalog.addCustomCat(io: 'exp', key: 'c3', name: '张医生诊所', emoji: '🩺');
      final today = day(DateTime.now());

      final bodies = [
        ai
            .quickRequest(text: '午饭35', today: today, zh: true, keyPrefix: '')
            .body,
        ai
            .askRequest(
              question: '这个月吃饭花了多少',
              today: today,
              zh: true,
              keyPrefix: '',
            )
            .body,
        ai
            .receiptRequest(
              imageBase64: 'AAAA',
              mime: 'image/jpeg',
              today: today,
              zh: true,
              keyPrefix: '',
            )
            .body,
      ];

      for (final b in bodies) {
        expect(b, isNot(contains('张医生诊所')));
        // and the built-in names still go, so the check is of the right body
        expect(b, contains('餐饮'));
      }
    });
  });
}
