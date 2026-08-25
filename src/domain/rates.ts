// Historical rate fetching via Frankfurter API (ECB data, free, no key).
// Rate convention: 1 foreign = N base — matching store$.currencies.rates.
// Frankfurter returns "1 base = X target", so we invert (1/X).
//
// The decisions live in the three pure functions at the top — what counts as a
// believable rate, whether a date is recent enough to justify the second
// source, and which of the three answers wins. Everything below them is
// transport. Splitting them that way is what lets the Rust port check the
// decisions against this file without either side needing a network.

const FRANKFURTER = 'https://api.frankfurter.app';
const EXCHANGERATE = 'https://api.exchangerate-api.com/v4/latest';
const TIMEOUT = 15000;

export type RateSource = 'identity' | 'historical' | 'live' | 'cache' | 'none';

/** Turn an API's "1 base = X target" into our "1 target = N base", or reject it.
 *
 *  A zero, a negative, an infinity, a NaN and anything that is not a number at
 *  all are all refused — the alternative is storing an infinite rate. */
export function invertRate(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  return +(1 / raw).toFixed(6);
}

/** Is `date` (YYYY-MM-DD) close enough to now to be worth asking the live-only
 *  source about?
 *
 *  This measures |now − midnight(date)| < 48h, which is not the same as "today
 *  or yesterday": the window is anchored to the current instant while dates sit
 *  at midnight, so the time of day counts against a past date and in favour of
 *  a future one. The day before yesterday is never inside it; two days ahead
 *  almost always is. Left as it is — the second source only serves live rates,
 *  so a generous window costs at most one request that returns nothing. */
export function isRecent(date: string, now: number = Date.now()): boolean {
  const d = new Date(date + 'T00:00:00');
  return Math.abs(now - d.getTime()) < 2 * 86400000;
}

/** Which of the three answers to believe, in order: the historical source, then
 *  the live one but only for recent dates, then whatever the store had.
 *
 *  `historical` and `live` are raw API numbers; `cached` is already in our
 *  convention and so is not inverted. */
export function resolveRate(
  sameCurrency: boolean,
  historical: unknown,
  liveAllowed: boolean,
  live: unknown,
  cached: number | undefined,
): { rate: number | null; source: RateSource } {
  if (sameCurrency) return { rate: 1, source: 'identity' };

  const h = invertRate(historical);
  if (h != null) return { rate: h, source: 'historical' };

  if (liveAllowed) {
    const l = invertRate(live);
    if (l != null) return { rate: l, source: 'live' };
  }

  return cached && Number.isFinite(cached) && cached > 0
    ? { rate: cached, source: 'cache' }
    : { rate: null, source: 'none' };
}

/** The raw `rates[target]` from a URL, or undefined on any failure. */
async function fetchRate(url: string, target: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return undefined;
    const j = await res.json();
    return j?.rates?.[target];
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a single historical rate from Frankfurter, inverted to our convention.
 *  Returns null on any failure. */
export async function fetchHistoricalRate(
  base: string,
  target: string,
  date: string,
): Promise<number | null> {
  if (base === target) return 1;
  return invertRate(await fetchRate(`${FRANKFURTER}/${date}?from=${base}&to=${target}`, target));
}

/** Fetch a rate for a specific date with fallback chain:
 *  1. Frankfurter for the exact date
 *  2. exchangerate-api.com (only for recent/today dates)
 *  3. Cached rate from store
 *
 *  `cachedRates` is the current store$.currencies.rates record. */
export async function getRateForDate(
  base: string,
  target: string,
  date: string,
  cachedRates: Record<string, number>,
): Promise<number | null> {
  if (base === target) return 1;

  const historical = await fetchRate(`${FRANKFURTER}/${date}?from=${base}&to=${target}`, target);
  const liveAllowed = isRecent(date);
  // the live source is only asked when the date is recent — and only when the
  // historical one gave nothing, which is what makes this ordering matter
  const live =
    liveAllowed && invertRate(historical) == null
      ? await fetchRate(`${EXCHANGERATE}/${base}`, target)
      : undefined;

  return resolveRate(false, historical, liveAllowed, live, cachedRates[target]).rate;
}
