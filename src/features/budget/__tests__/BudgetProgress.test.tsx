import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { BudgetProgress } from '../BudgetProgress';
import { I18N } from '@/i18n';

jest.mock('@/theme/ThemeContext', () => ({
  useTheme: () => ({
    leaf: '#6FA88F',
    stamen: '#E8A838',
    hibiscusDeep: '#B83A48',
    ink: '#2B2622',
    inkSoft: '#8A8178',
    line: '#EADFCF',
    paperWarm: '#F6EEE2',
    isDark: false,
  }),
}));

const s = I18N.zh;

describe('BudgetProgress', () => {
  it('renders progress bar with correct percentage', () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <BudgetProgress label="餐饮" spent={300} total={1000} lang="zh" />,
      );
    });

    const json = r.toJSON();
    const allText = JSON.stringify(json);
    expect(allText).toContain('30%');
  });

  it('shows over budget state', () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <BudgetProgress label="餐饮" spent={1200} total={1000} lang="zh" />,
      );
    });

    const texts = r.root.findAllByType('Text');
    const overText = texts.find((t) =>
      t.props.children?.toString().includes(s.budgetOver.split('%s')[0]),
    );
    expect(overText).toBeTruthy();
  });

  it('returns null when total is 0', () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <BudgetProgress label="餐饮" spent={100} total={0} lang="zh" />,
      );
    });

    expect(r.toJSON()).toBeNull();
  });
});
