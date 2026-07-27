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
import { monthKey } from './indexes';

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

// ---------- full-dataset gate ----------
//
// The fast hydration pass loads only the current month, so between it and the
// full load `store$.data` is a SUBSET of what's on disk. Anything that treats
// the in-memory list as complete during that window corrupts data:
//   - autosave would persist the subset, wiping history from disk;
//   - the sync pull would merge against the subset and advance its watermark
//     past history that was never pushed;
//   - subscription catch-up and the notification drain would post entries that
//     the full load then replaces.
// All of those now wait on this gate; hydrateFull()/hydrate() open it.
let dataReadyFlag = false;
let resolveDataReady: () => void;
const dataReadyPromise = new Promise<void>((r) => { resolveDataReady = r; });
// entry writes that happened while the gate was closed still need persisting
let entriesDirtyBeforeReady = false;
// suppresses the dirty flag while a loader swaps persisted data into the store
let applyingLoad = false;

/** True once the full entry list is in memory. */
export function isDataReady(): boolean {
  return dataReadyFlag;
}

/** Resolves once the full entry list is in memory (immediately if it already is). */
export function whenDataReady(): Promise<void> {
  return dataReadyPromise;
}

/** Open the gate. Called by the hydrate paths once the full dataset is loaded;
 *  flushes any entry write that was deferred while the gate was closed. */
export function markDataReady(): void {
  if (dataReadyFlag) return;
  dataReadyFlag = true;
  resolveDataReady();
  if (entriesDirtyBeforeReady) {
    entriesDirtyBeforeReady = false;
    scheduleEntriesSave();
  }
}

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

function scheduleEntriesSave(): void {
  if (entriesTimer) clearTimeout(entriesTimer);
  entriesTimer = setTimeout(saveEntries, 400);
}

/** Persist entries + config now (used by the one-time legacy migration). */
async function saveAll(): Promise<void> {
  await Promise.all([saveEntries(), saveConfig()]);
}

/** Start debounced autosave. Entry edits only rewrite the entries key; config
 *  changes only rewrite the (small) config key. Call once after loadPersisted.
 *
 *  Entry saves are gated on the full dataset being in memory: after the fast
 *  (current-month) hydration pass, persisting `store$.data` would overwrite the
 *  full history on disk with the subset. Writes made while the gate is closed
 *  are flushed by markDataReady(). Config is loaded in full by the fast pass,
 *  so config saves are never deferred. */
export function startAutosave(): void {
  store$.data.onChange(() => {
    if (applyingLoad) return; // a loader swapping persisted data in — not an edit
    if (!dataReadyFlag) {
      entriesDirtyBeforeReady = true;
      return;
    }
    scheduleEntriesSave();
  });
  // any change (incl. data) re-saves config; it's tiny, so re-serializing it on
  // an entry edit is negligible — the expensive entries write is gated above.
  store$.onChange(() => {
    if (configTimer) clearTimeout(configTimer);
    configTimer = setTimeout(saveConfig, 400);
  });
}

/** Current YYYY-MM key for filtering the fast hydration pass. */
function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Read config + current-month entries only — gives the UI something to render
 *  immediately while the full dataset loads in the background. */
export async function loadPersistedCurrentMonth(): Promise<void> {
  try {
    const [entriesRaw, configRaw] = await Promise.all([
      AsyncStorage.getItem(ENTRIES_KEY),
      AsyncStorage.getItem(CONFIG_KEY),
    ]);
    if (entriesRaw != null || configRaw != null) {
      applyingLoad = true;
      try {
        if (configRaw) store$.assign(JSON.parse(configRaw) as Partial<AppState>);
        if (entriesRaw) {
          const mk = currentMonthKey();
          const all = JSON.parse(entriesRaw) as AppState['data'];
          store$.data.set(all.filter((e) => monthKey(e.ts) === mk));
        }
      } finally {
        applyingLoad = false;
      }
      return;
    }
    // migrate the old single-blob key forward, then drop it
    const legacy = await AsyncStorage.getItem(LEGACY_KEY);
    if (legacy) {
      applyingLoad = true;
      try {
        store$.assign(JSON.parse(legacy) as Partial<AppState>);
        const mk = currentMonthKey();
        store$.data.set(store$.data.peek().filter((e) => monthKey(e.ts) === mk));
      } finally {
        applyingLoad = false;
      }
      await saveAll();
      await AsyncStorage.removeItem(LEGACY_KEY).catch(() => {});
    }
  } catch {
    applyingLoad = false;
    // corrupt/missing storage -> fall back to defaults
  }
}

/** Merge the full persisted list with whatever is in memory. The in-memory list
 *  after the fast pass is a subset of disk PLUS anything written since (a quick
 *  manual entry, a subscription charge, a drained notification, a sync pull) —
 *  a wholesale replace would silently drop those writes, and their side effects
 *  (advanced subscription cursors, consumed notification queues, bumped sync
 *  watermarks) make them unrecoverable. Newer updatedAt wins per id. */
function mergePersistedFull(disk: Entry[]): void {
  const byId = new Map(disk.map((e) => [e.id, e] as const));
  for (const m of store$.data.peek()) {
    const d = byId.get(m.id);
    if (!d || (m.updatedAt ?? 0) > (d.updatedAt ?? 0)) byId.set(m.id, m);
  }
  applyingLoad = true;
  try {
    store$.data.set([...byId.values()]);
  } finally {
    applyingLoad = false;
  }
}

/** Load the full entry list, merging it with the month-only subset from the
 *  fast hydration pass. No-op when storage is empty. */
export async function loadPersistedFull(): Promise<void> {
  try {
    const entriesRaw = await AsyncStorage.getItem(ENTRIES_KEY);
    if (entriesRaw) {
      mergePersistedFull(JSON.parse(entriesRaw) as AppState['data']);
      return;
    }
    const legacy = await AsyncStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as Partial<AppState>;
      if (parsed.data) mergePersistedFull(parsed.data);
    }
  } catch {
    applyingLoad = false;
    // corrupt/missing storage -> keep whatever the fast pass loaded
  }
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

/** Everything unremoveEntry needs to reverse one removeEntry as fresh stamped
 *  writes. Deliberately NOT a snapshot of the old row objects: replaying stale
 *  objects (old updatedAt/fieldTs) is invisible to the push watermark, and once
 *  the tombstone has been pushed, the next pull would re-delete the entry. */
export interface RemoveUndo {
  id: string;
  childIds: string[]; // refund incomes tombstoned along with the entry
  refundedId?: string; // the original whose refund counter was reduced
  prevRefund?: number; // that counter's value before the delete
}

/** Soft-delete an entry (tombstone for sync), keeping refund bookkeeping
 *  consistent. The tombstone stays in `data`; all display/calc reads filter
 *  `!deletedAt`. Deleting an original also tombstones its refund incomes.
 *  Returns an undo token for unremoveEntry (undefined when the id is unknown). */
export function removeEntry(id: string): RemoveUndo | undefined {
  const now = Date.now();
  const list = store$.data.peek();
  const d = list.find((x) => x.id === id);
  if (!d) return undefined;
  const undo: RemoveUndo = { id, childIds: [] };
  const next = list.map((x) => {
    // give the refunded amount back to the original when deleting a refund income
    if (d.refundOf && x.id === d.refundOf && x.refund) {
      undo.refundedId = x.id;
      undo.prevRefund = x.refund;
      const refund = Math.max(0, x.refund - d.amt);
      return stampEntry(x, { refund: refund || undefined }, now);
    }
    // tombstone the entry itself and any refund incomes pointing at it
    if (x.id === id || x.refundOf === id) {
      if (x.id !== id) undo.childIds.push(x.id);
      return stampEntry(x, { deletedAt: now }, now);
    }
    return x;
  });
  store$.data.set(next);
  return undo;
}

/** Undo a removeEntry as NEW stamped writes: clear the tombstones and restore
 *  the refund counter with fresh field timestamps, so the restore wins over the
 *  already-pushed delete on every device instead of being silently re-deleted
 *  by the next sync merge. */
export function unremoveEntry(undo: RemoveUndo): void {
  const now = Date.now();
  const ids = new Set([undo.id, ...undo.childIds]);
  store$.data.set(
    store$.data.peek().map((x) => {
      if (ids.has(x.id)) return stampEntry(x, { deletedAt: undefined }, now);
      if (undo.refundedId && x.id === undo.refundedId) {
        return stampEntry(x, { refund: undo.prevRefund }, now);
      }
      return x;
    }),
  );
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
    src: 'bill',
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
