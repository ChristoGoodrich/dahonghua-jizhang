// Ledger store — the single import surface for the app's state and actions.
//
// The store was split by domain (state, accounts, assets, categories,
// subscriptions, templates, tags, currency, reimburse) to keep each file
// cohesive; this module re-exports them all so callers keep one import
// (`@/store/ledger`) and acts as the boot composition root (`hydrate`).
import { store$, startAutosave, loadPersisted, loadPersistedCurrentMonth, loadPersistedFull, wireDisplaySymbol } from './state';
import { runSubscriptions } from './subscriptions';
import { loadAnalytics } from '@/util/analytics';
import { runAutoBackup } from '@/util/backup';

export * from './state';
export * from './accounts';
export * from './assets';
export * from './categories';
export * from './subscriptions';
export * from './templates';
export * from './tags';
export * from './currency';
export * from './reimburse';

/** Load persisted state, then start auto-saving on every change. Call once at boot. */
export async function hydrate(): Promise<void> {
  await loadPersisted();
  store$.hydrated.set(true);
  wireDisplaySymbol();
  startAutosave();
  // trackEvent() drops everything until the store is loaded, so this has to
  // happen before anything can be recorded
  await loadAnalytics().catch(() => {});
  // snapshot the restored ledger before this session can change it, honouring
  // the user's auto-backup toggle/frequency
  const st = store$.settings.peek();
  runAutoBackup({ enabled: st.autoBackup, frequency: st.backupFrequency, maxBackups: st.maxBackups }).catch(() => {});
  runSubscriptions(); // catch up any subscription charges missed while away
}

/** Fast hydration: load config + current month entries only. The UI can render
 *  immediately with a small dataset while the full load follows. */
export async function hydrateCurrentMonth(): Promise<void> {
  await loadPersistedCurrentMonth();
  store$.hydrated.set(true);
  wireDisplaySymbol();
  startAutosave();
  await loadAnalytics().catch(() => {});
  const st = store$.settings.peek();
  runAutoBackup({ enabled: st.autoBackup, frequency: st.backupFrequency, maxBackups: st.maxBackups }).catch(() => {});
  runSubscriptions();
}

/** Background hydration: swap in the full entry list after the fast pass. */
export async function hydrateFull(): Promise<void> {
  await loadPersistedFull();
}
