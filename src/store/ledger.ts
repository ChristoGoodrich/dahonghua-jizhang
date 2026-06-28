// Ledger store — Legend-State observable with offline AsyncStorage persistence.
//
// Persistence is intentionally a small, explicit hydrate+save loop rather than a
// plugin: it is Expo Go-compatible, easy to unit-test, and decoupled from
// Legend-State's evolving sync API. Phase 3 swaps this for the Supabase sync
// plugin (cloud account + realtime multi-device) without touching the UI.
import { observable } from '@legendapp/state';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Account, Asset, Category, Currencies, Entry, IO, Loan, Settings, Sub, Tags, Template } from '@/domain/types';
import { CAT_PALETTE, catOf, catName } from '@/domain/cats';
import { computeDueCharges } from '@/domain/subscriptions';
import type { Lang } from '@/i18n';

export interface AppState {
  lang: Lang;
  data: Entry[];
  settings: Settings;
  customCats: Record<IO, Category[]>;
  accounts: Account[];
  assets: Asset[];
  loans: Loan[];
  subs: Sub[];
  templates: Template[];
  tags: Tags;
  curLedger: string;
  currencies: Currencies;
  subcats: Record<string, { k: string; name: string }[]>;
  curAccount: string;
  hydrated: boolean;
}

const DEFAULTS: AppState = {
  lang: 'zh',
  data: [],
  settings: { budget: 0, cycleStart: 1, theme: 'default', dark: false },
  customCats: { exp: [], inc: [], xfer: [] },
  accounts: [{ id: 'default', name: '默认', nameEn: 'Default', balance: 0 }],
  assets: [],
  loans: [],
  subs: [],
  templates: [],
  tags: { normal: [], ledger: [] },
  curLedger: '',
  currencies: { base: 'CNY', rates: {} },
  subcats: {},
  curAccount: 'default',
  hydrated: false,
};

export const store$ = observable<AppState>(structuredClone(DEFAULTS));

const STORAGE_KEY = 'dhh_state_v1';
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Snapshot the persistable state (everything except transient flags). */
function snapshot(): Omit<AppState, 'hydrated'> {
  const { hydrated, ...rest } = store$.peek();
  return rest;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot())).catch(() => {
      // best-effort; a real device rarely fails here, but never throw into render
    });
  }, 400);
}

/** Load persisted state, then start auto-saving on every change. Call once at boot. */
export async function hydrate(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppState>;
      store$.assign(saved);
    }
  } catch {
    // corrupt/missing storage -> fall back to defaults
  }
  store$.hydrated.set(true);
  store$.onChange(() => scheduleSave());
  runSubscriptions(); // catch up any subscription charges missed while away
}

export function newId(prefix = ''): string {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 6);
}

// ---------- actions ----------

export function addEntry(e: Omit<Entry, 'id' | 'ts'> & { ts?: number }): Entry {
  const now = Date.now();
  const entry: Entry = { id: newId(), ts: e.ts ?? now, ...e, updatedAt: now };
  store$.data.set([...store$.data.peek(), entry]);
  if (entry.acct) store$.curAccount.set(entry.acct);
  return entry;
}

/** Record a transfer between two accounts as one `io:'xfer'` entry. The optional
 *  fee is deducted from the FROM account; the optional discount credits the TO
 *  account. Excluded from income/expense stats by its `io`. */
export function addTransfer(p: {
  from: string;
  to: string;
  amt: number;
  fee?: number;
  discount?: number;
  note?: string;
  ledger?: string;
  ts?: number;
}): Entry {
  const now = Date.now();
  const entry: Entry = {
    id: newId(),
    ts: p.ts ?? now,
    io: 'xfer',
    cat: 'transfer',
    amt: p.amt,
    acct: p.from,
    acctTo: p.to,
    fee: p.fee || undefined,
    discount: p.discount || undefined,
    note: p.note?.trim() || undefined,
    ledger: p.ledger || undefined,
    updatedAt: now,
  };
  store$.data.set([...store$.data.peek(), entry]);
  store$.curAccount.set(p.from);
  return entry;
}

export function updateEntry(id: string, patch: Partial<Entry>): void {
  const now = Date.now();
  store$.data.set(store$.data.peek().map((d) => (d.id === id ? { ...d, ...patch, updatedAt: now } : d)));
}

/** Soft-delete an entry (tombstone for sync), keeping refund bookkeeping
 *  consistent. The tombstone stays in `data`; all display/calc reads filter
 *  `!deletedAt`. Deleting an original also tombstones its refund incomes. */
export function removeEntry(id: string): void {
  const now = Date.now();
  const list = store$.data.peek();
  const d = list.find((x) => x.id === id);
  if (!d) return;
  const next = list.map((x) => {
    // give the refunded amount back to the original when deleting a refund income
    if (d.refundOf && x.id === d.refundOf && x.refund) {
      const refund = Math.max(0, x.refund - d.amt);
      return { ...x, refund: refund || undefined, updatedAt: now };
    }
    // tombstone the entry itself and any refund incomes pointing at it
    if (x.id === id || x.refundOf === id) {
      return { ...x, deletedAt: now, updatedAt: now };
    }
    return x;
  });
  store$.data.set(next);
}

export function setLang(lang: Lang): void {
  store$.lang.set(lang);
}

export function patchSettings(patch: Partial<Settings>): void {
  store$.settings.assign(patch);
}

/** Full backup payload (importable via importV7). Excludes the device lock. */
export function buildBackup(): Record<string, unknown> {
  const { hydrated, settings, ...rest } = store$.peek();
  const { lock, ...safeSettings } = settings;
  return { app: 'dahonghua', version: 8, exportedAt: new Date().toISOString(), settings: safeSettings, ...rest };
}

// ---------- accounts ----------

export function addAccount(name: string, balance = 0, kind: Account['kind'] = 'cash'): Account {
  const a: Account = { id: newId('a'), name, nameEn: name, balance, kind };
  store$.accounts.set([...store$.accounts.peek(), a]);
  return a;
}

/** Delete an account, migrating its transactions to default (ported from v7). */
export function removeAccount(id: string): void {
  if (id === 'default') return;
  store$.data.set(store$.data.peek().map((d) => (d.acct === id ? { ...d, acct: 'default' } : d)));
  store$.accounts.set(store$.accounts.peek().filter((a) => a.id !== id));
  if (store$.curAccount.peek() === id) store$.curAccount.set('default');
}

// ---------- custom categories ----------

export function addCustomCat(io: IO, name: string, emoji: string): Category {
  const list = store$.customCats[io].peek();
  const c: Category = {
    k: 'c' + Date.now(),
    e: emoji,
    zh: name,
    en: name,
    c: CAT_PALETTE[list.length % CAT_PALETTE.length],
    custom: true,
  };
  store$.customCats[io].set([...list, c]);
  return c;
}

// ---------- assets / liabilities ----------

export function addAsset(name: string, type: 'asset' | 'liab', val: number): Asset {
  const a: Asset = { id: newId('as'), name, type, val, noCount: false };
  store$.assets.set([...store$.assets.peek(), a]);
  return a;
}

export function removeAsset(id: string): void {
  store$.assets.set(store$.assets.peek().filter((a) => a.id !== id));
}

// ---------- loans (borrow / lend) ----------

export function addLoan(who: string, type: 'lend' | 'borrow', amt: number): Loan {
  const l: Loan = { id: newId('ln'), who, type, amt, repaid: 0, ts: Date.now() };
  store$.loans.set([...store$.loans.peek(), l]);
  return l;
}

/** Record a repayment, clamped to the remaining balance. */
export function repayLoan(id: string, amount: number): void {
  store$.loans.set(
    store$.loans.peek().map((l) => {
      if (l.id !== id) return l;
      const remaining = Math.max(0, l.amt - (l.repaid ?? 0));
      return { ...l, repaid: (l.repaid ?? 0) + Math.min(amount, remaining) };
    }),
  );
}

export function removeLoan(id: string): void {
  store$.loans.set(store$.loans.peek().filter((l) => l.id !== id));
}

// ---------- subscriptions ----------

export function addSub(sub: Omit<Sub, 'id' | 'created' | 'lastCharged'>): Sub {
  const s: Sub = { ...sub, id: newId('s'), created: Date.now(), lastCharged: '' };
  store$.subs.set([...store$.subs.peek(), s]);
  runSubscriptions(); // charge immediately if already due today
  return s;
}

export function removeSub(id: string): void {
  store$.subs.set(store$.subs.peek().filter((s) => s.id !== id));
}

/** Apply any due subscription charges. Returns the names that fired. */
export function runSubscriptions(now: Date = new Date()): string[] {
  const subs = store$.subs.peek();
  if (!subs.length) return [];
  const data = [...store$.data.peek()];
  const fired: string[] = [];
  let changed = false;
  const nextSubs = subs.map((sub) => {
    const { charges, lastCharged } = computeDueCharges(sub, now);
    if (!charges.length) return sub;
    // installment cap: never fire more than `periods` charges in total
    let toApply = charges;
    if (sub.periods && sub.periods > 0) {
      const remaining = Math.max(0, sub.periods - (sub.charged ?? 0));
      toApply = charges.slice(0, remaining);
    }
    if (!toApply.length) return { ...sub, lastCharged }; // advance the cursor, charge nothing
    changed = true;
    for (const ts of toApply) {
      if (sub.kind === 'transfer' && sub.from && sub.to) {
        data.push({ id: newId('sub'), ts, io: 'xfer', cat: 'transfer', amt: sub.amt, acct: sub.from, acctTo: sub.to, note: sub.name, fromSub: true, updatedAt: Date.now() });
      } else {
        data.push({ id: newId('sub'), ts, io: 'exp', cat: sub.cat || 'home', amt: sub.amt, note: sub.name, fromSub: true, updatedAt: Date.now() });
      }
      fired.push(sub.name);
    }
    return { ...sub, lastCharged, ...(sub.periods ? { charged: (sub.charged ?? 0) + toApply.length } : {}) };
  });
  if (changed) {
    store$.data.set(data);
    store$.subs.set(nextSubs);
  }
  return fired;
}

// ---------- quick templates ----------

export function addTemplate(tpl: Omit<Template, 'id'>): Template {
  const t: Template = { ...tpl, id: newId('t') };
  store$.templates.set([...store$.templates.peek(), t]);
  return t;
}

export function removeTemplate(id: string): void {
  store$.templates.set(store$.templates.peek().filter((t) => t.id !== id));
}

/** Instantly log an entry from a template (uses the current account/ledger). */
export function logTemplate(id: string): Entry | null {
  const tpl = store$.templates.peek().find((t) => t.id === id);
  if (!tpl) return null;
  return addEntry({
    io: tpl.io,
    cat: tpl.cat,
    amt: tpl.amt,
    note: tpl.note ?? '',
    acct: store$.curAccount.peek(),
    ledger: store$.curLedger.peek() || undefined,
  });
}

// ---------- tags & ledgers ----------

export function addTag(type: keyof Tags, name: string): void {
  const list = store$.tags[type].peek();
  if (!list.includes(name)) store$.tags[type].set([...list, name]);
}

export function removeTag(type: keyof Tags, name: string): void {
  store$.tags[type].set(store$.tags[type].peek().filter((g) => g !== name));
  if (type === 'ledger' && store$.curLedger.peek() === name) store$.curLedger.set('');
}

export function setCurLedger(ledger: string): void {
  store$.curLedger.set(ledger);
}

// ---------- multi-currency ----------

export function setBaseCurrency(code: string): void {
  store$.currencies.base.set(code);
}

export function setRate(code: string, rate: number): void {
  store$.currencies.rates.set({ ...store$.currencies.rates.peek(), [code]: rate });
}

export function addRate(code: string): void {
  const rates = store$.currencies.rates.peek();
  if (!rates[code]) store$.currencies.rates.set({ ...rates, [code]: 1 });
}

export function removeRate(code: string): void {
  const rates = { ...store$.currencies.rates.peek() };
  delete rates[code];
  store$.currencies.rates.set(rates);
}

/** Refresh rates from a free exchange-rate API (1 foreign = ? base). */
export async function updateRates(): Promise<boolean> {
  const base = store$.currencies.base.peek() || 'CNY';
  const codes = Object.keys(store$.currencies.rates.peek());
  if (!codes.length) return false;
  try {
    const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${base}`);
    const j = await res.json();
    const rates = { ...store$.currencies.rates.peek() };
    codes.forEach((c) => {
      if (j.rates && j.rates[c]) rates[c] = +(1 / j.rates[c]).toFixed(4);
    });
    store$.currencies.rates.set(rates);
    return true;
  } catch {
    return false;
  }
}

// ---------- subcategories ----------

export function addSubcat(catKey: string, name: string): void {
  const map = store$.subcats.peek();
  const list = map[catKey] ?? [];
  store$.subcats.set({ ...map, [catKey]: [...list, { k: newId('sc'), name }] });
}

export function removeSubcat(catKey: string, k: string): void {
  const map = store$.subcats.peek();
  store$.subcats.set({ ...map, [catKey]: (map[catKey] ?? []).filter((sc) => sc.k !== k) });
}

// ---------- reimbursement / refund ----------

export function toggleReimburse(id: string): void {
  const now = Date.now();
  store$.data.set(
    store$.data.peek().map((d) => {
      if (d.id !== id) return d;
      if (d.rb === 'pending') {
        const { rb, ...rest } = d;
        return { ...rest, updatedAt: now };
      }
      return { ...d, rb: 'pending' as const, updatedAt: now };
    }),
  );
}

export function confirmReimburse(id: string): void {
  const now = Date.now();
  store$.data.set(
    store$.data.peek().map((d) => (d.id === id ? { ...d, rb: 'done' as const, rbAmt: d.amt, updatedAt: now } : d)),
  );
}

export function unmarkReimburse(id: string): void {
  const now = Date.now();
  store$.data.set(
    store$.data.peek().map((d) => {
      if (d.id !== id) return d;
      const { rb, rbAmt, ...rest } = d;
      return { ...rest, updatedAt: now };
    }),
  );
}

/** Refund part/all of an expense: bumps its `refund` total and logs a linked
 *  income so balances reflect the money coming back (ported from v7). */
export function refundEntry(id: string, amount: number, lang: Lang): number {
  const list = store$.data.peek();
  const d = list.find((x) => x.id === id);
  if (!d) return 0;
  const already = d.refund ?? 0;
  const maxR = d.amt - already;
  const r = Math.min(amount, maxR);
  if (r <= 0) return 0;
  const now = Date.now();
  const c = catOf(d.io, d.cat, store$.customCats.peek());
  const note = (lang === 'zh' ? '退款·' : 'Refund·') + (d.note || catName(c, lang));
  const next = list.map((x) => (x.id === id ? { ...x, refund: already + r, updatedAt: now } : x));
  next.push({
    id: newId(),
    ts: now,
    io: 'inc',
    cat: 'other',
    amt: r,
    note,
    acct: d.acct || store$.curAccount.peek(),
    refundOf: id,
    updatedAt: now,
  });
  store$.data.set(next);
  return r;
}
