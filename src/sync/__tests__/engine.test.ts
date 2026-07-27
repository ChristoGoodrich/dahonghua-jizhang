// Orchestration coverage for the sync engine.
//
// merge.ts / rows.ts / pushScheduler.ts are pure and already tested; what was
// never exercised — by tests OR at runtime, since this machine has no Supabase
// credentials so `supabase` is null — is the code that stitches them together.
// That is also where the riskiest recent changes live: the root store
// subscription, the profiles realtime channel, and the applyingRemote guard.
//
// Supabase is faked at the module boundary. Each test re-requires the engine so
// its module-level state (activeUser, channels, the push scheduler's watermark)
// starts clean.

interface MockChannel {
  name: string;
  handlers: { cfg: Record<string, string>; handler: (payload: unknown) => void }[];
  subscribed: boolean;
}

interface MockState {
  entries: Record<string, unknown>[];
  profile: Record<string, unknown> | null;
  upserts: { table: string; payload: any; opts?: unknown }[];
  channels: MockChannel[];
  removed: string[];
  failPull: boolean;
  failPush: boolean;
  failConfigRead: boolean;
}

const mockBox: { client: unknown } = { client: null };

jest.mock('../supabase', () => ({
  isSyncConfigured: () => mockBox.client !== null,
  get supabase() {
    return mockBox.client;
  },
}));

function freshState(): MockState {
  return { entries: [], profile: null, upserts: [], channels: [], removed: [], failPull: false, failPush: false, failConfigRead: false };
}

function makeClient(state: MockState) {
  // `.select().eq()` is awaited directly for entries but chained into
  // `.maybeSingle()` for profiles, so the builder is both thenable and chainable.
  const query = (result: () => unknown) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: () => Promise.resolve(result()),
      then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
    };
    return q;
  };

  return {
    from(table: string) {
      return {
        select: () =>
          query(() =>
            table === 'entries'
              ? { data: state.entries, error: state.failPull ? new Error('pull failed') : null }
              : {
                  data: state.profile ? { config: state.profile } : null,
                  error: state.failConfigRead ? new Error('config read failed') : null,
                },
          ),
        upsert(payload: any, opts?: unknown) {
          state.upserts.push({ table, payload, opts });
          if (state.failPush) return Promise.resolve({ error: new Error('push failed') });
          if (table === 'profiles') state.profile = payload.config;
          return Promise.resolve({ error: null });
        },
      };
    },
    channel(name: string) {
      const ch: any = { name, handlers: [], subscribed: false };
      ch.on = (_evt: string, cfg: Record<string, string>, handler: (p: unknown) => void) => {
        ch.handlers.push({ cfg, handler });
        return ch;
      };
      ch.subscribe = () => {
        ch.subscribed = true;
        return ch;
      };
      state.channels.push(ch as MockChannel);
      return ch;
    },
    removeChannel(ch: MockChannel) {
      state.removed.push(ch.name);
    },
  };
}

const SESSION = { user: { id: 'u1' } };
const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1', user_id: 'u1', ts: 1000, io: 'exp', cat: 'food', amt: 10,
  subcat: null, cur: null, orig_amt: null, note: null, acct: null, acct_to: null,
  fee: null, discount: null, tags: null, ledger: null, rb: null, rb_amt: null,
  refund: null, refund_of: null, from_sub: null, deleted_at: null,
  updated_at: 5000, field_ts: null, ...over,
});

function boot(configure?: (s: MockState) => void) {
  jest.resetModules();
  const state = freshState();
  configure?.(state);
  mockBox.client = makeClient(state);

  const { store$, markDataReady } = require('@/store/ledger');
  markDataReady(); // the engine waits for the full local dataset before pulling
  const { auth$ } = require('../auth');
  const engine = require('../engine');
  return { state, store$, auth$, engine };
}

/** Run the engine to a settled state: microtasks flushed, push debounce elapsed. */
const settle = () => jest.advanceTimersByTimeAsync(1200);

async function signIn(ctx: ReturnType<typeof boot>) {
  ctx.engine.initSync();
  ctx.auth$.session.set(SESSION);
  await settle();
}

const profileUpserts = (s: MockState) => s.upserts.filter((u) => u.table === 'profiles');
const entryUpserts = (s: MockState) => s.upserts.filter((u) => u.table === 'entries');

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('start-up sequence', () => {
  it('pulls, merges the remote rows into the store, and reaches "synced"', async () => {
    const ctx = boot((s) => { s.entries = [row({ id: 'remote1' })]; });
    await signIn(ctx);

    expect(ctx.store$.data.peek().map((e: any) => e.id)).toContain('remote1');
    expect(ctx.engine.sync$.status.peek()).toBe('synced');
  });

  it('pushes local rows the server does not have', async () => {
    const ctx = boot();
    ctx.store$.data.set([{ id: 'local1', ts: 1, io: 'exp', cat: 'food', amt: 5, updatedAt: 9 }]);
    await signIn(ctx);

    const pushed = entryUpserts(ctx.state).flatMap((u) => u.payload.map((r: any) => r.id));
    expect(pushed).toContain('local1');
  });

  it('adopts the cloud config when a device joins an existing account', async () => {
    const ctx = boot((s) => {
      s.profile = { accounts: [{ id: 'a1', name: '云端账户', balance: 0 }], curLedger: '旅行' };
    });
    await signIn(ctx);

    expect(ctx.store$.accounts.peek()).toEqual([{ id: 'a1', name: '云端账户', balance: 0 }]);
    expect(ctx.store$.curLedger.peek()).toBe('旅行');
  });

  it('never lets the device lock cross the wire', async () => {
    const ctx = boot();
    ctx.store$.settings.assign({ lock: true });
    await signIn(ctx);

    const cfg = profileUpserts(ctx.state).at(-1)!.payload.config;
    expect(cfg.settings.lock).toBeUndefined();
    expect(ctx.store$.settings.lock.peek()).toBe(true); // still set locally
  });

  it('reports an error when the initial pull fails', async () => {
    const ctx = boot((s) => { s.failPull = true; });
    await signIn(ctx);
    expect(ctx.engine.sync$.status.peek()).toBe('error');
  });

  it('opens both realtime channels, each scoped to the signed-in user', async () => {
    const ctx = boot();
    await signIn(ctx);

    const names = ctx.state.channels.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['entries-sync', 'config-sync']));
    expect(ctx.state.channels.every((c) => c.subscribed)).toBe(true);

    const filters = ctx.state.channels.flatMap((c) => c.handlers.map((h) => h.cfg.filter));
    expect(filters).toEqual(expect.arrayContaining(['user_id=eq.u1', 'id=eq.u1']));
  });
});

// The bug this covers: the engine subscribed only to store$.data and
// store$.settings, but the config blob it uploads also carries accounts, assets,
// loans, subs, templates, tags, currencies, customCats, subcats, curLedger and
// lang. Creating an account and nothing else was never uploaded at all.
describe('config changes schedule a push', () => {
  it.each([
    ['accounts', (s: any) => s.accounts.set([{ id: 'a9', name: 'New', balance: 0 }])],
    ['tags', (s: any) => s.tags.set({ normal: ['x'], ledger: [] })],
    ['currencies', (s: any) => s.currencies.set({ base: 'USD', rates: {} })],
    ['subs', (s: any) => s.subs.set([{ id: 's1', name: 'N', emoji: '📺', amt: 1, freq: 'monthly', day: 1, cat: 'fun', created: 0 }])],
    ['templates', (s: any) => s.templates.set([{ id: 't1', io: 'exp', cat: 'food', amt: 1, name: 'T' }])],
    ['loans', (s: any) => s.loans.set([{ id: 'l1', who: 'A', type: 'lend', amt: 1, ts: 0 }])],
    ['curLedger', (s: any) => s.curLedger.set('旅行')],
    ['lang', (s: any) => s.lang.set('en')],
  ])('uploads after a %s-only change', async (_name, mutate) => {
    const ctx = boot();
    await signIn(ctx);
    const before = profileUpserts(ctx.state).length;

    mutate(ctx.store$);
    await settle();

    expect(profileUpserts(ctx.state).length).toBeGreaterThan(before);
  });

  it('still uploads on an entry change', async () => {
    const ctx = boot();
    await signIn(ctx);
    const before = entryUpserts(ctx.state).length;

    ctx.store$.data.set([{ id: 'e1', ts: 1, io: 'exp', cat: 'food', amt: 5, updatedAt: Date.now() }]);
    await settle();

    expect(entryUpserts(ctx.state).length).toBeGreaterThan(before);
  });
});

// Subscribing at the store root means a remote config written into the store
// looks exactly like a local edit. Without a guard the echo is pushed straight
// back, and two devices bounce updates off each other indefinitely.
describe('applyingRemote guard', () => {
  const fireConfig = (ctx: ReturnType<typeof boot>, config: unknown) => {
    const ch = ctx.state.channels.find((c) => c.name === 'config-sync')!;
    ch.handlers.forEach((h) => h.handler({ new: { config } }));
  };

  it('applies a remote config without pushing it back', async () => {
    const ctx = boot();
    await signIn(ctx);
    const before = profileUpserts(ctx.state).length;

    fireConfig(ctx, { accounts: [{ id: 'a2', name: '远端', balance: 0 }] });
    await settle();

    expect(ctx.store$.accounts.peek()).toEqual([{ id: 'a2', name: '远端', balance: 0 }]);
    expect(profileUpserts(ctx.state).length).toBe(before); // no echo
  });

  it('releases the guard so the next genuine local edit still pushes', async () => {
    const ctx = boot();
    await signIn(ctx);
    fireConfig(ctx, { accounts: [{ id: 'a2', name: '远端', balance: 0 }] });
    await settle();
    const before = profileUpserts(ctx.state).length;

    ctx.store$.accounts.set([{ id: 'a3', name: '本地', balance: 0 }]);
    await settle();

    expect(profileUpserts(ctx.state).length).toBeGreaterThan(before);
  });

  it('ignores an empty remote config', async () => {
    const ctx = boot();
    await signIn(ctx);
    const accounts = ctx.store$.accounts.peek();

    fireConfig(ctx, {});
    await settle();

    expect(ctx.store$.accounts.peek()).toEqual(accounts);
  });

  it('keeps the local lock when a remote config lands', async () => {
    const ctx = boot();
    ctx.store$.settings.assign({ lock: true });
    await signIn(ctx);

    fireConfig(ctx, { settings: { budget: 500, cycleStart: 1, theme: 'default', dark: false } });
    await settle();

    expect(ctx.store$.settings.lock.peek()).toBe(true);
    expect(ctx.store$.settings.budget.peek()).toBe(500);
  });
});

// Whole-blob LWW clobbered concurrent edits to DIFFERENT sections: A adds an
// account, B renames a tag, last push erased the other's change. Each section
// now carries a timestamp; a remote section is adopted only when newer.
describe('per-section config merge', () => {
  const fireConfig = (ctx: ReturnType<typeof boot>, config: unknown) => {
    const ch = ctx.state.channels.find((c) => c.name === 'config-sync')!;
    ch.handlers.forEach((h) => h.handler({ new: { config } }));
  };

  it('a stale remote section does not clobber a locally-newer edit', async () => {
    const ctx = boot();
    ctx.store$.hydrated.set(true); // stamps only track post-hydration edits
    await signIn(ctx);
    ctx.store$.accounts.set([{ id: 'mine', name: '本地', balance: 0 }]); // stamped now
    await settle();

    fireConfig(ctx, { accounts: [{ id: 'stale', name: '远端旧', balance: 0 }], configTs: { accounts: 1 } });
    await settle();

    expect(ctx.store$.accounts.peek()[0].id).toBe('mine');
  });

  it('adopts remotely-newer sections while keeping locally-newer ones', async () => {
    const ctx = boot();
    ctx.store$.hydrated.set(true);
    await signIn(ctx);
    ctx.store$.accounts.set([{ id: 'mine', name: '本地', balance: 0 }]);
    await settle();

    fireConfig(ctx, {
      accounts: [{ id: 'stale', name: '远端旧', balance: 0 }],
      tags: { normal: ['远端'], ledger: [] },
      configTs: { accounts: 1, tags: Date.now() + 60_000 },
    });
    await settle();

    expect(ctx.store$.accounts.peek()[0].id).toBe('mine'); // local newer → kept
    expect(ctx.store$.tags.peek().normal).toEqual(['远端']); // remote newer → adopted
  });

  it('pushes back when the remote blob lags local edits', async () => {
    const ctx = boot();
    ctx.store$.hydrated.set(true);
    await signIn(ctx);
    ctx.store$.accounts.set([{ id: 'mine', name: '本地', balance: 0 }]);
    await settle();
    const before = profileUpserts(ctx.state).length;

    fireConfig(ctx, { accounts: [{ id: 'stale', name: '远端旧', balance: 0 }], configTs: { accounts: 1 } });
    await settle();

    // ours is newer → keep it AND re-push so the server converges on it
    expect(profileUpserts(ctx.state).length).toBeGreaterThan(before);
  });

  it('uploads the section stamps with the config blob', async () => {
    const ctx = boot();
    ctx.store$.hydrated.set(true);
    await signIn(ctx);
    ctx.store$.accounts.set([{ id: 'a9', name: 'X', balance: 0 }]);
    await settle();

    const cfg = profileUpserts(ctx.state).at(-1)!.payload.config;
    expect(cfg.configTs.accounts).toBeGreaterThan(0);
  });
});

describe('entries realtime', () => {
  const fireEntry = (ctx: ReturnType<typeof boot>, r: unknown) => {
    const ch = ctx.state.channels.find((c) => c.name === 'entries-sync')!;
    ch.handlers.forEach((h) => h.handler({ new: r }));
  };

  it('inserts a row it has not seen', async () => {
    const ctx = boot();
    await signIn(ctx);

    fireEntry(ctx, row({ id: 'new1', updated_at: 8000 }));

    expect(ctx.store$.data.peek().map((e: any) => e.id)).toContain('new1');
  });

  it('applies a newer version of a row it already has', async () => {
    const ctx = boot();
    ctx.store$.data.set([{ id: 'r1', ts: 1000, io: 'exp', cat: 'food', amt: 10, updatedAt: 1 }]);
    await signIn(ctx);

    fireEntry(ctx, row({ id: 'r1', amt: 99, updated_at: 9999 }));

    expect(ctx.store$.data.peek().find((e: any) => e.id === 'r1').amt).toBe(99);
  });

  it('ignores a stale version', async () => {
    const ctx = boot();
    ctx.store$.data.set([{ id: 'r1', ts: 1000, io: 'exp', cat: 'food', amt: 10, updatedAt: 9999 }]);
    await signIn(ctx);

    fireEntry(ctx, row({ id: 'r1', amt: 1, updated_at: 5 }));

    expect(ctx.store$.data.peek().find((e: any) => e.id === 'r1').amt).toBe(10);
  });

  it('shrugs off a malformed payload', async () => {
    const ctx = boot();
    await signIn(ctx);
    const before = ctx.store$.data.peek().length;

    expect(() => {
      fireEntry(ctx, undefined);
      fireEntry(ctx, {});
    }).not.toThrow();
    expect(ctx.store$.data.peek()).toHaveLength(before);
  });
});

describe('sign-out', () => {
  it('removes both channels and stops pushing', async () => {
    const ctx = boot();
    await signIn(ctx);

    ctx.auth$.session.set(null);
    await settle();

    expect(ctx.state.removed).toEqual(expect.arrayContaining(['entries-sync', 'config-sync']));
    expect(ctx.engine.sync$.status.peek()).toBe('off');

    const before = ctx.state.upserts.length;
    ctx.store$.accounts.set([{ id: 'after', name: 'After', balance: 0 }]);
    await settle();
    expect(ctx.state.upserts.length).toBe(before); // the root subscription is gone
  });
});

describe('failure handling', () => {
  // Both of these were silently swallowed before the orchestration was covered.
  it('surfaces a failed CONFIG push instead of reporting success', async () => {
    const ctx = boot((s) => { s.failPush = true; });
    await signIn(ctx);

    // an accounts-only change pushes config but no entries, so this is the
    // path that used to report "synced" while the upload had actually failed
    ctx.store$.accounts.set([{ id: 'a9', name: 'X', balance: 0 }]);
    await settle();

    expect(ctx.engine.sync$.status.peek()).toBe('error');
  });

  it('does not overwrite an existing cloud config when the config READ fails', async () => {
    const ctx = boot((s) => {
      s.profile = { accounts: [{ id: 'cloud', name: '云端', balance: 0 }] };
      s.failConfigRead = true;
    });
    await signIn(ctx);

    // a failed read is indistinguishable from "no config yet", so the device
    // used to skip adopting the cloud config and push its own defaults over it
    expect(ctx.state.profile).toEqual({ accounts: [{ id: 'cloud', name: '云端', balance: 0 }] });
    expect(ctx.engine.sync$.status.peek()).toBe('error');
  });

  it('goes to "error" when a push fails, and recovers on retry', async () => {
    const ctx = boot((s) => { s.failPush = true; });
    await signIn(ctx);

    ctx.store$.accounts.set([{ id: 'a9', name: 'X', balance: 0 }]);
    await settle();
    expect(ctx.engine.sync$.status.peek()).toBe('error');

    ctx.state.failPush = false;
    ctx.engine.retrySync();
    await settle();
    expect(ctx.engine.sync$.status.peek()).toBe('synced');
  });
});

describe('when Supabase is not configured', () => {
  it('initSync is inert and the app stays offline', async () => {
    jest.resetModules();
    mockBox.client = null;
    const { store$ } = require('@/store/ledger');
    const engine = require('../engine');

    expect(() => engine.initSync()).not.toThrow();
    store$.accounts.set([{ id: 'a1', name: 'Local only', balance: 0 }]);
    await jest.advanceTimersByTimeAsync(1200);

    expect(engine.sync$.status.peek()).toBe('off');
  });
});
