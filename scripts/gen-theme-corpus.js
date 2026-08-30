#!/usr/bin/env node
// The theme corpus: every field of every theme, lit and unlit.
//
// Exhaustive rather than sampled — seven themes times two modes times twenty
// fields is 280 cases, which is small enough to enumerate and large enough
// that one transposed hex digit shows up. A sampled corpus over a table of
// constants would only be testing the sampler.
//
// Unknown keys are in here too: a stored theme from a build that had one more
// flower must fall back rather than stop the app from opening.

const fs = require('node:fs');
const path = require('node:path');

const KEYS = ['default', 'sakura', 'daisy', 'jasmine', 'ocean', 'forest', 'sunset'];
const UNKNOWN = ['', 'chrysanthemum', 'DEFAULT', 'sakura ', '樱花'];
const FIELDS = [
  'hibiscus', 'hibiscusDeep', 'hibiscusSoft', 'stamen', 'leaf', 'leafDeep',
  'paper', 'paperWarm', 'ink', 'inkSoft', 'line', 'card',
  'tint', 'tintStrong', 'gradFrom', 'gradTo', 'shadow', 'glow', 'overlay',
  'isDark', 'swatch',
];

const lines = [];
for (const key of [...KEYS, ...UNKNOWN]) {
  for (const dark of ['0', '1']) {
    for (const f of FIELDS) lines.push(`${key}\t${dark}\t${f}`);
  }
}

const out = lines.join('\n') + '\n';
const dest = path.join(__dirname, '..', 'rust', 'parity', 'theme-corpus.tsv');
fs.writeFileSync(dest, out);
console.log(`${lines.length} cases → ${path.relative(path.join(__dirname, '..'), dest)}`);
