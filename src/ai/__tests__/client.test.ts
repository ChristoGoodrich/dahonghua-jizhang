// client.ts was at 13% coverage. The network halves need a live endpoint, but
// the part that matters most — turning an untrusted model reply into JSON, and
// the gate that keeps the whole feature inert when no key is configured — is
// pure and testable.
//
// The module reads its config from process.env at import time, so each case
// re-imports it under a fresh environment.

const ORIGINAL_ENV = { ...process.env };

function loadClient(env: Record<string, string | undefined>) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
   
  return require('../client');
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
});

describe('aiConfigured', () => {
  it('is off when neither a proxy nor a key is set', () => {
    const c = loadClient({ EXPO_PUBLIC_AI_PROXY_URL: undefined, EXPO_PUBLIC_MIMO_API_KEY: undefined });
    expect(c.aiConfigured()).toBe(false);
  });

  it('is on with a proxy alone', () => {
    const c = loadClient({ EXPO_PUBLIC_AI_PROXY_URL: 'https://x.example/parse', EXPO_PUBLIC_MIMO_API_KEY: undefined });
    expect(c.aiConfigured()).toBe(true);
  });

  it('is on with a direct key alone', () => {
    const c = loadClient({ EXPO_PUBLIC_AI_PROXY_URL: undefined, EXPO_PUBLIC_MIMO_API_KEY: 'sk-test' });
    expect(c.aiConfigured()).toBe(true);
  });
});

describe('parseEntryText when unconfigured', () => {
  it('returns null instead of reaching the network, so the app stays offline', async () => {
    const c = loadClient({ EXPO_PUBLIC_AI_PROXY_URL: undefined, EXPO_PUBLIC_MIMO_API_KEY: undefined });
    const spy = jest.spyOn(global, 'fetch' as never);
    const noCustom = { exp: [], inc: [], xfer: [] };
    await expect(c.parseEntryText('午饭 35', noCustom, 'zh')).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// parseEntryText routes through extractJson for the direct-API path, so driving
// it with a stubbed fetch exercises the real reply-parsing code.
describe('reply parsing', () => {
  const noCustom = { exp: [], inc: [], xfer: [] };

  function withReply(content: string) {
    const c = loadClient({ EXPO_PUBLIC_AI_PROXY_URL: undefined, EXPO_PUBLIC_MIMO_API_KEY: 'sk-test' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    }) as unknown as typeof fetch;
    return c;
  }

  it('reads a bare JSON object', async () => {
    const c = withReply('{"io":"exp","amount":35,"category":"餐饮","note":"午饭"}');
    const d = await c.parseEntryText('午饭35', noCustom, 'zh');
    expect(d).toMatchObject({ io: 'exp', amt: '35', note: '午饭' });
  });

  it('unwraps a ```json fenced block', async () => {
    const c = withReply('```json\n{"io":"exp","amount":12,"category":"餐饮"}\n```');
    expect((await c.parseEntryText('x', noCustom, 'zh')).amt).toBe('12');
  });

  it('unwraps an unlabelled fenced block', async () => {
    const c = withReply('```\n{"io":"inc","amount":900,"category":"工资"}\n```');
    const d = await c.parseEntryText('x', noCustom, 'zh');
    expect(d.io).toBe('inc');
    expect(d.amt).toBe('900');
  });

  it('salvages an object wrapped in prose', async () => {
    const c = withReply('Sure! Here you go:\n{"io":"exp","amount":8,"category":"交通"}\nHope that helps.');
    expect((await c.parseEntryText('x', noCustom, 'zh')).amt).toBe('8');
  });

  it('throws AIError on a reply with no JSON at all', async () => {
    const c = withReply('I am not able to help with that.');
    await expect(c.parseEntryText('x', noCustom, 'zh')).rejects.toThrow(c.AIError);
  });

  it('throws AIError on an empty reply', async () => {
    const c = withReply('');
    await expect(c.parseEntryText('x', noCustom, 'zh')).rejects.toThrow(c.AIError);
  });

  it('throws AIError on a non-ok HTTP status', async () => {
    const c = loadClient({ EXPO_PUBLIC_AI_PROXY_URL: undefined, EXPO_PUBLIC_MIMO_API_KEY: 'sk-test' });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;
    await expect(c.parseEntryText('x', noCustom, 'zh')).rejects.toThrow(c.AIError);
  });

  it('throws AIError when the network rejects', async () => {
    const c = loadClient({ EXPO_PUBLIC_AI_PROXY_URL: undefined, EXPO_PUBLIC_MIMO_API_KEY: 'sk-test' });
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(c.parseEntryText('x', noCustom, 'zh')).rejects.toThrow(c.AIError);
  });

  it('sends an Authorization header and no thinking budget', async () => {
    const c = withReply('{"io":"exp","amount":1,"category":"餐饮"}');
    await c.parseEntryText('x', noCustom, 'zh');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body).thinking).toEqual({ type: 'disabled' });
  });

  it('passes an abort signal so a hung request cannot wedge the sheet', async () => {
    const c = withReply('{"io":"exp","amount":1,"category":"餐饮"}');
    await c.parseEntryText('x', noCustom, 'zh');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.signal).toBeDefined();
  });
});

describe('category privacy', () => {
  const custom = {
    exp: [{ k: 'c1', e: '🤫', zh: '私密分类', en: 'Secret', c: '#000', custom: true }],
    inc: [],
    xfer: [],
  };

  function capture(share: boolean) {
    const c = loadClient({ EXPO_PUBLIC_AI_PROXY_URL: undefined, EXPO_PUBLIC_MIMO_API_KEY: 'sk-test' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"io":"exp","amount":1,"category":"餐饮"}' } }] }),
    }) as unknown as typeof fetch;
    return c.parseEntryText('x', custom, 'zh', share).then(() => {
      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      return init.body as string;
    });
  }

  it('sends custom category names when sharing is on', async () => {
    expect(await capture(true)).toContain('私密分类');
  });

  it('withholds them when the user opts out', async () => {
    expect(await capture(false)).not.toContain('私密分类');
  });
});
