// analytics.ts sat at 20% coverage with a load-bearing gate: trackEvent returns
// on its first line until loadAnalytics() has run. That call was missing from
// boot entirely, so every event was dropped. These tests pin the gate itself —
// the boot wiring that satisfies it is covered in store/__tests__/hydrate.test.ts.
const KEY = 'dhh_analytics';

// jest.resetModules() hands the re-required analytics module a FRESH
// AsyncStorage mock with its own in-memory store, so the storage handle has to
// come from the same registry — a module-scope import would be a different
// instance and every read would come back empty.
function load() {
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports */
  const mod = require('@react-native-async-storage/async-storage');
  const analytics = require('../analytics');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { ...analytics, storage: mod.default ?? mod }; // CJS mock has no .default
}

describe('the loaded gate', () => {
  it('drops events until loadAnalytics has run', async () => {
    const a = load();
    a.trackEvent('too_early');
    expect(a.getEvents()).toHaveLength(0);

    await a.loadAnalytics();
    a.trackEvent('now_counted');
    expect(a.getEvents().map((e: { name: string }) => e.name)).toEqual(['now_counted']);
  });

  it('opens the gate even when storage is empty', async () => {
    const a = load();
    await a.loadAnalytics();
    a.trackEvent('x');
    expect(a.getEvents()).toHaveLength(1);
  });

  it('opens the gate even when storage holds junk', async () => {
    const a = load();
    await a.storage.setItem(KEY, 'not json{');
    await a.loadAnalytics(); // must not reject
    a.trackEvent('after_corrupt');
    expect(a.getEvents()).toHaveLength(1);
  });
});

describe('recording', () => {
  it('restores previously persisted events', async () => {
    const a = load();
    await a.storage.setItem(KEY, JSON.stringify([{ name: 'old', timestamp: 1 }]));
    await a.loadAnalytics();
    expect(a.getEvents()).toHaveLength(1);
  });

  it('stamps a timestamp and keeps properties optional', async () => {
    const a = load();
    await a.loadAnalytics();
    a.trackEvent('plain');
    a.trackEvent('with_props', { n: 1 });
    const [p, w] = a.getEvents();
    expect(p.timestamp).toBeGreaterThan(0);
    expect(p.properties).toBeUndefined();
    expect(w.properties).toEqual({ n: 1 });
  });

  it('writes through to storage, so the next launch can restore it', async () => {
    const a = load();
    await a.loadAnalytics();
    a.trackEvent('persisted');
    await new Promise((r) => setTimeout(r, 0)); // the write is fire-and-forget

    const raw = JSON.parse((await a.storage.getItem(KEY)) ?? '[]');
    expect(raw.map((e: { name: string }) => e.name)).toContain('persisted');
  });

  it('caps the log and keeps the NEWEST events', async () => {
    const a = load();
    await a.loadAnalytics();
    for (let i = 0; i < 1050; i++) a.trackEvent('e' + i);
    const ev = a.getEvents();
    expect(ev).toHaveLength(1000);
    expect(ev[ev.length - 1].name).toBe('e1049'); // newest retained
    expect(ev[0].name).toBe('e50'); // oldest dropped
  });

  it('hands out a copy, so callers cannot mutate the log', async () => {
    const a = load();
    await a.loadAnalytics();
    a.trackEvent('x');
    a.getEvents().push({ name: 'injected', timestamp: 0 });
    expect(a.getEvents()).toHaveLength(1);
  });

  it('clears', async () => {
    const a = load();
    await a.loadAnalytics();
    a.trackEvent('x');
    await a.clearEvents();
    expect(a.getEvents()).toHaveLength(0);
    expect(await a.storage.getItem(KEY)).toBeNull();
  });
});
