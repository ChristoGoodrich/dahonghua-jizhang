// Receipt-image recognition coverage.
//
// The module snapshots EXPO_PUBLIC_MIMO_API_KEY at import time, so every case
// sets the env and re-requires. That also keeps the suite independent of
// whether the developer running it happens to have a key in .env.local — the
// previous version of this file silently skipped its only real assertion on
// machines that did.
//
// Two collaborators are faked: expo-file-system (the native read path) and
// global fetch (the model call). The web fallback in imageToBase64 is exercised
// by making the native read throw.

const fsBox: { read: ((uri: string, opts: unknown) => Promise<string>) | null } = { read: null };

jest.mock('expo-file-system', () => ({
  EncodingType: { Base64: 'base64' },
  readAsStringAsync: (uri: string, opts: unknown) => {
    if (!fsBox.read) throw new Error('no native file system');
    return fsBox.read(uri, opts);
  },
}));

const CATS = { exp: [], inc: [], xfer: [] } as any;

/** `null` means "no key configured" — passing `undefined` would just re-trigger
 *  the default, which is exactly how the first draft of this file fooled itself. */
function load(key: string | null = 'tp-test-key') {
  jest.resetModules();
  process.env = key === null
    ? { ...ORIGINAL_ENV, EXPO_PUBLIC_MIMO_API_KEY: undefined }
    : { ...ORIGINAL_ENV, EXPO_PUBLIC_MIMO_API_KEY: key };
   
  return require('../receipt') as typeof import('../receipt');
}

/** Fake a chat-completions response carrying `content`. */
function reply(content: string, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  fsBox.read = async () => 'BASE64DATA';
  global.fetch = jest.fn(async () =>
    reply('{"io":"exp","amount":12.5,"category":"餐饮","note":"KFC"}')) as never;
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
  global.fetch = ORIGINAL_FETCH;
});

describe('receiptAiConfigured', () => {
  it('is false without a key', () => {
    expect(load(null).receiptAiConfigured()).toBe(false);
  });

  it('is true with a key', () => {
    expect(load('tp-abc').receiptAiConfigured()).toBe(true);
  });
});

describe('ReceiptError', () => {
  it('is an Error subclass so callers can branch on it', () => {
    const err = new (load().ReceiptError)('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('boom');
  });
});

describe('parseReceiptImage — unconfigured', () => {
  it('returns null and never calls the network', async () => {
    const mod = load(null);
    expect(await mod.parseReceiptImage('file:///r.jpg', CATS, 'zh')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('parseReceiptImage — happy path', () => {
  it('returns a normalized draft', async () => {
    const draft = await load().parseReceiptImage('file:///r.jpg', CATS, 'zh');
    expect(draft).toEqual({ io: 'exp', cat: 'food', amt: '12.5', note: 'KFC', date: undefined });
  });

  it('sends the image as a base64 data URL on the multimodal model', async () => {
    await load().parseReceiptImage('file:///r.jpg', CATS, 'zh');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer tp-test-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('mimo-v2.5');
    expect(body.temperature).toBe(0);
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,BASE64DATA');
  });

  it('passes the caller language through to the category list in the prompt', async () => {
    await load().parseReceiptImage('file:///r.jpg', CATS, 'en');
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('Expense categories: ');
  });

  it('keeps an ISO date the model reports', async () => {
    global.fetch = jest.fn(async () =>
      reply('{"io":"exp","amount":8,"category":"餐饮","note":"","date":"2026-03-04"}')) as never;
    const draft = await load().parseReceiptImage('file:///r.jpg', CATS, 'zh');
    expect(draft?.date).toBe('2026-03-04');
  });
});

describe('parseReceiptImage — content extraction', () => {
  it('unwraps a markdown-fenced JSON block', async () => {
    const fenced = ['```json', '{"io":"inc","amount":300,"category":"工资","note":"pay"}', '```'].join('\n');
    global.fetch = jest.fn(async () => reply(fenced)) as never;
    const draft = await load().parseReceiptImage('file:///r.jpg', CATS, 'zh');
    expect(draft?.io).toBe('inc');
    expect(draft?.amt).toBe('300');
  });

  it('digs the object out of surrounding prose', async () => {
    global.fetch = jest.fn(async () =>
      reply('Here is what I read: {"io":"exp","amount":5,"category":"餐饮"} — hope that helps!')) as never;
    const draft = await load().parseReceiptImage('file:///r.jpg', CATS, 'zh');
    expect(draft?.amt).toBe('5');
  });

  it('an unreadable receipt normalizes to a zero amount rather than throwing', async () => {
    global.fetch = jest.fn(async () => reply('{"io":"exp","amount":0,"category":"","note":""}')) as never;
    const draft = await load().parseReceiptImage('file:///r.jpg', CATS, 'zh');
    expect(draft?.amt).toBe('');
  });
});

describe('parseReceiptImage — failure modes', () => {
  it('throws ReceiptError when the image reads empty', async () => {
    fsBox.read = async () => '';
    const mod = load();
    await expect(mod.parseReceiptImage('file:///r.jpg', CATS, 'zh')).rejects.toThrow(mod.ReceiptError);
    await expect(mod.parseReceiptImage('file:///r.jpg', CATS, 'zh')).rejects.toThrow('image read failed');
  });

  it('maps a network failure to ReceiptError("network")', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline'); }) as never;
    await expect(load().parseReceiptImage('file:///r.jpg', CATS, 'zh')).rejects.toThrow('network');
  });

  it('surfaces a non-2xx status', async () => {
    global.fetch = jest.fn(async () => reply('', { ok: false, status: 429 })) as never;
    await expect(load().parseReceiptImage('file:///r.jpg', CATS, 'zh')).rejects.toThrow('status 429');
  });

  it('maps an unreadable response body to ReceiptError("bad response")', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200, json: async () => { throw new Error('not json'); },
    })) as never;
    await expect(load().parseReceiptImage('file:///r.jpg', CATS, 'zh')).rejects.toThrow('bad response');
  });

  it('maps unparseable content to ReceiptError("parse failed")', async () => {
    global.fetch = jest.fn(async () => reply('I could not read that receipt.')) as never;
    await expect(load().parseReceiptImage('file:///r.jpg', CATS, 'zh')).rejects.toThrow('parse failed');
  });

  it('treats a response with no choices as empty content', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as never;
    await expect(load().parseReceiptImage('file:///r.jpg', CATS, 'zh')).rejects.toThrow('parse failed');
  });
});

describe('imageToBase64 web fallback', () => {
  it('falls back to fetch + FileReader when the native read throws', async () => {
    fsBox.read = null; // makes the expo-file-system mock throw

    class FakeFileReader {
      result: string | null = null;
      onloadend: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      readAsDataURL() {
        this.result = 'data:image/jpeg;base64,WEBFALLBACK';
        this.onloadend?.();
      }
    }
    (global as any).FileReader = FakeFileReader;

    global.fetch = jest.fn(async (input: unknown) =>
      String(input).startsWith('blob:')
        ? { ok: true, blob: async () => ({}) }
        : reply('{"io":"exp","amount":9,"category":"餐饮","note":"web"}')) as never;

    const draft = await load().parseReceiptImage('blob:http://x/y', CATS, 'zh');
    expect(draft?.note).toBe('web');
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body);
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,WEBFALLBACK');

    delete (global as any).FileReader;
  });
});
