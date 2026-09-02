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
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const { MODULES } = require('./parity-modules');

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

  // No TZ is injected, and an earlier `tz` option here was inert for a blunter
  // reason than it looked: **Node on this machine ignores the TZ environment
  // variable entirely** — `TZ=America/New_York node -e …` still reports
  // Australia/Sydney, with or without a shell in between.
  //
  // That is fine, and was checked rather than assumed. Every date-dependent
  // comparison renders civil y/m/d on both sides, so the runner's zone cancels
  // out. And the runner's zone is Australia/Sydney, which *does* observe
  // daylight saving — so these corpora have been running against DST
  // transitions all along, just not the ones the removed option named.
  const env = {};
  const rustOut = run(exe, [], corpus, env).split('\n').map((l) => l.replace(/\r$/, ''));

  let tsOut;
  if (m.harness) {
    // jest cannot take the corpus on stdin, so the two sides hand it over
    // through files instead
    const outPath = path.join(os.tmpdir(), `parity-${m.name}-${process.pid}.tsv`);
    // jest writes its own summary to stderr; swallow it so the parity report
    // stays one line per module
    execFileSync('npx', ['jest', '--config', 'jest.parity.config.js', '--silent', m.harness], {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: process.platform === 'win32',
      env: { ...process.env, ...env, PARITY_IN: corpusPath, PARITY_OUT: outPath },
    });
    tsOut = fs.readFileSync(outPath, 'utf8').split('\n').map((l) => l.replace(/\r$/, ''));
    fs.unlinkSync(outPath);
  } else {
    tsOut = run('npx', ['tsx', m.ts], corpus, env).split('\n').map((l) => l.replace(/\r$/, ''));
  }

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
