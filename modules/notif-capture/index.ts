// notif-capture — Android payment-notification listener.
//
// The native module is Android-only and absent in Expo Go, on web, and under
// jest. Every export here degrades to a safe no-op in that case (`isSupported()`
// is false, the queue is empty, capture can't be turned on), so callers never
// need a Platform check and the web build and test suite keep working.
import { requireOptionalNativeModule } from 'expo-modules-core';

/** One notification as captured by the listener, before any interpretation.
 *  Mirrors RawNotif in src/domain/notifParse.ts. */
export interface CapturedNotif {
  id: string;
  pkg: string;
  title?: string;
  text?: string;
  bigText?: string;
  postedAt: number;
}

interface NotifCaptureNative {
  isEnabled(): boolean;
  openSettings(): void;
  isCapturing(): boolean;
  setCapturing(on: boolean): void;
  getWatchedPackages(): string[];
  setWatchedPackages(packages: string[]): void;
  pendingCount(): Promise<number>;
  getPending(limit: number): Promise<CapturedNotif[]>;
  markConsumed(ids: string[]): Promise<void>;
  clearPending(): Promise<void>;
}

const native = requireOptionalNativeModule<NotifCaptureNative>('NotifCapture');

/** Whether this build can capture notifications at all (Android dev/release
 *  build with the module linked). False in Expo Go, on web, and under jest. */
export function isSupported(): boolean {
  return native != null;
}

/** Has the user granted notification access in system settings? Re-read every
 *  time — access can be revoked without the app being notified. */
export function isEnabled(): boolean {
  return native?.isEnabled() ?? false;
}

/** Open the system's notification-access screen. There is no in-app permission
 *  dialog for this; the user has to flip the switch themselves. */
export function openSettings(): void {
  native?.openSettings();
}

/** Capture is a separate switch from permission: granted access with capture
 *  off stores nothing. */
export function isCapturing(): boolean {
  return native?.isCapturing() ?? false;
}

export function setCapturing(on: boolean): void {
  native?.setCapturing(on);
}

/** Apps allowed to reach the queue. This is the privacy boundary — anything not
 *  listed is dropped by the listener and never written to disk. */
export function getWatchedPackages(): string[] {
  return native?.getWatchedPackages() ?? [];
}

export function setWatchedPackages(packages: string[]): void {
  native?.setWatchedPackages(packages);
}

export async function pendingCount(): Promise<number> {
  return (await native?.pendingCount()) ?? 0;
}

export async function getPending(limit = 200): Promise<CapturedNotif[]> {
  return (await native?.getPending(limit)) ?? [];
}

/** Acknowledge rows the app has taken responsibility for. Only call this after
 *  the drained items are persisted, or a crash mid-drain loses them. */
export async function markConsumed(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await native?.markConsumed(ids);
}

export async function clearPending(): Promise<void> {
  await native?.clearPending();
}
