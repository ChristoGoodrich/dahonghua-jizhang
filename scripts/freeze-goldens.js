#!/usr/bin/env node
// Records what the TypeScript answers, once, so it can be checked against
// after the TypeScript is gone.
//
// The parity harness runs both implementations and compares them. That works
// only while both exist. This writes the TypeScript side's output to
// `rust/parity/golden/<module>.txt`, turning 120,000 comparisons into 120,000
// frozen answers — after which `npm run goldens` needs only Rust.
//
// What is lost in the conversion, and it is worth being clear about it: a
// golden file cannot notice that the TypeScript changed, because nothing will
// change it again. What it still does is the thing that actually mattered —
// hold the Rust to answers that were verified against real shipping code, for
// as long as the Rust exists. Every one of these lines was produced by the app
// that was in users' hands on the day it was written.
//
// Run once, before the React Native tree is removed. Running it afterwards
// would produce nothing, which is why it refuses if `src/` is missing.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'rust', 'parity', 'golden');

if (!fs.existsSync(path.join(ROOT, 'src'))) {
  console.error(
    'src/ is gone, so there is nothing left to record.\n' +
      'The goldens in rust/parity/golden are the only copy of these answers now.'
  );
  process.exit(1);
}

const { MODULES } = require('./parity-modules');

function run(cmd, args, input, cwd) {
  return execFileSync(cmd, args, {
    cwd: cwd || ROOT,
    input,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
}

fs.mkdirSync(OUT_DIR, { recursive: true });

let total = 0;
for (const m of MODULES) {
  const corpusPath = path.join(ROOT, m.corpus);
  const corpus = fs.readFileSync(corpusPath, 'utf8');

  let out;
  if (m.harness) {
    const tmp = path.join(os.tmpdir(), `golden-${m.name}-${process.pid}.tsv`);
    execFileSync(
      'npx',
      ['jest', '--config', 'jest.parity.config.js', '--silent', m.harness],
      {
        cwd: ROOT,
        stdio: ['ignore', 'ignore', 'pipe'],
        shell: process.platform === 'win32',
        env: { ...process.env, PARITY_IN: corpusPath, PARITY_OUT: tmp },
      }
    );
    out = fs.readFileSync(tmp, 'utf8');
    fs.unlinkSync(tmp);
  } else {
    out = run('npx', ['tsx', m.ts], corpus);
  }

  // Normalised to \n so the file compares the same on either platform.
  out = out.replace(/\r\n/g, '\n');
  fs.writeFileSync(path.join(OUT_DIR, `${m.name}.txt`), out);

  const cases = corpus.split('\n').filter(Boolean).length;
  total += cases;
  console.log(`frozen ${m.name}: ${cases} cases`);
}

console.log(`\n${MODULES.length} modules, ${total} cases -> rust/parity/golden/`);
