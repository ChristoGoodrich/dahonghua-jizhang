import { chartMax, xOf, yOf, polyline, CHART_W, CHART_H, CHART_PAD } from '../geometry';

describe('chartMax', () => {
  it('is never less than one, so an all-zero day does not divide by zero', () => {
    expect(chartMax([0, 0], [0])).toBe(1);
    expect(chartMax([], [])).toBe(1);
    expect(chartMax([0.5], [0.2])).toBe(1);
  });

  it('does not become -Infinity when the drawn series is empty', () => {
    // `Math.max(...[])` is -Infinity, which would put every point off the top
    expect(chartMax([], [7], 'exp')).toBe(1);
  });

  it('ignores a series nobody is drawing', () => {
    expect(chartMax([100], [5], 'inc')).toBe(5);
    expect(chartMax([100], [5], 'exp')).toBe(100);
    expect(chartMax([100], [5], 'both')).toBe(100);
  });

  it('propagates a NaN from a drawn series, and not from an undrawn one', () => {
    expect(chartMax([1, NaN], [], 'exp')).toBeNaN();
    expect(chartMax([NaN], [5], 'inc')).toBe(5);
  });
});

describe('xOf', () => {
  it('puts a single point at the left padding rather than dividing by zero', () => {
    expect(xOf(0, 1)).toBe(CHART_PAD);
    expect(xOf(0, 0)).toBe(CHART_PAD);
  });

  it('spans the padded box', () => {
    expect(xOf(0, 5)).toBe(CHART_PAD);
    expect(xOf(4, 5)).toBe(CHART_W - CHART_PAD);
  });
});

describe('yOf', () => {
  it('puts the maximum at the top padding and zero at the bottom', () => {
    expect(yOf(10, 10)).toBe(CHART_PAD);
    expect(yOf(0, 10)).toBe(CHART_H - CHART_PAD);
  });
});

describe('polyline', () => {
  it('rounds to the decimal the drawing actually carries', () => {
    expect(polyline([0, 5, 10], 10, 3)).toEqual([
      { x: 7, y: 89 },
      { x: 150, y: 48 },
      { x: 293, y: 7 },
    ]);
  });

  it('rounds an exact tie away from zero, as toFixed does', () => {
    // y is exactly 58.25 here, which `toFixed(1)` makes 58.3 and a
    // round-half-to-even formatter would make 58.2
    expect(polyline([3], 8, 1)[0].y).toBe(58.3);
  });
});
