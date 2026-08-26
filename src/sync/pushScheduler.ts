// Debounced push + exponential-backoff retry state machine, extracted from the
// sync engine so it can be unit-tested without a live Supabase project. It owns
// the push watermark: dirty items are (re)pushed until they succeed, and the
// watermark only advances past items that were actually persisted — so a failed
// push never silently drops changes.
//
// Everything I/O-related is injected, keeping this module pure and deterministic
// under fake timers.

export interface PushSchedulerConfig<T> {
  /** Items changed since the given watermark (newest-wins is the caller's job). */
  getDirty: (watermark: number) => T[];
  /** Monotonic timestamp used as the watermark (e.g. entry.updatedAt). */
  stamp: (item: T) => number;
  /** Persist the dirty items. Must throw/reject on failure. */
  pushItems: (items: T[]) => Promise<void>;
  /** Persist per-user config. Must throw/reject on failure. */
  pushConfig: () => Promise<void>;
  /** Called when a flush fails (after scheduling a retry). */
  onError: () => void;
  /** Called when a flush fully succeeds. */
  onSuccess: () => void;
  debounceMs?: number; // coalesce bursts of changes (default 800)
  retryBaseMs?: number; // first backoff delay (default 2000)
  retryMaxMs?: number; // backoff ceiling (default 60000)
}

export interface PushScheduler {
  /** Debounced flush — call on every local change. */
  schedule(): void;
  /** Flush immediately, cancelling any pending retry and resetting backoff. */
  flushNow(): Promise<void>;
  /** Raise the watermark (e.g. after a pull/merge or a realtime echo). */
  bumpWatermark(v: number): void;
  /** Clear timers, reset backoff and watermark (call on sign-out/stop). */
  cancel(): void;
  /** Current watermark — exposed for tests. */
  readonly watermark: number;
}

// ---------- the watermark rules ----------
//
// Exported because they are the whole of what this module decides, and because
// the dirty filter has to be the SAME rule the scheduler advances past. It used
// to be written once here and once in the engine's `getDirty`; two spellings of
// one rule is how the realtime path came to disagree with the pull.

/** Rows the server has not seen: strictly newer than the watermark.
 *
 *  Strictly, which is what makes it a watermark — a row whose stamp equals it
 *  has been pushed. A row stamped in the same millisecond as the newest row of
 *  a batch already in flight is therefore not picked up by the next flush; the
 *  pull sends it anyway, since a row the server does not have is uploaded
 *  regardless of any watermark. */
export function dirtySince<T>(items: T[], stamp: (t: T) => number, watermark: number): T[] {
  return items.filter((e) => stamp(e) > watermark);
}

/** How far the watermark may move once a batch is persisted.
 *
 *  Seeded with the current watermark so it never moves backwards, and past
 *  ONLY what was actually written — a watermark that advanced on intent rather
 *  than on success would drop every change in a failed batch, silently. */
export function advanceWatermark<T>(watermark: number, pushed: T[], stamp: (t: T) => number): number {
  return pushed.reduce((m, e) => Math.max(m, stamp(e)), watermark);
}

/** The next backoff delay: double, or start at base, capped.
 *
 *  A zero means "not currently backing off", so the first failure after a
 *  success waits `base` rather than nothing. */
export function nextDelay(current: number, base: number, max: number): number {
  return Math.min(current ? current * 2 : base, max);
}

export function createPushScheduler<T>(cfg: PushSchedulerConfig<T>): PushScheduler {
  const debounceMs = cfg.debounceMs ?? 800;
  const retryBaseMs = cfg.retryBaseMs ?? 2000;
  const retryMaxMs = cfg.retryMaxMs ?? 60000;

  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 0;
  let watermark = 0;

  async function flush(): Promise<void> {
    const dirty = cfg.getDirty(watermark);
    try {
      if (dirty.length) {
        await cfg.pushItems(dirty);
        // advance only past what we just persisted
        watermark = advanceWatermark(watermark, dirty, cfg.stamp);
      }
      await cfg.pushConfig();
      retryDelay = 0;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      cfg.onSuccess();
    } catch {
      cfg.onError();
      scheduleRetry();
    }
  }

  function scheduleRetry(): void {
    if (retryTimer) return; // a retry is already pending
    retryDelay = nextDelay(retryDelay, retryBaseMs, retryMaxMs);
    retryTimer = setTimeout(() => { retryTimer = null; flush(); }, retryDelay);
  }

  return {
    schedule() {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(flush, debounceMs);
    },
    flushNow() {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      retryDelay = 0;
      return flush();
    },
    bumpWatermark(v: number) {
      watermark = Math.max(watermark, v);
    },
    cancel() {
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      retryDelay = 0;
      watermark = 0;
    },
    get watermark() {
      return watermark;
    },
  };
}
