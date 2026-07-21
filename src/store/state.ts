// Store core — the Legend-State observable, offline persistence, and the core
// entry CRUD every other action module builds on.
//
// Persistence is intentionally a small, explicit hydrate+save loop rather than a
// plugin: it is Expo Go-compatible, easy to unit-test, and decoupled from
// Legend-State's evolving sync API. The per-domain action modules (accounts,
// subscriptions, currency, …) all mutate this same `store$` tree; `ledger.ts`
// re-exports everything so callers keep a single import surface.
import { observable } from '@legendapp/state';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Account, Asset, Category, Currencies, Entry, IO, Loan, Settings, Sub, Tags, Template } from '@/domain/types';
import { curSymbol, setDisplaySymbol } from '@/domain/money';
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

// Entries and config are persisted under separate keys so a config-only change
// (a settings toggle, a theme switch…) never re-serializes the whole entries
// array — which can grow to thousands of rows. The old single-blob key is
// migrated forward on first load. (A per-row SQLite store is the next step for
// very large datasets; this split removes the write amplification cheaply and
// without a native module.)
const ENTRIES_KEY = 'dhh_entries_v1';
const CONFIG_KEY = 'dhh_config_v1';
const LEGACY_KEY = 'dhh_state_v1';

type Config = Omit<AppState, 'hydrated' | 'data'>;

let entriesTimer: ReturnType<typeof setTimeout> | null = null;
let configTimer: ReturnType<typeof setTimeout> | null = null;

function configSnapshot(): Config {
  const { hydrated, data, ...rest } = store$.peek();
  return rest;
}

function saveEntries(): Promise<void> {
  return AsyncStorage.setItem(ENTRIES_KEY, JSON.stringify(store$.data.peek())).catch(() => {});
}
function saveConfig(): Promise<void> {
  return AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(configSnapshot())).catch(() => {});
}

/** Persist entries + config now (used by the one-time legacy migration). */
async function saveAll(): Promise<void> {
  await Promise.all([saveEntries(), saveConfig()]);
}

/** Start debounced autosave. Entry edits only rewrite the entries key; config
 *  changes only rewrite the (small) config key. Call once after loadPersisted. */
export function startAutosave(): void {
  store$.data.onChange(() => {
    if (entriesTimer) clearTimeout(entriesTimer);
    entriesTimer = setTimeout(saveEntries, 400);
  });
  // any change (incl. data) re-saves config; it's tiny, so re-serializing it on
  // an entry edit is negligible — the expensive entries write is gated above.
  store$.onChange(() => {
    if (configTimer) clearTimeout(configTimer);
    configTimer = setTimeout(saveConfig, 400);
  });
}

/** Read persisted state into the store. Call once at boot (see ledger.hydrate). */
export async function loadPersisted(): Promise<void> {
  try {
    const [entriesRaw, configRaw] = await Promise.all([
      AsyncStorage.getItem(ENTRIES_KEY),
      AsyncStorage.getItem(CONFIG_KEY),
    ]);
    if (entriesRaw != null || configRaw != null) {
      if (configRaw) store$.assign(JSON.parse(configRaw) as Partial<AppState>);
      if (entriesRaw) store$.data.set(JSON.parse(entriesRaw) as AppState['data']);
      return;
    }
    // migrate the old single-blob key forward, then drop it
    const legacy = await AsyncStorage.getItem(LEGACY_KEY);
    if (legacy) {
      store$.assign(JSON.parse(legacy) as Partial<AppState>);
      await saveAll();
      await AsyncStorage.removeItem(LEGACY_KEY).catch(() => {});
    }
  } catch {
    // corrupt/missing storage -> fall back to defaults
  }
}

/** Keep money formatting in sync with the base currency, so fmt()/fmtShort()
 *  render the user's actual currency symbol rather than a language default. */
export function wireDisplaySymbol(): void {
  const apply = () => setDisplaySymbol(curSymbol(store$.currencies.base.peek() || 'CNY'));
  apply();
  store$.currencies.base.onChange(apply);
}

// Monotonic counter so IDs minted inside one millisecond can't collide. The
// timestamp alone repeats across a tight loop (bulk bill import, subscription
// catch-up), and 4 random base36 chars is only ~1.7M of space — a 1000-row
// import reliably produced duplicate ids, which silently merge into one row on
// the next sync upsert (onConflict user_id,id). Counter + 8 chars removes it.
let idSeq = 0;

export function newId(prefix = ''): string {
  idSeq = (idSeq + 1) % 0x10000;
  return (
    prefix +
    Date.now().toString(36) +
    idSeq.toString(36).padStart(4, '0') +
    Math.random().toString(36).slice(2, 10)
  );
}

// ---------- core entry CRUD ----------

export function addEntry(e: Omit<Entry, 'id' | 'ts'> & { ts?: number }): Entry {
  const now = Date.now();
  // computed fields go AFTER the spread so an explicit `ts: undefined` in the
  // caller's payload can't clobber the `e.ts ?? now` fallback (spread order)
  const entry: Entry = { ...e, id: newId(), ts: e.ts ?? now, updatedAt: now };
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

/**
 * Apply a patch to an entry, stamping a write time for every field touched.
 *
 * EVERY mutation that writes entry fields must go through this. The per-field
 * timestamps are what make the sync merge resolve a field by recency; a field
 * written without one falls through to merge.ts's deterministic *content*
 * tiebreak, which compares serialized values. That silently reverts edits:
 * a newer `rb:'done'` loses to an older `rb:'pending'` purely because "done"
 * sorts before "pending".
 *
 * Passing `undefined` for a key clears it, and still stamps — so the clear wins
 * over a stale device that still holds a value.
 */
export function stampEntry<T extends Entry>(d: T, patch: Partial<Entry>, now: number): T {
  const fieldTs = { ...(d.fieldTs ?? {}) };
  for (const k of Object.keys(patch)) if (k !== 'fieldTs' && k !== 'updatedAt') fieldTs[k] = now;
  return { ...d, ...patch, fieldTs, updatedAt: now };
}

export function updateEntry(id: string, patch: Partial<Entry>): void {
  const now = Date.now();
  store$.data.set(store$.data.peek().map((d) => (d.id === id ? stampEntry(d, patch, now) : d)));
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
      return stampEntry(x, { refund: refund || undefined }, now);
    }
    // tombstone the entry itself and any refund incomes pointing at it
    if (x.id === id || x.refundOf === id) {
      return stampEntry(x, { deletedAt: now }, now);
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

/** Set (or clear, when amt<=0) a per-category budget limit. */
export function setCatBudget(catKey: string, amt: number): void {
  const cb = { ...(store$.settings.catBudgets.peek() ?? {}) };
  if (amt > 0) cb[catKey] = amt;
  else delete cb[catKey];
  store$.settings.catBudgets.set(cb);
}

/** Bulk-append imported bills (e.g. from an Alipay/WeChat CSV) as entries in a
 *  single store write. Each becomes a normal expense/income entry, stamped for
 *  sync. Returns the number added. */
export function importBills(
  bills: { io: 'exp' | 'inc'; cat: string; amt: number; note: string; ts: number }[],
): number {
  if (!bills.length) return 0;
  const now = Date.now();
  const entries: Entry[] = bills.map((b, i) => ({
    id: newId('bi'),
    ts: b.ts,
    io: b.io,
    cat: b.cat,
    amt: b.amt,
    note: b.note || undefined,
    updatedAt: now + i, // keep updatedAt distinct so LWW ordering is stable
  }));
  store$.data.set([...store$.data.peek(), ...entries]);
  return entries.length;
}

/** Full backup payload (importable via importV7). Excludes the device lock. */
export function buildBackup(): Record<string, unknown> {
  const { hydrated, settings, ...rest } = store$.peek();
  const { lock, ...safeSettings } = settings;
  return { app: 'dahonghua', version: 8, exportedAt: new Date().toISOString(), settings: safeSettings, ...rest };
}
