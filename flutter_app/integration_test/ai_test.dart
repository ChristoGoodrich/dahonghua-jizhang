// 智能记账 on a device: 一句话记账, 拍小票 and 问账本, on the phone and with a
// service standing in for the model.
//
// The reading itself is `core::ai`'s and is tested there, case by case. What
// is checked here is what only the whole app can show: that off means nothing
// is sent, that on sends only what the settings screen says it sends, that a
// failure falls back to the phone and says so, and that what is saved is what
// was shown.

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_app/ai.dart';
import 'package:flutter_app/ai_entry_screen.dart';
import 'package:flutter_app/ask_screen.dart';
import 'package:flutter_app/main.dart';
import 'package:flutter_app/settings_screen.dart';
import 'package:flutter_app/src/rust/api/ai.dart' as ai;
import 'package:flutter_app/src/rust/api/store.dart' as store;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'rust_init.dart';

int get now => DateTime.now().millisecondsSinceEpoch;

/// Every request the stand-in service was sent.
final sent = <({Uri url, Map<String, String> headers, String body})>[];

/// Answer as the service would: a chat completion carrying `content`.
AiSend answering(String content, {int status = 200}) =>
    (url, headers, body, timeout) async {
      sent.add((url: url, headers: headers, body: body));
      return (
        status: status,
        body: jsonEncode({
          'choices': [
            {
              'message': {'role': 'assistant', 'content': content},
            },
          ],
          if (status != 200) 'error': {'message': 'Invalid API Key'},
        }),
      );
    };

Future<AiReply> unreachable(
  Uri u,
  Map<String, String> h,
  String b,
  Duration t,
) async {
  sent.add((url: u, headers: h, body: b));
  throw Exception('no route to host');
}

void aiOn({String key = 'tp-test-key-123456'}) {
  AiKey.inMemory = true;
  AiKey.write(key);
  ai.setAiSettings(
    view: const ai.AiSettingsView(
      enabled: true,
      baseUrl: '',
      model: '',
      visionModel: '',
    ),
  );
}

void add(
  String id,
  double amt, {
  String? note,
  String cat = 'food',
  String io = 'exp',
}) => store.addEntry(
  entry: store.NewEntry(io: io, cat: cat, amt: amt, note: note, ts: now),
  id: id,
  now: now,
);

Future<List<String>> showEntry(WidgetTester tester, {PickPicture? pick}) async {
  final saved = <String>[];
  await tester.pumpWidget(
    MaterialApp(
      home: AiEntryScreen(onSaved: saved.addAll, pick: pick),
    ),
  );
  await tester.pumpAndSettle();
  return saved;
}

Future<void> read(WidgetTester tester, String text) async {
  await tester.enterText(find.byKey(const Key('ai-text')), text);
  await tester.tap(find.byKey(const Key('ai-read')));
  await tester.pumpAndSettle();
}

String notice(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('ai-notice'))).data!;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(ensureRust);
  setUp(() async {
    store.reset();
    sent.clear();
    AiKey.inMemory = true;
    await AiKey.clear();
    Ai.send = unreachable;
  });

  group('一句话记账 on the phone', () {
    testWidgets('several entries from one sentence, and nothing sent', (
      tester,
    ) async {
      // a key saved and AI switched off: off has to mean off, key or not
      await AiKey.write('tp-saved-but-off');
      Ai.send = answering('{"entries":[]}');
      final saved = await showEntry(tester);
      await read(tester, '午饭35 打车12，昨天超市买菜128');

      expect(find.byKey(const Key('draft-0')), findsOneWidget);
      expect(find.byKey(const Key('draft-2')), findsOneWidget);
      expect(notice(tester), contains('本机'));
      expect(sent, isEmpty, reason: 'AI is off: nothing leaves the phone');

      await tester.tap(find.byKey(const Key('ai-save')));
      await tester.pumpAndSettle();
      expect(saved, hasLength(3));
      final rows = store.liveEntries();
      expect(rows.map((e) => e.amt).toSet(), {35.0, 12.0, 128.0});
      final lunch = rows.firstWhere((e) => e.amt == 35);
      expect((lunch.cat, lunch.note), ('food', '午饭'));
      final shop = rows.firstWhere((e) => e.amt == 128);
      final d = DateTime.fromMillisecondsSinceEpoch(shop.ts);
      final y = DateTime.now().subtract(const Duration(days: 1));
      expect(
        (d.year, d.month, d.day, d.hour),
        (y.year, y.month, y.day, 12),
        reason: "yesterday's, at noon",
      );
    });

    testWidgets('what is saved is what was ticked and corrected', (
      tester,
    ) async {
      await showEntry(tester);
      await read(tester, '午饭35 打车12');

      await tester.tap(find.byKey(const Key('draft-1-on')));
      await tester.pumpAndSettle();
      expect(find.text('记下 1 笔'), findsOneWidget);

      await tester.tap(find.byKey(const Key('draft-0-amt')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('draft-amt-field')), '38.5');
      await tester.tap(find.byKey(const Key('draft-amt-ok')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('draft-0-cat')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('draft-cat-fun')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('ai-save')));
      await tester.pumpAndSettle();
      final rows = store.liveEntries();
      expect(rows, hasLength(1));
      expect((rows.single.amt, rows.single.cat), (38.5, 'fun'));
    });

    testWidgets('a sentence with no amount says how to write one', (
      tester,
    ) async {
      await showEntry(tester);
      await read(tester, '今天天气不错');
      expect(notice(tester), contains('午饭35'));
      expect(find.byKey(const Key('ai-save')), findsNothing);
    });

    testWidgets(
      'a picture needs AI, and says so instead of opening the camera',
      (tester) async {
        var picked = false;
        await showEntry(
          tester,
          pick: (_) async {
            picked = true;
            return null;
          },
        );
        await tester.tap(find.byKey(const Key('ai-gallery')));
        await tester.pumpAndSettle();
        expect(picked, isFalse);
        expect(notice(tester), contains('设置'));
      },
    );
  });

  group('一句话记账 with AI', () {
    testWidgets('the model reads it; the request is what the settings say', (
      tester,
    ) async {
      aiOn();
      Ai.send = answering(
        '{"entries":[{"io":"exp","amount":35,"category":"餐饮","note":"午饭"},'
        '{"io":"exp","amount":"12","category":"交通","note":"打车"}]}',
      );
      await showEntry(tester);
      await read(tester, '中午吃饭三十五 回来打的十二');

      expect(sent, hasLength(1));
      final r = sent.single;
      expect(
        r.url.toString(),
        'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
        reason: 'a tp- key',
      );
      expect(r.headers['Authorization'], 'Bearer tp-test-key-123456');
      expect(r.body, contains('中午吃饭三十五 回来打的十二'));
      expect(notice(tester), contains('AI'));

      await tester.tap(find.byKey(const Key('ai-save')));
      await tester.pumpAndSettle();
      expect(store.liveEntries().map((e) => e.cat).toSet(), {'food', 'trans'});
    });

    testWidgets('a refused key falls back to the phone, and says so', (
      tester,
    ) async {
      aiOn();
      Ai.send = answering('', status: 401);
      await showEntry(tester);
      await read(tester, '午饭35');
      expect(notice(tester), contains('API Key'));
      expect(notice(tester), contains('本机'));
      expect(
        find.byKey(const Key('draft-0')),
        findsOneWidget,
        reason: 'still read',
      );
    });

    testWidgets('no network falls back too', (tester) async {
      aiOn();
      await showEntry(tester);
      await read(tester, '午饭35');
      expect(sent, hasLength(1), reason: 'it did try');
      expect(notice(tester), contains('连不上'));
      expect(find.byKey(const Key('draft-0')), findsOneWidget);
    });

    testWidgets('a picture goes as a picture and comes back as drafts', (
      tester,
    ) async {
      aiOn();
      Ai.send = answering(
        '{"entries":[{"io":"exp","amount":45,"category":"餐饮","note":"星巴克"}]}',
      );
      // a PNG's first bytes, which is what the type is read from
      final png = Uint8List.fromList([0x89, 0x50, 0x4E, 0x47, 1, 2, 3, 4]);
      await showEntry(tester, pick: (_) async => png);
      await tester.tap(find.byKey(const Key('ai-gallery')));
      await tester.pumpAndSettle();

      expect(
        sent.single.body,
        contains('data:image/png;base64,${base64Encode(png)}'),
      );
      expect(
        sent.single.body,
        contains('mimo-v2.5"'),
        reason: 'the model that reads pictures',
      );
      expect(find.text('星巴克 · 今天'), findsOneWidget);
    });
  });

  group('问账本', () {
    Future<void> ask(WidgetTester tester, String q) async {
      await tester.enterText(find.byKey(const Key('ask-field')), q);
      await tester.tap(find.byKey(const Key('ask-send')));
      await tester.pumpAndSettle();
    }

    String headline(WidgetTester tester) =>
        tester.widget<Text>(find.byKey(const Key('ask-headline')).last).data!;

    testWidgets('answered on the phone', (tester) async {
      add('a', 30, note: '外卖');
      add('b', 20, note: '食堂');
      add('c', 12, note: '打车', cat: 'trans');
      await tester.pumpWidget(const MaterialApp(home: AskScreen()));
      await tester.pumpAndSettle();

      await ask(tester, '这个月外卖花了多少');
      expect(headline(tester), '共花了 ￥30.00');
      await ask(tester, '这个月花了几笔');
      expect(headline(tester), '共 3 笔');
      await ask(tester, '钱都花在哪了');
      expect(find.textContaining('餐饮'), findsWidgets);
      expect(sent, isEmpty);
    });

    /// The whole design: the model sees the question, never a row.
    testWidgets('the model writes the query and never sees the ledger', (
      tester,
    ) async {
      add('a', 318.25, note: '张医生诊所');
      add('b', 20, note: '食堂');
      aiOn();
      Ai.send = answering('{"period":"this_month","io":"exp","metric":"sum"}');
      await tester.pumpWidget(const MaterialApp(home: AskScreen()));
      await tester.pumpAndSettle();
      await ask(tester, '这个月一共花了多少');

      final body = sent.single.body;
      expect(body, contains('这个月一共花了多少'));
      for (final secret in ['张医生诊所', '食堂', '318.25', '338.25']) {
        expect(
          body,
          isNot(contains(secret)),
          reason: '$secret stayed on the phone',
        );
      }
      expect(
        headline(tester),
        '共花了 ￥338.25',
        reason: 'and it was counted here',
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('ask-source'))).data,
        contains('在手机上算'),
      );
    });
  });

  group('设置 › AI 助手', () {
    Future<void> show(WidgetTester tester) async {
      await tester.pumpWidget(const MaterialApp(home: SettingsScreen()));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.byKey(const Key('ai-privacy')),
        300,
        // the page's own list; with AI on, every text field has one too
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
    }

    testWidgets('off by default, and says what would be sent', (tester) async {
      await show(tester);
      expect(
        tester.widget<Switch>(find.byKey(const Key('ai-toggle'))).value,
        isFalse,
      );
      expect(find.byKey(const Key('ai-key-edit')), findsNothing);
      expect(
        tester.widget<Text>(find.byKey(const Key('ai-privacy'))).data,
        contains('账本本身从不离开手机'),
      );
    });

    testWidgets('a key is kept apart from the config, and shown masked', (
      tester,
    ) async {
      await show(tester);
      await tester.tap(find.byKey(const Key('ai-toggle')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('ai-key-edit')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('ai-key-field')),
        'tp-abcdefghijkl9876',
      );
      await tester.tap(find.byKey(const Key('ai-key-ok')));
      await tester.pumpAndSettle();

      expect(await AiKey.read(), 'tp-abcdefghijkl9876');
      expect(
        tester.widget<Text>(find.byKey(const Key('ai-key-state'))).data,
        'tp-••••9876',
      );
      expect(ai.aiSettings().enabled, isTrue);
      expect(
        store.snapshotConfig(),
        isNot(contains('abcdefghijkl')),
        reason: 'not in the config, so not in a backup',
      );
    });

    testWidgets('测试连接 says whether it works', (tester) async {
      aiOn();
      Ai.send = answering('OK');
      await show(tester);
      await tester.tap(find.byKey(const Key('ai-ping')));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(const Key('ai-ping-result'))).data,
        contains('连上了'),
      );

      Ai.send = answering('', status: 401);
      await tester.tap(find.byKey(const Key('ai-ping')));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(const Key('ai-ping-result'))).data,
        contains('API Key'),
      );
    });
  });

  group('in the shell', () {
    testWidgets('a long press on + opens it, and 撤销 takes all of it back', (
      tester,
    ) async {
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();
      await tester.longPress(find.byKey(const Key('record-button')));
      await tester.pumpAndSettle();
      expect(find.byType(AiEntryScreen), findsOneWidget);

      await read(tester, '奶茶18 地铁4');
      await tester.tap(find.byKey(const Key('ai-save')));
      await tester.pumpAndSettle();
      expect(find.byType(AiEntryScreen), findsNothing);
      expect(store.liveEntries().where((e) => e.note == '奶茶'), hasLength(1));
      expect(find.text('记了 2 笔'), findsOneWidget);

      await tester.tap(find.byKey(const Key('smart-undo')));
      await tester.pumpAndSettle();
      expect(
        store.liveEntries().where((e) => e.note == '奶茶' || e.note == '地铁'),
        isEmpty,
      );
    });

    testWidgets('记一笔 hands over to it', (tester) async {
      await tester.pumpWidget(const App());
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('record-button')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('record-smart')));
      await tester.pumpAndSettle();
      expect(find.byType(AiEntryScreen), findsOneWidget);
      expect(find.text('记一笔'), findsNothing, reason: 'the sheet went');
    });
  });
}
