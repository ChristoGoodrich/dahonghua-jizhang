#!/usr/bin/env node
// Builds the release APKs, one per architecture, and says which one to send.
//
// `flutter build apk` on its own produces a **universal** APK: one file with
// the native libraries for all three architectures inside it. That was 67MB,
// and 63MB of it was three copies of the same two libraries —
//
//     23.1 MB  lib/x86_64        only an emulator ever runs this
//     21.5 MB  lib/arm64-v8a     every phone made since about 2016
//     18.3 MB  lib/armeabi-v7a   32-bit, for old hardware
//
// — of which any given phone loads exactly one. `--split-per-abi` writes them
// separately: 25MB for the arm64 build that actually goes on the phone.
//
// ## The versionCode trap, which is why this is a script and not a flag
//
// Splitting changes the versionCode. Flutter's Gradle plugin offsets it per
// architecture — armeabi-v7a becomes 1xxx, arm64-v8a 2xxx, x86_64 4xxx — so
// the arm64 build here is versionCode **2001** while the universal one is
// **1**. Android refuses to install a lower versionCode over a higher one, so
// once a split APK is on the phone, **a universal APK can no longer be
// installed as an update**. It fails with an unhelpful parse error and the way
// out is uninstalling, which on a debug-signed build means losing the ledger.
//
// So the choice has to be made once and kept. This script is that choice.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'flutter_app');
const OUT = path.join(APP, 'build', 'app', 'outputs', 'flutter-apk');

/// The one that goes on a phone. Everything since about 2016 is arm64.
const SEND = 'app-arm64-v8a-release.apk';

// Gradle unpacks to the system temp directory, and the default one on this
// machine sits under a path long enough to break the build. Same value the
// README gives for building by hand. Elsewhere the platform temp is fine —
// a Windows path on a Linux runner is not a shortcut, it is a broken build.
const TEMP =
  process.env.DAHONGHUA_BUILD_TEMP ||
  (process.platform === 'win32'
    ? 'C:\\Temp\\dahonghua-build'
    : path.join(require('node:os').tmpdir(), 'dahonghua-build'));

function mb(file) {
  return (fs.statSync(file).size / 1048576).toFixed(1);
}

/// The versionCode Android will compare against what is installed, if the
/// SDK's aapt2 can be found. Absent is not an error — it is one line of
/// output, not a build step.
function versionOf(apk) {
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'sdk');
  const tools = path.join(sdk, 'build-tools');
  if (!fs.existsSync(tools)) return null;
  const newest = fs.readdirSync(tools).sort().pop();
  const aapt2 = path.join(tools, newest, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2');
  if (!fs.existsSync(aapt2)) return null;
  try {
    const out = execFileSync(aapt2, ['dump', 'badging', apk], { encoding: 'utf8' });
    const code = /versionCode='(\d+)'/.exec(out);
    const name = /versionName='([^']*)'/.exec(out);
    return { code: code && code[1], name: name && name[1] };
  } catch {
    return null;
  }
}

// `cmd /c` rather than `shell: true`. Node deprecates passing an argument
// array with a shell — the arguments are concatenated rather than escaped —
// and it prints a warning about it on every build, which is a warning nobody
// will still be reading by the time one matters. Windows needs a shell at all
// only because `flutter` is a `.bat`.
const win = process.platform === 'win32';
execFileSync(
  win ? 'cmd.exe' : 'flutter',
  win
    ? ['/c', 'flutter', 'build', 'apk', '--split-per-abi']
    : ['build', 'apk', '--split-per-abi'],
  {
    cwd: APP,
    stdio: 'inherit',
    env: { ...process.env, TEMP, TMP: TEMP },
  }
);

const built = fs
  .readdirSync(OUT)
  .filter((f) => /^app-.*-release\.apk$/.test(f))
  .sort();

console.log('');
for (const f of built) {
  const mark = f === SEND ? '->' : '  ';
  console.log(`${mark} ${mb(path.join(OUT, f)).padStart(6)} MB  ${f}`);
}

// The universal APK from an older `flutter build apk` outlives it, and it is
// the wrong file with the more obvious name — 67MB, versionCode 1, sitting in
// the same folder. Nothing reads it after this script has run, and leaving it
// there is leaving a way to send it by accident.
const stale = path.join(OUT, 'app-release.apk');
if (fs.existsSync(stale)) {
  fs.unlinkSync(stale);
  console.log('');
  console.log('(removed the stale universal app-release.apk)');
}

const target = path.join(OUT, SEND);
if (!fs.existsSync(target)) {
  console.error(`\n${SEND} was not built.`);
  process.exit(1);
}

const v = versionOf(target);
console.log(`\nSend ${SEND}.`);
if (v) {
  console.log(`versionCode ${v.code}, versionName ${v.name}`);
  if (/-debugsigned$/.test(v.name || '')) {
    // Loud, because the consequence lands weeks later on somebody who has by
    // then recorded a month of entries into it.
    console.log(
      '\nThis is signed with the DEBUG key. It installs on your own phone and\n' +
        'nowhere else, and it can never be updated by a properly signed build —\n' +
        'that swap needs an uninstall, which takes the ledger with it. Export a\n' +
        'backup first. See flutter_app/android/README.md.'
    );
  }
}
