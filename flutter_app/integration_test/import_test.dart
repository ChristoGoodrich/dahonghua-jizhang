// 导入账单, on a device, against a real ledger.
//
// The parsing, the category mapping and the dedup are Rust's and are pinned by
// parity corpora. What those corpora cannot reach is everything this file is
// about: bytes that are not UTF-8, a preview that has to survive the ledger
// changing under it, and the difference between "already recorded" and "new".
//
// The 支付宝 fixture is REAL GBK. Writing it as a Dart string would have tested
// nothing — the whole reason `encoding.rs` exists is that 微信 writes UTF-8 and
// 支付宝 does not, and a fixture that is UTF-8 either way cannot tell them
// apart. Dart has no GBK encoder, so the bytes are spelled out.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_app/import_screen.dart';
import 'package:flutter_app/src/rust/api/imports.dart' as imports;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_app/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

/// A 支付宝 export, in the GBK bytes 支付宝 actually writes.
const alipayGbk = <int>[
  214, 167, 184, 182, 177, 166, 189, 187, 210, 215, 188, 199, 194, 188, 195, 247, 207, 184,
  178, 233, 209, 175, 10, 213, 203, 186, 197, 58, 91, 116, 101, 115, 116, 93, 10, 45,
  45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
  45, 45, 189, 187, 210, 215, 188, 199, 194, 188, 195, 247, 207, 184, 193, 208, 177, 237,
  45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45, 45,
  45, 45, 45, 10, 189, 187, 210, 215, 202, 177, 188, 228, 44, 189, 187, 210, 215, 183,
  214, 192, 224, 44, 189, 187, 210, 215, 182, 212, 183, 189, 44, 201, 204, 198, 183, 203,
  181, 195, 247, 44, 202, 213, 47, 214, 167, 44, 189, 240, 182, 238, 44, 189, 187, 210,
  215, 215, 180, 204, 172, 10, 50, 48, 50, 54, 45, 48, 56, 45, 48, 50, 32, 49,
  50, 58, 51, 48, 58, 48, 48, 44, 178, 205, 210, 251, 195, 192, 202, 179, 44, 208,
  199, 176, 205, 191, 203, 44, 196, 195, 204, 250, 44, 214, 167, 179, 246, 44, 51, 53,
  46, 48, 48, 44, 189, 187, 210, 215, 179, 201, 185, 166, 10, 50, 48, 50, 54, 45,
  48, 56, 45, 48, 51, 32, 48, 57, 58, 49, 53, 58, 48, 48, 44, 189, 187, 205,
  168, 179, 246, 208, 208, 44, 181, 206, 181, 206, 179, 246, 208, 208, 44, 191, 236, 179,
  181, 44, 214, 167, 179, 246, 44, 49, 56, 46, 53, 48, 44, 189, 187, 210, 215, 179,
  201, 185, 166, 10, 50, 48, 50, 54, 45, 48, 56, 45, 48, 52, 32, 49, 48, 58,
  48, 48, 58, 48, 48, 44, 202, 213, 200, 235, 44, 185, 171, 203, 190, 44, 185, 164,
  215, 202, 44, 202, 213, 200, 235, 44, 49, 50, 48, 48, 48, 46, 48, 48, 44, 189,
  187, 210, 215, 179, 201, 185, 166, 10,
];

/// A 微信 export: UTF-8, and with the BOM 微信 puts in front of it.
List<int> wechatUtf8() => [
      0xef, 0xbb, 0xbf,
      ...utf8.encode(
        '微信支付账单明细\n'
        '导出时间:[2026-08-05]\n'
        '----------------------微信支付账单明细列表--------------------\n'
        '交易时间,交易类型,交易对方,商品,收/支,金额(元),当前状态\n'
        '2026-08-02 08:10:00,商户消费,全家便利店,饮料,支出,¥6.50,支付成功\n'
        '2026-08-03 19:40:00,商户消费,美团外卖,晚饭,支出,¥42.00,支付成功\n',
      ),
    ];

List<int> bytesOf(String s) => utf8.encode(s);

imports.ImportPreview previewOf(List<int> bytes) {
  final live = store.liveEntries();
  return imports.previewBills(
    bytes: bytes,
    ids: live.map((e) => e.id).toList(),
    daysOf: live
        .map((e) {
          final d = DateTime.fromMillisecondsSinceEpoch(e.ts);
          return '${d.year}-${d.month}-${d.day}';
        })
        .toList(),
  );
}

Future<void> show(
  WidgetTester tester, {
  bool zh = true,
  List<int>? file,
  VoidCallback? onImported,
}) async {
  await tester.pumpWidget(MaterialApp(
    home: ImportScreen(
      zh: zh,
      onImported: onImported,
      pick: () async => file,
    ),
  ));
  await tester.pumpAndSettle();
}

Future<void> pickFile(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('pick-bill-file')));
  await tester.pumpAndSettle();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() => store.reset());

  group('reading the file', () {
    testWidgets('GBK bytes come back as 中文, not mojibake', (tester) async {
      final p = previewOf(alipayGbk);

      expect(p.ok, isTrue);
      expect(p.source, 'alipay');
      expect(p.candidates.length, 3);
      // If the encoding had been guessed wrong these would be 锟斤拷.
      expect(p.candidates.first.note, contains('星巴克'));
      expect(p.candidates.first.amt, 35.0);
    });

    testWidgets('a BOM does not become part of the first header cell',
        (tester) async {
      final p = previewOf(wechatUtf8());

      expect(p.ok, isTrue);
      expect(p.source, 'wechat');
      expect(p.candidates.length, 2);
      expect(p.candidates.first.note, contains('全家便利店'));
    });

    testWidgets('the currency sign in front of the amount is not a digit',
        (tester) async {
      final p = previewOf(wechatUtf8());
      expect(p.candidates.map((c) => c.amt).toList(), [6.5, 42.0]);
    });

    testWidgets('a file with no header is refused, not silently empty',
        (tester) async {
      final p = previewOf(bytesOf('hello,world\n1,2\n'));

      expect(p.ok, isFalse);
      expect(p.candidates, isEmpty);
    });

    testWidgets('the wall time in the file is the wall time on the phone',
        (tester) async {
      final p = previewOf(alipayGbk);
      final c = p.candidates.first;

      // Six numbers, no instant: the zone is the platform's to apply.
      expect([c.y, c.mo, c.d, c.h, c.mi, c.s], [2026, 8, 2, 12, 30, 0]);
    });
  });

  group('what it would add', () {
    testWidgets('income and expense are counted and summed apart',
        (tester) async {
      final p = previewOf(alipayGbk);

      expect(p.expCount, 2);
      expect(p.incCount, 1);
      expect(p.expSum, closeTo(53.5, 1e-9));
      expect(p.incSum, closeTo(12000, 1e-9));
    });

    testWidgets('an entry already in the ledger is marked, not repeated',
        (tester) async {
      // Import once, then look at the same file again.
      await show(tester, file: alipayGbk);
      await pickFile(tester);
      await tester.tap(find.byKey(const Key('confirm-import')));
      await tester.pumpAndSettle();

      expect(store.entryCount(), 3);

      await pickFile(tester);
      expect(find.text('没有新的一笔'), findsOneWidget);
      expect(store.entryCount(), 3, reason: 'nothing more was written');
    });

    testWidgets('re-importing twice over adds nothing either time',
        (tester) async {
      await show(tester, file: wechatUtf8());
      for (var i = 0; i < 3; i++) {
        await pickFile(tester);
        final btn = tester.widget<FilledButton>(
            find.byKey(const Key('confirm-import')));
        if (btn.onPressed == null) continue;
        await tester.tap(find.byKey(const Key('confirm-import')));
        await tester.pumpAndSettle();
      }
      expect(store.entryCount(), 2);
    });

    testWidgets('two same-day payments of the same amount both survive',
        (tester) async {
      final csv = bytesOf(
        '交易时间,收/支,金额,商品说明\n'
        '2026-08-02 12:00:00,支出,20.00,咖啡\n'
        '2026-08-02 15:00:00,支出,20.00,咖啡\n',
      );
      final p = previewOf(csv);

      expect(p.candidates.length, 2);
      expect(p.candidates.every((c) => !c.dup), isTrue,
          reason: 'neither has an existing entry to absorb it');
    });
  });

  group('the screen', () {
    testWidgets('says which wallet the file came from', (tester) async {
      await show(tester, file: alipayGbk);
      await pickFile(tester);

      expect(find.text('支付宝'), findsOneWidget);
      expect(find.byKey(const Key('import-source')), findsOneWidget);
    });

    testWidgets('counts every row, duplicates included', (tester) async {
      await show(tester, file: alipayGbk);
      await pickFile(tester);

      final meta = tester.widget<Text>(find.byKey(const Key('import-meta')));
      expect(meta.data, contains('3 行'));
      expect(meta.data, contains('0 行已经记过'));
    });

    testWidgets('a duplicate row is shown and labelled', (tester) async {
      await show(tester, file: alipayGbk);
      await pickFile(tester);
      await tester.tap(find.byKey(const Key('confirm-import')));
      await tester.pumpAndSettle();
      await pickFile(tester);

      // All three still listed — hiding them would leave the count unexplained.
      expect(find.textContaining('已记过'), findsNWidgets(3));
      final meta = tester.widget<Text>(find.byKey(const Key('import-meta')));
      expect(meta.data, contains('3 行已经记过'));
    });

    testWidgets('cancelling the picker says nothing and changes nothing',
        (tester) async {
      await show(tester, file: null);
      await pickFile(tester);

      expect(find.byKey(const Key('import-flash')), findsNothing);
      expect(find.byKey(const Key('import-meta')), findsNothing);
      expect(store.entryCount(), 0);
    });

    testWidgets('a file it cannot read says so where the list would be',
        (tester) async {
      await show(tester, file: bytesOf('nothing,useful\n'));
      await pickFile(tester);

      expect(find.byKey(const Key('import-no-header')), findsOneWidget);
      expect(find.byKey(const Key('confirm-import')), findsNothing);
    });

    testWidgets('importing writes the rows and reports how many',
        (tester) async {
      var told = 0;
      await show(tester, file: alipayGbk, onImported: () => told++);
      await pickFile(tester);
      await tester.tap(find.byKey(const Key('confirm-import')));
      await tester.pumpAndSettle();

      expect(store.entryCount(), 3);
      expect(told, 1, reason: 'the ledger changed, so the file needs writing');
      expect(find.text('已导入 3 条'), findsOneWidget);
    });

    testWidgets('the imported rows carry the note the file described',
        (tester) async {
      await show(tester, file: alipayGbk);
      await pickFile(tester);
      await tester.tap(find.byKey(const Key('confirm-import')));
      await tester.pumpAndSettle();

      final notes = store.liveEntries().map((e) => e.note ?? '').toList();
      expect(notes.any((n) => n.contains('星巴克')), isTrue);
      expect(notes.any((n) => n.contains('滴滴出行')), isTrue);
    });

    testWidgets('the rows land on the days the file gave', (tester) async {
      await show(tester, file: alipayGbk);
      await pickFile(tester);
      await tester.tap(find.byKey(const Key('confirm-import')));
      await tester.pumpAndSettle();

      final days = store
          .liveEntries()
          .map((e) => DateTime.fromMillisecondsSinceEpoch(e.ts))
          .map((d) => '${d.month}/${d.day}')
          .toSet();
      expect(days, {'8/2', '8/3', '8/4'});
    });

    testWidgets('English throughout when the app is in English',
        (tester) async {
      await show(tester, zh: false, file: alipayGbk);
      await pickFile(tester);

      expect(find.text('Alipay'), findsOneWidget);
      expect(find.text('Import 3'), findsOneWidget);
      expect(find.textContaining('already recorded'), findsOneWidget);
    });
  });
}
