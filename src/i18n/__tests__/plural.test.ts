import { daysUnit, flowersUnit } from '../index';

describe('count-aware units', () => {
  it('pluralizes English on n !== 1', () => {
    expect(daysUnit('en', 1)).toBe('day');
    expect(daysUnit('en', 0)).toBe('days');
    expect(daysUnit('en', 2)).toBe('days');
    expect(flowersUnit('en', 1)).toBe('flower');
    expect(flowersUnit('en', 28)).toBe('flowers');
  });

  it('uses a fixed Chinese unit regardless of count', () => {
    expect(daysUnit('zh', 1)).toBe('天');
    expect(daysUnit('zh', 5)).toBe('天');
    expect(flowersUnit('zh', 1)).toBe('朵');
    expect(flowersUnit('zh', 28)).toBe('朵');
  });
});
