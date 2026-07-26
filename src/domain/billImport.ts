// Alipay / WeChat CSV bill import — inspired by Cookie 记账's 账单导入 (BillImportMapper).
//
// Chinese users' real transaction history lives in the CSV exports 支付宝 and 微信支付
// produce ("导出交易记录"). Those files have a multi-line preamble, then a header row,
// then the data. Column order differs between wallets and even between export versions,
// so — like Cookie — this importer does NOT hardcode a layout: it finds the header row,
// maps columns by keyword, and normalizes each data row into a candidate entry. Every
// function here is pure so the parsing rules can be unit-tested without any file I/O.
import type { Category, Entry, IO } from './types';
import { allCats } from './cats';
import { decodeGbkJs, decodeUtf8Js } from './encoding';

export type BillSource = 'alipay' | 'wechat' | 'generic';

/** A normalized row lifted out of the CSV, before it becomes an Entry. */
export interface RawBill {
  ts: number; // epoch ms
  io: Exclude<IO, 'xfer'>; // 收/支 → inc/exp (rows that are neither are dropped)
  amt: number; // positive, in the file's currency (assumed base)
  srcCat?: string; // the wallet's own category label (交易分类/类型)
  party?: string; // 交易对方
  desc?: string; // 商品说明/商品
  method?: string; // 收/付款方式/支付方式
  status?: string; // 交易状态/当前状态
}

/** Header-index for each field we care about; -1/undefined = column absent. */
export interface ColumnMap {
  ts: number;
  amt: number;
  io: number;
  srcCat: number;
  party: number;
  desc: number;
  method: number;
  status: number;
}

export interface RowError {
  row: number; // 1-indexed line number in the original CSV text
  reason: string;
}

export interface ParseResult {
  source: BillSource;
  headerRow: number; // index into the raw rows, -1 if no header found
  columns: ColumnMap | null;
  bills: RawBill[];
  dataRows: number; // data rows seen below the header
  skipped: number; // data rows that were unusable (不计收支 / closed / unparseable)
  errors: RowError[];
}

/** An import-ready candidate: an Entry-shaped payload plus preview metadata. */
export interface Candidate {
  io: Exclude<IO, 'xfer'>;
  cat: string; // resolved category key
  amt: number;
  note: string;
  ts: number;
  dup: boolean; // already present in the store (skipped by default)
}

// ---------- 0. encoding ----------

/** Well-formed-UTF-8 check. GBK/GB18030 text (支付宝 exports) trips the
 *  continuation-byte rules almost immediately, so a false result is a reliable
 *  "this isn't UTF-8" signal for choosing a fallback decoder. */
export function looksLikeUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i];
    if (b < 0x80) { i++; continue; }
    let extra: number;
    if (b >= 0xc2 && b <= 0xdf) extra = 1;
    else if (b >= 0xe0 && b <= 0xef) extra = 2;
    else if (b >= 0xf0 && b <= 0xf4) extra = 3;
    else return false; // invalid lead byte (0x80–0xC1, 0xF5–0xFF)
    if (i + extra >= n) return false;
    for (let j = 1; j <= extra; j++) if ((bytes[i + j] & 0xc0) !== 0x80) return false;
    i += extra + 1;
  }
  return true;
}

/**
 * Decode a bill file's raw bytes, auto-detecting the encoding: a UTF-8 BOM
 * (微信 writes one) or valid UTF-8 → UTF-8; otherwise GBK (支付宝's classic
 * encoding). Falls back to UTF-8 where a platform's TextDecoder has no 'gbk'
 * label (some RN engines) so it never throws — worst case the user re-saves the
 * CSV as UTF-8.
 */
/** Platform TextDecoder when available (web, Node); null when the engine lacks
 *  it or the label is unsupported (Hermes has no 'gbk'). */
function tryTextDecoder(label: string, bytes: Uint8Array): string | null {
  try {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder(label).decode(bytes);
  } catch {
    // unsupported label on this engine — fall through to the JS decoder
  }
  return null;
}

export function decodeBillText(bytes: Uint8Array): string {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (bom || looksLikeUtf8(bytes)) {
    // TextDecoder strips the BOM itself; the JS fallback needs it sliced off
    return tryTextDecoder('utf-8', bytes) ?? decodeUtf8Js(bom ? bytes.subarray(3) : bytes);
  }
  return tryTextDecoder('gbk', bytes) ?? decodeGbkJs(bytes);
}

// ---------- 1. CSV parsing ----------

/**
 * Parse CSV text into a matrix. Handles the RFC-4180 essentials the wallet
 * exports rely on: quoted fields, embedded commas/newlines/escaped quotes, and
 * CRLF line endings. A leading UTF-8 BOM (WeChat writes one) is stripped.
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* swallow, handled by \n */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  // trailing field/row (file may end without a newline)
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ---------- 2. header detection + column mapping ----------

// Keyword → field. Order matters: the first field whose keyword list matches a
// header cell wins, so more specific fields are listed before generic ones.
const TS_KEYS = ['交易时间', '交易创建时间', '付款时间', '时间', '日期'];
const AMT_KEYS = ['金额', '发生金额', '交易金额'];
const IO_KEYS = ['收/支', '收支', '收/付'];
const CAT_KEYS = ['交易分类', '交易类型', '类型', '分类'];
const PARTY_KEYS = ['交易对方', '对方', '商户名称'];
const DESC_KEYS = ['商品说明', '商品名称', '商品', '说明', '摘要', '备注'];
const METHOD_KEYS = ['收/付款方式', '付款方式', '支付方式', '收款方式'];
const STATUS_KEYS = ['交易状态', '当前状态', '状态'];

function findCol(header: string[], keys: string[]): number {
  for (const k of keys) {
    const i = header.findIndex((h) => h.trim().includes(k));
    if (i >= 0) return i;
  }
  return -1;
}

/** True if a row looks like the column header (has a time-ish and a 收/支 column). */
function isHeaderRow(row: string[]): boolean {
  return findCol(row, TS_KEYS) >= 0 && findCol(row, IO_KEYS) >= 0 && findCol(row, AMT_KEYS) >= 0;
}

/** Locate the header row, skipping the export's preamble. -1 if not found. */
export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < rows.length; i++) if (isHeaderRow(rows[i])) return i;
  return -1;
}

/** Guess which wallet produced the file, for display + slightly tuned defaults. */
export function detectSource(rows: string[][]): BillSource {
  const head = rows.slice(0, 25).map((r) => r.join('')).join('\n');
  if (/支付宝|alipay/i.test(head)) return 'alipay';
  if (/微信|wechat|weixin|财付通/i.test(head)) return 'wechat';
  return 'generic';
}

/** Map header cells to our fields. Returns null if the required columns (time,
 *  amount, 收/支) can't all be found. */
export function autoMap(header: string[]): ColumnMap | null {
  const map: ColumnMap = {
    ts: findCol(header, TS_KEYS),
    amt: findCol(header, AMT_KEYS),
    io: findCol(header, IO_KEYS),
    srcCat: findCol(header, CAT_KEYS),
    party: findCol(header, PARTY_KEYS),
    desc: findCol(header, DESC_KEYS),
    method: findCol(header, METHOD_KEYS),
    status: findCol(header, STATUS_KEYS),
  };
  if (map.ts < 0 || map.amt < 0 || map.io < 0) return null;
  return map;
}

// ---------- 3. value parsers ----------

/** Parse a wallet datetime string to epoch ms. Accepts `2024-01-05 12:30:00`,
 *  `2024/1/5 8:00`, `2024-01-05`, and `2024年1月5日 12:30`. null if unparseable. */
export function parseDateMs(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const dt = new Date(+y, +mo - 1, +d, +(h ?? 0), +(mi ?? 0), +(se ?? 0));
  const t = dt.getTime();
  return Number.isFinite(t) ? t : null;
}

/** Parse an amount cell, tolerating currency symbols, thousands separators, a
 *  leading sign, and stray spaces. Returns the magnitude (always ≥ 0). */
export function parseAmount(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[^\d.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.abs(Math.round(n * 100) / 100);
}

/** Interpret the 收/支 cell. 支出→exp, 收入→inc; 不计收支 / blank / "/" → null. */
export function parseIO(s: string | undefined): Exclude<IO, 'xfer'> | null {
  if (!s) return null;
  if (s.includes('支出') || /expense/i.test(s)) return 'exp';
  if (s.includes('收入') || /income/i.test(s)) return 'inc';
  return null; // 不计收支, 其他, "/"
}

// A transaction status that means the money never actually moved — dropped.
const DEAD_STATUS = /关闭|失败|退款成功|已退款|全额退款|冻结|解冻/;

// ---------- 4. category mapping ----------

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

// ---------- 5. pipeline ----------

/** Parse raw CSV text into normalized bills (no store access, no dedup). */
export function parseBills(text: string): ParseResult {
  const rows = parseCSV(text);
  const source = detectSource(rows);
  const headerRow = findHeaderRow(rows);
  if (headerRow < 0) {
    return { source, headerRow: -1, columns: null, bills: [], dataRows: 0, skipped: 0, errors: [] };
  }
  const columns = autoMap(rows[headerRow]);
  if (!columns) {
    return { source, headerRow, columns: null, bills: [], dataRows: 0, skipped: 0, errors: [] };
  }
  const bills: RawBill[] = [];
  const errors: RowError[] = [];
  let dataRows = 0;
  let skipped = 0;
  const at = (row: string[], i: number) => (i >= 0 && i < row.length ? row[i] : undefined);
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row.length || row.every((c) => !c.trim())) continue; // blank line
    dataRows++;
    const io = parseIO(at(row, columns.io));
    const amt = parseAmount(at(row, columns.amt));
    const ts = parseDateMs(at(row, columns.ts));
    const status = at(row, columns.status);
    if (!io || amt == null || amt <= 0 || ts == null || (status && DEAD_STATUS.test(status))) {
      skipped++;
      let reason: string;
      if (status && DEAD_STATUS.test(status)) reason = `交易状态: ${status.trim()}`;
      else if (!io) reason = '不计收支或收/支字段为空';
      else if (ts == null) reason = '无法解析交易时间';
      else reason = '金额无效或为零';
      errors.push({ row: r + 1, reason }); // r is 0-indexed CSV row; +1 for human line number
      continue;
    }
    bills.push({
      ts, io, amt,
      srcCat: at(row, columns.srcCat)?.trim() || undefined,
      party: at(row, columns.party)?.trim() || undefined,
      desc: at(row, columns.desc)?.trim() || undefined,
      method: at(row, columns.method)?.trim() || undefined,
      status: status?.trim() || undefined,
    });
  }
  return { source, headerRow, columns, bills, dataRows, skipped, errors };
}

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

export interface ImportPreview {
  source: BillSource;
  ok: boolean; // header found + at least one usable bill
  candidates: Candidate[];
  fresh: Candidate[]; // candidates not already in the store
  dupCount: number;
  skipped: number;
  errors: RowError[];
  expCount: number;
  incCount: number;
  expSum: number;
  incSum: number;
}

/** End-to-end: text → a preview the import screen renders and then applies. */
export function prepareImport(
  text: string,
  existing: Entry[],
  custom: Record<IO, Category[]>,
): ImportPreview {
  const parsed = parseBills(text);
  const candidates = toCandidates(parsed.bills, existing, custom);
  const fresh = candidates.filter((c) => !c.dup);
  const expSum = fresh.filter((c) => c.io === 'exp').reduce((s, c) => s + c.amt, 0);
  const incSum = fresh.filter((c) => c.io === 'inc').reduce((s, c) => s + c.amt, 0);
  return {
    source: parsed.source,
    ok: parsed.headerRow >= 0 && candidates.length > 0,
    candidates,
    fresh,
    dupCount: candidates.length - fresh.length,
    skipped: parsed.skipped,
    errors: parsed.errors,
    expCount: fresh.filter((c) => c.io === 'exp').length,
    incCount: fresh.filter((c) => c.io === 'inc').length,
    expSum: Math.round(expSum * 100) / 100,
    incSum: Math.round(incSum * 100) / 100,
  };
}
