// An amount, as 隐藏金额 allows it to be shown.
//
// The shipping app's eye hid the totals a person might not want read over
// their shoulder — 明细's summary, 资产's net worth and 账户's balances — and
// left the rows alone, because a ledger with every row starred out is not a
// ledger. One function, so the three screens cannot disagree about what a
// hidden amount looks like.

import 'src/rust/api/currency.dart' as currency;
import 'src/rust/api/money.dart' as money;
import 'src/rust/api/privacy.dart' as privacy;

/// What a hidden amount reads as. The shipping app's.
const hiddenAmount = '****';

/// The base currency's symbol — `$`, `￥`, `€`…
///
/// Not the language's. A Chinese UI keeping a USD ledger has to read \$35,
/// not ￥35; tying the glyph to `zh` was fine while the only two options were
/// CNY and a wish, and wrong the day multi-currency shipped. The map lives in
/// `core::money::cur_symbol`; this keeps the fullwidth ￥ the shipping app
/// drew for CNY rather than the halfwidth the core returns.
String baseSymbol() {
  final code = currency.baseCurrency();
  if (code.isEmpty || code == 'CNY') return '￥';
  return money.curSymbol(code: code);
}

/// `money.fmt`, or [hiddenAmount] while the eye is shut.
String shownAmount(double n, String symbol) =>
    privacy.hideAmounts() ? hiddenAmount : money.fmt(n: n, symbol: symbol);

/// `money.fmt` against the base currency, or [hiddenAmount] while the eye is
/// shut.
String shownBase(double n) => shownAmount(n, baseSymbol());

/// `money.fmtShort`, or [hiddenAmount] while the eye is shut.
String shownShort(double n, String symbol) => privacy.hideAmounts()
    ? hiddenAmount
    : money.fmtShort(n: n, symbol: symbol);

/// `money.fmtShort` against the base currency.
String shownBaseShort(double n) => shownShort(n, baseSymbol());
