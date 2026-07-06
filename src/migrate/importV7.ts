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
  currencies?: Currencies;
}

export interface ImportResult {
  entries: number;
  net: number;
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

/** Validate, migrate, and apply a backup to the store. Throws on a bad file. */
export function importV7(backup: unknown): ImportResult {
  const b = migrateBackup(backup);

  store$.data.set(b.data!);

  if (b.settings) {
    // never carry secrets across — the native app uses account auth + biometrics
    const { passcode, passHash, passSalt, ...safe } = b.settings;
    store$.settings.assign({
      budget: safe.budget ?? 0,
      cycleStart: safe.cycleStart ?? 1,
      theme: safe.theme ?? 'default',
      dark: safe.dark ?? false,
      catBudgets: safe.catBudgets,
      remindTime: safe.remindTime,
    });
  }
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

  const data = b.data!; // migrateBackup guarantees this is an array
  const net = data.reduce((s, d) => s + (d.io === 'inc' ? d.amt : -d.amt), 0);
  return { entries: data.length, net };
}
