import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SyncIndicator } from '../SyncIndicator';
import { I18N } from '@/i18n';

jest.mock('@/sync/engine', () => {
  const { observable } = require('@legendapp/state');
  return {
    sync$: observable({ status: 'off', lastSync: 0 }),
    retrySync: jest.fn(),
  };
});

// Grab the mocked module after jest.mock hoists the factory
function getEngine() {
  return require('@/sync/engine') as {
    sync$: { status: { set: (v: string) => void }; get: () => { status: string } };
    retrySync: jest.Mock;
  };
}

function textOf(json: TestRenderer.ReactTestRendererJSON | TestRenderer.ReactTestRendererJSON[] | null | string): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (Array.isArray(json)) return json.map(textOf).join('');
  return textOf(json.children as never);
}

let tree: TestRenderer.ReactTestRenderer | undefined;

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  getEngine().sync$.status.set('off');
  getEngine().retrySync.mockClear();
});

describe('SyncIndicator', () => {
  it('shows "not synced" when status is off', async () => {
    await act(async () => {
      tree = TestRenderer.create(<SyncIndicator />);
    });
    expect(textOf(tree!.toJSON())).toContain(I18N.zh.syncOff);
  });

  it('shows "syncing" when status is syncing', async () => {
    const { sync$ } = getEngine();
    await act(async () => {
      sync$.status.set('syncing');
    });
    await act(async () => {
      tree = TestRenderer.create(<SyncIndicator />);
    });
    expect(textOf(tree!.toJSON())).toContain(I18N.zh.syncSyncing);
  });

  it('shows "synced" when status is synced', async () => {
    const { sync$ } = getEngine();
    await act(async () => {
      sync$.status.set('synced');
    });
    await act(async () => {
      tree = TestRenderer.create(<SyncIndicator />);
    });
    expect(textOf(tree!.toJSON())).toContain(I18N.zh.syncSynced);
  });

  it('shows error label and retry button when status is error', async () => {
    const { sync$ } = getEngine();
    await act(async () => {
      sync$.status.set('error');
    });
    await act(async () => {
      tree = TestRenderer.create(<SyncIndicator />);
    });
    const text = textOf(tree!.toJSON());
    expect(text).toContain(I18N.zh.syncError);
    expect(text).toContain(I18N.zh.lockRetry);
  });

  it('calls retrySync when retry is tapped in error state', async () => {
    const { sync$, retrySync } = getEngine();
    await act(async () => {
      sync$.status.set('error');
    });
    await act(async () => {
      tree = TestRenderer.create(<SyncIndicator />);
    });
    const buttons = tree!.root.findAll((n) => typeof n.props?.onPress === 'function');
    expect(buttons.length).toBeGreaterThan(0);
    await act(async () => {
      buttons[0].props.onPress();
    });
    expect(retrySync).toHaveBeenCalled();
  });

  it('updates reactively when status changes', async () => {
    const { sync$ } = getEngine();
    await act(async () => {
      tree = TestRenderer.create(<SyncIndicator />);
    });
    expect(textOf(tree!.toJSON())).toContain(I18N.zh.syncOff);

    await act(async () => {
      sync$.status.set('synced');
    });
    expect(textOf(tree!.toJSON())).toContain(I18N.zh.syncSynced);
  });
});
