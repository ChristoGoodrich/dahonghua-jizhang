import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ErrorBoundary } from '../ErrorBoundary';
import { I18N } from '@/i18n';

// Suppress console.error from React's boundary logging during tests.
let errorSpy: jest.SpyInstance;
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

/** A component that throws on first render to trigger the boundary. */
function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('test error');
  return <Text>healthy</Text>;
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
});

describe('ErrorBoundary', () => {
  it('renders children when there is no error', async () => {
    await act(async () => {
      tree = TestRenderer.create(
        <ErrorBoundary><Bomb shouldThrow={false} /></ErrorBoundary>,
      );
    });
    expect(textOf(tree!.toJSON())).toContain('healthy');
  });

  it('catches errors and displays the error screen', async () => {
    await act(async () => {
      tree = TestRenderer.create(
        <ErrorBoundary><Bomb shouldThrow={true} /></ErrorBoundary>,
      );
    });
    const output = textOf(tree!.toJSON());
    expect(output).toContain(I18N.zh.errorTitle);
    expect(output).toContain(I18N.zh.errorMessage);
    expect(output).toContain('test error');
  });

  it('renders the restart button', async () => {
    await act(async () => {
      tree = TestRenderer.create(
        <ErrorBoundary><Bomb shouldThrow={true} /></ErrorBoundary>,
      );
    });
    const buttons = tree!.root.findAll(
      (n) => typeof n.props?.onPress === 'function',
    );
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('calls onReset when restart is pressed', async () => {
    const onReset = jest.fn();
    await act(async () => {
      tree = TestRenderer.create(
        <ErrorBoundary onReset={onReset}><Bomb shouldThrow={true} /></ErrorBoundary>,
      );
    });
    expect(textOf(tree!.toJSON())).toContain(I18N.zh.errorTitle);

    const button = tree!.root.findAll(
      (n) => typeof n.props?.onPress === 'function',
    ).at(-1)!;
    await act(async () => { button.props.onPress(); });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('shows children again after reset when the error is resolved', async () => {
    function Wrapper() {
      const [throwNow, setThrowNow] = React.useState(true);
      return (
        <ErrorBoundary onReset={() => setThrowNow(false)}>
          <Bomb shouldThrow={throwNow} />
        </ErrorBoundary>
      );
    }
    await act(async () => {
      tree = TestRenderer.create(<Wrapper />);
    });
    expect(textOf(tree!.toJSON())).toContain(I18N.zh.errorTitle);

    const button = tree!.root.findAll(
      (n) => typeof n.props?.onPress === 'function',
    ).at(-1)!;
    await act(async () => { button.props.onPress(); });
    expect(textOf(tree!.toJSON())).toContain('healthy');
  });
});
