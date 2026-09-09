# 大红花记账

A Rust core with a Flutter UI, for Android. There is no JavaScript in this app.

This file used to say "Expo HAS CHANGED — read the versioned docs before
writing any code." There is no Expo any more. The React Native app was the
reference implementation for a rewrite, and it was removed once every part of
it had been ported and shipped; it is still in history at the `rn-final` tag.

## The shape

    rust/core          the domain. Pure, and one dependency (regex-lite).
    rust/store         SQLite, deliberately outside core — see below.
    flutter_app/rust_bridge   the FFI layer, flutter_rust_bridge.
    flutter_app/lib    the UI.
    flutter_app/android/…/kotlin   two Android components: the notification
                       listener and the home-screen widget.

## The rule the whole thing rests on

**`rust/core` decides; everything else transports or draws.**

A screen that computes its own answer can disagree with the rest of the app,
and its answer is the one nobody thinks to test. So the core owns the
arithmetic and the judgement, and the platform owns what only the platform can
know: the timezone, the clock, identity, files, the network, and every locale
string. When you are unsure which side something belongs on, ask whether two
implementations of it could ever disagree — if so, it belongs in the core.

`core` has exactly one dependency and it should stay that way. It is the crate
whose every answer is checked against real shipping behaviour, and a crate that
can touch a disk or a clock has answers that depend on one. `dahonghua-store`
exists because SQLite had to live somewhere that was not `core`.

## The goldens

`npm run goldens` checks the core against 125,683 recorded answers in
`rust/parity/golden/`. Those were produced by the TypeScript app on the day it
was removed, so every line came from code that was in users' hands.

**A golden failure is not a formatting nit.** It means the core now answers
something the shipping app did not. Do not regenerate the goldens to make it
pass — there is nothing left to regenerate them from, and `freeze-goldens.js`
refuses to run without `src/` for exactly that reason.

## Running things

    npm run goldens       the core against what the TypeScript answered
    npm run rust:test     764 tests
    npm run rust:clippy   -D warnings
    npm run bridge:clippy the bridge is a separate cargo project
    npm run tests:check   all_test.dart is not stale

    cd flutter_app
    flutter test integration_test/all_test.dart    601 tests, ~5 min
    flutter test integration_test/<one>_test.dart  while working on one screen

The suite is one entrypoint on purpose: per file it was 33 APK builds and about
twenty minutes. Add a test file and re-run `node scripts/gen-all-tests.js`.

## Writing to the store

`store()` hands out a **read-only** reference. Writing goes through
`store_mut()`, which marks the whole ledger dirty, or `store_marked()` for the
handful of paths that mark narrowly and can prove their blast radius.

This is not ceremony. When the dirty set was written, six mutators in
`api/store.rs` were audited and nobody checked whether other modules reached
past them. Five did — `record.rs`, `reimburse.rs`, `capture.rs`,
`currency.rs`, `subscriptions.rs` — and every one of them wrote rows that were
never marked and never saved. **Every entry recorded through the record sheet
was lost on the next launch**, which is the app's primary way of creating one.

The type is what makes it findable: making `store()` read-only turned twenty
silent data-loss sites into twenty compile errors. Forgetting now means taking
the wide mark, which costs a slower save rather than the data.

## Two habits worth keeping

**Injections.** After writing a test, break the thing it covers and check that
it fails. Three times in this project a check turned out to be incapable of
failing — a `sed` that ate an ampersand, a `const` that inlined so the linker
dropped every line of SQLite, a shell that expanded `\$` so a replacement
silently did nothing. Each looked green. Assert the pattern was found before
writing it, and diff the file afterwards.

**A run without a device makes no claim.** A suite that reports zero failures
because the emulator died is not a passing suite. Check for device errors
before believing a result.

## What is deliberately absent

iOS — nobody has a device to test on, and shipping a binary nobody has run is
not shipping. `xlsxWrite` — CSV opens everywhere and xlsx would cost the core a
pile of dependencies. Cloud sync — sync is a file you carry, so the app still
reaches the network for nothing but an exchange rate, and `AndroidManifest.xml`
still says so truthfully.
