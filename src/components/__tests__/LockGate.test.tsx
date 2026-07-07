import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import * as LocalAuth from 'expo-local-authentication';
import { LockGate } from '../LockGate';
import { store$ } from '@/store/ledger';
import { I18N } from '@/i18n';

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

const auth = LocalAuth as jest.Mocked<typeof LocalAuth>;

function textOf(json: TestRenderer.ReactTestRendererJSON | TestRenderer.ReactTestRendererJSON[] | null | string): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (Array.isArray(json)) return json.map(textOf).join('');
  return textOf(json.children as never);
}

let tree: TestRenderer.ReactTestRenderer | undefined;

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
});
