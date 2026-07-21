// Sync engine — wires the local store to Supabase: initial pull+merge, push of
// local changes, realtime subscription, and per-user config (profiles) sync.
// Entirely no-op when sync isn't configured. The pure mapping/merge it relies on
// (rows.ts, merge.ts) are unit-tested; this orchestration is covered in
// __tests__/engine.test.ts against a faked Supabase client, so a live project is
// only needed to validate the schema and RLS policies, not the logic.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { observable } from '@legendapp/state';
import { supabase } from './supabase';
import { auth$ } from './auth';
import { mergeById } from './merge';
import { entryToRow, rowToEntry, type DbEntry } from './rows';
import { createPushScheduler } from './pushScheduler';
import { loadConflictLog, logConflict } from './conflictLog';
import { store$, type AppState } from '@/store/ledger';
import type { Entry } from '@/domain/types';

export type SyncStatus = 'off' | 'syncing' | 'synced' | 'error';
export const sync$ = observable<{ status: SyncStatus; lastSync: number }>({ status: 'off', lastSync: 0 });

// config = all per-user state except the ledger entries, transient flags, and the
// device-local lock (never synced).
type Settings = AppState['settings'];
type Config = Omit<AppState, 'data' | 'hydrated' | 'settings'> & { settings: Omit<Settings, 'lock'> };

let channel: RealtimeChannel | null = null;
let configChannel: RealtimeChannel | null = null;
const unsubs: (() => void)[] = [];
let activeUser: string | null = null;

// Debounced push + backoff retry, owning the watermark. Pure/tested in
// pushScheduler.ts; here we just wire the store + Supabase I/O into it.
const pusher = createPushScheduler<Entry>({
  getDirty: (wm) => store$.data.peek().filter((e) => (e.updatedAt ?? 0) > wm),
  stamp: (e) => e.updatedAt ?? 0,
  pushItems: (items) => pushRows(items, activeUser!),
  pushConfig: () => (activeUser ? pushConfig(activeUser) : Promise.resolve()),
  onError: () => sync$.status.set('error'),
  onSuccess: () => {
    if (sync$.status.peek() === 'error') sync$.status.set('synced');
    sync$.lastSync.set(Date.now());
  },
});

function configSnapshot(): Config {
  const { data, hydrated, settings, ...rest } = store$.peek();
  const { lock, ...safeSettings } = settings;
  return { ...rest, settings: safeSettings } as Config;
}

// Set while a remote config is being written into the store, so the store
// subscription below doesn't treat the echo as a local edit and push it straight
// back (which would ping-pong between devices).
let applyingRemote = false;

function applyConfig(cfg: Partial<Config>): void {
  applyingRemote = true;
  try {
    applyConfigInner(cfg);
  } finally {
    applyingRemote = false;
  }
}

function applyConfigInner(cfg: Partial<Config>): void {
  const keepLock = store$.settings.lock.peek();
  if (cfg.lang) store$.lang.set(cfg.lang);
  if (cfg.settings) store$.settings.set({ ...cfg.settings, lock: keepLock } as Settings);
  if (cfg.customCats) store$.customCats.set(cfg.customCats);
  if (cfg.accounts) store$.accounts.set(cfg.accounts);
  if (cfg.assets) store$.assets.set(cfg.assets);
  if (cfg.loans) store$.loans.set(cfg.loans);
  if (cfg.subs) store$.subs.set(cfg.subs);
  if (cfg.templates) store$.templates.set(cfg.templates);
  if (cfg.tags) store$.tags.set(cfg.tags);
  if (cfg.curLedger !== undefined) store$.curLedger.set(cfg.curLedger);
  if (cfg.currencies) store$.currencies.set(cfg.currencies);
  if (cfg.subcats) store$.subcats.set(cfg.subcats);
  if (cfg.curAccount) store$.curAccount.set(cfg.curAccount);
}

async function pushRows(entries: Entry[], userId: string): Promise<void> {
  if (!supabase || !entries.length) return;
  const { error } = await supabase.from('entries').upsert(
    entries.map((e) => entryToRow(e, userId)),
    { onConflict: 'user_id,id' },
  );
  if (error) throw error;
}

async function pullAndMerge(userId: string): Promise<void> {
  if (!supabase) return;
  const { data: rows, error } = await supabase.from('entries').select('*').eq('user_id', userId);
  if (error) throw error;
  const remote = (rows as DbEntry[]).map(rowToEntry);
  const { merged, toPush } = mergeById(store$.data.peek(), remote, (info) => {
    logConflict({ ...info, timestamp: Date.now() });
  });
  store$.data.set(merged);
  pusher.bumpWatermark(merged.reduce((m, e) => Math.max(m, e.updatedAt ?? 0), 0));
  await pushRows(toPush, userId);
}

async function pushConfig(userId: string): Promise<void> {
  if (!supabase) return;
  // The error MUST be checked (pushRows does the same). Swallowing it let the
  // scheduler count a failed upload as a success: status stayed "synced", no
  // retry was queued, and the change never reached the cloud while the UI said
  // it had. Config is now pushed on every store change, so this is the hot path.
  const { error } = await supabase.from('profiles').upsert({ id: userId, config: configSnapshot() });
  if (error) throw error;
}

async function syncConfig(userId: string): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase.from('profiles').select('config').eq('id', userId).maybeSingle();
  // Throw rather than fall through: on a failed read `remote` is undefined, which
  // is indistinguishable from "this account has no config yet" — so the device
  // would skip adopting the cloud config and immediately push its own defaults
  // over it. That silently wipes an existing account's config on a new device.
  if (error) throw error;
  const remote = data?.config as Partial<Config> | undefined;
  // a device joining an existing account adopts the cloud config first
  if (remote && Object.keys(remote).length) applyConfig(remote);
  await pushConfig(userId);
}

/** Manually re-attempt a failed push (e.g. from a "retry sync" button). */
export function retrySync(): void {
  if (activeUser) pusher.flushNow();
}

function subscribeRealtime(userId: string): void {
  if (!supabase) return;
  channel = supabase
    .channel('entries-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'entries', filter: `user_id=eq.${userId}` },
      (payload) => {
        const row = payload.new as DbEntry | undefined;
        if (!row || !row.id) return;
        const e = rowToEntry(row);
        const local = store$.data.peek();
        const idx = local.findIndex((x) => x.id === e.id);
        if (idx < 0) {
          store$.data.set([...local, e]);
        } else if ((e.updatedAt ?? 0) > (local[idx].updatedAt ?? 0)) {
          const copy = [...local];
          copy[idx] = e;
          store$.data.set(copy);
        }
        pusher.bumpWatermark(e.updatedAt ?? 0);
      },
    )
    .subscribe();
}

/** Config (accounts, subs, tags…) lives in a single `profiles.config` blob, so it
 *  needs its own channel — the entries channel never carries it. Without this a
 *  device only saw another device's account/tag edits after a restart. */
function subscribeConfigRealtime(userId: string): void {
  if (!supabase) return;
  configChannel = supabase
    .channel('config-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
      (payload) => {
        const row = payload.new as { config?: Partial<Config> } | undefined;
        if (row?.config && Object.keys(row.config).length) applyConfig(row.config);
      },
    )
    .subscribe();
}

async function start(userId: string): Promise<void> {
  if (!supabase || activeUser === userId) return;
  activeUser = userId;
  sync$.status.set('syncing');
  try {
    await loadConflictLog();
    await pullAndMerge(userId);
    await syncConfig(userId);
    subscribeRealtime(userId);
    subscribeConfigRealtime(userId);
    // Subscribe at the ROOT, not just data+settings: the synced config blob also
    // carries accounts, assets, loans, subs, templates, tags, currencies,
    // customCats, subcats, curLedger and lang. Watching only data+settings meant
    // creating an account (and nothing else) was never uploaded at all.
    unsubs.push(
      store$.onChange(() => {
        if (!applyingRemote) pusher.schedule();
      }),
    );
    sync$.status.set('synced');
    sync$.lastSync.set(Date.now());
  } catch {
    sync$.status.set('error');
  }
}

function stop(): void {
  activeUser = null;
  if (supabase) {
    if (channel) supabase.removeChannel(channel);
    if (configChannel) supabase.removeChannel(configChannel);
  }
  channel = null;
  configChannel = null;
  while (unsubs.length) unsubs.pop()!();
  pusher.cancel();
  sync$.status.set('off');
}

/** Bind sync to the auth session. Call once at boot (no-op when unconfigured). */
export function initSync(): void {
  if (!supabase) return;
  auth$.session.onChange(() => {
    const session = auth$.session.peek();
    if (session) start(session.user.id);
    else stop();
  });
  const cur = auth$.session.peek();
  if (cur) start(cur.user.id);
}
