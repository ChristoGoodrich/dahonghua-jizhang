import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, AppState } from 'react-native';
import * as LocalAuth from 'expo-local-authentication';
import { LockGate } from '../LockGate';
import { store$ } from '@/store/ledger';
import { I18N } from '@/i18n';

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
  cancelAuthenticate: jest.fn(),
}));

const auth = LocalAuth as jest.Mocked<typeof LocalAuth>;

function textOf(json: TestRenderer.ReactTestRendererJSON | TestRenderer.ReactTestRendererJSON[] | null | string): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (Array.isArray(json)) return json.map(textOf).join('');
  return textOf(json.children as never);
}

let tree: TestRenderer.ReactTestRenderer | undefined;

// Captured AppState handlers, so the background/foreground cycle can be driven
// by hand — the path where the unlock button used to die.
let appStateHandlers: ((s: string) => void)[] = [];
beforeEach(() => {
  appStateHandlers = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_e: string, h: (s: string) => void) => {
    appStateHandlers.push(h);
    return { remove: () => { appStateHandlers = appStateHandlers.filter((x) => x !== h); } };
  }) as never);
});

const fireAppState = async (state: string) => {
  await act(async () => { appStateHandlers.forEach((h) => h(state)); });
};

/** The overlay's unlock/retry button (Pressable is a forwardRef wrapper, so it
 *  is found by prop rather than by component type). */
const unlockButton = () => tree!.root.findAll((n) => typeof n.props?.onPress === 'function').at(-1)!;

async function renderGate() {
  await act(async () => {
    tree = TestRenderer.create(<LockGate><Text>APP CONTENT</Text></LockGate>);
  });
  await act(async () => {}); // flush the tryUnlock promise chain
  return tree!;
}

const lockTitle = I18N.zh.lockTitle;

afterEach(() => {
  // Unmount before touching store$ — the gate is an observer, and mutating the
  // lock while it is still mounted schedules a re-render that can land after
  // Jest tears the environment down.
  act(() => tree?.unmount());
  tree = undefined;
  store$.settings.lock.set(false);
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('LockGate', () => {
  it('shows content and no overlay when the lock is off', async () => {
    store$.settings.lock.set(false);
    const r = await renderGate();
    const text = textOf(r.toJSON());
    expect(text).toContain('APP CONTENT');
    expect(text).not.toContain(lockTitle);
  });

  it('unlocks when device authentication succeeds', async () => {
    store$.settings.lock.set(true);
    auth.hasHardwareAsync.mockResolvedValue(true);
    auth.isEnrolledAsync.mockResolvedValue(true);
    auth.authenticateAsync.mockResolvedValue({ success: true } as never);
    const r = await renderGate();
    expect(auth.authenticateAsync).toHaveBeenCalled();
    expect(textOf(r.toJSON())).not.toContain(lockTitle); // overlay gone
  });

  it('keeps the overlay when authentication fails', async () => {
    store$.settings.lock.set(true);
    auth.hasHardwareAsync.mockResolvedValue(true);
    auth.isEnrolledAsync.mockResolvedValue(true);
    auth.authenticateAsync.mockResolvedValue({ success: false } as never);
    const r = await renderGate();
    expect(textOf(r.toJSON())).toContain(lockTitle); // still locked
  });

  it('unlocks gracefully when no biometrics are enrolled', async () => {
    store$.settings.lock.set(true);
    auth.hasHardwareAsync.mockResolvedValue(true);
    auth.isEnrolledAsync.mockResolvedValue(false); // nothing enrolled
    const r = await renderGate();
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
    expect(textOf(r.toJSON())).not.toContain(lockTitle);
  });

  it('tells the user when authentication is refused, instead of doing nothing', async () => {
    store$.settings.lock.set(true);
    auth.hasHardwareAsync.mockResolvedValue(true);
    auth.isEnrolledAsync.mockResolvedValue(true);
    auth.authenticateAsync.mockResolvedValue({ success: false } as never);
    const r = await renderGate();
    const text = textOf(r.toJSON());
    expect(text).toContain(I18N.zh.lockFailed);
    expect(text).toContain(I18N.zh.lockRetry); // the button re-labels itself
  });
});

// The lock is re-armed whenever the app leaves the foreground, so this cycle is
// the one users hit constantly — and the one that had no coverage at all.
describe('LockGate across background/foreground', () => {
  beforeEach(() => {
    store$.settings.lock.set(true);
    auth.hasHardwareAsync.mockResolvedValue(true);
    auth.isEnrolledAsync.mockResolvedValue(true);
    auth.authenticateAsync.mockResolvedValue({ success: true } as never);
    auth.cancelAuthenticate.mockResolvedValue(undefined);
  });

  it('re-locks on leaving the foreground and re-prompts on return', async () => {
    const r = await renderGate();
    expect(textOf(r.toJSON())).not.toContain(lockTitle); // unlocked at launch
    expect(auth.authenticateAsync).toHaveBeenCalledTimes(1);

    await fireAppState('background');
    expect(textOf(r.toJSON())).toContain(lockTitle); // re-armed

    await fireAppState('active');
    expect(auth.authenticateAsync).toHaveBeenCalledTimes(2);
    expect(textOf(r.toJSON())).not.toContain(lockTitle);
  });

  // Regression: the prompt used to be raised by the re-lock itself, against an
  // activity that was already going away — wasting the automatic attempt.
  it('does not raise the prompt while the app is leaving the foreground', async () => {
    await renderGate();
    expect(auth.authenticateAsync).toHaveBeenCalledTimes(1);
    await fireAppState('background');
    expect(auth.authenticateAsync).toHaveBeenCalledTimes(1);
  });

  // Regression: Android's BiometricPrompt can be dismissed by backgrounding
  // without ever invoking its callback, leaving the promise pending. The
  // in-flight latch then never cleared and every later tap returned early —
  // the unlock button was dead until the process restarted.
  it('recovers when a prompt never settles, so Unlock keeps working', async () => {
    const r = await renderGate();
    auth.authenticateAsync.mockReturnValue(new Promise(() => {}) as never); // never settles

    await fireAppState('background');
    await fireAppState('active');
    expect(auth.authenticateAsync).toHaveBeenCalledTimes(2); // the hung attempt
    expect(textOf(r.toJSON())).toContain(lockTitle); // still locked, as expected

    // the button must still work — this is what was broken
    auth.authenticateAsync.mockResolvedValue({ success: true } as never);
    await act(async () => { unlockButton().props.onPress(); });
    expect(auth.authenticateAsync).toHaveBeenCalledTimes(3);
    expect(textOf(r.toJSON())).not.toContain(lockTitle);
  });

  // A superseded prompt can still settle later (the OS delivers the callback
  // after all). It must not be able to open a gate the user never passed.
  it('ignores a superseded attempt that settles late', async () => {
    let settleStale: (v: unknown) => void = () => {};
    const r = await renderGate();
    auth.authenticateAsync.mockReturnValue(new Promise((res) => { settleStale = res; }) as never);

    await fireAppState('background');
    await fireAppState('active'); // starts the attempt that will hang
    expect(textOf(r.toJSON())).toContain(lockTitle);

    // user retries and cancels that one instead
    auth.authenticateAsync.mockResolvedValue({ success: false } as never);
    await act(async () => { unlockButton().props.onPress(); });
    expect(auth.cancelAuthenticate).toHaveBeenCalled();
    expect(textOf(r.toJSON())).toContain(lockTitle);

    // the abandoned attempt now reports success — too late to count
    await act(async () => { settleStale({ success: true }); });
    expect(textOf(r.toJSON())).toContain(lockTitle);
  });

  it('does not re-lock while the system prompt itself backgrounds the app', async () => {
    let settle: (v: unknown) => void = () => {};
    auth.authenticateAsync.mockReturnValue(new Promise((res) => { settle = res; }) as never);
    const r = await renderGate();
    expect(textOf(r.toJSON())).toContain(lockTitle); // prompt in flight

    await fireAppState('inactive'); // iOS backgrounds the app to show the prompt
    await act(async () => { settle({ success: true }); });
    expect(textOf(r.toJSON())).not.toContain(lockTitle); // the unlock survives
  });
});
