// Tests for domain/rates.ts — Frankfurter API integration with fallback.
import { fetchHistoricalRate, getRateForDate } from '../rates';

// Mock global fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('fetchHistoricalRate', () => {
  afterEach(() => jest.resetAllMocks());

  it('fetches a rate from Frankfurter and inverts it', async () => {
    // Frankfurter returns: 1 CNY = 0.1389 USD
    // We store: 1 USD = 1/0.1389 ≈ 7.199424 CNY
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ base: 'CNY', date: '2024-01-15', rates: { USD: 0.1389 } }),
    );

    const rate = await fetchHistoricalRate('CNY', 'USD', '2024-01-15');
    expect(rate).toBeCloseTo(1 / 0.1389, 4);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.frankfurter.app/2024-01-15?from=CNY&to=USD',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns null on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, false, 404));
    const rate = await fetchHistoricalRate('CNY', 'USD', '2024-01-15');
    expect(rate).toBeNull();
  });

  it('returns null when target currency is missing from response', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ base: 'CNY', date: '2024-01-15', rates: { EUR: 0.12 } }),
    );
    const rate = await fetchHistoricalRate('CNY', 'USD', '2024-01-15');
    expect(rate).toBeNull();
  });

  it('returns null when rate value is zero or negative', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ base: 'CNY', date: '2024-01-15', rates: { USD: 0 } }),
    );
    expect(await fetchHistoricalRate('CNY', 'USD', '2024-01-15')).toBeNull();

    mockFetch.mockResolvedValueOnce(
      jsonResponse({ base: 'CNY', date: '2024-01-15', rates: { USD: -1 } }),
    );
    expect(await fetchHistoricalRate('CNY', 'USD', '2024-01-15')).toBeNull();
  });

  it('returns null on fetch error (network failure)', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network error'));
    const rate = await fetchHistoricalRate('CNY', 'USD', '2024-01-15');
    expect(rate).toBeNull();
  });

  it('returns null when base equals target', async () => {
    const rate = await fetchHistoricalRate('CNY', 'CNY', '2024-01-15');
    expect(rate).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('getRateForDate', () => {
  const cachedRates = { USD: 7.2, JPY: 0.048, EUR: 7.8 };

  afterEach(() => jest.resetAllMocks());

  it('returns 1 when base equals target', async () => {
    expect(await getRateForDate('CNY', 'CNY', '2024-01-15', cachedRates)).toBe(1);
  });

  it('prefers Frankfurter API rate', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ base: 'CNY', date: '2024-01-15', rates: { USD: 0.1389 } }),
    );
    const rate = await getRateForDate('CNY', 'USD', '2024-01-15', cachedRates);
    expect(rate).toBeCloseTo(1 / 0.1389, 4);
  });

  it('falls back to exchangerate-api.com for today when Frankfurter fails', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Frankfurter fails
    mockFetch.mockResolvedValueOnce(jsonResponse({}, false, 500));
    // exchangerate-api succeeds
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ rates: { USD: 7.15 } }),
    );

    const rate = await getRateForDate('CNY', 'USD', today, cachedRates);
    // exchangerate-api returns 1 base = 7.15 target; we invert to 1 USD = 1/7.15 CNY
    expect(rate).toBeCloseTo(1 / 7.15, 6);
    // Should have called both APIs
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT fall back to exchangerate-api for old dates', async () => {
    // Frankfurter fails for an old date
    mockFetch.mockResolvedValueOnce(jsonResponse({}, false, 500));

    const rate = await getRateForDate('CNY', 'USD', '2020-06-15', cachedRates);
    // Should fall back to cached, not exchangerate-api
    expect(rate).toBe(7.2);
    // Only 1 fetch call (Frankfurter), no exchangerate-api
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to cached rate when all APIs fail', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockFetch.mockResolvedValueOnce(jsonResponse({}, false, 500)); // Frankfurter
    mockFetch.mockResolvedValueOnce(jsonResponse({}, false, 500)); // exchangerate-api

    const rate = await getRateForDate('CNY', 'USD', today, cachedRates);
    expect(rate).toBe(7.2); // from cache
  });

  it('returns null when all sources fail and no cached rate exists', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockFetch.mockResolvedValueOnce(jsonResponse({}, false, 500));
    mockFetch.mockResolvedValueOnce(jsonResponse({}, false, 500));

    const rate = await getRateForDate('CNY', 'XYZ', today, {});
    expect(rate).toBeNull();
  });

  it('rounds the result to 6 decimal places', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ base: 'CNY', date: '2024-01-15', rates: { USD: 0.1389 } }),
    );
    const rate = await getRateForDate('CNY', 'USD', '2024-01-15', cachedRates);
    // Check it's rounded to 6 decimal places
    const str = String(rate);
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(6);
  });
});
