// Lightweight performance markers using the Performance API.
// On Hermes the global `performance` object is available; on older runtimes
// we fall back to Date.now() so the module never throws.

const marks = new Map<string, number>();
const durations = new Map<string, number>();

let initTime: number | null = null;

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/** Record the module-load timestamp as the app init reference point. */
initTime = now();

export function markStart(name: string): void {
  marks.set(name, now());
}

export function markEnd(name: string): number {
  const start = marks.get(name);
  if (start == null) return 0;
  const elapsed = now() - start;
  marks.delete(name);
  durations.set(name, elapsed);
  return elapsed;
}

export function getDuration(name: string): number | undefined {
  return durations.get(name);
}

export function getAllDurations(): Record<string, number> {
  return Object.fromEntries(durations);
}

/** Milliseconds from module load to first call (≈ first render). */
export function getStartupTime(): number {
  if (initTime == null) return 0;
  return now() - initTime;
}

export function resetPerf(): void {
  marks.clear();
  durations.clear();
  initTime = now();
}
