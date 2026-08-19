#!/usr/bin/env node
// Runs the shipping TypeScript and the Rust port over the same corpus and fails
// if they disagree on a single case.
//
// This is the contract for the migration: a module is not "ported" because the
// Rust tests pass — Rust tests only prove the Rust matches what the author
// believed. It is ported when it answers identically to the code currently in
// users' hands. The first run of this harness found a real divergence
// (JS Math.round breaks ties toward +∞, Rust's f64::round breaks them away from
// zero), which no amount of unit testing on either side would have surfaced.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MODULES = [
  {
    name: 'calc',
    corpus: 'rust/parity/calc-corpus.tsv',
    ts: 'scripts/calc-parity.ts',
    example: 'dump_calc',
  },
  {
    name: 'money',
    corpus: 'rust/parity/money-corpus.tsv',
    ts: 'scripts/money-parity.ts',
    example: 'dump_money',
  },
  {
    name: 'cycle',
    corpus: 'rust/parity/cycle-corpus.tsv',
    ts: 'scripts/cycle-parity.ts',
    example: 'dump_cycle',
    // The TypeScript does this maths on local-time Date objects, so the run is
    // pinned to a known zone rather than the runner's. Belt and braces, not a
    // fix: the corpus was also run under America/New_York, where `cycleDays`
    // sees 23- and 25-hour days across a DST transition, and it still agrees
    // to the case — the `Math.round` in that millisecond division absorbs
    // them, and the Rust side counts civil days and never sees them at all.
    tz: 'Asia/Shanghai',
  },
  {
    name: 'period',
    corpus: 'rust/parity/period-corpus.tsv',
    ts: 'scripts/period-parity.ts',
    example: 'dump_period',
    tz: 'Asia/Shanghai',
  },
];

function run(cmd, args, input, env) {
  return execFileSync(cmd, args, {
    input,
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
}

let failed = 0;

for (const m of MODULES) {
  const corpusPath = path.join(ROOT, m.corpus);
  if (!fs.existsSync(corpusPath)) {
    console.error(`✗ ${m.name}: corpus missing at ${m.corpus}`);
    failed++;
    continue;
  }
  const corpus = fs.readFileSync(corpusPath, 'utf8');

  run('cargo', ['build', '--manifest-path', 'rust/Cargo.toml', '--example', m.example, '--quiet']);

  const exe = path.join(
    ROOT,
    'rust/target/debug/examples',
    process.platform === 'win32' ? `${m.example}.exe` : m.example,
  );

  const rustOut = run(exe, [], corpus).split('\n').map((l) => l.replace(/\r$/, ''));
  const tsOut = run('npx', ['tsx', m.ts], corpus).split('\n').map((l) => l.replace(/\r$/, ''));

  const n = Math.max(rustOut.length, tsOut.length);
  const diffs = [];
  for (let i = 0; i < n; i++) {
    if (rustOut[i] !== tsOut[i]) diffs.push({ line: i + 1, ts: tsOut[i], rust: rustOut[i] });
  }

  const cases = corpus.split('\n').filter(Boolean).length;
  if (diffs.length === 0) {
    console.log(`✓ ${m.name}: TypeScript and Rust agree on all ${cases} cases`);
  } else {
    failed++;
    console.error(`✗ ${m.name}: ${diffs.length} divergence(s) across ${cases} cases`);
    for (const d of diffs.slice(0, 20)) {
      console.error(`  line ${d.line}`);
      console.error(`    ts  : ${d.ts}`);
      console.error(`    rust: ${d.rust}`);
    }
    if (diffs.length > 20) console.error(`  … and ${diffs.length - 20} more`);
  }
}

process.exit(failed ? 1 : 0);
