// 币种 — the rate table, and the unit everything is denominated in.
//
// Switching the base is the most dangerous thing this app can do, and the
// danger is in the data model rather than the code: entry amounts, account
// balances, asset values, loan amounts, subscription charges, template amounts
// and budgets are all defined as "in the base currency". The base is not a
// label on those numbers — it is the unit they are in.
//
// So the switch rewrites every one of them or refuses, and this screen asks
// twice before it lets you. What it does NOT do is decide anything about the
// conversion: it hands over a code and shows what came back.

import 'package:flutter/material.dart';

import 'src/rust/api/currency.dart' as cur;
import 'glass.dart';
import 'theme.dart';

class CurrencyScreen extends StatefulWidget {
  const CurrencyScreen({super.key, this.zh = true, this.onChanged});

  final bool zh;

  /// The rate table changed, or the base did — a base switch rewrites the
  /// ledger too.
  final void Function({required bool ledgerToo})? onChanged;

  @override
  State<CurrencyScreen> createState() => _CurrencyScreenState();
}

class _CurrencyScreenState extends State<CurrencyScreen> {
  List<cur.RateView> _rates = const [];
  String _base = 'CNY';
  String? _flash;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    setState(() {
      _rates = cur.rates();
      _base = cur.baseCurrency();
    });
  }

  void _changed({bool ledgerToo = false}) {
    widget.onChanged?.call(ledgerToo: ledgerToo);
    _reload();
  }

  Future<void> _add() async {
    final zh = widget.zh;
    // The base is excluded as well as the tracked codes. A base has no rate
    // against itself — the core drops it from the table on every switch — so
    // offering it here would let someone put it back in.
    final tracked = _rates.map((r) => r.code).toSet()..add(_base);
    final offer = cur
        .knownCurrencies()
        .where((c) => !tracked.contains(c.code))
        .toList();
    if (offer.isEmpty) {
      setState(() => _flash = zh ? '已经全都在了' : 'All of them are already here');
      return;
    }
    final code = await showDialog<String>(
      context: context,
      builder: (ctx) => SimpleDialog(
        key: const Key('pick-currency'),
        backgroundColor: palette.card,
        title: Text(
          zh ? '添加币种' : 'Add a currency',
          style: TextStyle(fontSize: 16, color: palette.ink),
        ),
        children: [
          for (final c in offer)
            SimpleDialogOption(
              key: Key('pick-${c.code}'),
              onPressed: () => Navigator.pop(ctx, c.code),
              child: Text(
                '${c.code} · ${cur.currencyName(code: c.code)}',
                style: TextStyle(fontSize: 14, color: palette.ink),
              ),
            ),
        ],
      ),
    );
    if (code == null) return;
    // Added at parity, which is a placeholder rather than a claim — the rate
    // is the next thing the user edits.
    cur.addRate(code: code);
    setState(() => _flash = null);
    _changed();
  }

  /// Switching the base asks twice, and says what it would do in between.
  Future<void> _switchBase(cur.RateView r) async {
    final zh = widget.zh;
    if (r.isBase) return;
    if (r.rate <= 0) {
      setState(
        () => _flash = zh
            ? '${r.code} 还没有汇率,先填一个'
            : 'No rate for ${r.code} yet — set one first',
      );
      return;
    }

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        key: const Key('base-dialog'),
        backgroundColor: palette.card,
        title: Text(
          zh ? '换成 ${r.code}?' : 'Switch to ${r.code}?',
          style: TextStyle(fontSize: 16, color: palette.ink),
        ),
        content: Text(
          zh
              ? '每一笔记录、每个账户余额、资产、借贷、订阅、模板和预算都会按 1 ${r.code} = ${r.rate} $_base 重新换算。这不是改个标签,是改单位。'
              : 'Every entry, balance, asset, loan, subscription, template and '
                    'budget is re-expressed at 1 ${r.code} = ${r.rate} $_base. '
                    'This changes the unit, not the label.',
          style: TextStyle(fontSize: 13.5, color: palette.inkSoft),
        ),
        actions: [
          TextButton(
            key: const Key('base-cancel'),
            onPressed: () => Navigator.pop(ctx, false),
            style: TextButton.styleFrom(foregroundColor: palette.inkSoft),
            child: Text(zh ? '取消' : 'Cancel'),
          ),
          TextButton(
            key: const Key('base-ok'),
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: palette.hibiscus),
            child: Text(zh ? '换' : 'Switch'),
          ),
        ],
      ),
    );
    if (ok != true) return;

    final result = cur.setBaseCurrency(
      code: r.code,
      now: DateTime.now().millisecondsSinceEpoch,
    );
    setState(() {
      _flash = switch (result) {
        'ok' => zh ? '已换成 ${r.code}' : 'Now in ${r.code}',
        'same' => null,
        // The core refuses rather than corrupting, and the screen says which
        // of the two happened rather than reporting a generic failure.
        _ =>
          zh
              ? '${r.code} 没有可用汇率,没有改动'
              : 'No usable rate for ${r.code} — nothing changed',
      };
    });
    if (result == 'ok') _changed(ledgerToo: true);
  }

  @override
  Widget build(BuildContext context) {
    final zh = widget.zh;
    return ScrimScaffold(
      title: Text(
        zh ? '币种与汇率' : 'Currencies',
        style: TextStyle(
          color: palette.ink,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),
      actions: [
        IconButton(
          key: const Key('add-currency'),
          icon: Icon(Icons.add, color: palette.ink),
          onPressed: _add,
        ),
      ],
      body: ListView(
        padding: EdgeInsets.fromLTRB(22, headerInset(context) + 6, 22, 120),
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: palette.card,
              borderRadius: BorderRadius.circular(Rad.lg),
              border: Border.all(color: palette.line),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  zh ? '记账单位' : 'Base currency',
                  style: TextStyle(fontSize: 12, color: palette.inkSoft),
                ),
                const SizedBox(height: 3),
                Text(
                  '$_base · ${cur.currencyName(code: _base)}',
                  key: const Key('base-currency'),
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: palette.ink,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  zh
                      ? '所有金额都以它为单位。换单位会重算全部历史。'
                      : 'Every amount is in this unit. Switching re-expresses all history.',
                  style: TextStyle(fontSize: 11.5, color: palette.inkSoft),
                ),
              ],
            ),
          ),
          if (_flash != null) ...[
            const SizedBox(height: 10),
            Text(
              _flash!,
              key: const Key('cur-flash'),
              style: TextStyle(fontSize: 12.5, color: palette.hibiscus),
            ),
          ],
          const SizedBox(height: 20),
          Padding(
            padding: const EdgeInsets.only(left: 2, bottom: 10),
            child: Text(
              zh ? '汇率' : 'Rates',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: palette.inkSoft,
              ),
            ),
          ),
          if (_rates.isEmpty)
            Padding(
              padding: const EdgeInsets.only(left: 2),
              child: Text(
                zh ? '还没有别的币种' : 'No other currencies yet',
                key: const Key('no-rates'),
                style: TextStyle(fontSize: 12.5, color: palette.inkSoft),
              ),
            ),
          for (final r in _rates) _row(r, zh),
        ],
      ),
    );
  }

  Widget _row(cur.RateView r, bool zh) => Padding(
    key: Key('rate-${r.code}'),
    padding: const EdgeInsets.only(bottom: 10),
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: palette.card,
        borderRadius: BorderRadius.circular(Rad.md),
        border: Border.all(
          color: r.isBase ? palette.stamen : palette.line,
          width: r.isBase ? 1.5 : 1,
        ),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 84,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${r.symbol} ${r.code}',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: palette.ink,
                  ),
                ),
                if (r.isBase)
                  Text(
                    zh ? '记账单位' : 'Base',
                    style: TextStyle(fontSize: 10.5, color: palette.stamen),
                  ),
              ],
            ),
          ),
          Expanded(
            child: r.isBase
                // the base is 1 of itself by definition, and an editable
                // field there would invite a number that means nothing
                // Only reachable from a config that carried the base in its
                // own table: the core drops it on every switch, and the
                // picker will not offer it. Drawn rather than hidden, because
                // a row that silently vanished would read as data loss.
                ? Text(
                    '1',
                    key: Key('rate-${r.code}-fixed'),
                    style: TextStyle(
                      fontSize: 14,
                      fontFeatures: tabular,
                      color: palette.inkSoft,
                    ),
                  )
                : _RateField(
                    // remounted when the value changes underneath — a base
                    // switch rewrites every rate at once
                    key: ValueKey('${r.code}-${r.rate}'),
                    initial: r.rate,
                    onChanged: (v) {
                      cur.setRate(code: r.code, rate: v);
                      widget.onChanged?.call(ledgerToo: false);
                    },
                  ),
          ),
          if (!r.isBase) ...[
            IconButton(
              key: Key('rate-${r.code}-base'),
              tooltip: zh ? '设为记账单位' : 'Make base',
              icon: Icon(Icons.swap_horiz, size: 19, color: palette.inkSoft),
              onPressed: () => _switchBase(r),
            ),
            IconButton(
              key: Key('rate-${r.code}-delete'),
              tooltip: zh ? '删除' : 'Delete',
              icon: Icon(
                Icons.delete_outline,
                size: 19,
                color: palette.hibiscus,
              ),
              onPressed: () {
                cur.removeRate(code: r.code);
                _changed();
              },
            ),
          ],
        ],
      ),
    ),
  );
}

/// One rate, editable.
///
/// Its own widget so it owns its controller, and keyed on the value from Rust
/// so a base switch — which rewrites every rate at once — remounts it rather
/// than leaving a stale number in the field.
class _RateField extends StatefulWidget {
  const _RateField({super.key, required this.initial, required this.onChanged});

  final double initial;
  final void Function(double) onChanged;

  @override
  State<_RateField> createState() => _RateFieldState();
}

class _RateFieldState extends State<_RateField> {
  late final TextEditingController _c = TextEditingController(
    text: _show(widget.initial),
  );

  /// Trailing zeros dropped: `7.2`, not `7.200000`.
  static String _show(double v) {
    final s = v.toStringAsFixed(6);
    return s.contains('.')
        ? s.replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '')
        : s;
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => TextField(
    controller: _c,
    keyboardType: const TextInputType.numberWithOptions(decimal: true),
    textAlign: TextAlign.right,
    cursorColor: palette.stamen,
    style: TextStyle(fontSize: 14, fontFeatures: tabular, color: palette.ink),
    decoration: InputDecoration(
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(vertical: 6),
      enabledBorder: UnderlineInputBorder(
        borderSide: BorderSide(color: palette.line),
      ),
      focusedBorder: UnderlineInputBorder(
        borderSide: BorderSide(color: palette.stamen, width: 2),
      ),
    ),
    // On submit rather than on every keystroke: `set_rate` does no
    // validation by design, and half a typed number is not a rate.
    onSubmitted: (v) {
      final n = double.tryParse(v.replaceAll(',', ''));
      if (n != null) widget.onChanged(n);
    },
    onTapOutside: (_) {
      final n = double.tryParse(_c.text.replaceAll(',', ''));
      if (n != null) widget.onChanged(n);
      FocusScope.of(context).unfocus();
    },
  );
}
