// Capture inbox — drains the native notification queue into the ledger.
//
// Deliberately NOT part of store$: everything in store$ except `data` is
// serialized into the cloud `profiles.config` blob, and raw notification text is
// device-local by nature — it would be both a privacy leak and useless on
// another phone. This slice keeps its own observable and its own storage key,
// and never syncs.
import { observable } from '@legendapp/state';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as capture from '../../modules/notif-capture';
import {
  parseNotification, toEntryDraft, isDuplicate, fullText, DUP_WINDOW_MS,
  type NotifEntryDraft, type NotifSource, type PaymentKey,
} from '@/domain/notifParse';
import { store$, addEntry, isDataReady, whenDataReady } from './state';

/** A parsed payment that wasn't confident enough to post unattended. */
export interface PendingItem {
  id: string;
  draft: NotifEntryDraft;
  source: NotifSource;
  raw: string; // what the notification actually said, shown on the confirm sheet
}

/**
 * A capture from a watched app that no rule understood.
 *
 * Kept on purpose. Notification wording differs by app version, bank, and
 * region, and there is no way to write rules for text you have never seen —
 * this list is how the real strings on your own phone become visible so
 * notifParse.ts can be tightened against them. Bounded, and never synced.
 */
export interface UnparsedItem {
  id: string;
  pkg: string;
  raw: string;
  postedAt: number;
}

interface InboxState {
  pending: PendingItem[];
  unparsed: UnparsedItem[];
  hydrated: boolean;
}

const MAX_UNPARSED = 30;
const INBOX_KEY = 'dhh_inbox_v1';

export const inbox$ = observable<InboxState>({ pending: [], unparsed: [], hydrated: false });

// ---------- persistence ----------

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function save(): Promise<void> {
  const { hydrated, ...rest } = inbox$.peek();
  return AsyncStorage.setItem(INBOX_KEY, JSON.stringify(rest)).catch(() => {});
}

/** Load the queue and start saving on change. Call once at boot. */
export async function hydrateInbox(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(INBOX_KEY);
    if (raw) inbox$.assign(JSON.parse(raw) as Partial<InboxState>);
  } catch {
    // corrupt storage -> start empty; nothing here is irreplaceable
  }
  inbox$.hydrated.set(true);
  inbox$.onChange(() => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  });
}

// ---------- draining ----------

/**
 * Payments already represented, so a re-drain can't double-post: whatever is
 * waiting for confirmation, plus ledger entries captured around the same time.
 *
 * The ledger scan is bounded by the *event* times in this batch, not by the
 * clock. One payment's follow-up push can be drained an hour after the first if
 * that's when the app happens to be opened, and a wall-clock "recent entries"
 * window would have already forgotten the original by then.
 */
function alreadySeen(from: number, to: number): PaymentKey[] {
  const seen: PaymentKey[] = inbox$.pending.peek().map((p) => ({
    io: p.draft.io,
    amt: p.draft.amt,
    postedAt: p.draft.ts,
  }));
  for (const e of store$.data.peek()) {
    if (e.src !== 'notif' || e.deletedAt || e.io === 'xfer') continue;
    if (e.ts < from || e.ts > to) continue;
    seen.push({ io: e.io, amt: e.amt, postedAt: e.ts });
  }
  return seen;
}

export interface DrainResult {
  posted: number; // added to the ledger outright
  queued: number; // parsed but waiting for a tap
  unparsed: number;
}

const EMPTY: DrainResult = { posted: 0, queued: 0, unparsed: 0 };

/**
 * Move everything the listener captured into the ledger or the inbox.
 *
 * Confident captures (a merchant name came through, so the note is meaningful)
 * post straight to the ledger tagged `src:'notif'`; the rest wait for one tap.
 *
 * Account and ledger are left unset on purpose. A notification says nothing
 * about which account paid or which ledger it belongs to, and guessing "whatever
 * was last used" silently corrupts account balances — the confirm sheet is where
 * that gets decided.
 *
 * The native queue is acknowledged only after the results are in the store, so a
 * crash mid-drain replays instead of losing payments.
 */
export async function drainInbox(): Promise<DrainResult> {
  if (!capture.isSupported() || !capture.isEnabled() || !capture.isCapturing()) return EMPTY;

  let raws: capture.CapturedNotif[];
  try {
    raws = await capture.getPending();
  } catch {
    return EMPTY; // native side unavailable; try again next foreground
  }
  if (!raws.length) return EMPTY;

  const times = raws.map((r) => r.postedAt);
  const seen = alreadySeen(Math.min(...times) - DUP_WINDOW_MS, Math.max(...times) + DUP_WINDOW_MS);
  const pending: PendingItem[] = [];
  const unparsed: UnparsedItem[] = [];
  const posted: NotifEntryDraft[] = [];

  for (const r of raws) {
    const candidate = parseNotification(r);
    if (!candidate) {
      unparsed.push({ id: r.id, pkg: r.pkg, raw: fullText(r), postedAt: r.postedAt });
      continue;
    }
    if (isDuplicate(candidate, seen)) continue;
    seen.push(candidate);

    const draft = toEntryDraft(candidate, store$.customCats.peek());
    if (draft.confident) posted.push(draft);
    else pending.push({ id: r.id, draft, source: candidate.source, raw: fullText(r) });
  }

  for (const d of posted) {
    addEntry({ io: d.io, cat: d.cat, amt: d.amt, note: d.note, ts: d.ts, src: 'notif' });
  }
  if (pending.length) inbox$.pending.set([...inbox$.pending.peek(), ...pending]);
  if (unparsed.length) {
    inbox$.unparsed.set([...inbox$.unparsed.peek(), ...unparsed].slice(-MAX_UNPARSED));
  }

  await capture.markConsumed(raws.map((r) => r.id)).catch(() => {});
  return { posted: posted.length, queued: pending.length, unparsed: unparsed.length };
}

/**
 * Drain now and on every return to the foreground, which is the only moment the
 * JS side is guaranteed to be alive. Returns a disposer — call it on unmount so
 * the listener and its pending promise can't outlive the tree (an AppState
 * subscription firing after teardown is a classic jest open-handle).
 *
 * Draining waits for the full ledger (whenDataReady): the dedup scan reads
 * `store$.data`, and a posted entry would be dropped by the full-load merge's
 * disk copy being absent — while the native queue was already acknowledged, so
 * the payment would be gone for good.
 */
export function startInboxDrain(): () => void {
  let disposed = false;
  void whenDataReady().then(() => {
    if (!disposed) return drainInbox().catch(() => {});
  });
  const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
    if (s === 'active' && isDataReady()) void drainInbox().catch(() => {});
  });
  return () => {
    disposed = true;
    sub.remove();
  };
}

// ---------- inbox actions ----------

/** Accept a queued capture as-is, optionally with edits from the confirm sheet. */
export function confirmPending(id: string, patch: Partial<NotifEntryDraft> = {}): void {
  const item = inbox$.pending.peek().find((p) => p.id === id);
  if (!item) return;
  const d = { ...item.draft, ...patch };
  addEntry({ io: d.io, cat: d.cat, amt: d.amt, note: d.note, ts: d.ts, src: 'notif' });
  dismissPending(id);
}

export function dismissPending(id: string): void {
  inbox$.pending.set(inbox$.pending.peek().filter((p) => p.id !== id));
}

export function clearPending(): void {
  inbox$.pending.set([]);
}

export function clearUnparsed(): void {
  inbox$.unparsed.set([]);
}
