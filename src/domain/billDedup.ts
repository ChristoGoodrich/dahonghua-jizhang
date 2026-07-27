// Deduplication and candidate matching for bill import.
//
// Category resolution (keyword + exact match), note composition, and the
// multiset-based dedup that turns parsed bills into import-ready candidates.
import type { Category, Entry, IO } from './types';
import { allCats } from './cats';
import type { RawBill } from './billParse';

/** An import-ready candidate: an Entry-shaped payload plus preview metadata. */
export interface Candidate {
  io: Exclude<IO, 'xfer'>;
  cat: string; // resolved category key
  amt: number;
  note: string;
  ts: number;
  dup: boolean; // already present in the store (skipped by default)
}

// ---------- category mapping ----------

// Substring keyword → our category key, scoped by io. First match wins.
const EXP_KEYWORDS: [string, string[]][] = [
  ['food', ['餐饮', '美食', '外卖', '咖啡', '奶茶', '饮', '零食', '水果', '生鲜', '快餐', '食堂', '早餐', '午餐', '晚餐', '烧烤', '火锅', '面', '饭']],
  ['shop', ['购物', '服饰', '服装', '日用', '百货', '数码', '电器', '美妆', '化妆', '淘宝', '京东', '拼多多', '天猫', '网购', '家居', '母婴', '鞋帽', '箱包']],
  ['trans', ['交通', '出行', '打车', '地铁', '公交', '火车', '高铁', '飞机', '加油', '停车', '滴滴', '出租', '车费', '通勤', '单车', '共享']],
  ['home', ['居家', '房租', '物业', '水电', '燃气', '家政', '房贷', '缴费', '话费', '宽带', '电费', '水费', '充值']],
  ['fun', ['娱乐', '游戏', '电影', '休闲', '视频', '会员', '音乐', 'ktv', '文化', '演出', '订阅', '游玩']],
  ['health', ['医疗', '医药', '药', '医院', '健康', '挂号', '体检', '诊所', '牙']],
  ['study', ['学习', '教育', '培训', '图书', '书', '课程', '文具', '学费', '知识']],
  ['gift', ['人情', '红包', '礼', '请客', '份子', '捐']],
  ['travel', ['旅行', '旅游', '酒店', '机票', '民宿', '景点', '度假', '住宿']],
];
const INC_KEYWORDS: [string, string[]][] = [
  ['salary', ['工资', '薪', '报酬', '劳务', '发薪']],
  ['bonus', ['奖金', '红包', '返现', '奖励', '补贴', '退税']],
  ['invest', ['理财', '收益', '基金', '股', '利息', '分红', '存款', '余额宝']],
  ['parttime', ['兼职', '外快', '副业', '接单']],
];

/**
 * Resolve a source category label (+ note fallback) to one of our category keys.
 * Tries an exact name match against the user's real categories first (so a
 * custom "咖啡" category is honored), then a keyword table, then 'other'.
 */
export function mapCategory(
  io: Exclude<IO, 'xfer'>,
  srcCat: string | undefined,
  note: string | undefined,
  custom: Record<IO, Category[]>,
): string {
  const hay = `${srcCat ?? ''} ${note ?? ''}`.toLowerCase();
  const cats = allCats(io, custom);
  // exact label match against real category names
  if (srcCat) {
    const label = srcCat.trim();
    const hit = cats.find((c) => c.zh === label || c.en.toLowerCase() === label.toLowerCase());
    if (hit) return hit.k;
  }
  // keyword table
  const table = io === 'exp' ? EXP_KEYWORDS : INC_KEYWORDS;
  for (const [key, words] of table) {
    if (words.some((w) => hay.includes(w.toLowerCase()))) {
      // only return keys that actually exist in this io's category set
      if (cats.some((c) => c.k === key)) return key;
    }
  }
  return 'other';
}

/** Compose a human note from the counterparty + product description. */
export function composeNote(bill: RawBill): string {
  const parts = [bill.party?.trim(), bill.desc?.trim()].filter((p): p is string => !!p);
  // avoid "X · X" when party and desc are identical
  const uniq = parts.filter((p, i) => parts.indexOf(p) === i);
  return uniq.join(' · ').slice(0, 80);
}

// ---------- dedup ----------

function ymd(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
/** Coarse dedup key: same direction, same amount, same calendar day. The note is
 *  matched separately because not every source spells it the same way. */
function looseKey(io: string, amt: number, ts: number): string {
  return `${io}|${amt.toFixed(2)}|${ymd(ts)}`;
}

/** An existing entry still available to absorb a candidate. */
interface Slot {
  note: string;
  /** Match this slot on amount+day alone, ignoring the note. */
  anyNote: boolean;
}

/**
 * Turn parsed bills into import-ready candidates and flag those already present
 * in the store. Dedup is multiset-based against existing (non-deleted) entries —
 * each existing entry is "consumed" once — so re-importing the same file is
 * idempotent while genuine same-day duplicates in a first import are preserved.
 *
 * Notification-captured entries (`src: 'notif'`) match on amount + day alone.
 * A notification only carries the merchant ("星巴克") while the CSV row for that
 * same payment reads "星巴克咖啡(国贸店) · 消费", so a note-sensitive match would
 * call them different transactions and the monthly CSV import would duplicate
 * every payment the listener already captured. An exact note match is still
 * tried first, so a hand-typed entry is preferred over a captured one when both
 * could absorb the same row.
 */
export function toCandidates(
  bills: RawBill[],
  existing: Entry[],
  custom: Record<IO, Category[]>,
): Candidate[] {
  const buckets = new Map<string, Slot[]>();
  for (const e of existing) {
    if (e.deletedAt || e.io === 'xfer') continue;
    const k = looseKey(e.io, e.amt, e.ts);
    const slot: Slot = { note: e.note ?? '', anyNote: e.src === 'notif' };
    const bucket = buckets.get(k);
    if (bucket) bucket.push(slot);
    else buckets.set(k, [slot]);
  }
  return bills.map((b) => {
    const note = composeNote(b);
    const cat = mapCategory(b.io, b.srcCat, note, custom);
    const bucket = buckets.get(looseKey(b.io, b.amt, b.ts));
    let hit = -1;
    if (bucket) {
      hit = bucket.findIndex((s) => s.note === note);
      if (hit < 0) hit = bucket.findIndex((s) => s.anyNote);
    }
    const dup = hit >= 0;
    if (bucket && dup) bucket.splice(hit, 1); // consume it — one row per entry
    return { io: b.io, cat, amt: b.amt, note, ts: b.ts, dup };
  });
}
