// An amount, as 隐藏金额 allows it to be shown.
//
// The shipping app's eye hid the totals a person might not want read over
// their shoulder — 明细's summary, 资产's net worth and 账户's balances — and
// left the rows alone, because a ledger with every row starred out is not a
// ledger. One function, so the three screens cannot disagree about what a
// hidden amount looks like.

import 'src/rust/api/money.dart' as money;
import 'src/rust/api/privacy.dart' as privacy;

/// What a hidden amount reads as. The shipping app's.
const hiddenAmount = '****';

/// `money.fmt`, or [hiddenAmount] while the eye is shut.
String shownAmount(double n, String symbol) =>
    privacy.hideAmounts() ? hiddenAmount : money.fmt(n: n, symbol: symbol);

/// `money.fmtShort`, or [hiddenAmount] while the eye is shut.
String shownShort(double n, String symbol) => privacy.hideAmounts()
    ? hiddenAmount
    : money.fmtShort(n: n, symbol: symbol);
