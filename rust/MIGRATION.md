# Rewriting 大红花记账 in Rust

Target platforms: **Android and Web**. iOS is out of scope — there is no device
to test on, and the `WidgetExtension/` Swift is already unwired.

## Why this document exists

The app being replaced is 16,600 lines of TypeScript: 9,209 of UI across 21
routes and 72 components, 2,679 of pure domain logic, 1,958 of store and sync,
and a 751-test suite that is currently the only description of how any of it
behaves. A rewrite that starts from the UI and works down would spend months
before anything is runnable and would silently drop behaviour nobody wrote down.

So the order is inverted: **logic first, UI last**, with every ported module
proved equal to the shipping TypeScript before the next one starts.

## The parity rule

A module is not ported when its Rust tests pass. Rust tests only prove the Rust
matches what the author believed. A module is ported when it answers
**identically to the code currently in users' hands**, over a corpus large
enough to include the cases nobody thought about.

`npm run parity` runs both implementations over a shared corpus and fails on any
divergence. It runs in CI on every push.

This is not ceremony. The first run, on the 1,262-case calculator corpus, found
a real difference: JavaScript's `Math.round` breaks ties toward +∞ while Rust's
`f64::round` breaks them away from zero, so `9-396-29.82÷12.0` came out as
`-389.48` in the app and `-389.49` in the port. Both implementations' own unit
tests were green. See `rust/core/src/num.rs`.

Adding a module to the harness:

1. Write `rust/parity/<name>-corpus.tsv` — `kind<TAB>arg` per line, generated
   rather than hand-written, weighted toward edges and negatives.
2. Add `rust/core/examples/dump_<name>.rs` reading the corpus on stdin.
3. Add `scripts/<name>-parity.ts` doing the same against the TypeScript.
4. Register it in the `MODULES` list in `scripts/parity.js`.

## Status

| Layer | TS lines | State |
| --- | --- | --- |
| `domain/calc` | 82 | **Ported**, 1,262-case parity |
| `domain/num` (new) | — | **Added** — JS-compatible rounding all money paths must use |
| `domain/money` | 120 | Next |
| `domain/dates`, `period`, `cycle` | ~250 | Queued |
| `domain/budget`, `stats`, `trends`, `insight`, `recap`, `weekly`, `streak` | ~900 | Queued |
| `domain/billParse`, `billDedup`, `encoding`, `gbkTable` | ~700 | Queued |
| `domain/export` + `xlsxWrite` | ~230 | Queued — `rust_xlsxwriter` replaces the hand-rolled writer |
| `store/*` | 1,180 | After domain — needs a state model decision |
| `sync/*` | 778 | After store — `reqwest` + the Supabase REST API |
| UI (21 routes, 72 components) | 9,209 | Last |

## Phase 1 — the domain crate (in progress)

`rust/core` is `no_std`-friendly in spirit: no I/O, no UI, no platform calls.
That is what lets one crate serve both targets — `cdylib` through JNI on
Android, `wasm32-unknown-unknown` through `wasm-bindgen` on web.

Port order follows the dependency graph: `num` → `money` → `dates` → everything
that builds on them. Each module lands with its ported tests **and** a parity
corpus in the same commit.

## Phase 2 — state and sync

The store is Legend-State observables today. The Rust equivalent is a plain
owned model plus a change-notification channel; reactive-signal libraries in
Rust are tied to their UI framework, so keeping the model framework-agnostic
here avoids being married to the Phase 3 choice.

Sync talks to Supabase over plain REST + a realtime websocket. `reqwest` and
`tokio-tungstenite` cover it; there is no official Supabase Rust client, and
`supabase-rs` community crates are thin wrappers not worth the dependency.

## Phase 3 — the UI

**Recommendation: Dioxus.** It is the only mature option that compiles one
component tree to both a WASM web app and an Android app, and its
component/signal model maps almost line-for-line onto the React code being
replaced, which matters when 9,209 lines have to be moved by hand.

**The cost, stated plainly:** Dioxus on Android renders into a WebView. The UI
is authored in Rust — `rsx!` and Rust event handlers, no HTML or TypeScript —
but the pixels come from a web engine, not native widgets. For this app that is
survivable: the design is already custom-drawn rather than platform-native.

Alternatives, and why not:

- **Slint** — genuinely native rendering (Skia), Android and WASM both
  supported. Rejected for now because its `.slint` DSL is a poor fit for this
  app's heavily custom visuals (gradients, blur, the animated flower burst), and
  its Android story is younger than Dioxus's.
- **egui** — immediate-mode. Excellent for tools, wrong for a consumer app with
  this much bespoke styling and animation.
- **Tauri v2** — Rust backend, but the UI stays HTML/TypeScript, which is not a
  Rust rewrite.

If native-widget rendering is a hard requirement, the choice flips to Slint and
Phase 3 gets substantially more expensive. Worth settling before Phase 2 ends.

## Phase 4 — the platform edges

These have no Rust equivalent and must be written by hand against the Android
SDK through `jni` / `ndk-context`, and stubbed or reimplemented for web:

| Today | Android replacement |
| --- | --- |
| `expo-local-authentication` | `BiometricPrompt` via JNI |
| `expo-notifications` | `NotificationManager` + `AlarmManager` |
| `modules/notif-capture` | already Kotlin — keep as-is, rebind |
| `plugins/android-widget` | already Kotlin — keep as-is, rebind |
| `expo-document-picker` / `expo-image-picker` | `Intent.ACTION_GET_CONTENT` |
| `expo-print` (PDF) | `PdfDocument`, or `printpdf` in Rust |
| `expo-sharing` | `Intent.ACTION_SEND` |
| `expo-file-system` | `std::fs` + scoped-storage paths |
| `AsyncStorage` | `rusqlite` or a flat file |
| `expo-haptics` | `Vibrator` |
| `expo-router` | Dioxus Router |

## Rules while both trees exist

- The TypeScript app stays shippable and green the entire time. It is the
  reference implementation, and it is what users are running.
- Nothing is deleted from `src/` until its Rust counterpart passes parity **and**
  is wired into a running build.
- Every ported module joins `npm run parity`. A module without a corpus is not
  done.
- `cargo clippy -- -D warnings` and `cargo fmt --check` gate CI alongside the
  existing lint/typecheck/test jobs.
