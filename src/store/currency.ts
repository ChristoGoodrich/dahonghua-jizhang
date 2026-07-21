// Multi-currency actions — base currency, per-code rates, and rate refresh.
import { store$ } from './state';

/** Round money to cents, killing the float drift a divide introduces. */
function money(n: number): number {
  return Math.round(n * 100) / 100;
}

export type BaseSwitch = 'ok' | 'same' | 'no-rate';

/**
 * Switch the base currency, re-expressing every stored figure in the new unit.
 *
 * `Entry.amt` (and account balances, asset values, loan amounts, budgets…) are
 * defined as "in the user's base currency", so the base is the UNIT those raw
 * numbers are denominated in. Previously this only reassigned the label, which
 * silently reinterpreted the entire history — a ¥10,000 balance became $10,000
 * on a CNY→USD switch.
 *
 * Needs a rate for the incoming code (`rates[code]` = 1 code in old base) and
 * returns 'no-rate' when there isn't one, rather than corrupting the ledger.
 */
export function setBaseCurrency(code: string): BaseSwitch {
  const cur = store$.currencies.peek();
  const oldBase = cur.base || 'CNY';
  if (code === oldBase) return 'same';

  const rate = cur.rates?.[code]; // 1 `code` = `rate` oldBase
  if (!rate || !Number.isFinite(rate) || rate <= 0) return 'no-rate';

  const conv = (n: number) => money(n / rate);

  store$.data.set(
    store$.data.peek().map((d) => {
      // an entry originally typed in the incoming currency round-trips exactly
      const amt = d.cur === code && d.origAmt != null ? d.origAmt : conv(d.amt);
      const next = { ...d, amt };
      if (d.fee != null) next.fee = conv(d.fee);
      if (d.discount != null) next.discount = conv(d.discount);
      if (d.rbAmt != null) next.rbAmt = conv(d.rbAmt);
      if (d.refund != null) next.refund = conv(d.refund);
      // it is no longer "foreign" once its own currency became the base
      if (d.cur === code) {
        delete next.cur;
        delete next.origAmt;
      }
      return next;
    }),
  );

  store$.accounts.set(store$.accounts.peek().map((a) => ({ ...a, balance: conv(a.balance) })));
  store$.assets.set(store$.assets.peek().map((a) => ({ ...a, val: conv(a.val) })));
  store$.loans.set(
    store$.loans.peek().map((l) => ({ ...l, amt: conv(l.amt), ...(l.repaid != null ? { repaid: conv(l.repaid) } : {}) })),
  );
  store$.subs.set(store$.subs.peek().map((sb) => ({ ...sb, amt: conv(sb.amt) })));
  store$.templates.set(store$.templates.peek().map((tp) => ({ ...tp, amt: conv(tp.amt) })));

  const st = store$.settings.peek();
  const budgetPatch: Record<string, unknown> = { budget: conv(st.budget || 0) };
  if (st.dailyBudget != null) budgetPatch.dailyBudget = conv(st.dailyBudget);
  if (st.weeklyBudget != null) budgetPatch.weeklyBudget = conv(st.weeklyBudget);
  if (st.catBudgets) {
    budgetPatch.catBudgets = Object.fromEntries(
      Object.entries(st.catBudgets).map(([k, v]) => [k, conv(v)]),
    );
  }
  store$.settings.assign(budgetPatch);

  // re-anchor the rate table on the new base: every rate was "1 c = r oldBase",
  // and 1 oldBase = 1/rate newBase, so "1 c = r/rate newBase". The old base joins
  // the table; the new base leaves it (a base has no rate against itself).
  const nextRates: Record<string, number> = {};
  for (const [c, r] of Object.entries(cur.rates ?? {})) {
    if (c === code) continue;
    nextRates[c] = +(r / rate).toFixed(6);
  }
  nextRates[oldBase] = +(1 / rate).toFixed(6);

  store$.currencies.set({ base: code, rates: nextRates });
  return 'ok';
}

export function setRate(code: string, rate: number): void {
  store$.currencies.rates.set({ ...store$.currencies.rates.peek(), [code]: rate });
}

export function addRate(code: string): void {
  const rates = store$.currencies.rates.peek();
  if (!rates[code]) store$.currencies.rates.set({ ...rates, [code]: 1 });
}

export function removeRate(code: string): void {
  const rates = { ...store$.currencies.rates.peek() };
  delete rates[code];
  store$.currencies.rates.set(rates);
}

/** Refresh rates from a free exchange-rate API (1 foreign = ? base). */
export async function updateRates(): Promise<boolean> {
  const base = store$.currencies.base.peek() || 'CNY';
  const codes = Object.keys(store$.currencies.rates.peek());
  if (!codes.length) return false;
  // no cancel affordance in the UI, so a hung request needs a deadline
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${base}`, { signal: ctrl.signal });
    if (!res.ok) return false;
    const j = await res.json();
    if (!j?.rates || typeof j.rates !== 'object') return false;
    const rates = { ...store$.currencies.rates.peek() };
    let any = false;
    codes.forEach((c) => {
      const r = j.rates[c];
      // guard the divide: a 0/negative/non-numeric quote would poison the table
      if (typeof r === 'number' && Number.isFinite(r) && r > 0) {
        rates[c] = +(1 / r).toFixed(6);
        any = true;
      }
    });
    if (!any) return false;
    store$.currencies.rates.set(rates);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
