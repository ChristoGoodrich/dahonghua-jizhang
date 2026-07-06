import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { BudgetForecast } from '../BudgetForecast';

jest.mock('@/theme/ThemeContext', () => ({
  useTheme: () => ({
    leaf: '#6FA88F',
    stamen: '#E8A838',
    hibiscusDeep: '#B83A48',
    ink: '#2B2622',
    inkSoft: '#8A8178',
    isDark: false,
  }),
}));

describe('BudgetForecast', () => {
  it('renders forecast data', () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <BudgetForecast spent={500} budget={2000} daysElapsed={10} daysInCycle={30} lang="en" />,
      );
    });

    const texts = r.root.findAllByType('Text');
    const dailyAvg = texts.find((t) => t.props.children?.toString().includes('50'));
    expect(dailyAvg).toBeTruthy();

    const monthEnd = texts.find((t) => t.props.children?.toString().includes('1,500'));
    expect(monthEnd).toBeTruthy();
  });

  it('returns null when daysElapsed is 0', () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <BudgetForecast spent={0} budget={2000} daysElapsed={0} daysInCycle={30} lang="en" />,
      );
    });

    expect(r.toJSON()).toBeNull();
  });

  it('shows over budget warning', () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <BudgetForecast spent={1500} budget={2000} daysElapsed={10} daysInCycle={30} lang="en" />,
      );
    });

    const texts = r.root.findAllByType('Text');
    const overText = texts.find((t) =>
      t.props.children?.toString().includes('Projected over'),
    );
    expect(overText).toBeTruthy();
  });
});
