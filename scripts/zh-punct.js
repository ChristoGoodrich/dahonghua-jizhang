#!/usr/bin/env node
// Chinese text takes full-width punctuation: ，；：？！（）.
//
// The UI had both. 我的's subtitles said "这个周期和这一周,过得怎么样" and the
// budget line "超了 ¥24,下月再争取小红花" — an ASCII comma, which sits on the
// baseline with no room after it and runs the two clauses together — while
// other screens used "，". Fifty-two strings disagreed, and nothing would
// have noticed a fifty-third.
//
// Reads the string literals in flutter_app/lib and fails on an ASCII mark
// that touches a Chinese character, or an interpolation followed by one
// (`${s(left)},下月`). Only lib: the tests quote real notifications and real
// CSV exports, whose punctuation is whatever the bank wrote, and the core's
// strings answer to the goldens. `--fix` rewrites what it finds.

const fs = require('node:fs');
const path = require('node:path');

const LIB = path.join(__dirname, '..', 'flutter_app', 'lib');
const FULL = { ',': '，', ';': '；', ':': '：', '?': '？', '!': '！', '(': '（', ')': '）' };
const HAN = /[㐀-鿿　-〿＀-￯]/;
const fix = process.argv.includes('--fix');

function dartFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    // lib/src/rust is generated
    if (fs.statSync(p).isDirectory()) {
      if (path.relative(LIB, p) !== path.join('src', 'rust')) dartFiles(p, out);
    } else if (name.endsWith('.dart')) out.push(p);
  }
  return out;
}

/// Each character of `s` paired with what it reads as: an interpolation is one
/// opaque mark, so `${a},下` sees the comma between a value and a word.
function marks(s) {
  const out = [];
  for (let i = 0; i < s.length; ) {
    const m = /^\$(\{[^}]*\}|\w+)/.exec(s.slice(i));
    if (m) {
      out.push({ at: i, len: m[0].length, ch: '$' });
      i += m[0].length;
    } else {
      out.push({ at: i, len: 1, ch: s[i] });
      i += 1;
    }
  }
  return out;
}

/// The positions in literal `s` to make full-width.
function offenders(s) {
  if (!HAN.test(s)) return [];
  const ms = marks(s);
  const hit = new Set();
  ms.forEach((m, k) => {
    if (!(m.ch in FULL)) return;
    const prev = ms[k - 1]?.ch ?? '';
    const next = ms[k + 1]?.ch ?? '';
    if (HAN.test(prev) || HAN.test(next)) hit.add(k);
    // `导出成 CSV,Excel 和…`: Latin on both sides, but an English comma is
    // followed by a space. One that is not, in a Chinese sentence, is the
    // Chinese comma typed on the wrong keyboard. Digits are left alone (1,000).
    if ((m.ch === ',' || m.ch === ';') && next && !/[\s\d]/.test(next)) {
      hit.add(k);
    }
  });
  // A bracket goes with its partner: （$count） rather than （$count).
  for (const k of [...hit]) {
    const ch = ms[k].ch;
    if (ch === '(') {
      const j = ms.findIndex((m, i) => i > k && m.ch === ')');
      if (j >= 0) hit.add(j);
    } else if (ch === ')') {
      const j = ms.map((m) => m.ch).lastIndexOf('(', k);
      if (j >= 0) hit.add(j);
    }
  }
  return [...hit].sort((a, b) => a - b).map((k) => ms[k].at);
}

const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
let found = 0;

for (const file of dartFiles(LIB)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let changed = false;
  lines.forEach((line, n) => {
    if (/^\s*\/\//.test(line)) return;
    const next = line.replace(LITERAL, (whole, single, double) => {
      const body = single ?? double;
      const at = offenders(body);
      if (at.length === 0) return whole;
      found += 1;
      console.log(`${path.relative(process.cwd(), file)}:${n + 1}: ${body}`);
      // `at` indexes UTF-16 units; every mark replaced here is one unit wide.
      let out = '';
      for (let i = 0; i < body.length; i++) {
        out += at.includes(i) ? FULL[body[i]] : body[i];
      }
      return whole[0] + out + whole[0];
    });
    if (next !== line) {
      lines[n] = next;
      changed = true;
    }
  });
  if (fix && changed) fs.writeFileSync(file, lines.join('\n'));
}

if (found > 0 && !fix) {
  console.error(
    `\n${found} Chinese string(s) with ASCII punctuation. ` +
      'Run `node scripts/zh-punct.js --fix`, or write ，；：？！（） by hand.',
  );
  process.exit(1);
}
if (fix) console.log(`fixed ${found}`);
