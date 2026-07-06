import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { QuickEntry } from '../QuickEntry';
import { I18N } from '@/i18n';

jest.mock('@/util/haptics', () => ({ tapHaptic: jest.fn() }));

const s = I18N.zh;

describe('QuickEntry', () => {
  it('renders amount and note input fields', () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<QuickEntry lang="zh" onSubmit={jest.fn()} />);
    });

    const inputs = r.root.findAllByType('TextInput');
    expect(inputs).toHaveLength(2);
    expect(inputs[0].props.placeholder).toBe(s.amountPh);
    expect(inputs[1].props.placeholder).toBe(s.note);
  });

  it('calls onSubmit with amount and note', () => {
    const onSubmit = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<QuickEntry lang="zh" onSubmit={onSubmit} />);
    });

    const inputs = r.root.findAllByType('TextInput');

    act(() => {
      inputs[0].props.onChangeText('42.5');
      inputs[1].props.onChangeText(' lunch ');
    });

    // press the submit button
    const btn = r.root.find((n) => n.props?.accessibilityLabel === s.save);
    act(() => btn.props.onPress());

    expect(onSubmit).toHaveBeenCalledWith(42.5, 'lunch');
  });

  it('clears inputs after submit', () => {
    const onSubmit = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<QuickEntry lang="zh" onSubmit={onSubmit} />);
    });

    const inputs = r.root.findAllByType('TextInput');

    act(() => {
      inputs[0].props.onChangeText('10');
      inputs[1].props.onChangeText('coffee');
    });

    const btn = r.root.find((n) => n.props?.accessibilityLabel === s.save);
    act(() => btn.props.onPress());

    const updatedInputs = r.root.findAllByType('TextInput');
    expect(updatedInputs[0].props.value).toBe('');
    expect(updatedInputs[1].props.value).toBe('');
  });

  it('does not call onSubmit for zero or empty amount', () => {
    const onSubmit = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<QuickEntry lang="zh" onSubmit={onSubmit} />);
    });

    const btn = r.root.find((n) => n.props?.accessibilityLabel === s.save);
    act(() => btn.props.onPress());

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
