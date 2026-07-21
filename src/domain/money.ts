// Currency + formatting — ported from v7's toBase / fmt / fmtShort / curSymbol.
import type { Currencies } from './types';

export const CUR_NAMES: Record<string, string> = {
  CNY: '人民币 ¥', USD: '美元 $', AUD: '澳元 A$', EUR: '欧元 €', GBP: '英镑 £',
  JPY: '日元 ¥', HKD: '港币 HK$', KRW: '韩元 ₩', CAD: '加元 C$', SGD: '新元 S$',
};

const SYMBOLS: Record<string, string> = {
  CNY: '¥', USD: '$', AUD: 'A$', EUR: '€', GBP: '£',
  JPY: '¥', HKD: 'HK$', KRW: '₩', CAD: 'C$', SGD: 'S$',
};

export function curSymbol(code: string): string {
  return SYMBOLS[code] ?? code + ' ';
}

/** Convert a foreign amount into the base currency.
 *
 *  A missing rate falls through UNCONVERTED — which would store a foreign number
 *  as if it were base currency. Callers must not reach here without a rate; the
 *  record sheet blocks the save instead (see validationError). Kept permissive
 *  so pure formatting paths can't throw. */
export function toBase(amt: number, code: string | undefined, currencies: Currencies): number {
  const base = currencies.base || 'CNY';
  if (!code || code === base) return amt;
  const r = currencies.rates?.[code];
  return r ? amt * r : amt;
}

// The symbol every fmt()/fmtShort() call renders, driven by the user's base
// currency. Wired to the store at boot (see wireDisplaySymbol in store/ledger).
// Until set — and in unit tests — it falls back to the language default so the
// pure formatters keep working standalone.
let displaySymbol: string | null = null;

/** Point all money formatting at the base-currency symbol. Pass null to fall
 *  back to the per-language default. */
export function setDisplaySymbol(sym: string | null): void {
  displaySymbol = sym;
}

/** Display symbol for the active currency, falling back to the language default. */
export function curOf(lang: 'zh' | 'en'): string {
  return displaySymbol ?? (lang === 'zh' ? '￥' : '$');
}

/** Number-only formatting (no currency symbol) — for rows that render their own sign. */
export function fmtNum(n: number): string {
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmt(n: number, lang: 'zh' | 'en' = 'zh'): string {
  return curOf(lang) + fmtNum(n);
}

export function fmtShort(n: number, lang: 'zh' | 'en' = 'zh'): string {
  return curOf(lang) + Math.round(n).toLocaleString();
}
