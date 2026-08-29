#!/usr/bin/env node
// Generates the bill-encoding parity corpus.
//
// Five kinds, each over a hex byte string:
//
//   utf8?   is this valid UTF-8 (the switch that picks a decoder)
//   decide  which decoder decodeBillText would pick
//   gbk     what the GBK decoder makes of it
//   utf8    what the UTF-8 decoder makes of it
//   bill    the whole path, detection included
//
// The bytes are drawn to hit the boundaries rather than the middle: every lead
// class UTF-8 has, every GBK trail edge, and the sequences that are valid as
// one encoding and not the other. Real column names from both wallets are in
// there too — if 日期 and 金额 do not come back, nothing else matters.

const fs = require('node:fs');
const path = require('node:path');

let seed = 20260828;
function rnd() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (a) => a[Math.floor(rnd() * a.length)];
const upto = (n) => Math.floor(rnd() * (n + 1));

const hex = (bytes) =>
  bytes.map((b) => b.toString(16).padStart(2, '0')).join('');

/** The interesting single bytes: every UTF-8 lead class boundary, the GBK
 *  trail edges, and the bytes that are valid in neither. */
const EDGE = [
  0x00, 0x09, 0x0a, 0x0d, 0x20, 0x2c, 0x22, 0x7e, 0x7f,
  0x80, 0x81, 0xa0, 0xc1, 0xc2, 0xdf, 0xe0, 0xef, 0xf0, 0xf4, 0xf5, 0xfe, 0xff,
  0x3f, 0x40, 0x41, 0x7b, 0xfd,
];

/** GBK bytes for text a bill actually contains. */
const GBK_WORDS = [
  [0xc8, 0xd5, 0xc6, 0xda], // 日期
  [0xbd, 0xf0, 0xb6, 0xee], // 金额
  [0xd6, 0xa7, 0xb3, 0xf6], // 支出
  [0xca, 0xd5, 0xc8, 0xeb], // 收入
  [0xd6, 0xa7, 0xb8, 0xb6, 0xb1, 0xa6], // 支付宝
];

const UTF8_WORDS = [
  [...Buffer.from('日期', 'utf8')],
  [...Buffer.from('金额', 'utf8')],
  [...Buffer.from('微信支付', 'utf8')],
  [...Buffer.from('a,b,c', 'utf8')],
  [...Buffer.from('午饭 35.50', 'utf8')],
];

const BOM = [0xef, 0xbb, 0xbf];

function someBytes() {
  const r = rnd();
  if (r < 0.2) return pick(GBK_WORDS);
  if (r < 0.4) return pick(UTF8_WORDS);
  if (r < 0.45) return [...BOM, ...pick(UTF8_WORDS)];
  // a random walk over the edge bytes, which is where the two decoders
  // disagree if they are going to
  const n = 1 + upto(7);
  return Array.from({ length: n }, () => pick(EDGE));
}

const KINDS = ['utf8?', 'decide', 'gbk', 'utf8', 'bill'];

const lines = new Set();

// The cases that matter most, spelled out, so a failure names the thing.
for (const l of [
  'utf8?\t',
  'utf8?\t61622c63', // ascii
  'utf8?\te697a5e69c9f', // 日期 in utf8
  'utf8?\tc8d5c6da', // 日期 in gbk — must be rejected
  'utf8?\t80',
  'utf8?\tc1',
  'utf8?\tf5',
  'utf8?\tff',
  'utf8?\te697', // truncated
  'decide\t',
  'decide\tefbbbfe697a5e69c9f', // wechat, with a BOM
  'decide\tc8d5c6da', // alipay, gbk
  'gbk\tc8d5c6da',
  'gbk\tbdf0b6ee',
  'gbk\t80',
  'gbk\tffff',
  'gbk\tc82c78', // invalid pair must NOT eat the comma
  'gbk\tc83078',
  'gbk\t61c8', // lead dangling at EOF
  'gbk\t',
  'utf8\te697a5e69c9f',
  'utf8\t',
  'bill\tefbbbfe697a5e69c9f',
  'bill\tc8d5c6da',
  'bill\te697a5e69c9f',
  'bill\t',
]) {
  lines.add(l);
}

const TARGET = 2600;
for (let tries = 0; tries < TARGET * 40 && lines.size < TARGET; tries++) {
  lines.add(`${pick(KINDS)}\t${hex(someBytes())}`);
}

const out = [...lines].join('\n') + '\n';
const dest = path.join(__dirname, '..', 'rust', 'parity', 'encoding-corpus.tsv');
fs.writeFileSync(dest, out);
console.log(`${lines.size} cases → ${path.relative(path.join(__dirname, '..'), dest)}`);
