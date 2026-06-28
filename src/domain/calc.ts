// Inline calculator for the amount field (Cookie-style "15+8" → 23). Pure so the
// evaluation is unit-tested without the keypad UI. Supports + - × ÷ with the usual
// precedence (× ÷ before + −); no parentheses (the keypad can't enter them).

type Tok = number | '+' | '-' | '*' | '/';

function tokenize(expr: string): Tok[] {
  const s = expr.replace(/×/g, '*').replace(/÷/g, '/');
  const out: Tok[] = [];
  let num = '';
  for (const ch of s) {
    if (/[0-9.]/.test(ch)) num += ch;
    else if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      if (num) { out.push(parseFloat(num)); num = ''; }
      out.push(ch);
    }
  }
  if (num) out.push(parseFloat(num));
  return out;
}

/** Evaluate an expression string. Empty/invalid → 0. A trailing operator is
 *  ignored (so the live preview works while typing "15+"). */
export function evalExpr(expr: string): number {
  const toks = tokenize(expr);
  while (toks.length && typeof toks[toks.length - 1] === 'string') toks.pop();
  if (!toks.length || typeof toks[0] !== 'number') return 0;

  // pass 1: × ÷
  const p1: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk === '*' || tk === '/') {
      const a = p1.pop() as number;
      const b = toks[++i] as number;
      p1.push(tk === '*' ? a * b : b === 0 ? 0 : a / b);
    } else p1.push(tk);
  }
  // pass 2: + −
  let acc = p1[0] as number;
  for (let i = 1; i < p1.length; i += 2) {
    const op = p1[i];
    const b = p1[i + 1] as number;
    acc = op === '+' ? acc + b : acc - b;
  }
  return Number.isFinite(acc) ? Math.round(acc * 100) / 100 : 0;
}

/** True if the expression actually contains an operator (so the UI knows to show
 *  a "= result" preview rather than just echoing the typed number). */
export function hasOperator(expr: string): boolean {
  return /[+\-×÷*/]/.test(expr.slice(1)); // skip index 0 so a leading sign never counts
}

const OPS = '+-×÷';

/** Apply one keypad key to the current expression, returning the next expression.
 *  Keys: digits, '.', the four operators, 'back', 'clear', 'eq'. */
export function applyKey(expr: string, key: string): string {
  if (key === 'clear') return '';
  if (key === 'back') return expr.slice(0, -1);
  if (key === 'eq') return expr ? String(evalExpr(expr)) : '';
  const last = expr.slice(-1);
  if (OPS.includes(key)) {
    if (!expr) return ''; // no leading operator
    if (OPS.includes(last)) return expr.slice(0, -1) + key; // replace a trailing operator
    return expr + key;
  }
  const seg = expr.split(/[+\-×÷]/).pop() ?? '';
  if (key === '.') {
    // only one dot per number segment
    if (seg.includes('.')) return expr;
    return expr + (seg === '' ? '0.' : '.');
  }
  // a digit — normalize leading zeros so a segment never becomes "05" or "00"
  if (seg === '0') {
    if (key === '0') return expr; // no "00"
    return expr.slice(0, -1) + key; // replace the lone leading 0
  }
  return expr + key;
}
