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

/** Convert a foreign amount into the base currency. */
export function toBase(amt: number, code: string | undefined, currencies: Currencies): number {
  const base = currencies.base || 'CNY';
  if (!code || code === base) return amt;
  const r = currencies.rates?.[code];
  return r ? amt * r : amt;
}

/** Display symbol for the active language ('¥' for zh, '$' for en — matches v7). */
export function curOf(lang: 'zh' | 'en'): string {
  return lang === 'zh' ? '￥' : '$';
}

export function fmt(n: number, lang: 'zh' | 'en' = 'zh'): string {
  return curOf(lang) + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtShort(n: number, lang: 'zh' | 'en' = 'zh'): string {
  return curOf(lang) + Math.round(n).toLocaleString();
}
