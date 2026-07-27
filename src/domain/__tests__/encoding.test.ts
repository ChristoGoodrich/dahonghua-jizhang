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
    //
    // …outside the private use area, which is excluded deliberately. ICU parks
    // the GBK code points it has no Unicode assignment for in U+E000-U+F8FF,
    // and which ones graduate out of it depends on the ICU build Node ships:
    // 0xa2e3 is U+E76C on the Node 20 CI runner and € (U+20AC) on the newer
    // Node the committed table was generated from. Asserting equality there
    // would make the suite a test of the runner's ICU version. Those cells are
    // pinned by the oddballs case below instead.
    //
    // Every mismatch is collected rather than thrown on, so one run reports the
    // whole picture instead of stopping at the first lead byte that differs.
    const dec = new NodeTextDecoder('gbk');
    const isPua = (c: string) => c >= '' && c <= '';
    const diffs: string[] = [];
    for (let lead = 0x81; lead <= 0xfe; lead++) {
      const pairs: number[] = [];
      for (let trail = 0x40; trail <= 0xfe; trail++) {
        if (trail !== 0x7f) pairs.push(lead, trail);
      }
      const bytes = new Uint8Array(pairs);
      const ours = [...decodeGbkJs(bytes)];
      const icu = [...dec.decode(bytes)];
      if (ours.length !== icu.length) {
        diffs.push(`lead 0x${lead.toString(16)}: ${ours.length} chars vs ICU's ${icu.length}`);
        continue;
      }
      for (let i = 0; i < ours.length; i++) {
        if (ours[i] === icu[i] || isPua(ours[i]) || isPua(icu[i])) continue;
        const trail = i < 0x3f ? 0x40 + i : 0x41 + i;
        diffs.push(`0x${lead.toString(16)}${trail.toString(16)}: ours ${JSON.stringify(ours[i])} vs ICU ${JSON.stringify(icu[i])}`);
      }
    }
    expect(diffs).toEqual([]);
  });

  it('handles the GBK oddballs: €, dangling lead, ASCII after an error', () => {
    expect(decodeGbkJs(new Uint8Array([0x80]))).toBe('€');
    // CP936's other euro. Real 支付宝/微信 exports carry it; older ICU builds
    // decode it into the private use area, so pin our own behaviour here.
    expect(decodeGbkJs(new Uint8Array([0xa2, 0xe3]))).toBe('€');
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
