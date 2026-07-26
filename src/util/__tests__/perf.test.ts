import { markStart, markEnd, getDuration, getAllDurations, getStartupTime, resetPerf } from '../perf';

describe('perf', () => {
  beforeEach(() => {
    resetPerf();
  });

  it('markStart/markEnd records a duration', () => {
    markStart('test');
    const elapsed = markEnd('test');
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(getDuration('test')).toBe(elapsed);
  });

  it('markEnd returns 0 when no start mark exists', () => {
    expect(markEnd('nonexistent')).toBe(0);
  });

  it('getAllDurations returns all recorded durations', () => {
    markStart('a');
    markEnd('a');
    markStart('b');
    markEnd('b');
    const all = getAllDurations();
    expect(all).toHaveProperty('a');
    expect(all).toHaveProperty('b');
  });

  it('getStartupTime returns a non-negative number', () => {
    const t = getStartupTime();
    expect(t).toBeGreaterThanOrEqual(0);
  });

  it('resetPerf clears marks and durations', () => {
    markStart('x');
    markEnd('x');
    expect(getDuration('x')).toBeDefined();
    resetPerf();
    expect(getDuration('x')).toBeUndefined();
    expect(getAllDurations()).toEqual({});
  });
});
