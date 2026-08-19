// Auth coverage. Every function here is a thin wrapper over the Supabase auth
// API, and each one has an unconfigured path that the UI relies on: the sign-in
// screen calls these unconditionally, so a machine with no credentials must get
// a clean `false`/no-op rather than a crash. Supabase is faked at the module
// boundary the same way engine.test.ts does it, and the module is re-required
// per test so `auth$` starts empty.

interface MockAuth {
  session: unknown;
  otpError: unknown;
  verifyError: unknown;
  calls: { fn: string; arg?: unknown }[];
  listener: ((event: string, session: unknown) => void) | null;
}

const mockBox: { client: unknown; auth: MockAuth } = { client: null, auth: null as never };

jest.mock('../supabase', () => ({
  isSyncConfigured: () => mockBox.client !== null,
  get supabase() {
    return mockBox.client;
  },
}));

function freshAuth(): MockAuth {
  return { session: null, otpError: null, verifyError: null, calls: [], listener: null };
}

function makeClient(a: MockAuth) {
  return {
    auth: {
      getSession: async () => {
        a.calls.push({ fn: 'getSession' });
        return { data: { session: a.session } };
      },
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        a.listener = cb;
        a.calls.push({ fn: 'onAuthStateChange' });
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signInWithOtp: async (arg: unknown) => {
        a.calls.push({ fn: 'signInWithOtp', arg });
        return { error: a.otpError };
      },
      verifyOtp: async (arg: unknown) => {
        a.calls.push({ fn: 'verifyOtp', arg });
        return { error: a.verifyError };
      },
      signOut: async () => {
        a.calls.push({ fn: 'signOut' });
        return { error: null };
      },
    },
  };
}

const SESSION = { user: { email: 'Ann@Example.com' } };

function load(configure?: (a: MockAuth) => void) {
  jest.resetModules();
  const a = freshAuth();
  configure?.(a);
  mockBox.auth = a;
  mockBox.client = makeClient(a);
   
  const mod = require('../auth') as typeof import('../auth');
  return { a, mod };
}

function loadUnconfigured() {
  jest.resetModules();
  mockBox.client = null;
   
  return require('../auth') as typeof import('../auth');
}

describe('auth with sync unconfigured', () => {
  it('initAuth is a no-op and leaves the observable empty', async () => {
    const mod = loadUnconfigured();
    await mod.initAuth();
    expect(mod.auth$.session.peek()).toBeNull();
    expect(mod.auth$.email.peek()).toBeNull();
  });

  it('sendOtp returns false without touching the network', async () => {
    const mod = loadUnconfigured();
    expect(await mod.sendOtp('a@b.com')).toBe(false);
  });

  it('verifyOtp returns false', async () => {
    const mod = loadUnconfigured();
    expect(await mod.verifyOtp('a@b.com', '123456')).toBe(false);
  });

  it('signOut resolves without throwing', async () => {
    const mod = loadUnconfigured();
    await expect(mod.signOut()).resolves.toBeUndefined();
  });

  it('isSignedIn is false', () => {
    const mod = loadUnconfigured();
    expect(mod.isSignedIn()).toBe(false);
  });
});

describe('initAuth', () => {
  it('applies a persisted session and subscribes to changes', async () => {
    const { a, mod } = load((x) => { x.session = SESSION; });
    await mod.initAuth();
    expect(mod.auth$.session.peek()).toEqual(SESSION);
    expect(mod.auth$.email.peek()).toBe('Ann@Example.com');
    expect(a.calls.map((c) => c.fn)).toEqual(['getSession', 'onAuthStateChange']);
  });

  it('leaves email null when there is no persisted session', async () => {
    const { mod } = load();
    await mod.initAuth();
    expect(mod.auth$.session.peek()).toBeNull();
    expect(mod.auth$.email.peek()).toBeNull();
  });

  it('a later auth-state change updates the observable', async () => {
    const { a, mod } = load();
    await mod.initAuth();
    expect(mod.isSignedIn()).toBe(false);

    a.listener!('SIGNED_IN', SESSION);
    expect(mod.auth$.email.peek()).toBe('Ann@Example.com');
    expect(mod.isSignedIn()).toBe(true);

    a.listener!('SIGNED_OUT', null);
    expect(mod.auth$.session.peek()).toBeNull();
    expect(mod.auth$.email.peek()).toBeNull();
    expect(mod.isSignedIn()).toBe(false);
  });

  it('tolerates a session whose user carries no email', async () => {
    const { mod } = load((x) => { x.session = { user: {} }; });
    await mod.initAuth();
    expect(mod.auth$.session.peek()).toEqual({ user: {} });
    expect(mod.auth$.email.peek()).toBeNull();
  });
});

describe('sendOtp', () => {
  it('trims the address and reports success', async () => {
    const { a, mod } = load();
    expect(await mod.sendOtp('  ann@example.com  ')).toBe(true);
    expect(a.calls.at(-1)).toEqual({ fn: 'signInWithOtp', arg: { email: 'ann@example.com' } });
  });

  it('reports failure when Supabase returns an error', async () => {
    const { mod } = load((x) => { x.otpError = { message: 'rate limited' }; });
    expect(await mod.sendOtp('ann@example.com')).toBe(false);
  });
});

describe('verifyOtp', () => {
  it('trims both fields and sends type "email"', async () => {
    const { a, mod } = load();
    expect(await mod.verifyOtp(' ann@example.com ', ' 123456 ')).toBe(true);
    expect(a.calls.at(-1)).toEqual({
      fn: 'verifyOtp',
      arg: { email: 'ann@example.com', token: '123456', type: 'email' },
    });
  });

  it('reports failure on a wrong code', async () => {
    const { mod } = load((x) => { x.verifyError = { message: 'invalid token' }; });
    expect(await mod.verifyOtp('ann@example.com', '000000')).toBe(false);
  });
});

describe('signOut', () => {
  it('calls through to Supabase', async () => {
    const { a, mod } = load((x) => { x.session = SESSION; });
    await mod.initAuth();
    await mod.signOut();
    expect(a.calls.map((c) => c.fn)).toContain('signOut');
  });
});
