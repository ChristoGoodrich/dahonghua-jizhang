// Import a backup produced by the legacy v7 web app's "备份全部数据" (exportJSON).
// Shape: { app:"dahonghua", version:7, data:[...], settings, customCats, accounts, currencies, ... }
import { store$ } from '@/store/ledger';
import type { Account, Asset, Category, Currencies, Entry, IO, Loan, Settings, Sub, Tags, Template } from '@/domain/types';

export interface V7Backup {
  app?: string;
  version?: number;
  data?: Entry[];
  settings?: Partial<Settings> & { passcode?: string; passHash?: string; passSalt?: string };
  customCats?: Record<IO, Category[]>;
  accounts?: Account[];
  assets?: Asset[];
  loans?: Loan[];
  subs?: Sub[];
  templates?: Template[];
  tags?: Tags;
  subcats?: Record<string, { k: string; name: string }[]>;
  curAccount?: string;
  curLedger?: string;
  lang?: string;
  currencies?: Currencies;
}

export interface ImportResult {
  entries: number;
  net: number;
  skipped: number; // malformed rows dropped instead of being written to the ledger
}

const IO_VALUES: ReadonlySet<string> = new Set<IO>(['exp', 'inc', 'xfer']);

/** A row is only allowed into the ledger if the fields every reader depends on
 *  are present and well-typed. Without this an array of anything at all (the
 *  only thing migrateBackup checked) would replace the whole ledger — and rows
 *  missing `id` silently break edit, delete and sync upsert downstream. */
function isValidEntry(x: unknown): x is Entry {
  if (!x || typeof x !== 'object') return false;
  const e = x as Partial<Entry>;
  return (
    typeof e.id === 'string' &&
    e.id.length > 0 &&
    typeof e.ts === 'number' &&
    Number.isFinite(e.ts) &&
    typeof e.io === 'string' &&
    IO_VALUES.has(e.io) &&
    typeof e.cat === 'string' &&
    typeof e.amt === 'number' &&
    Number.isFinite(e.amt)
  );
}

/** The backup schema version this build writes (kept in sync with buildBackup). */
export const CURRENT_BACKUP_VERSION = 8;

// Upgrade steps keyed by the *source* version: MIGRATIONS[n] turns a version-n
// payload into version-(n+1). Add one entry per schema change so any older
// backup can be walked forward to the current shape. v7→v8 added no persisted
// field changes, so it is an identity bump that just establishes the chain.
const MIGRATIONS: Record<number, (b: V7Backup) => V7Backup> = {
  7: (b) => ({ ...b, version: 8 }),
};

/**
 * Walk a backup forward to the current schema version. Files from the legacy v7
 * web app may omit `version`; those are treated as v7. Throws on a malformed
 * file or an unbridgeable version gap. Newer-than-current files pass through
 * unchanged (unknown extra fields are ignored on apply).
 */
export function migrateBackup(raw: unknown): V7Backup {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { data?: unknown }).data)) {
    throw new Error('not a valid 大红花记账 backup');
  }
  let b = { ...(raw as V7Backup) };
  let v = typeof b.version === 'number' ? b.version : 7;
  while (v < CURRENT_BACKUP_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`no migration path from backup version ${v}`);
    b = step(b);
    v += 1;
  }
  return b;
}

/** Validate, migrate, and apply a backup to the store. Throws on a bad file.
 *  Malformed rows are dropped (reported as `skipped`) rather than written. */
export function importV7(backup: unknown): ImportResult {
  const b = migrateBackup(backup);

  const raw = b.data!;
  const valid = raw.filter(isValidEntry);
  // an array that parsed but yielded nothing usable is the wrong file, not an
  // empty ledger — refuse rather than wipe the user's data
  if (!valid.length && raw.length) throw new Error('not a valid 大红花记账 backup');

  // Restamp so the restore actually reaches the cloud. Imported rows carry the
  // backup's own updatedAt (v7 web exports have none at all → 0), which sits
  // below the push watermark, so the pusher's `updatedAt > watermark` filter
  // skipped them forever and the next pull could overwrite them. A restore is an
  // explicit "this wins", so stale fieldTs is dropped too and whole-row LWW with
  // a fresh timestamp makes the backup authoritative.
  // A backup is a file, and a file can say anything — including the same id
  // twice. Two rows sharing an id make the sync merge incoherent: it indexes
  // by id and would resolve the pair to one row while the other stayed in the
  // list, so the ledger and the thing being merged disagree about what is in
  // it. Keep the last copy, which is what the merge's own Map would have kept.
  const unique = [...new Map(valid.map((e) => [e.id, e] as const)).values()];

  const now = Date.now();
  const stamped = unique.map((e, i) => {
    const { fieldTs, ...rest } = e;
    return { ...rest, updatedAt: now + i };
  });
  store$.data.set(stamped);

  if (b.settings) {
    // never carry secrets across — the native app uses account auth + biometrics
    const { passcode, passHash, passSalt, lock, ...safe } = b.settings;
    // Carry EVERY persisted setting. buildBackup writes the full Settings object,
    // so restoring a hand-picked subset silently reset the user's daily/weekly
    // budgets, budget mode, garden goal, archived ledgers and privacy toggles.
    // `lock` stays device-local and is deliberately never restored.
    store$.settings.assign({
      ...safe,
      budget: safe.budget ?? 0,
      cycleStart: safe.cycleStart ?? 1,
      theme: safe.theme ?? 'default',
      dark: safe.dark ?? false,
    });
  }
  if (b.lang === 'zh' || b.lang === 'en') store$.lang.set(b.lang);
  if (typeof b.curLedger === 'string') store$.curLedger.set(b.curLedger);
  if (b.customCats) store$.customCats.set(b.customCats);
  if (Array.isArray(b.accounts) && b.accounts.length) store$.accounts.set(b.accounts);
  if (Array.isArray(b.assets)) store$.assets.set(b.assets);
  if (Array.isArray(b.loans)) store$.loans.set(b.loans);
  if (Array.isArray(b.subs)) store$.subs.set(b.subs);
  if (Array.isArray(b.templates)) store$.templates.set(b.templates);
  if (b.tags && Array.isArray(b.tags.normal) && Array.isArray(b.tags.ledger)) store$.tags.set(b.tags);
  if (b.curAccount) store$.curAccount.set(b.curAccount);
  if (b.currencies) store$.currencies.set(b.currencies);
  if (b.subcats && typeof b.subcats === 'object') store$.subcats.set(b.subcats);

  const net = stamped.reduce((s, d) => s + (d.io === 'inc' ? d.amt : -d.amt), 0);
  return { entries: stamped.length, net, skipped: raw.length - stamped.length };
}
