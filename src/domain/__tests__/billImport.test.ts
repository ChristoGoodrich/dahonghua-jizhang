import {
  parseCSV, findHeaderRow, detectSource, autoMap,
  parseDateMs, parseAmount, parseIO, mapCategory, composeNote,
  parseBills, toCandidates, prepareImport,
  looksLikeUtf8, decodeBillText,
} from '../billImport';
import type { Category, Entry, IO } from '../types';

const custom: Record<IO, Category[]> = { exp: [], inc: [], xfer: [] };

// A realistic (trimmed) 支付宝 export: preamble, dashed separator, header, rows.
const ALIPAY = `支付宝交易记录明细查询
账号:[test@example.com]
起始日期:[2026-06-01 00:00:00]    终止日期:[2026-06-30 23:59:59]
---------------------------------交易记录明细列表------------------------------------
交易时间,交易分类,交易对方,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,备注
2026-06-02 08:15:30,餐饮美食,瑞幸咖啡,标准美式,支出,15.90,余额宝,交易成功,T2026x,
2026-06-02 12:40:00,交通出行,滴滴出行,快车,支出,23.00,花呗,交易成功,T2026y,
2026-06-03 09:00:00,,某公司,工资发放,收入,"8,000.00",余额,交易成功,T2026z,月薪
2026-06-04 20:00:00,数码电器,京东,充电器,支出,¥59.00,余额,交易关闭,T2026w,`;

// A realistic (trimmed) 微信支付 export: BOM, preamble, dashed line, header, rows.
const WECHAT = `﻿微信支付账单明细
微信昵称：[test]
起始时间：[2026-06-01 00:00:00] 终止时间：[2026-06-30 23:59:59]
----------------------微信支付账单明细列表--------------------
交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注
2026-06-05 19:30:00,商户消费,肯德基,午餐,支出,¥38.50,零钱,支付成功,W1,M1,
2026-06-06 10:00:00,转账,朋友,/,收入,¥100.00,零钱,已收钱,W2,M2,还款
2026-06-07 14:00:00,商户消费,便利店,饮料,/,¥3.00,零钱,支付成功,W3,M3,`;

describe('encoding detection', () => {
  // "交易时间" encoded as GBK (the classic 支付宝 export encoding)
  const GBK_HEADER = new Uint8Array([0xbd, 0xbb, 0xd2, 0xd7, 0xca, 0xb1, 0xbc, 0xe4]);
  it('accepts UTF-8 and rejects GBK byte sequences', () => {
    expect(looksLikeUtf8(new TextEncoder().encode('交易时间,收入'))).toBe(true);
    expect(looksLikeUtf8(GBK_HEADER)).toBe(false);
  });
  it('decodes a UTF-8 BOM (WeChat) and valid UTF-8, and never throws on GBK', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('收入')]);
    expect(decodeBillText(bom)).toBe('收入');
    expect(decodeBillText(new TextEncoder().encode('交易时间'))).toBe('交易时间');
    // The exact GBK→text decode depends on the platform TextDecoder (native on
    // web & Node, absent on some RN engines). decodeBillText must always return a
    // string; the real GBK decode is verified in the browser. See billImport.ts.
    expect(typeof decodeBillText(GBK_HEADER)).toBe('string');
  });
});

describe('parseCSV', () => {
  it('handles quoted fields with embedded commas and strips a BOM', () => {
    const rows = parseCSV('﻿a,"1,000",c\nd,e,f');
    expect(rows).toEqual([['a', '1,000', 'c'], ['d', 'e', 'f']]);
  });
  it('handles escaped quotes and CRLF', () => {
    const rows = parseCSV('x,"he said ""hi"""\r\ny,z');
    expect(rows[0]).toEqual(['x', 'he said "hi"']);
    expect(rows[1]).toEqual(['y', 'z']);
  });
});

describe('header detection + mapping', () => {
  it('finds the header row below an Alipay preamble', () => {
    const rows = parseCSV(ALIPAY);
    const h = findHeaderRow(rows);
    expect(rows[h][0]).toBe('交易时间');
  });
  it('detects the wallet source', () => {
    expect(detectSource(parseCSV(ALIPAY))).toBe('alipay');
    expect(detectSource(parseCSV(WECHAT))).toBe('wechat');
    expect(detectSource(parseCSV('a,b,c\n1,2,3'))).toBe('generic');
  });
  it('maps WeChat columns (金额(元) / 当前状态) correctly', () => {
    const rows = parseCSV(WECHAT);
    const map = autoMap(rows[findHeaderRow(rows)])!;
    expect(map.io).toBeGreaterThanOrEqual(0);
    expect(map.amt).toBeGreaterThanOrEqual(0);
    expect(map.status).toBeGreaterThanOrEqual(0);
  });
  it('returns null when required columns are missing', () => {
    expect(autoMap(['foo', 'bar'])).toBeNull();
  });
});

describe('value parsers', () => {
  it('parses several datetime shapes', () => {
    expect(parseDateMs('2026-06-02 08:15:30')).toBe(new Date(2026, 5, 2, 8, 15, 30).getTime());
    expect(parseDateMs('2026/6/2')).toBe(new Date(2026, 5, 2).getTime());
    expect(parseDateMs('2026年6月2日 8:15')).toBe(new Date(2026, 5, 2, 8, 15).getTime());
    expect(parseDateMs('nonsense')).toBeNull();
  });
  it('parses amounts with symbols, separators and signs', () => {
    expect(parseAmount('¥59.00')).toBe(59);
    expect(parseAmount('8,000.00')).toBe(8000);
    expect(parseAmount('-12.5')).toBe(12.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('--')).toBeNull();
  });
  it('reads 收/支 direction and rejects 不计收支', () => {
    expect(parseIO('支出')).toBe('exp');
    expect(parseIO('收入')).toBe('inc');
    expect(parseIO('不计收支')).toBeNull();
    expect(parseIO('/')).toBeNull();
  });
});

describe('mapCategory', () => {
  it('maps by keyword within the correct io scope', () => {
    expect(mapCategory('exp', '餐饮美食', '瑞幸咖啡', custom)).toBe('food');
    expect(mapCategory('exp', '交通出行', '滴滴', custom)).toBe('trans');
    expect(mapCategory('exp', '数码电器', '京东 充电器', custom)).toBe('shop');
    expect(mapCategory('inc', '', '工资发放', custom)).toBe('salary');
  });
  it('resolves 红包 differently for income vs expense', () => {
    expect(mapCategory('exp', '', '发红包', custom)).toBe('gift');
    expect(mapCategory('inc', '', '收到红包', custom)).toBe('bonus');
  });
  it('honors an exact custom-category name match', () => {
    const withCustom: Record<IO, Category[]> = {
      exp: [{ k: 'coffee', e: '☕', zh: '咖啡', en: 'Coffee', c: '#000' }],
      inc: [], xfer: [],
    };
    expect(mapCategory('exp', '咖啡', '', withCustom)).toBe('coffee');
  });
  it('falls back to other', () => {
    expect(mapCategory('exp', '未知类目', '???', custom)).toBe('other');
  });
});

describe('composeNote', () => {
  it('joins party and description, de-duplicating identical parts', () => {
    expect(composeNote({ ts: 0, io: 'exp', amt: 1, party: '瑞幸', desc: '美式' })).toBe('瑞幸 · 美式');
    expect(composeNote({ ts: 0, io: 'exp', amt: 1, party: '肯德基', desc: '肯德基' })).toBe('肯德基');
  });
});

describe('parseBills (pipeline)', () => {
  it('parses Alipay rows and drops the 交易关闭 row', () => {
    const res = parseBills(ALIPAY);
    expect(res.source).toBe('alipay');
    // 3 usable (coffee, taxi, salary); the closed 京东 row is skipped
    expect(res.bills).toHaveLength(3);
    expect(res.skipped).toBe(1);
    const salary = res.bills.find((b) => b.io === 'inc')!;
    expect(salary.amt).toBe(8000);
  });
  it('parses WeChat rows and drops the 不计收支 (/) row', () => {
    const res = parseBills(WECHAT);
    expect(res.source).toBe('wechat');
    expect(res.bills).toHaveLength(2); // KFC + 转账收入; the "/" drink row dropped
    expect(res.skipped).toBe(1);
    expect(res.bills[0].amt).toBe(38.5);
  });
  it('returns an empty result when no header is present', () => {
    const res = parseBills('just some text\nwith no header');
    expect(res.headerRow).toBe(-1);
    expect(res.bills).toHaveLength(0);
  });
});

describe('toCandidates + dedup', () => {
  it('assigns categories and marks existing entries as duplicates', () => {
    const bills = parseBills(ALIPAY).bills;
    const existing: Entry[] = [
      // same day/amount/note as the coffee row → should be flagged dup
      { id: 'e1', ts: new Date(2026, 5, 2).getTime(), io: 'exp', cat: 'food', amt: 15.9, note: '瑞幸咖啡 · 标准美式' },
    ];
    const cands = toCandidates(bills, existing, custom);
    const coffee = cands.find((c) => c.amt === 15.9)!;
    expect(coffee.cat).toBe('food');
    expect(coffee.dup).toBe(true);
    // the taxi row is not in existing
    expect(cands.find((c) => c.amt === 23)!.dup).toBe(false);
  });
  it('is multiset-based: two identical existing entries dedup two bills', () => {
    const bills = [
      { ts: new Date(2026, 5, 2).getTime(), io: 'exp' as const, amt: 5, desc: '地铁' },
      { ts: new Date(2026, 5, 2).getTime(), io: 'exp' as const, amt: 5, desc: '地铁' },
    ];
    const one: Entry[] = [{ id: 'x', ts: new Date(2026, 5, 2).getTime(), io: 'exp', cat: 'trans', amt: 5, note: '地铁' }];
    // only ONE existing → first bill dup, second fresh
    const cands = toCandidates(bills, one, custom);
    expect(cands.filter((c) => c.dup)).toHaveLength(1);
    expect(cands.filter((c) => !c.dup)).toHaveLength(1);
  });
});

// The notification listener writes the merchant only ("瑞幸咖啡"); the CSV row
// for that same payment reads "瑞幸咖啡 · 标准美式". Without the relaxed match the
// monthly import would re-add every payment the listener already captured.
describe('dedup against notification-captured entries', () => {
  const coffeeDay = new Date(2026, 5, 2).getTime();

  it('matches a notif entry on amount + day despite a different note', () => {
    const captured: Entry[] = [
      { id: 'n1', ts: coffeeDay, io: 'exp', cat: 'food', amt: 15.9, note: '瑞幸咖啡', src: 'notif' },
    ];
    const cands = toCandidates(parseBills(ALIPAY).bills, captured, custom);
    expect(cands.find((c) => c.amt === 15.9)!.dup).toBe(true);
  });

  it('does NOT relax the match for hand-typed or CSV-imported entries', () => {
    const typed: Entry[] = [
      { id: 'h1', ts: coffeeDay, io: 'exp', cat: 'food', amt: 15.9, note: '咖啡' },
      { id: 'b1', ts: coffeeDay, io: 'exp', cat: 'trans', amt: 23, note: '打车', src: 'bill' },
    ];
    const cands = toCandidates(parseBills(ALIPAY).bills, typed, custom);
    expect(cands.find((c) => c.amt === 15.9)!.dup).toBe(false);
    expect(cands.find((c) => c.amt === 23)!.dup).toBe(false);
  });

  it('consumes a notif entry only once', () => {
    const bills = [
      { ts: coffeeDay, io: 'exp' as const, amt: 5, desc: '地铁' },
      { ts: coffeeDay, io: 'exp' as const, amt: 5, desc: '地铁' },
    ];
    const one: Entry[] = [{ id: 'n2', ts: coffeeDay, io: 'exp', cat: 'trans', amt: 5, note: '北京地铁', src: 'notif' }];
    const cands = toCandidates(bills, one, custom);
    expect(cands.filter((c) => c.dup)).toHaveLength(1);
  });

  it('prefers an exact note match over a loose notif match', () => {
    const bills = [{ ts: coffeeDay, io: 'exp' as const, amt: 5, desc: '地铁' }];
    const existing: Entry[] = [
      { id: 'n3', ts: coffeeDay, io: 'exp', cat: 'trans', amt: 5, note: '北京地铁', src: 'notif' },
      { id: 'h3', ts: coffeeDay, io: 'exp', cat: 'trans', amt: 5, note: '地铁' },
    ];
    // the hand-typed entry absorbs the row, leaving the captured one free to
    // absorb a later duplicate rather than being spent on the first match
    const cands = toCandidates(bills, existing, custom);
    expect(cands[0].dup).toBe(true);
    const second = toCandidates([...bills, ...bills], existing, custom);
    expect(second.filter((c) => c.dup)).toHaveLength(2);
  });

  it('still separates different days and directions', () => {
    const existing: Entry[] = [
      { id: 'n4', ts: new Date(2026, 5, 1).getTime(), io: 'exp', cat: 'food', amt: 15.9, note: '瑞幸', src: 'notif' },
    ];
    const cands = toCandidates(parseBills(ALIPAY).bills, existing, custom);
    expect(cands.find((c) => c.amt === 15.9)!.dup).toBe(false); // one day earlier
  });
});

describe('prepareImport', () => {
  it('summarizes fresh income/expense totals and dup/skip counts', () => {
    const prev = prepareImport(ALIPAY, [], custom);
    expect(prev.ok).toBe(true);
    expect(prev.source).toBe('alipay');
    expect(prev.expCount).toBe(2); // coffee + taxi
    expect(prev.incCount).toBe(1); // salary
    expect(prev.expSum).toBe(38.9);
    expect(prev.incSum).toBe(8000);
    expect(prev.dupCount).toBe(0);
    expect(prev.skipped).toBe(1); // closed 京东 row
  });
  it('re-importing the same file is idempotent (all dups the second time)', () => {
    // first import's fresh candidates become "existing"
    const first = prepareImport(WECHAT, [], custom);
    const existing: Entry[] = first.fresh.map((c, i) => ({
      id: 'imp' + i, ts: c.ts, io: c.io, cat: c.cat, amt: c.amt, note: c.note,
    }));
    const second = prepareImport(WECHAT, existing, custom);
    expect(second.fresh).toHaveLength(0);
    expect(second.dupCount).toBe(first.fresh.length);
  });
  it('flags an unparseable file as not ok', () => {
    expect(prepareImport('garbage', [], custom).ok).toBe(false);
  });
});
