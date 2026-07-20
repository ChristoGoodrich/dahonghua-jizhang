// NOTE: the jest globals carry expo's winter TextDecoder polyfill (UTF-8 only —
// the same on-device limitation that makes the JS fallback necessary), so the
// reference gbk decoder comes from Node's util module instead.
import { TextDecoder as NodeTextDecoder } from 'util';
import { decodeGbkJs, decodeUtf8Js } from '../encoding';
import { decodeBillText } from '../billImport';

// GBK bytes precomputed with Python's gbk codec (see the strings alongside).
const GBK_MIXED = new Uint8Array([50, 48, 50, 54, 45, 48, 55, 45, 50, 48, 32, 49, 50, 58, 48, 56, 58, 48, 48, 44, 195, 192, 205, 197, 44, 198, 239, 202, 214, 181, 189, 181, 234, 44, 214, 167, 184, 182, 177, 166, 163, 168, 211, 224, 182, 238, 163, 169, 44, 163, 164, 52, 53, 46, 48, 48]);
const GBK_MIXED_STR = '2026-07-20 12:08:00,美团,骑手到店,支付宝（余额）,￥45.00';
const GBK_HEADER = new Uint8Array([189, 187, 210, 215, 202, 177, 188, 228, 44, 189, 187, 210, 215, 183, 214, 192, 224, 44, 189, 187, 210, 215, 182, 212, 183, 189, 44, 201, 204, 198, 183, 203, 181, 195, 247, 44, 202, 213, 47, 214, 167, 44, 189, 240, 182, 238]);
const GBK_HEADER_STR = '交易时间,交易分类,交易对方,商品说明,收/支,金额';

describe('decodeGbkJs', () => {
  it('decodes real Alipay-style GBK text', () => {
    expect(decodeGbkJs(GBK_MIXED)).toBe(GBK_MIXED_STR);
    expect(decodeGbkJs(GBK_HEADER)).toBe(GBK_HEADER_STR);
  });

  it('matches the platform WHATWG gbk decoder for every two-byte pair', () => {
    // full-space equivalence: proves the generated table + error rule track ICU
    const dec = new NodeTextDecoder('gbk');
    for (let lead = 0x81; lead <= 0xfe; lead++) {
      const pairs: number[] = [];
      for (let trail = 0x40; trail <= 0xfe; trail++) {
        if (trail !== 0x7f) pairs.push(lead, trail);
      }
      const bytes = new Uint8Array(pairs);
      expect(decodeGbkJs(bytes)).toBe(dec.decode(bytes));
    }
  });

  it('handles the GBK oddballs: €, dangling lead, ASCII after an error', () => {
    expect(decodeGbkJs(new Uint8Array([0x80]))).toBe('€');
    expect(decodeGbkJs(new Uint8Array([0xbd]))).toBe('�'); // lead at EOF
    // invalid trail 0x39 is ASCII → error then '9' decodes as itself
    expect(decodeGbkJs(new Uint8Array([0xbd, 0x39 + 0, 0x41]))).toBe('�9A');
  });
});

describe('decodeUtf8Js', () => {
  it('matches TextDecoder for ASCII, CJK, and 4-byte emoji', () => {
    for (const s of ['hello,world', '交易时间：午饭 ￥35', '🌺 emoji 🎉', 'mix 中英 mix']) {
      const bytes = new TextEncoder().encode(s);
      expect(decodeUtf8Js(bytes)).toBe(new TextDecoder('utf-8').decode(bytes));
    }
  });
});

describe('decodeBillText without a platform TextDecoder (the Hermes case)', () => {
  const g = globalThis as { TextDecoder?: typeof TextDecoder };
  let orig: typeof TextDecoder | undefined;
  beforeEach(() => {
    orig = g.TextDecoder;
    delete g.TextDecoder;
  });
  afterEach(() => {
    g.TextDecoder = orig;
  });

  it('still decodes GBK, UTF-8, and BOM UTF-8 via the JS fallbacks', () => {
    expect(decodeBillText(GBK_MIXED)).toBe(GBK_MIXED_STR);
    const utf8 = new TextEncoder().encode('收/支,金额(元)');
    expect(decodeBillText(utf8)).toBe('收/支,金额(元)');
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('收入')]);
    expect(decodeBillText(bom)).toBe('收入');
  });
});
