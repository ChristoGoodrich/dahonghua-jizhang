import { evalExpr, hasOperator, applyKey } from '../calc';

describe('evalExpr', () => {
  it('evaluates a plain number', () => {
    expect(evalExpr('42')).toBe(42);
    expect(evalExpr('3.5')).toBe(3.5);
  });
  it('adds and subtracts left to right', () => {
    expect(evalExpr('15+8')).toBe(23);
    expect(evalExpr('20-5-3')).toBe(12);
  });
  it('respects × ÷ precedence over + −', () => {
    expect(evalExpr('2+3×4')).toBe(14);
    expect(evalExpr('10+20÷4')).toBe(15);
  });
  it('handles the * and / ascii forms too', () => {
    expect(evalExpr('2*3+1')).toBe(7);
  });
  it('ignores a trailing operator (mid-typing)', () => {
    expect(evalExpr('15+')).toBe(15);
    expect(evalExpr('15+8×')).toBe(23);
  });
  it('rounds to 2 decimals and guards divide-by-zero', () => {
    expect(evalExpr('1÷3')).toBe(0.33);
    expect(evalExpr('5÷0')).toBe(0);
  });
  it('returns 0 for empty or operator-led input', () => {
    expect(evalExpr('')).toBe(0);
    expect(evalExpr('+5')).toBe(0);
  });
});

describe('hasOperator', () => {
  it('detects a real operator but not a leading position', () => {
    expect(hasOperator('15+8')).toBe(true);
    expect(hasOperator('15')).toBe(false);
    expect(hasOperator('100')).toBe(false);
  });
});

describe('applyKey', () => {
  it('appends digits and a single dot per segment', () => {
    expect(applyKey('1', '2')).toBe('12');
    expect(applyKey('1.5', '.')).toBe('1.5'); // no second dot
    expect(applyKey('12+', '.')).toBe('12+0.'); // dot after operator starts 0.
  });
  it('replaces a trailing operator instead of doubling it', () => {
    expect(applyKey('15+', '×')).toBe('15×');
    expect(applyKey('', '+')).toBe(''); // no leading operator
  });
  it('backspace, clear and equals', () => {
    expect(applyKey('15+8', 'back')).toBe('15+');
    expect(applyKey('15+8', 'clear')).toBe('');
    expect(applyKey('15+8', 'eq')).toBe('23');
  });
  it('normalizes leading zeros per segment', () => {
    expect(applyKey('0', '5')).toBe('5'); // replace the lone 0
    expect(applyKey('0', '0')).toBe('0'); // no "00"
    expect(applyKey('0', '.')).toBe('0.'); // but a decimal is fine
    expect(applyKey('12+0', '7')).toBe('12+7'); // also after an operator
    expect(applyKey('10', '0')).toBe('100'); // a non-leading 0 is kept
  });
});
