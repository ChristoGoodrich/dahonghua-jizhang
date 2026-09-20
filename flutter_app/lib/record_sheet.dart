// The record sheet, in Dart over the Rust form.
//
// Same division as the entry list, and the same test of whether it held: this
// file has no idea what makes a form invalid, what a fresh one starts as, what
// switching to a transfer does to the account fields, or what shape reaches the
// ledger. It holds a `FormView`, hands it over, and draws what comes back.
//
// The keypad is the clearest case. `applyKey` is a Rust call per press, because
// what a '.' does after an existing '.' — or a 'back' on an empty string, or an
// operator after an operator — is behaviour the shipping app has and a second
// implementation would approximate.

import 'package:flutter/material.dart';

import 'src/rust/api/accounts.dart' as accounts;
import 'src/rust/api/calc.dart' as calc;
import 'src/rust/api/catalog.dart' as catalog;
import 'src/rust/api/money.dart' as money;
import 'src/rust/api/record.dart' as record;
import 'rate_fetch.dart';
import 'src/rust/api/currency.dart' as cur;
import 'src/rust/api/history.dart' as history;
import 'src/rust/api/rates.dart' as rates;
import 'date_field.dart';
import 'tap.dart';
import 'theme.dart';

/// The refusals `validate_form` can answer, spelled.
///
/// The core says *which* one applies; this says it in the reader's language.
/// A rejection is logic and crosses the boundary; a sentence is Intl and does
/// not.
String rejectionText(String kind, bool zh) {
  if (kind.startsWith('noRate:')) {
    final cur = kind.substring(7);
    return zh ? '$cur 暂无汇率,无法换算' : 'No exchange rate for $cur';
  }
  switch (kind) {
    case 'amount':
      return zh ? '请输入金额' : 'Enter an amount';
    case 'xferTo':
      return zh ? '请选择转入账户' : 'Pick a destination account';
    case 'xferSame':
      return zh ? '转入和转出不能是同一个账户' : 'Pick two different accounts';
    default:
      return kind;
  }
}

/// `copyWith` for the generated form.
///
/// flutter_rust_bridge generates a value class with a full constructor and no
/// copier, which is the right default — it mirrors a Rust struct, and Rust has
/// no copier either. This is Dart-side convenience over that value, and it
/// changes nothing about what the value *means*: every field it does not name
/// comes through untouched.
extension FormEdit on record.FormView {
  record.FormView copyWith({
    String? io,
    String? cat,
    String? amt,
    String? note,
    String? acct,
    String? acctTo,
    String? fee,
    String? discount,
    List<String>? tags,
    String? ledger,
    String? cur,
    String? subcat,
  }) => record.FormView(
    io: io ?? this.io,
    cat: cat ?? this.cat,
    amt: amt ?? this.amt,
    note: note ?? this.note,
    acct: acct ?? this.acct,
    acctTo: acctTo ?? this.acctTo,
    fee: fee ?? this.fee,
    discount: discount ?? this.discount,
    tags: tags ?? this.tags,
    ledger: ledger ?? this.ledger,
    cur: cur ?? this.cur,
    subcat: subcat ?? this.subcat,
    ts: ts,
  );

  /// The same form on another day. Separate from [copyWith] because `ts` is
  /// nullable there in the other sense — `null` means "leave it" — so
  /// copyWith cannot put a date on a form at all.
  record.FormView withTs(int ts) => record.FormView(
    io: io,
    cat: cat,
    amt: amt,
    note: note,
    acct: acct,
    acctTo: acctTo,
    fee: fee,
    discount: discount,
    tags: tags,
    ledger: ledger,
    // `this.` because `cur` is also the currency import's prefix in this
    // file, and without it the analyser reads the field as the library.
    cur: this.cur,
    subcat: subcat,
    ts: ts,
  );
}

class RecordSheet extends StatefulWidget {
  const RecordSheet({
    super.key,
    this.zh = true,
    this.onSaved,
    this.editId,
    this.fetchRate,
  });

  final bool zh;
  final void Function({required bool staleRate})? onSaved;

  /// The entry being edited, or null for a new one.
  ///
  /// Editing loads the source whole, date included — which is what separates it
  /// from 再记一笔, where the same fields land on a new row dated today.
  final String? editId;

  /// Where the exchange rate comes from. A test has no network, and the part
  /// worth testing is what this screen does with each answer.
  final Future<rates.ResolvedRate> Function({
    required String base,
    required String target,
    required String day,
    required String today,
    required int nowMinutes,
    double? cached,
  })?
  fetchRate;

  @override
  State<RecordSheet> createState() => _RecordSheetState();
}

class _RecordSheetState extends State<RecordSheet> {
  late record.FormView _form;
  final _note = TextEditingController();

  /// A rate request is in flight. The save button is held rather than
  /// disabled-looking: pressing twice would write the row twice.
  bool _fetching = false;
  String? _flash;
  bool _flashIsError = false;

  @override
  void initState() {
    super.initState();
    _loadForm();
  }

  @override
  void didUpdateWidget(RecordSheet old) {
    super.didUpdateWidget(old);
    // the shell reuses one sheet for every target, so switching which entry is
    // being edited has to reload the fields rather than keep the last one's
    if (old.editId != widget.editId) _loadForm();
  }

  void _loadForm() {
    final id = widget.editId ?? '';
    _form = record.initialForm(
      sourceId: id,
      editing: id.isNotEmpty,
      ledger: '',
    );
    _note.text = _form.note;
    _flash = null;
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  /// Every keypress goes through Rust. The expression grammar — what a second
  /// '.' does, what 'back' does to an empty string, what an operator does after
  /// an operator — is the shipping app's, and it is not obvious enough to write
  /// twice.
  void _key(String k) {
    setState(() {
      _form = _form.copyWith(
        amt: calc.applyKey(expr: _form.amt, key: k),
      );
      // A refusal about the amount stops being true the moment the amount
      // changes. The React Native sheet clears it on a timer because it is a
      // modal that comes and goes; this is a tab that stays, and a complaint
      // that outlives what it complained about is worse than no complaint.
      _flash = null;
    });
  }

  void _pick(String io) {
    setState(() {
      _form = record.pickDirection(next: io, form: _form);
      _flash = null;
    });
  }

  Future<void> _save() async {
    final now = DateTime.now().millisecondsSinceEpoch;
    final cached = record.cachedRate(code: _form.cur);
    final base = record.baseCurrency();
    final foreign = _form.cur != base;

    // Ask the network for the rate this entry's own DATE deserves. A cached
    // rate is today's, and an expense entered a week late converted at today's
    // rate is quietly the wrong number.
    //
    // Failing is ordinary. No signal, a captive portal, an API that is down:
    // `resolveRate` falls through to the cache and `staleRate` says so, which
    // is the same outcome this screen had before there was any fetching at all.
    var rate = cached;
    var wasCached = cached != null && foreign;
    if (foreign) {
      setState(() => _fetching = true);
      // An absent stamp is a form that has not been dated, which means now.
      final at = _form.ts == null
          ? DateTime.now()
          : DateTime.fromMillisecondsSinceEpoch(_form.ts!.toInt());
      final today = DateTime.now();
      final r = await (widget.fetchRate ?? fetchRate)(
        base: base,
        target: _form.cur,
        day: '${at.year}-${at.month}-${at.day}',
        today: '${today.year}-${today.month}-${today.day}',
        nowMinutes: today.hour * 60 + today.minute,
        cached: cached,
      );
      if (!mounted) return;
      setState(() => _fetching = false);
      rate = r.rate;
      // Only a rate that came from the cache is a stale one. A fetched rate
      // for the entry's own day is exactly right, and saying otherwise would
      // teach the user to ignore the notice.
      wasCached = r.source == 'cache';
    }

    final r = record.saveForm(
      form: _form.copyWith(note: _note.text),
      editId: widget.editId ?? '',
      id: 'e${now}x${_form.amt.hashCode}',
      now: now,
      rateOverride: rate,
      rateWasCached: wasCached,
    );

    if (r.rejected != null) {
      setState(() {
        _flash = rejectionText(r.rejected!, widget.zh);
        _flashIsError = true;
      });
      return;
    }

    // The entry is written. A stale rate is a notice about it, not a reason to
    // pretend otherwise — the TypeScript treated the two the same and wrote the
    // row twice when a user pressed save again.
    widget.onSaved?.call(staleRate: r.staleRate);
    if (widget.editId != null) {
      // an edit is finished when it is saved; there is no next one of the same
      // kind to type
      setState(() => _flash = widget.zh ? '已保存' : 'Saved');
      return;
    }
    setState(() {
      _form = record.clearForNext(form: _form);
      _note.clear();
      _flash = r.staleRate
          ? (widget.zh ? '已保存 · 使用了缓存汇率' : 'Saved · used a cached rate')
          : (widget.zh ? '已保存' : 'Saved');
      _flashIsError = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    final total = calc.evalExpr(expr: _form.amt);
    final showsTotal = calc.hasOperator(expr: _form.amt);
    final accent = _form.io == 'inc' ? palette.leafDeep : palette.hibiscus;

    return Scaffold(
      backgroundColor: palette.paper,
      appBar: AppBar(
        backgroundColor: palette.paper,
        surfaceTintColor: Colors.transparent,
        title: Text(
          widget.editId != null
              ? (zh ? '编辑' : 'Edit')
              : (zh ? '记一笔' : 'Record'),
          style: TextStyle(
            color: palette.ink,
            fontSize: 20,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 22),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _templateRow(zh),
                    _directions(zh),
                    const SizedBox(height: 14),
                    _amount(total, showsTotal, accent),
                    const SizedBox(height: 14),
                    if (_form.io != 'xfer') _categories(zh, accent),
                    const SizedBox(height: 14),
                    _accountRow(zh, accent),
                    const SizedBox(height: 14),
                    ..._currencyRow(zh, accent),
                    _noteField(zh),
                    _tagRow(zh, accent),
                    _ledgerRow(zh, accent),
                    if (_flash != null) _flashLine(),
                  ],
                ),
              ),
            ),
            _keypad(zh, accent),
          ],
        ),
      ),
    );
  }

  Widget _directions(bool zh) {
    final labels = {
      'exp': zh ? '支出' : 'Expense',
      'inc': zh ? '收入' : 'Income',
      'xfer': zh ? '转账' : 'Transfer',
    };
    return Row(
      children: [
        for (final io in ['exp', 'inc', 'xfer'])
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Tap(
                radius: Rad.sm,
                onTap: () => _pick(io),
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: _form.io == io ? palette.card : Colors.transparent,
                    borderRadius: BorderRadius.circular(Rad.sm),
                    border: Border.all(
                      color: _form.io == io ? palette.stamen : palette.line,
                      width: _form.io == io ? 1.5 : 1,
                    ),
                  ),
                  child: Text(
                    labels[io]!,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: _form.io == io
                          ? FontWeight.w700
                          : FontWeight.w500,
                      color: _form.io == io ? palette.ink : palette.inkSoft,
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  /// The amount, and the day it is on.
  ///
  /// The number sat alone at the right of an otherwise empty card, with no
  /// currency on it: a bare red 0. The left half now holds the date chip —
  /// the control the port had lost — and the number carries its symbol, in
  /// the entry's own currency when that is not the base one.
  Widget _amount(double total, bool showsTotal, Color accent) => Container(
    padding: const EdgeInsets.fromLTRB(14, 14, 16, 16),
    decoration: BoxDecoration(
      color: palette.card,
      borderRadius: BorderRadius.circular(Rad.lg),
      border: Border.all(color: palette.line),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DateChip(
          ts: _form.ts,
          accent: accent,
          zh: widget.zh,
          onChanged: (ts) => setState(() => _form = _form.withTs(ts)),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text(
                    money.curSymbol(code: _form.cur),
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w600,
                      color: accent.withValues(alpha: 0.7),
                    ),
                  ),
                  const SizedBox(width: 3),
                  Flexible(
                    child: Text(
                      _form.amt.isEmpty ? '0' : _form.amt,
                      key: const Key('amount-expr'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 34,
                        fontWeight: FontWeight.w700,
                        fontFeatures: tabular,
                        color: accent,
                      ),
                    ),
                  ),
                ],
              ),
              // the running total, only while the expression has an operator in
              // it — `hasOperator` is Rust's answer, not a `contains('+')`
              if (showsTotal)
                Text(
                  '= ${money.fmtNum(n: total)}',
                  style: TextStyle(
                    fontSize: 15,
                    fontFeatures: tabular,
                    color: palette.inkSoft,
                  ),
                ),
            ],
          ),
        ),
      ],
    ),
  );

  Widget _categories(bool zh, Color accent) {
    final cats = catalog.allCats(io: _form.io, custom: const []);
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final c in cats)
          Tap(
            radius: Rad.pill,
            onTap: () => setState(() => _form = _form.copyWith(cat: c.k)),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
              decoration: BoxDecoration(
                color: _form.cat == c.k
                    ? parseHex(c.c, opacity: 0.16)
                    : palette.card,
                borderRadius: BorderRadius.circular(Rad.pill),
                border: Border.all(
                  color: _form.cat == c.k ? parseHex(c.c) : palette.line,
                ),
              ),
              child: Text(
                '${c.e} ${catalog.catName(cat: c, zh: zh)}',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: _form.cat == c.k
                      ? FontWeight.w700
                      : FontWeight.w500,
                  color: palette.ink,
                ),
              ),
            ),
          ),
      ],
    );
  }

  /// The account the money leaves, and — for a transfer — the one it lands in.
  ///
  /// Without this a transfer cannot be saved at all: `validate` refuses one
  /// with no destination, and nothing else on the sheet can name one. The list
  /// is `pickable`, not every account: an archived account stays out of the
  /// picker but stays *in* it while it is the one selected, so editing an old
  /// entry does not silently move it somewhere else.
  Widget _accountRow(bool zh, Color accent) {
    final xfer = _form.io == 'xfer';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _acctLine(
          zh ? (xfer ? '转出' : '账户') : (xfer ? 'From' : 'Account'),
          'acct',
          _form.acct,
          accent,
          zh,
          (id) => _form = _form.copyWith(acct: id),
        ),
        if (xfer) ...[
          const SizedBox(height: 10),
          _acctLine(
            zh ? '转入' : 'To',
            'acct-to',
            _form.acctTo,
            accent,
            zh,
            (id) => _form = _form.copyWith(acctTo: id),
          ),
        ],
      ],
    );
  }

  Widget _acctLine(
    String label,
    String key,
    String selected,
    Color accent,
    bool zh,
    void Function(String) pick,
  ) {
    final options = accounts.pickable(selected: selected);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 40,
          child: Padding(
            padding: const EdgeInsets.only(top: 7),
            child: Text(
              label,
              style: TextStyle(fontSize: 12.5, color: palette.inkSoft),
            ),
          ),
        ),
        Expanded(
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final a in options)
                GestureDetector(
                  key: Key('$key-${a.id}'),
                  onTap: () => setState(() {
                    pick(a.id);
                    _flash = null;
                  }),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 11,
                      vertical: 7,
                    ),
                    decoration: BoxDecoration(
                      color: selected == a.id
                          ? accent.withValues(alpha: 0.14)
                          : palette.card,
                      borderRadius: BorderRadius.circular(Rad.pill),
                      border: Border.all(
                        color: selected == a.id ? accent : palette.line,
                      ),
                    ),
                    child: Text(
                      zh ? a.name : (a.nameEn ?? a.name),
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: selected == a.id
                            ? FontWeight.w700
                            : FontWeight.w500,
                        color: palette.ink,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  /// The pinned entries, as one-tap chips.
  ///
  /// A template fills the form rather than saving straight away — the amount is
  /// usually right and the note usually is not, and a chip that wrote a row on
  /// one tap would be a chip you could not correct.
  Widget _templateRow(bool zh) {
    // hidden while editing: a template is a way to start an entry, and the one
    // being edited has already started
    if (widget.editId != null) return const SizedBox.shrink();
    final list = catalog.templates();
    if (list.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: SizedBox(
        height: 32,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: list.length,
          separatorBuilder: (_, _) => const SizedBox(width: 8),
          itemBuilder: (_, i) {
            final t = list[i];
            final c = catalog.catOf(io: t.io, key: t.cat, custom: const []);
            final label = t.name.isEmpty
                ? catalog.catName(cat: c, zh: zh)
                : t.name;
            return Tap(
              radius: Rad.pill,
              key: Key('tpl-chip-${t.id}'),
              onTap: () => _applyTemplate(t.id),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 11),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: parseHex(c.c, opacity: 0.13),
                  borderRadius: BorderRadius.circular(Rad.pill),
                  border: Border.all(color: parseHex(c.c, opacity: 0.45)),
                ),
                child: Text(
                  '${c.e} $label',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: palette.ink,
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  /// Fill the form from a template.
  ///
  /// The draft is the core's: which account and which ledger it lands on, and
  /// the two fallbacks that point opposite ways — an absent note becomes an
  /// empty string, an empty ledger becomes absent.
  void _applyTemplate(String id) {
    final d = catalog.templateDraft(id: id);
    if (d == null) return;
    setState(() {
      _form = _form.copyWith(
        io: d.io,
        cat: d.cat,
        amt: money.plain(n: d.amt),
        note: d.note,
        acct: d.acct,
        ledger: d.ledger ?? '',
      );
      _note.text = d.note;
      _flash = null;
    });
  }

  /// Tags, multi-select. Absent entirely when none have been made.
  Widget _tagRow(bool zh, Color accent) {
    final all = catalog.tags();
    if (all.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final g in all)
            _pill(
              key: 'tag-chip-$g',
              label: g,
              on: _form.tags.contains(g),
              accent: accent,
              onTap: () => setState(() {
                final next = [..._form.tags];
                next.contains(g) ? next.remove(g) : next.add(g);
                _form = _form.copyWith(tags: next);
                _flash = null;
              }),
            ),
        ],
      ),
    );
  }

  /// Which book this entry is filed under. Single-select, and tapping the
  /// current one clears it — there is no "no ledger" chip to add.
  Widget _ledgerRow(bool zh, Color accent) {
    final all = catalog.pickableLedgers(keep: _form.ledger);
    if (all.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 40,
            child: Padding(
              padding: const EdgeInsets.only(top: 7),
              child: Text(
                zh ? '账本' : 'Book',
                style: TextStyle(fontSize: 12.5, color: palette.inkSoft),
              ),
            ),
          ),
          Expanded(
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final l in all)
                  _pill(
                    key: 'ledger-chip-$l',
                    label: l,
                    on: _form.ledger == l,
                    accent: accent,
                    onTap: () => setState(() {
                      _form = _form.copyWith(
                        ledger: _form.ledger == l ? '' : l,
                      );
                      _flash = null;
                    }),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _pill({
    required String key,
    required String label,
    required bool on,
    required Color accent,
    required VoidCallback onTap,
  }) => Tap(
    radius: Rad.pill,
    key: Key(key),
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
      decoration: BoxDecoration(
        color: on ? accent.withValues(alpha: 0.14) : palette.card,
        borderRadius: BorderRadius.circular(Rad.pill),
        border: Border.all(color: on ? accent : palette.line),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12.5,
          fontWeight: on ? FontWeight.w700 : FontWeight.w500,
          color: palette.ink,
        ),
      ),
    ),
  );

  /// Pin what is on the sheet as a template.
  ///
  /// A long press on the save key, which is where the shipping app puts it and
  /// which is why the templates screen says so when it is empty.
  Future<void> _saveAsTemplate() async {
    final zh = widget.zh;
    final amt = calc.evalExpr(expr: _form.amt);
    if (amt <= 0) {
      setState(() {
        _flash = zh ? '先输入金额' : 'Enter an amount first';
        _flashIsError = true;
      });
      return;
    }
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => _TemplateNameDialog(zh: zh),
    );
    if (name == null) return;
    catalog.addTemplate(
      id: 'tpl${DateTime.now().millisecondsSinceEpoch}',
      io: _form.io,
      cat: _form.cat,
      amt: amt,
      note: _note.text.isEmpty ? null : _note.text,
      name: name,
    );
    setState(() {
      _flash = zh ? '已存为模板' : 'Pinned as a template';
      _flashIsError = false;
    });
  }

  /// Which currency this entry is in.
  ///
  /// Absent entirely until a second currency is being tracked: a row of one
  /// chip is not a choice, and every ledger starts with exactly one currency.
  ///
  /// This is what makes the rate fetch reachable at all. Wiring the fetch
  /// without it would have been the same shape of mistake as an account model
  /// that carries a statement day nothing can set.
  List<Widget> _currencyRow(bool zh, Color accent) {
    final base = record.baseCurrency();
    final codes = [
      base,
      ...cur.rates().map((r) => r.code).where((c) => c != base),
    ];
    if (codes.length < 2) return const [];
    return [
      Row(
        children: [
          Text(
            zh ? '币种' : 'Currency',
            style: TextStyle(fontSize: 12, color: palette.inkSoft),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final c in codes)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: Tap(
                        radius: Rad.pill,
                        key: Key('cur-$c'),
                        onTap: () =>
                            setState(() => _form = _form.copyWith(cur: c)),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 5,
                          ),
                          decoration: BoxDecoration(
                            color: _form.cur == c
                                ? accent.withValues(alpha: 0.18)
                                : Colors.transparent,
                            borderRadius: BorderRadius.circular(Rad.pill),
                            border: Border.all(
                              color: _form.cur == c ? accent : palette.line,
                            ),
                          ),
                          child: Text(
                            c,
                            style: TextStyle(fontSize: 12, color: palette.ink),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
      const SizedBox(height: 14),
    ];
  }

  Widget _noteField(bool zh) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Semantics(
        label: zh ? '备注' : 'Note',
        textField: true,
        child: TextField(
          controller: _note,
          decoration: InputDecoration(
            hintText: zh ? '午饭、打车、房租…' : 'lunch, taxi, rent…',
            filled: true,
            fillColor: palette.card,
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(Rad.md),
              borderSide: BorderSide(color: palette.line),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(Rad.md),
              borderSide: BorderSide(color: palette.stamen, width: 2),
            ),
          ),
        ),
      ),
      ..._noteHints(zh),
    ],
  );

  /// What this category is usually called, learned from the ledger.
  ///
  /// Offered, never imposed: tapping one fills the box, and a user who wants
  /// something else types it. A category recorded for the first time has no
  /// history and shows nothing, which is the ordinary state and not a gap.
  List<Widget> _noteHints(bool zh) {
    // One more than the limit, because the note already in the box is dropped
    // and asking for four should still be able to show four.
    final typed = _note.text.trim();
    final hints = history
        .noteHints(io: _form.io, cat: _form.cat, limit: 5)
        // A chip offering exactly what is already written does nothing when
        // tapped. It is also the common case when EDITING: an entry's own note
        // is usually the most-used note for its category, so the sheet would
        // open offering the row back to itself.
        .where((h) => h != typed)
        .take(4)
        .toList();
    if (hints.isEmpty) return const [];
    return [
      const SizedBox(height: 8),
      Wrap(
        key: const Key('note-hints'),
        spacing: 8,
        runSpacing: 6,
        children: [
          for (final h in hints)
            Tap(
              radius: 999,
              key: Key('note-hint-$h'),
              onTap: () => setState(() => _note.text = h),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: palette.paperWarm,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: palette.line),
                ),
                child: Text(
                  h,
                  style: TextStyle(fontSize: 12.5, color: palette.ink),
                ),
              ),
            ),
        ],
      ),
    ];
  }

  Widget _flashLine() => Padding(
    padding: const EdgeInsets.only(top: 10),
    child: Text(
      _flash!,
      key: const Key('flash'),
      style: TextStyle(
        fontSize: 13,
        color: _flashIsError ? palette.hibiscus : palette.leafDeep,
      ),
    ),
  );

  Widget _keypad(bool zh, Color accent) {
    // The shipping keypad's layout and its key *names*, which are not the same
    // as its labels. `=` is the key `eq`, and the operators are `×` and `÷`
    // rather than `*` and `/` — `applyKey` matches on those exact characters,
    // so a keypad that sent `*` would have it appended as if it were a digit.
    // A screenshot found that: pressing `=` put a literal `=` in the amount.
    const rows = [
      [('7', '7'), ('8', '8'), ('9', '9'), ('÷', '÷')],
      [('4', '4'), ('5', '5'), ('6', '6'), ('×', '×')],
      [('1', '1'), ('2', '2'), ('3', '3'), ('−', '-')],
      [('.', '.'), ('0', '0'), ('⌫', 'back'), ('+', '+')],
      [('C', 'clear'), ('=', 'eq'), ('保存', 'save')],
    ];
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
      decoration: BoxDecoration(
        color: palette.paperWarm,
        border: Border(top: BorderSide(color: palette.line)),
      ),
      child: Column(
        children: [
          for (final row in rows)
            Row(
              children: [
                for (final (label, k) in row)
                  Expanded(
                    // the save key takes the width the fourth column would
                    flex: k == 'save' ? 2 : 1,
                    child: Padding(
                      padding: const EdgeInsets.all(4),
                      child: _key2(label, k, zh, accent),
                    ),
                  ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _key2(String label, String k, bool zh, Color accent) {
    final isSave = k == 'save';
    final shown = isSave ? (zh ? '保存' : 'Save') : label;
    // spelled out, because a screen reader saying "times" is not the same as
    // saying "x" — the shipping keypad labels these too
    final spoken = switch (k) {
      'back' => zh ? '删除' : 'Delete',
      'clear' => zh ? '清空' : 'Clear',
      'eq' => zh ? '等于' : 'Equals',
      '×' => zh ? '乘以' : 'Times',
      '÷' => zh ? '除以' : 'Divide',
      '+' => zh ? '加' : 'Plus',
      '-' => zh ? '减' : 'Minus',
      _ => shown,
    };
    return Semantics(
      button: true,
      label: spoken,
      // keyed: the keypad's '0' and '=' also appear in the amount panel above
      // it, so a finder that goes by text cannot say which one it means
      child: Tap(
        radius: Rad.md,
        key: Key('key-$k'),
        // Held while a rate is in flight: pressing twice would write twice.
        onTap: () => isSave ? (_fetching ? null : _save()) : _key(k),
        onLongPress: isSave ? _saveAsTemplate : null,
        child: Container(
          height: 52,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: isSave ? accent : palette.card,
            borderRadius: BorderRadius.circular(Rad.md),
            border: Border.all(color: isSave ? accent : palette.line),
          ),
          child: Text(
            shown,
            style: TextStyle(
              fontSize: isSave ? 16 : 20,
              fontWeight: FontWeight.w600,
              color: isSave ? Colors.white : palette.ink,
            ),
          ),
        ),
      ),
    );
  }
}

/// One field: what to call the template.
class _TemplateNameDialog extends StatefulWidget {
  const _TemplateNameDialog({required this.zh});

  final bool zh;

  @override
  State<_TemplateNameDialog> createState() => _TemplateNameDialogState();
}

class _TemplateNameDialogState extends State<_TemplateNameDialog> {
  final _name = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _submit() {
    // An empty name is allowed: the templates screen falls back to the category
    // name, so a nameless template is still a usable one.
    Navigator.pop(context, _name.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return AlertDialog(
      key: const Key('tpl-name-dialog'),
      backgroundColor: palette.card,
      title: Text(
        zh ? '存为模板' : 'Pin as template',
        style: TextStyle(fontSize: 16, color: palette.ink),
      ),
      content: TextField(
        key: const Key('tpl-name-field'),
        controller: _name,
        autofocus: true,
        cursorColor: palette.stamen,
        decoration: InputDecoration(
          labelText: zh ? '名字(可空)' : 'Name (optional)',
          labelStyle: TextStyle(color: palette.inkSoft),
          floatingLabelStyle: TextStyle(color: palette.stamen),
          focusedBorder: UnderlineInputBorder(
            borderSide: BorderSide(color: palette.stamen, width: 2),
          ),
        ),
        onSubmitted: (_) => _submit(),
      ),
      actions: [
        TextButton(
          key: const Key('tpl-name-cancel'),
          onPressed: () => Navigator.pop(context),
          style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
          child: Text(zh ? '取消' : 'Cancel'),
        ),
        TextButton(
          key: const Key('tpl-name-ok'),
          onPressed: _submit,
          style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
          child: Text(zh ? '存' : 'Pin'),
        ),
      ],
    );
  }
}
