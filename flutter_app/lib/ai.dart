// 智能记账's transport: the key, the bytes, and saving what came back.
//
// What a request says and what a reply means are decided in Rust —
// `core::ai` and `api::ai`. What is here is what only the platform can do:
// keep the key encrypted on this phone, send a request with it, stop waiting
// when the request says to, and put the words on a failure.
//
// Nothing is sent unless the user turned AI on, gave it a key, and pressed
// something. Off, 一句话记账 and 问账本 still answer — on the phone.

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import 'ledger_days.dart';
import 'record_sheet.dart' show FormEdit;
import 'src/rust/api/ai.dart' as ai;
import 'src/rust/api/record.dart' as record;

/// The key, in Android's encrypted store — never in the config, so never in a
/// backup, a sync file or an export.
class AiKey {
  AiKey._();

  static const _name = 'ai-api-key';
  static const _storage = FlutterSecureStorage();

  static String? _kept;
  static bool _read = false;

  /// For a test: a key held in memory, and the store left alone.
  static bool inMemory = false;

  static Future<String?> read() async {
    if (_read || inMemory) return _kept;
    try {
      _kept = await _storage.read(key: _name);
    } catch (_) {
      // a keystore that cannot be opened is a key that is not there
      _kept = null;
    }
    _read = true;
    return _kept;
  }

  static Future<void> write(String key) async {
    final k = key.trim();
    _kept = k.isEmpty ? null : k;
    _read = true;
    if (inMemory) return;
    if (k.isEmpty) {
      await _storage.delete(key: _name);
    } else {
      await _storage.write(key: _name, value: k);
    }
  }

  static Future<void> clear() => write('');

  /// What the key is, for a screen that says one is set: its prefix and its
  /// last four, never the rest.
  static String masked(String key) => key.length <= 8
      ? '••••'
      : '${key.substring(0, 3)}••••${key.substring(key.length - 4)}';

  /// The first three characters, which pick the default cluster.
  static String prefix(String? key) =>
      key == null || key.length < 3 ? '' : key.substring(0, 3);
}

/// A reply, or why there is none.
typedef AiReply = ({int status, String body});

/// How a request is sent. Replaceable in a test, which answers with what a
/// service would and never touches the network.
typedef AiSend =
    Future<AiReply> Function(
      Uri url,
      Map<String, String> headers,
      String body,
      Duration timeout,
    );

Future<AiReply> _post(
  Uri url,
  Map<String, String> headers,
  String body,
  Duration timeout,
) async {
  final r = await http
      .post(url, headers: headers, body: utf8.encode(body))
      .timeout(timeout);
  return (
    status: r.statusCode,
    body: utf8.decode(r.bodyBytes, allowMalformed: true),
  );
}

class Ai {
  Ai._();

  static AiSend send = _post;

  /// Whether a request would be made: on, and a key to make it with.
  static Future<bool> ready() async =>
      ai.aiSettings().enabled && (await AiKey.read()) != null;

  /// Send `r`. A connection that fails or does not answer in time comes back
  /// as a `null` reply, which the core calls `network`.
  static Future<AiReply?> call(ai.AiRequest r) async {
    final key = await AiKey.read();
    if (key == null) return null;
    try {
      return await send(
        Uri.parse(r.url),
        {'Content-Type': 'application/json', 'Authorization': 'Bearer $key'},
        r.body,
        Duration(seconds: r.timeoutSecs),
      );
    } catch (_) {
      return null;
    }
  }

  static Future<String> _prefix() async => AiKey.prefix(await AiKey.read());

  /// 一句话记账: the model's reading when AI is on, the phone's otherwise —
  /// and the phone's too when the model could not be reached, with the
  /// failure beside it so the screen can say which it was.
  static Future<
    ({List<ai.DraftView> drafts, ai.FailureView? failure, bool byAi})
  >
  read(String text, {required bool zh}) async {
    final today = dayKey(DateTime.now());
    if (!await ready()) {
      return (
        drafts: ai.quickOffline(text: text, today: today, zh: zh),
        failure: null,
        byAi: false,
      );
    }
    final reply = await call(
      ai.quickRequest(
        text: text,
        today: today,
        zh: zh,
        keyPrefix: await _prefix(),
      ),
    );
    final v = reply == null
        ? ai.DraftsView(drafts: const [], failure: ai.networkFailure())
        : ai.draftsReply(
            status: reply.status,
            body: reply.body,
            today: today,
            zh: zh,
          );
    if (v.failure != null) {
      return (
        drafts: ai.quickOffline(text: text, today: today, zh: zh),
        failure: v.failure,
        byAi: false,
      );
    }
    return (drafts: v.drafts, failure: null, byAi: true);
  }

  /// 拍小票. There is no reading a picture on the phone, so a failure is only
  /// a failure.
  static Future<({List<ai.DraftView> drafts, ai.FailureView? failure})>
  readPicture(Uint8List bytes, {required bool zh}) async {
    final today = dayKey(DateTime.now());
    final reply = await call(
      ai.receiptRequest(
        imageBase64: base64Encode(bytes),
        mime: mimeOf(bytes),
        today: today,
        zh: zh,
        keyPrefix: await _prefix(),
      ),
    );
    final v = reply == null
        ? ai.DraftsView(drafts: const [], failure: ai.networkFailure())
        : ai.draftsReply(
            status: reply.status,
            body: reply.body,
            today: today,
            zh: zh,
          );
    return (drafts: v.drafts, failure: v.failure);
  }

  /// 问账本: the question into a query — the model's when AI is on, the
  /// phone's otherwise or when it fails — then the query run here.
  static Future<({ai.AskAnswerView answer, ai.FailureView? failure, bool byAi})>
  ask(String question, {required bool zh}) async {
    final today = dayKey(DateTime.now());
    ai.AskQueryView? query;
    ai.FailureView? failure;
    if (await ready()) {
      final reply = await call(
        ai.askRequest(
          question: question,
          today: today,
          zh: zh,
          keyPrefix: await _prefix(),
        ),
      );
      final v = reply == null
          ? ai.AskReplyView(failure: ai.networkFailure())
          : ai.askReply(status: reply.status, body: reply.body, today: today);
      query = v.query;
      failure = v.failure;
    }
    final byAi = query != null;
    query ??= ai.askOffline(question: question, today: today);
    final l = LedgerDays.current();
    final answer = ai.askRun(
      query: query,
      ids: l.ids,
      daysOf: l.days,
      today: today,
      zh: zh,
    );
    return (answer: answer, failure: failure, byAi: byAi);
  }

  /// Whether the key, the address and the model answer. `null` is yes.
  static Future<ai.FailureView?> ping() async {
    if ((await AiKey.read()) == null) {
      return const ai.FailureView(kind: 'nokey', detail: '');
    }
    final reply = await call(ai.pingRequest(keyPrefix: await _prefix()));
    if (reply == null) return ai.networkFailure();
    return ai.pingReply(status: reply.status, body: reply.body);
  }
}

/// `image/png` or `image/jpeg`, by the file's own first bytes rather than a
/// name that may be wrong.
String mimeOf(Uint8List b) =>
    b.length > 3 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47
    ? 'image/png'
    : b.length > 3 &&
          b[0] == 0x52 &&
          b[1] == 0x49 &&
          b[2] == 0x46 &&
          b[3] == 0x46
    ? 'image/webp'
    : 'image/jpeg';

/// What a failure is, in words.
String failureText(ai.FailureView f, bool zh) {
  final base = switch (f.kind) {
    'nokey' =>
      zh
          ? '还没有填 API Key，在 设置 › AI 助手 里填'
          : 'No API key yet — add one in Settings › AI',
    'network' => zh ? '连不上 AI 服务，检查一下网络' : 'Could not reach the AI service',
    'key' => zh ? 'API Key 不对，或者已经失效' : 'The API key was refused',
    'quota' => zh ? 'AI 账户的额度用完了' : 'The AI account is out of credit',
    'rate' => zh ? '请求太频繁了，稍等一会儿再试' : 'Too many requests — try again shortly',
    'request' =>
      zh
          ? '服务不认这个请求，多半是模型名不对'
          : 'The service refused the request — check the model name',
    'server' => zh ? 'AI 服务出错了，稍后再试' : 'The AI service had an error',
    _ => zh ? 'AI 没给出能用的结果' : 'The AI gave nothing usable',
  };
  return base;
}

/// Save drafts the way the record sheet saves an entry — the same form, the
/// same default account, the same checks — so an entry read out of a
/// sentence cannot differ from one typed. Returns the ids written, in order.
List<String> saveDrafts(List<ai.DraftView> drafts) {
  final written = <String>[];
  final now = DateTime.now();
  for (final (i, d) in drafts.indexed) {
    var f = record.initialForm(sourceId: '', editing: false, ledger: '');
    f = record.pickDirection(next: d.io, form: f);
    f = f.copyWith(cat: d.cat, amt: _amt(d.amt), note: d.note);
    final day = d.day;
    if (day != null && day != dayKey(now)) {
      // a day that is not today is recorded at noon of it, as 补记这天 does:
      // the middle of the day, where no zone change moves it to another
      final p = day.split('-').map(int.parse).toList();
      f = f.withTs(DateTime(p[0], p[1], p[2], 12).millisecondsSinceEpoch);
    }
    final stamp = now.millisecondsSinceEpoch;
    final id = 'e${stamp}a$i';
    final r = record.saveForm(
      form: f,
      editId: '',
      id: id,
      now: stamp + i,
      rateOverride: null,
      rateWasCached: false,
    );
    if (r.rejected == null) written.add(id);
  }
  return written;
}

String _amt(double v) =>
    v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(2);
