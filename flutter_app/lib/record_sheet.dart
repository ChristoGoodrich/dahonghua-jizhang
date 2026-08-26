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
}

class RecordSheet extends StatefulWidget {
  const RecordSheet({super.key, this.zh = true, this.onSaved, this.editId});

  final bool zh;
  final void Function({required bool staleRate})? onSaved;

  /// The entry being edited, or null for a new one.
  ///
  /// Editing loads the source whole, date included — which is what separates it
  /// from 再记一笔, where the same fields land on a new row dated today.
  final String? editId;

  @override
  State<RecordSheet> createState() => _RecordSheetState();
}

class _RecordSheetState extends State<RecordSheet> {
  late record.FormView _form;
  final _note = TextEditingController();
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

  void _save() {
    final now = DateTime.now().millisecondsSinceEpoch;
    // The rate the entry's own date deserves would be fetched here; until that
    // HTTP is wired, the cached one is what there is — and saying so is the
    // whole point of `staleRate`.
    final cached = record.cachedRate(code: _form.cur);
    final r = record.saveForm(
      form: _form.copyWith(note: _note.text),
      editId: widget.editId ?? '',
      id: 'e${now}x${_form.amt.hashCode}',
      now: now,
      rateOverride: cached,
      rateWasCached: cached != null && _form.cur != record.baseCurrency(),
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
                    _directions(zh),
                    const SizedBox(height: 14),
                    _amount(total, showsTotal, accent),
                    const SizedBox(height: 14),
                    if (_form.io != 'xfer') _categories(zh, accent),
                    const SizedBox(height: 14),
                    _accountRow(zh, accent),
                    const SizedBox(height: 14),
                    _noteField(zh),
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
              child: GestureDetector(
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

  Widget _amount(double total, bool showsTotal, Color accent) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
    decoration: BoxDecoration(
      color: palette.card,
      borderRadius: BorderRadius.circular(Rad.lg),
      border: Border.all(color: palette.line),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(
          _form.amt.isEmpty ? '0' : _form.amt,
          key: const Key('amount-expr'),
          style: TextStyle(
            fontSize: 34,
            fontWeight: FontWeight.w700,
            fontFeatures: tabular,
            color: accent,
          ),
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
  );

  Widget _categories(bool zh, Color accent) {
    final cats = catalog.allCats(io: _form.io, custom: const []);
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final c in cats)
          GestureDetector(
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

  Widget _noteField(bool zh) => Semantics(
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
  );

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
      child: GestureDetector(
        key: Key('key-$k'),
        onTap: () => isSave ? _save() : _key(k),
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
