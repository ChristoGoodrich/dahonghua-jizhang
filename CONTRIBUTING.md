# Contributing to 大红花记账 · Red Blossom

Thanks for taking the time. This covers setting the project up, what a good
change looks like here, and how to get it merged.

[简体中文版](CONTRIBUTING.zh-CN.md)

## Ways to help

- **Report a bug** — [open an issue](https://github.com/ChristoGoodrich/dahonghua-jizhang/issues/new/choose) with the bug template. Steps to reproduce beat a description.
- **Suggest a feature** — say what problem it solves, not only what to build.
- **Send a pull request** — small and focused is much easier to review than large and sweeping.

For a security vulnerability, do **not** open an issue — see [SECURITY.md](SECURITY.md).

## The shape, and the one rule

A Rust core with a Flutter UI, for Android:

    rust/core                 the domain — pure, one dependency (regex-lite)
    rust/store                SQLite, deliberately outside core
    flutter_app/rust_bridge   the FFI layer (flutter_rust_bridge)
    flutter_app/lib           the UI
    flutter_app/android/…     the notification listener and the home-screen widget

**`rust/core` decides; everything else transports or draws.** Before putting
logic in a screen, ask whether two implementations of it could ever disagree —
if so, it belongs in the core. [AGENTS.md](AGENTS.md) says why, and records the
mistakes that made each of its rules.

## Setup

You need the Flutter SDK, stable Rust, and the Android SDK with an NDK. Node
20+ is only for the check scripts — there is no JavaScript in the app.

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
cd flutter_app && flutter pub get
flutter run
```

No keys or environment variables are needed: the app reaches the network for
nothing but an exchange rate. On Windows, point `TEMP` and `TMP` at a short path
(`C:\Temp\dahonghua-build`) — Gradle's default one is long enough to break the
build.

If you change a function in `rust_bridge/src/api/`, regenerate the Dart side:

```bash
cd flutter_app && flutter_rust_bridge_codegen generate
```

## Before you push

CI runs all of these; running them first is kinder.

```bash
npm run rust:fmt && npm run rust:clippy && npm run rust:test
npm run bridge:fmt && npm run bridge:clippy
npm run goldens
npm run tests:check
cd flutter_app && flutter analyze && flutter test integration_test/all_test.dart
```

The integration suite needs a device or an emulator. **A run without one makes
no claim** — check for device errors before believing a green result.

**`npm run goldens` is not a formatting check.** It holds the core to 125,683
answers the shipping TypeScript app gave. A failure means the core now answers
something users never saw. Fix the core; never regenerate the goldens — there
is nothing left to regenerate them from.

## Code conventions

- **Arithmetic and judgement in `rust/core`**, with tests beside it. Dart does
  what only the platform can: the timezone, the clock, files, the network,
  every locale string.
- **Both languages at once.** User-visible text is written at the call site as
  `zh ? '…' : '…'`, and both halves go in the same change.
- **Writing to the store goes through `store_mut()`** (or `store_marked()` when
  the blast radius is provable). `store()` is read-only on purpose; AGENTS.md
  explains the data loss that made it so.
- **Comments explain *why*.** The code says what it does; a comment earns its
  place with the reason, the constraint or the edge case behind it.
- **Match the surrounding file** for naming, structure and comment density.

## Tests

- Rust tests live beside the code, in `#[cfg(test)]` modules.
- Integration tests live in `flutter_app/integration_test/` and run through one
  entrypoint, `all_test.dart`. Add a file, then re-run
  `node scripts/gen-all-tests.js`; `npm run tests:check` fails if you forget.
- Give a widget a `Key` when a test needs to reach it.
- Every bug fix comes with a test that fails before the fix.
- **After writing a test, break the thing it covers and check that it fails.**
  Three times in this project a check turned out to be incapable of failing,
  and each one looked green.

## Looking at it

`integration_test/tour.dart` screenshots every screen in both light and dark,
as real surface captures, into `flutter_app/build/tour/`:

```bash
cd flutter_app
flutter drive --driver=test_driver/tour.dart --target=integration_test/tour.dart -d <device>
```

Run it before and after anything visual, and put the two in the PR.

## Commits

The history follows [Conventional Commits](https://www.conventionalcommits.org/),
with the area in parentheses:

```
feat(stats): the six sections the port dropped
fix(glass): every band of the scrim now fades in
fix(android): narrow abiFilters to the build's target platform
chore: remove the corpus generators nothing runs
```

Imperative mood, subject under ~72 characters. Explain the reasoning in the
body when the change is not self-evident — what was wrong, how you found it,
and how you know it is fixed.

## Pull requests

1. Branch off `main` (`feat/…`, `fix/…`, `refactor/…`).
2. Keep the diff to one concern; split unrelated cleanups into their own PR.
3. Say what changed, why, and how you verified it.
4. Screenshots from the tour for anything visual.
5. Update AGENTS.md when you learn something the next person would otherwise
   learn the hard way, and CHANGELOG.md for anything user-facing.

Review is a conversation, not a gate — expect questions, and ask your own.

## Code of Conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
