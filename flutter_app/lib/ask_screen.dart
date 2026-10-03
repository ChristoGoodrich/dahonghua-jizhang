// 问账本 — ask the ledger a question, in the words you would ask a person.
//
// "上个月外卖花了多少", "钱都花在哪了", "最近7天平均每天花多少". The question
// becomes a query and the query runs here, over the ledger, by the same
// filters the rest of the app uses — `core::ai::ask`. When AI is on, the model
// reads the question and writes the query, and nothing else: **it never sees
// a row**, which is the one thing that lets an app whose ledger stays on the
// phone ask a model anything about it. Off, the phone reads the question
// itself.
//
// The answer is drawn from what the core measured; the sentence is composed
// here, because words are the platform's.

import 'package:flutter/material.dart';

import 'ai.dart';
import 'glass.dart';
import 'src/rust/api/ai.dart' as ai;
import 'src/rust/api/money.dart' as money;
import 'tap.dart';
import 'theme.dart';

class AskScreen extends StatefulWidget {
  const AskScreen({super.key, this.zh = true, this.onOpen});

  final bool zh;

  /// A row in an answer was pressed.
  final ValueChanged<String>? onOpen;

  @override
  State<AskScreen> createState() => _AskScreenState();
}

class _Turn {
  _Turn(this.question);
  final String question;
  ai.AskAnswerView? answer;
  ai.FailureView? failure;
  bool byAi = false;
}

class _AskScreenState extends State<AskScreen> {
  final _text = TextEditingController();
  final _scroll = ScrollController();
  final _turns = <_Turn>[];
  bool _busy = false;
  bool _ready = false;

  bool get _zh => widget.zh;

  List<String> get _suggestions => _zh
      ? const [
          '这个月花了多少',
          '钱都花在哪了',
          '上个月餐饮花了多少',
          '最近7天每天花多少',
          '今年最贵的一笔',
          '这个月收入多少',
        ]
      : const [
          'How much this month',
          'Where did it go',
          'Food last month',
          'Each day, last 7 days',
        ];

  @override
  void initState() {
    super.initState();
    Ai.ready().then((r) {
      if (mounted) setState(() => _ready = r);
    });
  }

  @override
  void dispose() {
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _ask(String q) async {
    final question = q.trim();
    if (question.isEmpty || _busy) return;
    _text.clear();
    final t = _Turn(question);
    setState(() {
      _turns.add(t);
      _busy = true;
    });
    final r = await Ai.ask(question, zh: _zh);
    if (!mounted) return;
    setState(() {
      t.answer = r.answer;
      t.failure = r.failure;
      t.byAi = r.byAi;
      _busy = false;
    });
    await Future<void>.delayed(const Duration(milliseconds: 50));
    if (_scroll.hasClients) {
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOutCubic,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final zh = _zh;
    return ScrimScaffold(
      title: Text(
        zh ? '问账本' : 'Ask the ledger',
        style: TextStyle(
          color: p.ink,
          fontSize: 17,
          fontWeight: FontWeight.w700,
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              key: const Key('ask-list'),
              controller: _scroll,
              padding: EdgeInsets.fromLTRB(
                22,
                headerInset(context) + 6,
                22,
                16,
              ),
              children: [
                Text(
                  _ready
                      ? (zh
                            ? 'AI 只读你的问题、写出查询；账本在手机上算，一条记录都不发出去。'
                            : 'The AI reads your question and writes a query; the ledger is counted on the phone and never sent.')
                      : (zh
                            ? '在本机理解问题，不联网。开启 AI 后能听懂更多问法。'
                            : 'Understood on the phone, offline. Turn AI on to understand more.'),
                  key: const Key('ask-mode'),
                  style: TextStyle(fontSize: 12, color: p.inkSoft, height: 1.5),
                ),
                const SizedBox(height: 14),
                if (_turns.isEmpty)
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final (i, s) in _suggestions.indexed)
                        Tap(
                          key: Key('ask-suggest-$i'),
                          radius: Rad.pill,
                          onTap: () => _ask(s),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 9,
                            ),
                            decoration: BoxDecoration(
                              color: p.card,
                              borderRadius: BorderRadius.circular(Rad.pill),
                              border: Border.all(color: p.line),
                            ),
                            child: Text(
                              s,
                              style: TextStyle(fontSize: 13, color: p.ink),
                            ),
                          ),
                        ),
                    ],
                  ),
                for (final (i, t) in _turns.indexed) ...[
                  _question(t.question),
                  const SizedBox(height: 8),
                  if (t.answer == null)
                    const Padding(
                      padding: EdgeInsets.all(12),
                      child: Center(
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    )
                  else
                    _AnswerCard(
                      key: Key('ask-answer-$i'),
                      turn: t,
                      zh: zh,
                      onOpen: widget.onOpen,
                    ),
                  const SizedBox(height: 18),
                ],
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      key: const Key('ask-field'),
                      controller: _text,
                      textInputAction: TextInputAction.send,
                      onSubmitted: _ask,
                      style: TextStyle(fontSize: 15, color: p.ink),
                      decoration: InputDecoration(
                        hintText: zh
                            ? '问点什么：上个月外卖花了多少'
                            : 'Ask: food last month',
                        hintStyle: TextStyle(color: p.inkSoft),
                        filled: true,
                        fillColor: p.card,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 12,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(Rad.pill),
                          borderSide: BorderSide(color: p.line),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(Rad.pill),
                          borderSide: BorderSide(color: p.line),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    key: const Key('ask-send'),
                    onPressed: _busy ? null : () => _ask(_text.text),
                    icon: const Icon(Icons.arrow_upward_rounded),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _question(String q) => Align(
    alignment: Alignment.centerRight,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
      decoration: BoxDecoration(
        color: palette.hibiscus.withValues(alpha: palette.isDark ? 0.22 : 0.12),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Text(q, style: TextStyle(fontSize: 14.5, color: palette.ink)),
    ),
  );
}

/// One answer: the number, what it covers, and what it is made of.
class _AnswerCard extends StatelessWidget {
  const _AnswerCard({
    super.key,
    required this.turn,
    required this.zh,
    this.onOpen,
  });

  final _Turn turn;
  final bool zh;
  final ValueChanged<String>? onOpen;

  String _m(double v) => money.fmt(n: v, symbol: zh ? '￥' : '\$');

  /// This year's days without the year, which every one of them would repeat.
  String _day(String ymd) {
    final p = ymd.split('-');
    if (p[0] == '${DateTime.now().year}') {
      return zh ? '${p[1]}月${p[2]}日' : '${p[1]}/${p[2]}';
    }
    return zh ? '${p[0]}年${p[1]}月${p[2]}日' : '${p[1]}/${p[2]}/${p[0]}';
  }

  String _short(String ymd) {
    final p = ymd.split('-');
    return p.length == 3
        ? (zh ? '${p[1]}月${p[2]}日' : '${p[1]}/${p[2]}')
        : (zh ? '${p[0]}年${p[1]}月' : '${p[1]}/${p[0]}');
  }

  String _range(ai.AskQueryView q) {
    if (q.from.startsWith('2000-')) return zh ? '全部记录' : 'Everything';
    if (q.from == q.to) return _day(q.from);
    return '${_day(q.from)} – ${_day(q.to)}';
  }

  /// The number, said.
  String _headline(ai.AskAnswerView a) {
    final inc = a.query.io == 'inc';
    return switch (a.query.metric) {
      'count' => zh ? '共 ${a.count} 笔' : '${a.count} entries',
      'avg_day' => zh ? '平均每天 ${_m(a.value)}' : '${_m(a.value)} a day',
      'avg_entry' => zh ? '平均每笔 ${_m(a.value)}' : '${_m(a.value)} per entry',
      'max' => zh ? '最大一笔 ${_m(a.value)}' : 'Largest: ${_m(a.value)}',
      _ =>
        zh
            ? (inc ? '共收入 ${_m(a.value)}' : '共花了 ${_m(a.value)}')
            : (inc ? '${_m(a.value)} in' : '${_m(a.value)} spent'),
    };
  }

  @override
  Widget build(BuildContext context) {
    final p = palette;
    final a = turn.answer!;
    final q = a.query;
    final scope = [
      _range(q),
      q.io == 'inc' ? (zh ? '收入' : 'income') : (zh ? '支出' : 'spending'),
      ...a.catNames,
      if (q.keyword.isNotEmpty) zh ? '含「${q.keyword}」' : '"${q.keyword}"',
    ];
    final maxGroup = a.groups.isEmpty
        ? 0.0
        : a.groups.map((g) => g.amount).reduce((x, y) => x > y ? x : y);
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: BoxDecoration(
        color: p.card,
        borderRadius: BorderRadius.circular(Rad.lg),
        border: Border.all(color: p.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final s in scope)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: p.paperWarm,
                    borderRadius: BorderRadius.circular(Rad.pill),
                  ),
                  child: Text(
                    s,
                    style: TextStyle(fontSize: 11.5, color: p.inkSoft),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          if (a.count == 0)
            Text(
              zh ? '这段时间没有符合的记录' : 'Nothing matches in that span',
              key: const Key('ask-none'),
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: p.ink,
              ),
            )
          else ...[
            Text(
              _headline(a),
              key: const Key('ask-headline'),
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w800,
                fontFeatures: tabular,
                color: p.ink,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              [
                if (q.metric != 'count')
                  zh ? '${a.count} 笔' : '${a.count} entries',
                if (q.metric == 'avg_day')
                  zh ? '共 ${a.days} 天' : '${a.days} days',
                if (q.metric != 'sum' && q.metric != 'count')
                  zh ? '合计 ${_m(a.total)}' : 'total ${_m(a.total)}',
                if (a.share != null)
                  zh
                      ? '占${q.io == 'inc' ? '收入' : '支出'} ${(a.share! * 100).toStringAsFixed(a.share! < 0.1 ? 1 : 0)}%'
                      : '${(a.share! * 100).toStringAsFixed(0)}% of all',
              ].join(' · '),
              key: const Key('ask-detail'),
              style: TextStyle(
                fontSize: 12.5,
                color: p.inkSoft,
                fontFeatures: tabular,
              ),
            ),
          ],
          if (a.fellBack) ...[
            const SizedBox(height: 6),
            Text(
              zh
                  ? '账里没有写着这个词的记录，按「${a.catNames.join('、')}」算的'
                  : 'No note says that word, so this counts ${a.catNames.join(', ')}',
              key: const Key('ask-fellback'),
              style: TextStyle(fontSize: 12, color: p.inkSoft),
            ),
          ],
          if (a.groups.isNotEmpty) ...[
            const SizedBox(height: 12),
            for (final g in a.groups.take(q.group == 'category' ? 8 : 31))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    SizedBox(
                      width: q.group == 'category' ? 86 : 64,
                      child: Text(
                        q.group == 'category'
                            ? '${g.emoji} ${g.label}'
                            : _short(g.key),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 12.5, color: p.ink),
                      ),
                    ),
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(3),
                        child: LinearProgressIndicator(
                          value: maxGroup == 0 ? 0 : g.amount / maxGroup,
                          minHeight: 6,
                          backgroundColor: p.paperWarm,
                          color: g.color.isEmpty
                              ? p.hibiscus
                              : parseHex(g.color),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 84,
                      child: Text(
                        _m(g.amount),
                        textAlign: TextAlign.right,
                        style: TextStyle(
                          fontSize: 12.5,
                          fontFeatures: tabular,
                          color: p.ink,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
          if (a.top.isNotEmpty && (q.metric == 'max' || q.group == 'none')) ...[
            const SizedBox(height: 10),
            Divider(height: 1, color: p.line),
            for (final r in a.top.take(q.metric == 'max' ? 1 : 5))
              Tap(
                key: Key('ask-row-${r.id}'),
                filled: false,
                onTap: onOpen == null ? null : () => onOpen!(r.id),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Row(
                    children: [
                      Text(r.emoji, style: const TextStyle(fontSize: 16)),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          [
                            r.name,
                            if (r.note.isNotEmpty) r.note,
                            _short(r.day),
                          ].join(' · '),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 13, color: p.ink),
                        ),
                      ),
                      Text(
                        _m(r.amt),
                        style: TextStyle(
                          fontSize: 13,
                          fontFeatures: tabular,
                          color: p.ink,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
          const SizedBox(height: 8),
          Text(
            turn.failure != null
                ? (zh
                      ? '${failureText(turn.failure!, true)}，这次在本机理解的'
                      : '${failureText(turn.failure!, false)} — understood on the phone')
                : turn.byAi
                ? (zh
                      ? 'AI 理解的问题 · 在手机上算的'
                      : 'Question read by AI · counted on the phone')
                : (zh ? '本机理解的问题' : 'Understood on the phone'),
            key: const Key('ask-source'),
            style: TextStyle(
              fontSize: 11,
              color: turn.failure != null ? p.warnDeep : p.inkSoft,
            ),
          ),
        ],
      ),
    );
  }
}
