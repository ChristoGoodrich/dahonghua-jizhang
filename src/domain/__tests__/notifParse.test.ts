import {
  classifySource, fullText, parseNotifAmount, parseNotifIO, parseMerchant,
  parseNotification, toEntryDraft, isDuplicate, parseBatch,
  type RawNotif, type NotifCandidate,
} from '../notifParse';
import type { Category, IO } from '../types';

const custom: Record<IO, Category[]> = { exp: [], inc: [], xfer: [] };

const T = new Date(2026, 6, 21, 12, 30).getTime();
let seq = 0;
const notif = (pkg: string, title: string, text: string, extra: Partial<RawNotif> = {}): RawNotif =>
  ({ id: `n${seq++}`, pkg, title, text, postedAt: T, ...extra });

const ALIPAY = 'com.eg.android.AlipayGphone';
const WECHAT = 'com.tencent.mm';

describe('source classification', () => {
  it('recognizes the known wallets by package', () => {
    expect(classifySource(notif(ALIPAY, '支付宝', '付款成功'))).toBe('alipay');
    expect(classifySource(notif(WECHAT, '微信支付', '付款成功'))).toBe('wechat');
    expect(classifySource(notif('com.unionpay', '云闪付', '消费'))).toBe('unionpay');
  });
  it('accepts an unknown package only when the text has a bank-push shape', () => {
    const bank = notif('com.icbc', '工商银行', '您尾号1234的卡于7月21日消费人民币35.00元');
    expect(classifySource(bank)).toBe('bank');
    expect(classifySource(notif('com.taobao.taobao', '淘宝', '你的订单已发货'))).toBeNull();
  });
});

describe('amount parsing', () => {
  it('needs a currency marker — bare digits are not amounts', () => {
    expect(parseNotifAmount('向星巴克付款 32.00 元')).toBe(32);
    expect(parseNotifAmount('你已成功付款 ¥15.90')).toBe(15.9);
    expect(parseNotifAmount('消费人民币35.00元')).toBe(35);
    expect(parseNotifAmount('收款 8 块')).toBe(8);
    expect(parseNotifAmount('尾号1234的卡')).toBeNull();
    expect(parseNotifAmount('7月21日 12:30')).toBeNull();
  });
  it('handles thousands separators and full-width yen', () => {
    expect(parseNotifAmount('工资 ￥8,000.00 已到账')).toBe(8000);
    expect(parseNotifAmount('RMB 1,234.56')).toBe(1234.56);
  });
  it('skips the card number and finds the real amount after it', () => {
    expect(parseNotifAmount('您尾号1234的卡于7月21日消费人民币35.00元')).toBe(35);
  });
});

describe('direction', () => {
  it('reads payments as expenses and arrivals as income', () => {
    expect(parseNotifIO('向星巴克付款32元')).toBe('exp');
    expect(parseNotifIO('消费人民币35.00元')).toBe('exp');
    expect(parseNotifIO('收款100.00元已到账')).toBe('inc');
    expect(parseNotifIO('工资已发放')).toBe('inc');
    expect(parseNotifIO('今天天气不错')).toBeNull();
  });
  // "支付宝" contains 支付 — if the brand counted as a verb, every notification
  // that app sends (balance, reminders, ads) would post as an expense
  it('does not read a direction out of a brand name', () => {
    expect(parseNotifIO('支付宝 账户余额 1,234.56 元')).toBeNull();
    expect(parseNotifIO('微信支付 你有一条通知')).toBeNull();
    expect(parseNotifIO('支付宝 向星巴克付款32.00元')).toBe('exp');
  });
  // a refund says both "退款" and (sometimes) "支付", and it is income
  it('classifies a refund as income even though it mentions payment', () => {
    expect(parseNotifIO('微信支付退款¥32.00已原路退回')).toBe('inc');
  });
});

describe('merchant extraction', () => {
  it('pulls the name out of the common phrasings', () => {
    expect(parseMerchant('向星巴克(国贸店)付款32.00元')).toBe('星巴克(国贸店)');
    expect(parseMerchant('在全家便利店消费15元')).toBe('全家便利店');
    expect(parseMerchant('收到 老王 的转账 200 元')).toBe('老王');
    expect(parseMerchant('商户：瑞幸咖啡 金额 15.90 元')).toBe('瑞幸咖啡');
  });
  it('rejects pronouns and bare numbers standing where a name would', () => {
    expect(parseMerchant('向你付款32.00元')).toBeUndefined();
    expect(parseMerchant('消费人民币35.00元')).toBeUndefined();
  });
});

describe('parseNotification', () => {
  it('parses a 支付宝 payment with a merchant as confident', () => {
    const c = parseNotification(notif(ALIPAY, '支付宝', '向星巴克(国贸店)付款32.00元'))!;
    expect(c).toMatchObject({ io: 'exp', amt: 32, merchant: '星巴克(国贸店)', source: 'alipay', confident: true });
  });
  it('parses a bank push without a merchant as unconfident', () => {
    const c = parseNotification(notif('com.icbc', '工商银行', '您尾号1234的卡于7月21日消费人民币35.00元'))!;
    expect(c).toMatchObject({ io: 'exp', amt: 35, source: 'bank', confident: false });
    expect(c.merchant).toBeUndefined();
  });
  it('reads an amount that only appears in bigText', () => {
    const c = parseNotification(notif(WECHAT, '微信支付', '微信支付凭证', { bigText: '向瑞幸咖啡付款 ¥15.90' }))!;
    expect(c).toMatchObject({ io: 'exp', amt: 15.9, merchant: '瑞幸咖啡' });
  });
  it('parses income', () => {
    const c = parseNotification(notif(ALIPAY, '支付宝', '收款100.00元已到账'))!;
    expect(c).toMatchObject({ io: 'inc', amt: 100, confident: false });
  });

  // false positives are worse than misses: a wrong entry has to be hunted down,
  // a missed one is recovered by the monthly CSV import
  it('drops marketing and statement pushes that happen to contain amounts', () => {
    expect(parseNotification(notif(ALIPAY, '支付宝', '您有一张5元优惠券待领取'))).toBeNull();
    expect(parseNotification(notif(ALIPAY, '花呗', '本期账单已出，应还1,234.56元'))).toBeNull();
    expect(parseNotification(notif(ALIPAY, '支付宝', '还款提醒：应还 500.00 元'))).toBeNull();
  });
  it('drops WeChat chat messages, which share the payment package', () => {
    expect(parseNotification(notif(WECHAT, '老王', '350元那个我明天转你'))).toBeNull();
    expect(parseNotification(notif(WECHAT, '家族群', '[2条新消息] 晚饭88元AA一下'))).toBeNull();
  });
  it('drops anything without an amount or without a direction', () => {
    expect(parseNotification(notif(ALIPAY, '支付宝', '付款成功'))).toBeNull();
    expect(parseNotification(notif(ALIPAY, '支付宝', '账户余额 1,234.56 元'))).toBeNull();
  });
});

describe('toEntryDraft', () => {
  it('resolves a category from the merchant name via the shared keyword table', () => {
    const c = parseNotification(notif(ALIPAY, '支付宝', '向瑞幸咖啡付款15.90元'))!;
    expect(toEntryDraft(c, custom)).toMatchObject({ io: 'exp', amt: 15.9, cat: 'food', note: '瑞幸咖啡', ts: T, confident: true });
  });
  it('falls back to a source label when there is no merchant', () => {
    const c = parseNotification(notif('com.icbc', '工商银行', '您尾号1234的卡消费人民币35.00元'))!;
    expect(toEntryDraft(c, custom)).toMatchObject({ cat: 'other', note: '银行卡', confident: false });
  });
});

describe('duplicate suppression', () => {
  const at = (ms: number, merchant?: string): NotifCandidate =>
    ({ io: 'exp', amt: 32, merchant, source: 'alipay', postedAt: T + ms, confident: !!merchant });

  it('treats the same amount within three minutes as one payment', () => {
    expect(isDuplicate(at(30_000), [at(0)])).toBe(true);
  });
  it('lets the same amount through after the window', () => {
    expect(isDuplicate(at(4 * 60_000), [at(0)])).toBe(false);
  });
  it('does not collapse opposite directions', () => {
    expect(isDuplicate({ ...at(1000), io: 'inc' }, [at(0)])).toBe(false);
  });

  // 支付宝 posts "付款成功" and then a bill push for one payment; the first
  // carries the merchant, so it must be the one that survives
  it('keeps the first capture of a payment, which is the richer one', () => {
    const batch = parseBatch([
      notif(ALIPAY, '支付宝', '向星巴克付款32.00元'),
      notif(ALIPAY, '支付宝', '你有一笔32.00元的支出已记录', { postedAt: T + 20_000 }),
    ]);
    expect(batch).toHaveLength(1);
    expect(batch[0].merchant).toBe('星巴克');
  });
  it('keeps genuinely separate payments', () => {
    const batch = parseBatch([
      notif(ALIPAY, '支付宝', '向星巴克付款32.00元'),
      notif(ALIPAY, '支付宝', '向全家付款8.50元', { postedAt: T + 10_000 }),
    ]);
    expect(batch).toHaveLength(2);
  });
});

describe('fullText', () => {
  it('collapses bigText when it merely repeats text', () => {
    expect(fullText({ id: 'a', pkg: 'p', title: '支付宝', text: '付款32元', bigText: '付款32元', postedAt: 0 }))
      .toBe('支付宝 付款32元');
  });
});
