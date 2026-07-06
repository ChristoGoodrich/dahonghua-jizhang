import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SwipeableRow } from '../SwipeableRow';

// Mock react-native-gesture-handler
jest.mock('react-native-gesture-handler', () => {
  const mockReact = require('react');
  const { View, TouchableOpacity } = require('react-native');
  return {
    Swipeable: mockReact.forwardRef(({ children, renderRightActions }: any, _ref: any) => {
      const actions = renderRightActions
        ? renderRightActions(
            { interpolate: () => 1 } as any,
            { interpolate: () => 0 } as any,
          )
        : null;
      return (
        <View>
          {children}
          {actions}
        </View>
      );
    }),
    RectButton: ({ onPress, children, ...rest }: any) => (
      <TouchableOpacity onPress={onPress} {...rest}>{children}</TouchableOpacity>
    ),
  };
});

jest.mock('@/theme/ThemeContext', () => ({
  useTheme: () => ({ hibiscus: '#FF6B6B' }),
}));

jest.mock('@/components/ui/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

function render(el: React.ReactElement) {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => { r = TestRenderer.create(el); });
  return r;
}

function textOf(json: TestRenderer.ReactTestRendererJSON | TestRenderer.ReactTestRendererJSON[] | null | string): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (Array.isArray(json)) return json.map(textOf).join('');
  return textOf(json.children as never);
}

describe('SwipeableRow', () => {
  it('renders children correctly', () => {
    const r = render(
      <SwipeableRow>
        <React.Fragment>child content</React.Fragment>
      </SwipeableRow>,
    );
    expect(textOf(r.toJSON())).toContain('child content');
  });

  it('calls onDelete when delete action is triggered', () => {
    const onDelete = jest.fn();
    const r = render(
      <SwipeableRow onDelete={onDelete}>
        <React.Fragment>row</React.Fragment>
      </SwipeableRow>,
    );
    // Find a node with text "trash", walk up to the touchable ancestor with onPress
    const trashText = r.root.find(
      (n) => typeof n.props?.children === 'string' && n.props.children === 'trash',
    );
    let node: any = trashText;
    while (node && !node.props?.onPress) {
      node = node.parent;
    }
    act(() => node.props.onPress());
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('calls onEdit when edit action is triggered', () => {
    const onEdit = jest.fn();
    const r = render(
      <SwipeableRow onEdit={onEdit}>
        <React.Fragment>row</React.Fragment>
      </SwipeableRow>,
    );
    const editText = r.root.find(
      (n) => typeof n.props?.children === 'string' && n.props.children === 'edit',
    );
    let node: any = editText;
    while (node && !node.props?.onPress) {
      node = node.parent;
    }
    act(() => node.props.onPress());
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
