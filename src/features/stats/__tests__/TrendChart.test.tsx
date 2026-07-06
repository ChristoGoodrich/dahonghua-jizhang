import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TrendChart } from '../TrendChart';

jest.mock('@/theme/ThemeContext', () => ({
  useTheme: () => ({
    card: '#FFFFFF',
    hibiscus: '#E8585B',
    leafDeep: '#4A9B6F',
    inkSoft: '#8A8178',
    line: '#EADFCF',
    isDark: false,
  }),
}));

jest.mock('react-native-chart-kit', () => ({
  LineChart: 'LineChart',
}));

const mockData = [
  { date: '2024-01-01', exp: 100, inc: 200 },
  { date: '2024-01-02', exp: 150, inc: 250 },
  { date: '2024-01-03', exp: 120, inc: 180 },
];

describe('TrendChart', () => {
  it('renders chart with data', () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <TrendChart data={mockData} lang="zh" type="exp" />,
      );
    });

    const json = r.toJSON();
    expect(json).toBeTruthy();
    expect(JSON.stringify(json)).toContain('LineChart');
  });

  it('renders legend when type is both', () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <TrendChart data={mockData} lang="zh" type="both" />,
      );
    });

    const texts = r.root.findAllByType('Text');
    const legendTexts = texts.filter(
      (t) => t.props.children === '支出' || t.props.children === '收入',
    );
    expect(legendTexts.length).toBe(2);
  });

  it('handles empty data', () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <TrendChart data={[]} lang="zh" type="both" />,
      );
    });

    expect(r.toJSON()).toBeNull();
  });
});
