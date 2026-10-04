#!/usr/bin/env node
// Checks the Rust against the answers the TypeScript gave.
//
// This is what `npm run parity` became once the React Native tree was removed.
// The corpora are the same, the comparison is the same, and the other side of
// it is a file instead of a process: `rust/parity/golden/<module>.txt`, written
// by `freeze-goldens.js` on the last day the TypeScript existed.
//
// Every line in those files was produced by the code that was in users' hands.
// That is the whole claim, and it is the same claim the parity harness made —
// what is gone is only the ability to re-derive it.
//
// A failure here means the Rust now answers something the shipping app did
// not. It is not a formatting nit and should not be resolved by regenerating
// the goldens; there is nothing left to regenerate them from.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GOLDEN = path.join(ROOT, 'rust', 'parity', 'golden');

const { MODULES } = require('./parity-modules');

const only = process.argv[2];
const wanted = only ? MODULES.filter((m) => m.name === only) : MODULES;
if (only && wanted.length === 0) {
  console.error(`no module named ${only}`);
  process.exit(1);
}

// One `cargo build` for every example, rather than one per module.
execFileSync('cargo', ['build', '--examples', '--manifest-path', 'rust/Cargo.toml'], {
  cwd: ROOT,
  stdio: ['ignore', 'ignore', 'inherit'],
  shell: process.platform === 'win32',
});

let failed = 0;
let checked = 0;

for (const m of wanted) {
  const corpusPath = path.join(ROOT, m.corpus);
  const goldenPath = path.join(GOLDEN, `${m.name}.txt`);

  if (!fs.existsSync(goldenPath)) {
    console.error(`✗ ${m.name}: no golden file — run freeze-goldens.js before removing src/`);
    failed++;
    continue;
  }

  const corpus = fs.readFileSync(corpusPath, 'utf8');
  const exe = path.join(
    ROOT,
    'rust/target/debug/examples',
    process.platform === 'win32' ? `${m.example}.exe` : m.example
  );

  const rustOut = execFileSync(exe, [], {
    cwd: ROOT,
    input: corpus,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .replace(/\r\n/g, '\n')
    .split('\n');

  const goldOut = fs
    .readFileSync(goldenPath, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n');

  const n = Math.max(rustOut.length, goldOut.length);
  const diffs = [];
  for (let i = 0; i < n; i++) {
    if (rustOut[i] !== goldOut[i]) {
      diffs.push({ line: i + 1, want: goldOut[i], got: rustOut[i] });
    }
  }

  const cases = corpus.split('\n').filter(Boolean).length;
  checked += cases;

  if (diffs.length === 0) {
    console.log(`✓ ${m.name}: ${cases} cases match what the TypeScript answered`);
  } else {
    failed++;
    console.error(`✗ ${m.name}: ${diffs.length} divergence(s) across ${cases} cases`);
    for (const d of diffs.slice(0, 20)) {
      console.error(`  line ${d.line}`);
      console.error(`    was : ${d.want}`);
      console.error(`    now : ${d.got}`);
    }
    if (diffs.length > 20) console.error(`  … and ${diffs.length - 20} more`);
  }
}

if (!failed) {
  console.log(`\n${wanted.length} modules, ${checked} cases, no divergence`);
}
process.exit(failed ? 1 : 0);
