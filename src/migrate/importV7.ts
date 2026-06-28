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

/** Validate + apply a v7 backup to the store. Throws on a malformed file. */
export function importV7(backup: unknown): ImportResult {
  const b = backup as V7Backup;
  if (!b || !Array.isArray(b.data)) {
    throw new Error('not a valid 大红花记账 backup');
  }

  store$.data.set(b.data);

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

  const net = b.data.reduce((s, d) => s + (d.io === 'inc' ? d.amt : -d.amt), 0);
  return { entries: b.data.length, net };
}
