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
        watermark = dirty.reduce((m, e) => Math.max(m, cfg.stamp(e)), watermark);
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
    retryDelay = Math.min(retryDelay ? retryDelay * 2 : retryBaseMs, retryMaxMs);
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
