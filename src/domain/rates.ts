// Historical rate fetching via Frankfurter API (ECB data, free, no key).
// Rate convention: 1 foreign = N base — matching store$.currencies.rates.
// Frankfurter returns "1 base = X target", so we invert (1/X).

const FRANKFURTER = 'https://api.frankfurter.app';
const EXCHANGERATE = 'https://api.exchangerate-api.com/v4/latest';
const TIMEOUT = 15000;

/** Fetch a single historical rate from Frankfurter, inverted to our convention.
 *  Returns null on any failure. */
export async function fetchHistoricalRate(
  base: string,
  target: string,
  date: string,
): Promise<number | null> {
  if (base === target) return 1;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(
      `${FRANKFURTER}/${date}?from=${base}&to=${target}`,
      { signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const j = await res.json();
    const r = j?.rates?.[target];
    if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) return null;
    return +(1 / r).toFixed(6);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Is `date` (YYYY-MM-DD) today or yesterday in local time? */
function isRecent(date: string): boolean {
  const now = new Date();
  const d = new Date(date + 'T00:00:00');
  const diff = Math.abs(now.getTime() - d.getTime());
  return diff < 2 * 86400000; // within ~2 days
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

  // 1. Try Frankfurter
  const frank = await fetchHistoricalRate(base, target, date);
  if (frank != null) return frank;

  // 2. For recent dates, try exchangerate-api.com as backup
  if (isRecent(date)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(`${EXCHANGERATE}/${base}`, { signal: ctrl.signal });
      if (res.ok) {
        const j = await res.json();
        const r = j?.rates?.[target];
        if (typeof r === 'number' && Number.isFinite(r) && r > 0) {
          return +(1 / r).toFixed(6);
        }
      }
    } catch {
      // fall through to cache
    } finally {
      clearTimeout(timer);
    }
  }

  // 3. Fall back to cached rate
  const cached = cachedRates[target];
  return cached && Number.isFinite(cached) && cached > 0 ? cached : null;
}
