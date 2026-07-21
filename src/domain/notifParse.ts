// Payment-notification parsing — turns an Android notification captured by the
// notif-capture native module into a ledger candidate.
//
// The native side is a dumb pipe: it stores {package, title, text, bigText,
// postedAt} and nothing else. ALL interpretation lives here, in pure functions,
// because these rules need dozens of rounds of tuning against real notifications
// and a rule that lives in Kotlin costs a rebuild to change and can't be tested.
//
// Category resolution and note composition are deliberately NOT reimplemented —
// they're imported from billImport, so a keyword added for CSV import
// immediately improves notification capture too.
import type { Category, IO } from './types';
import { mapCategory } from './billImport';

/** What the native listener hands over, verbatim. */
export interface RawNotif {
  id: string; // native row id, used to ack the queue
  pkg: string; // source application id
  title?: string;
  text?: string;
  bigText?: string; // EXTRA_BIG_TEXT — WeChat often puts the amount only here
  postedAt: number; // epoch ms (Notification.postTime)
}

export type NotifSource = 'alipay' | 'wechat' | 'unionpay' | 'bank';

/** A parsed payment. `confident` entries can be posted to the ledger without
 *  asking; the rest wait in the inbox for one tap. */
export interface NotifCandidate {
  io: Exclude<IO, 'xfer'>;
  amt: number;
  merchant?: string;
  source: NotifSource;
  postedAt: number;
  confident: boolean;
}

/** A candidate resolved against the user's categories, ready to become an Entry. */
export interface NotifEntryDraft {
  io: Exclude<IO, 'xfer'>;
  amt: number;
  cat: string;
  note: string;
  ts: number;
  confident: boolean;
}

// ---------- 1. package whitelist ----------

// Verified-by-name wallets. Anything else has to earn its way in through the
// strict bank-SMS shape below — an open policy would let every chat app through.
//
// NOTE: package ids drift between app versions and channel builds. The inbox
// keeps unrecognized captures from these packages with their raw text visible,
// which is how you discover the real strings on your own phone; add what you
// find here rather than loosening the rules.
const WALLET_PKGS: Record<string, NotifSource> = {
  'com.eg.android.AlipayGphone': 'alipay',
  'com.alipay.android.app': 'alipay',
  'com.tencent.mm': 'wechat',
  'com.unionpay': 'unionpay',
};

/** A bank push reads like an SMS: a masked card number plus a movement verb.
 *  Requiring both keeps unknown packages from feeding the ledger noise. */
const BANK_SHAPE = /尾号\s*\d{3,4}|信用卡|储蓄卡|借记卡/;

export function classifySource(n: RawNotif): NotifSource | null {
  const wallet = WALLET_PKGS[n.pkg];
  if (wallet) return wallet;
  return BANK_SHAPE.test(fullText(n)) ? 'bank' : null;
}

// ---------- 2. text assembly + noise ----------

/** Everything the notification said, joined for scanning. bigText usually
 *  repeats text, so identical parts are collapsed to keep merchant capture
 *  from matching across a seam. */
export function fullText(n: RawNotif): string {
  const parts = [n.title, n.text, n.bigText].map((p) => p?.trim()).filter((p): p is string => !!p);
  const uniq = parts.filter((p, i) => parts.indexOf(p) === i);
  return uniq.join(' ');
}

// Marketing, reminders, and statements — these carry amounts but no money moved.
const NOISE = /优惠券|立减|满减|红包封面|活动|积分|签到|领取|待还款|还款提醒|账单日|账单已出|即将到期|验证码|开通|升级|邀请/;

// WeChat pushes chat messages from the same package as payments, and a message
// like "老王: 350元那个我转你" would otherwise parse as a ¥350 expense. Payment
// notifications are titled 微信支付 / 微信支付凭证, so require a payment marker.
const WECHAT_PAYMENT = /微信支付|支付凭证|付款|收款|到账|退款/;

// ---------- 3. amount ----------

// An amount must be marked as money — either a currency prefix or a 元/块
// suffix. Bare digits are rejected on purpose: "尾号1234的卡" and "7月21日"
// both contain numbers that are not amounts.
const AMOUNT_RE = /(?:¥|￥|RMB|人民币)\s*(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:元|块)/g;

/** First money-shaped number in the text, or null. */
export function parseNotifAmount(text: string): number | null {
  AMOUNT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_RE.exec(text))) {
    const raw = (m[1] ?? m[2]).replace(/,/g, '');
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return null;
}

// ---------- 4. direction ----------

// Income markers are checked first: they're the more specific vocabulary, and a
// refund push ("退款¥32.00已原路返回") must not be read as a payment.
const INC_RE = /到账|收款|入账|退款|返现|已收款|收到|转入|发放/;
const EXP_RE = /付款|支付|消费|支出|扣款|扣费|已扣|转出|缴费/;

// Brand names contain the very verbs we scan for — "支付宝" contains 支付, so a
// balance reminder titled 支付宝 reads as a payment and every notification the
// app ever sends becomes an expense. Strip the brands before looking for a verb.
const BRAND_RE = /支付宝|微信支付|云闪付|银联|财付通/g;

export function parseNotifIO(text: string): Exclude<IO, 'xfer'> | null {
  const body = text.replace(BRAND_RE, ' ');
  if (INC_RE.test(body)) return 'inc';
  if (EXP_RE.test(body)) return 'exp';
  return null;
}

// ---------- 5. merchant ----------

// Ordered most-specific first; the first pattern that captures a plausible name
// wins. Names are bounded to 20 chars so a greedy match can't swallow a clause.
const MERCHANT_RES: RegExp[] = [
  /向\s*(.{1,20}?)\s*(?:付款|转账|支付)/,
  /在\s*(.{1,20}?)\s*(?:消费|支付|付款)/,
  /(?:收到|来自)\s*(.{1,20}?)\s*(?:的)?\s*(?:付款|转账|红包|汇款)/,
  /(.{1,20}?)\s*向(?:你|您)(?:付款|转账)/,
  /(?:商户|收款方|付款方)[:：]\s*(.{1,20}?)(?:\s|$)/,
];

// Boilerplate that shows up where a merchant name would be.
const NOT_A_MERCHANT = /^(你|您|对方|好友|本人|账户|余额|该|此)?$/;

export function parseMerchant(text: string): string | undefined {
  for (const re of MERCHANT_RES) {
    const m = text.match(re);
    const name = m?.[1]?.trim();
    if (name && !NOT_A_MERCHANT.test(name) && !/^\d+$/.test(name)) return name;
  }
  return undefined;
}

// ---------- 6. pipeline ----------

/**
 * Parse one captured notification. Returns null when it isn't a payment at all —
 * wrong package, marketing copy, a chat message, or no amount to be found.
 *
 * A candidate is `confident` when a merchant name came out, because that's what
 * makes the note meaningful enough to post unattended. Amount and direction are
 * required for any result; the category is a guess either way and stays editable.
 */
export function parseNotification(n: RawNotif): NotifCandidate | null {
  const source = classifySource(n);
  if (!source) return null;

  const text = fullText(n);
  if (!text || NOISE.test(text)) return null;
  if (source === 'wechat' && !WECHAT_PAYMENT.test(text)) return null;

  const io = parseNotifIO(text);
  if (!io) return null;
  const amt = parseNotifAmount(text);
  if (amt == null) return null;

  const merchant = parseMerchant(text);
  return { io, amt, merchant, source, postedAt: n.postedAt, confident: !!merchant };
}

/** Human label for a source, used when there's no merchant to show. */
const SOURCE_LABEL: Record<NotifSource, string> = {
  alipay: '支付宝',
  wechat: '微信支付',
  unionpay: '云闪付',
  bank: '银行卡',
};

/** Resolve a candidate against the user's categories into an Entry-shaped draft. */
export function toEntryDraft(c: NotifCandidate, custom: Record<IO, Category[]>): NotifEntryDraft {
  const note = c.merchant ?? SOURCE_LABEL[c.source];
  return {
    io: c.io,
    amt: c.amt,
    cat: mapCategory(c.io, undefined, note, custom),
    note,
    ts: c.postedAt,
    confident: c.confident,
  };
}

// ---------- 7. duplicate suppression ----------

/** Two captures of one payment (支付宝 posts a 付款成功 push and then a 账单 push)
 *  land seconds apart with the same amount and direction. */
export const DUP_WINDOW_MS = 3 * 60 * 1000;

/** The minimum needed to tell two payments apart. Kept narrower than
 *  NotifCandidate so an already-recorded ledger entry can be compared against a
 *  fresh capture without inventing a source for it. */
export interface PaymentKey {
  io: Exclude<IO, 'xfer'>;
  amt: number;
  postedAt: number;
}

/**
 * True when `c` restates a payment already represented in `seen`. Same direction
 * and amount within a three-minute window counts as the same payment regardless
 * of merchant, because the two pushes for one payment often word it differently
 * — and two genuinely distinct payments of the identical amount inside three
 * minutes are rare enough that a missed entry beats a duplicated one.
 */
export function isDuplicate(c: PaymentKey, seen: PaymentKey[]): boolean {
  return seen.some(
    (s) => s.io === c.io && s.amt === c.amt && Math.abs(s.postedAt - c.postedAt) <= DUP_WINDOW_MS,
  );
}

/** Parse a batch, dropping noise and collapsing duplicate pushes. Order is
 *  preserved; the first capture of a payment wins (it's the one with the
 *  merchant more often than the follow-up). */
export function parseBatch(raws: RawNotif[]): NotifCandidate[] {
  const out: NotifCandidate[] = [];
  for (const r of raws) {
    const c = parseNotification(r);
    if (c && !isDuplicate(c, out)) out.push(c);
  }
  return out;
}
