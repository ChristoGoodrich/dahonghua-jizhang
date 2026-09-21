<div align="center">

<img src="assets/images/icon.png" width="112" alt="Red Blossom app icon" />

# 大红花记账 · Red Blossom

**An offline-first personal ledger for Android — bilingual (中文 / English), and private not by policy but by construction.**

[![CI](https://github.com/ChristoGoodrich/dahonghua-jizhang/actions/workflows/ci.yml/badge.svg)](https://github.com/ChristoGoodrich/dahonghua-jizhang/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Rust core](https://img.shields.io/badge/core-Rust-CE422B?logo=rust&logoColor=white)](rust/core)
[![Flutter](https://img.shields.io/badge/UI-Flutter-02569B?logo=flutter&logoColor=white)](flutter_app)
[![Goldens](https://img.shields.io/badge/goldens-125%2C683%20cases-success)](rust/parity/golden)

**English** · [简体中文](README.zh-CN.md)

</div>

---

Every entry you log plants a flower. 大红花 ("big red blossom") is the sticker Chinese
schoolchildren get for doing well — the app turns bookkeeping into that same small daily
reward: a bloom per entry, a streak, a garden that fills up over the month.

Underneath the flowers it is a complete double-sided ledger: accounts, transfers,
multi-currency, budgets, subscriptions, reimbursements, loans, net worth, statistics and
reports. **It runs entirely on your device.** The only thing it ever asks the network for
is an exchange rate — a currency pair and a date. Syncing between two devices is a file
you carry, so even that goes nowhere on its own.

## How it is built

A **Rust core** decides everything: money arithmetic, budget cycles, statistics,
statement dates, the merge between two devices. A **Flutter UI** draws it, and two small
Kotlin components handle what only Android can — reading payment notifications, and the
home-screen widget.

The rule is that the core decides and everything else transports or draws. A screen that
computes its own answer can disagree with the rest of the app, and its answer is the one
nobody thinks to test.

This app was a React Native app until 2026. The rewrite kept it honest with a parity
harness: every ported module was run against the shipping TypeScript over a shared corpus
and had to answer identically. Those 125,683 answers are frozen in
[`rust/parity/golden/`](rust/parity/golden) and still gate every commit — each line was
produced by the code that was in users' hands. The TypeScript itself is at the `rn-final`
tag.

## Table of contents

- [Features](#features)
- [Getting started](#getting-started)
- [Not in this build](#not-in-this-build)
- [Project structure](#project-structure)
- [Scripts](#scripts)
- [Testing and quality](#testing-and-quality)
- [Building and releasing](#building-and-releasing)
- [Tech stack](#tech-stack)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Features

### Recording

| | |
| --- | --- |
| **Calculator keypad** | Type `12.5+8` and it settles the arithmetic for you. |
| **Learned note chips** | The notes you use most for the selected category, ranked by frequency then recency, offered as one-tap chips. No configuration. |
| **Backdating** | Today / yesterday / 2 days ago chips plus a date picker — an entry doesn't have to mean "now". |
| **再记 (Again)** | Saves without closing the sheet, so a run of similar entries goes in one sitting. |
| **Templates** | Pin recurring entries (rent, commute) as chips above the keypad. |
| **Transfers** | Between accounts, with fee and bonus legs. |
| **Multi-currency** | Per-entry currency and rate. Switching the base currency converts entries, balances, assets, loans, subscriptions, templates and budgets — it never just relabels them. |

### Money you hold

- **Accounts** — balances, archiving (hidden from pickers, history and balance kept), credit-card statement days, and a per-account history where a transfer shows what it actually did to *that* account.
- **Other assets and debts** — property, vehicles, funds, tracked by hand.
- **Loans** — money lent and borrowed, with partial repayments.
- **Net worth** — accounts + assets − debts, in one number.
- **Budget** — a monthly pot with a configurable cycle start day, progress, forecast and an insight banner.
- **Subscriptions** — recurring charges posted automatically, with the next due date. Charge ids are derived from (subscription, charge instant), so two devices converge on one row instead of double-charging.
- **Reimbursements** — mark an entry pending, confirm it when the money comes back.
- **Multiple ledgers, tags and sub-categories** — for separating work from personal, or a trip from the rest of the month.

### Reading the numbers

- **Activity view** with search and filters.
- **Statistics** — category donut, six-period trend, by weekday, by time of day, day/week/month/half/year switch, this-month-vs-last-month-so-far.
- **Insights** — next-cycle forecast from the last three cycles, with a trend direction, a confidence level and tips.
- **Recap and streaks** — a monthly wrap-up and a consecutive-days counter.

### Getting data in and out

- **Bill import** — Alipay and WeChat CSV exports, including their GBK encoding, with duplicate detection against what you already have.
- **Auto-capture** — an optional notification listener reads payment notifications, parses them, and queues anything it isn't sure about for you to confirm or dismiss.
- **Backups** — snapshots you can restore, and this app also reads the previous app's v7 backup JSON.
- **CSV export** of the whole ledger.

### Two devices, no server

Sync is a file. The app writes a document; you put it wherever your files already follow
you — a cloud folder, WebDAV, a USB stick — and the other device reads it, **merges**,
and writes it back. Where both edited the same entry the later edit wins, field by field;
anything deleted stays deleted.

There is no account, no server and no credential, which is why the manifest can still say
the only thing this app reaches the network for is an exchange rate. A ledger can end up
in a cloud folder because *you* put it there.

### Data, privacy and safety

- **Offline-first.** SQLite, owned by the Rust core, written a row at a time.
- **App lock** — biometrics or device passcode, re-locking whenever the app leaves the foreground, and failing *closed* on any authentication error.
- **Balance privacy** — an eye toggle masks every amount on the summary, asset and account screens.

### Look and feel

- **中文 / English** throughout, switchable at runtime.
- **Light and dark**, plus flower themes (default, ocean, forest, sunset).
- **Home-screen widget** — the budget, drawn from numbers the app itself computed, so it cannot disagree with the budget screen.
- **Reminders** — a daily nudge, plus weekly (Sunday 20:00) and monthly (1st, 09:00) reports.
- Haptics, glass navigation bar, petal-burst animation on save.

## Not in this build

Listed because a README that quietly drops a feature is worse than one that says it went.
The React Native app had these; this one does not.

| | Why |
| --- | --- |
| **iOS and web** | Nobody has an iOS device to test on, and shipping a binary nobody has run is not shipping. |
| **AI quick entry, receipt scan** | Needed a model API key and a network round trip for something the calculator keypad already does in two taps. |
| **Cloud sync (Supabase)** | Replaced by file sync, above. The merge logic is the same code, and far better tested. |
| **Encrypted backups** | The snapshot is written but not encrypted yet; the app still *reads* encrypted backups from the old one. |
| **PDF monthly report** | The report exists as a screen. Rendering it to a PDF does not. |
| **Calendar view** | The activity list and statistics cover what it did. |
| **xlsx export** | CSV opens in every spreadsheet, and writing xlsx would cost the core a pile of dependencies for no decision. |


## Getting started

You need the Flutter SDK, a Rust toolchain with the Android targets, and an Android
device or emulator. There is no Node dependency to install — the scripts here are plain
Node, and `node_modules` no longer exists.

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android

cd flutter_app
flutter pub get
flutter run
```

`flutter run` builds the Rust core for your device's ABI on the way, through cargokit.
The first build compiles SQLite from source for each target and is slow; later ones are
not.

## Project structure

```
rust/
  core/            the domain. Pure, and one dependency (regex-lite).
  store/           SQLite. Outside core on purpose — a crate that can touch a
                   disk has answers that depend on one.
  parity/golden/   125,683 answers the TypeScript gave, frozen.
  MIGRATION.md     why each decision went the way it did.

flutter_app/
  lib/             the UI, one file per screen.
  rust_bridge/     the FFI layer (flutter_rust_bridge). Its own cargo project.
  integration_test/  601 tests. all_test.dart runs them in one build.
  android/…/kotlin/  the notification listener and the home-screen widget.
  tool/gen_icons.py  launcher icon and splash, from assets/images/.

scripts/           goldens, corpus generators, the test aggregator.
assets/images/     the icon, shared with what the Kotlin widget draws.
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run goldens` | The core against 125,683 recorded answers |
| `npm run rust:test` | 764 Rust tests |
| `npm run rust:clippy` / `rust:fmt` | Lint and format the workspace |
| `npm run bridge:clippy` / `bridge:fmt` | The bridge is a separate cargo project |
| `npm run tests:check` | Fails if `all_test.dart` is stale |
| `flutter test integration_test/all_test.dart` | The whole suite, ~5 minutes |

## Testing and quality

Three layers, and they answer different questions.

**Rust unit tests** prove the core does what its author believed. **The goldens** prove
it does what the app that shipped to users did — a stronger claim, and the one that
caught real divergences during the rewrite (JavaScript's `Math.round` breaks ties toward
+∞; Rust's `f64::round` breaks them away from zero). **The integration suite** runs on a
real device and proves the app built out of them works.

A golden failure means the core now answers something the shipping app did not. It is
not a formatting nit, and it must not be fixed by regenerating the goldens — there is
nothing left to regenerate them from.

Tests here are also checked by breaking what they cover and confirming they fail. Three
times during this rewrite a check turned out to be incapable of failing, and each one
looked green.

## Building and releasing

```bash
cd flutter_app
flutter build apk --release
```

Without a signing key the release build falls back to the debug key and stamps
`-debugsigned` into the version name, which shows up in Android's app info. That is fine
for your own phone and nothing else: a debug-signed APK cannot be updated by a properly
signed one later. [`flutter_app/android/README.md`](flutter_app/android/README.md) covers
making a real key, and what losing it costs.

Debug builds install as `com.dahonghua.app.debug`, so running the test suite on a phone
does not uninstall the app that phone is using.

## Tech stack

| Layer | What |
| --- | --- |
| Domain | Rust 2021, one dependency (`regex-lite`) |
| Storage | SQLite via `rusqlite`, bundled and compiled per ABI |
| UI | Flutter, `flutter_rust_bridge` 2.12 |
| Android | Kotlin: a `NotificationListenerService` and a `RemoteViews` widget |
| Sync | A file you carry. No server, no account, no credentials |
| Platform | Android. iOS is deliberately absent — see AGENTS.md |


## Documentation

| Document | Contents |
| --- | --- |
| [rust/MIGRATION.md](rust/MIGRATION.md) | Why the rewrite went the way it did, module by module, including the things it got wrong first |
| [flutter_app/android/README.md](flutter_app/android/README.md) | Making a signing key, and what losing it costs |
| [AGENTS.md](AGENTS.md) | The rules this codebase is written under |
| [RELEASE.md](RELEASE.md) | Tagging a release |
| [docs/archive/DATA_MODEL_assets.md](docs/archive/DATA_MODEL_assets.md) | How accounts, assets, loans and net worth relate — written against the React Native files, still true of the model |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development workflow, commit and PR conventions |
| [SECURITY.md](SECURITY.md) | Reporting a vulnerability |

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md)
([中文](CONTRIBUTING.zh-CN.md)) for the workflow, and note that every change is expected
to keep lint, typecheck and tests green. Participation is governed by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please do not open a public issue for a vulnerability — see [SECURITY.md](SECURITY.md)
for how to report one privately.

## License

[MIT](LICENSE).

<div align="center">
<sub>A Rust core, a Flutter UI, and no server 🌺</sub>
</div>
