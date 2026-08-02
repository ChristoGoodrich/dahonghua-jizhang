<div align="center">

<img src="assets/images/icon.png" width="112" alt="Red Blossom app icon" />

# 大红花记账 · Red Blossom

**An offline-first personal ledger for iOS, Android and the web — bilingual (中文 / English), private by default, cloud sync optional.**

[![CI](https://github.com/ChristoGoodrich/dahonghua-jizhang/actions/workflows/ci.yml/badge.svg)](https://github.com/ChristoGoodrich/dahonghua-jizhang/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Expo SDK 56](https://img.shields.io/badge/Expo%20SDK-56-000020?logo=expo&logoColor=white)](https://docs.expo.dev/versions/v56.0.0/)
[![React Native 0.85](https://img.shields.io/badge/React%20Native-0.85-61DAFB?logo=react&logoColor=white)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Platforms](https://img.shields.io/badge/platforms-iOS%20·%20Android%20·%20Web-lightgrey)](#)

**English** · [简体中文](README.zh-CN.md)

</div>

---

Every entry you log plants a flower. 大红花 ("big red blossom") is the sticker Chinese
schoolchildren get for doing well — the app turns bookkeeping into that same small daily
reward: a bloom per entry, a streak, a garden that fills up over the month.

Underneath the flowers it is a complete double-sided ledger: accounts, transfers,
multi-currency, budgets, subscriptions, reimbursements, loans, net worth, statistics and
PDF reports. **It runs entirely on your device.** Cloud sync, AI quick-entry and crash
reporting are all opt-in — leave them unconfigured and the app never touches the network.

## Table of contents

- [Features](#features)
- [Getting started](#getting-started)
- [Configuration](#configuration)
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
| **再记 (Again)** | Saves without closing the sheet, so a run of similar entries goes in one sitting. Any entry can also be duplicated into a fresh one dated today. |
| **Templates** | Pin recurring entries (rent, commute) as chips above the keypad. |
| **Transfers** | Between accounts, with fee and bonus legs. |
| **Multi-currency** | Per-entry currency and rate. Switching the base currency converts entries, balances, assets, loans, subscriptions, templates and budgets — it never just relabels them. |
| **AI quick entry** | Type "午饭35" or "coffee 4.5", tap ✨, and the amount, category, direction and note are filled in. Optional — see [AI_SETUP.md](AI_SETUP.md). |
| **Receipt scan** | Photograph a receipt and let the model pull the total out of it. Optional, same setup. |

### Money you hold

- **Accounts** — balances, archiving (hidden from pickers, history and balance kept), credit-card statement days.
- **Other assets and debts** — property, vehicles, funds, tracked by hand.
- **Loans** — money lent and borrowed, with partial repayments.
- **Net worth** — accounts + assets − debts, in one number.
- **Budget** — a monthly pot with a configurable cycle start day, progress, forecast and an insight banner.
- **Subscriptions** — monthly/yearly recurring charges posted automatically, with the next due date. Charge ids are derived from (subscription, charge instant), so two devices converge on one row instead of double-charging.
- **Reimbursements** — mark an entry pending, confirm it when the money comes back.
- **Multiple ledgers, tags and sub-categories** — for separating work from personal, or a trip from the rest of the month.

### Reading the numbers

- **Activity and calendar views** of the same ledger, with search and filters; tapping a day opens the record sheet pre-dated to it.
- **Statistics** — category donut, six-period trend, by weekday, by time of day, day/week/month/half/year switch, this-month-vs-last-month-so-far.
- **Insights** — next-cycle forecast from the last three cycles, with a trend direction, a confidence level and tips.
- **Monthly report** — generated as a shareable PDF.
- **Recap and streaks** — a monthly wrap-up and a consecutive-days counter.

### Getting data in

- **Bill import** — Alipay and WeChat CSV/Excel exports, including their GBK encoding (decoded by a generated pure-JS table, so it works in Expo Go without a native module), with duplicate detection against what you already have.
- **Auto-capture (Android)** — an optional notification listener reads payment notifications, parses them, and queues anything it isn't sure about for you to confirm or dismiss.
- **Restore** — reads this app's backups and the previous app's v7 backup JSON.

### Data, privacy and safety

- **Offline-first.** Everything is stored locally through AsyncStorage. With no keys configured, nothing leaves the device.
- **Optional cloud sync** — Supabase with email one-time-code sign-in, row-level security so a user can only ever read their own rows, realtime updates across devices, and soft-delete tombstones so a deletion propagates. See [SYNC_SETUP.md](SYNC_SETUP.md).
- **Backups** — manual or automatic (daily/weekly, capped count, oldest pruned), optionally encrypted with AES-256-GCM. Export as CSV, Excel or JSON.
- **App lock** — biometrics or device passcode, re-locking whenever the app leaves the foreground, and failing *closed* on any authentication error. Lock settings and passcodes are never uploaded.
- **Balance privacy** — an eye toggle masks every amount on the summary, asset and account screens.

### Look and feel

- **中文 / English** throughout, switchable at runtime.
- **Light and dark**, plus flower themes (default, ocean, forest, sunset).
- **Home-screen widgets** — a WidgetKit budget widget on iOS, an app-widget provider on Android.
- **Reminders** — a daily nudge, plus weekly (Sunday 20:00) and monthly (1st, 09:00) report notifications.
- Haptics, glass navigation bar, petal-burst animation on save.

## Getting started

### Prerequisites

- **Node.js 20+** and npm
- A device or emulator: [Expo Go](https://expo.dev/go) is enough for most of the app; the
  biometric prompt, notification capture and widgets need a development build.

### Install and run

```bash
git clone https://github.com/ChristoGoodrich/dahonghua-jizhang.git
```

```bash
cd dahonghua-jizhang && npm install
```

```bash
npx expo start
```

Then press `i` for the iOS simulator, `a` for an Android emulator, `w` for the web build,
or scan the QR code with Expo Go.

The app is fully usable at this point — no accounts, no keys, no backend.

## Configuration

Copy [`.env.example`](.env.example) to `.env` and fill in only what you want. Every
variable is optional; each unset feature simply stays hidden.

| Variable | Enables | Guide |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Cloud sync + account | [SYNC_SETUP.md](SYNC_SETUP.md) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Cloud sync + account | [SYNC_SETUP.md](SYNC_SETUP.md) |
| `EXPO_PUBLIC_AI_PROXY_URL` | AI quick entry via your own server proxy (**recommended** — the LLM key stays server-side) | [AI_SETUP.md](AI_SETUP.md) |
| `EXPO_PUBLIC_MIMO_API_KEY` | AI quick entry calling MiMo directly — **personal builds only**, the key ships inside the bundle | [AI_SETUP.md](AI_SETUP.md) |
| `EXPO_PUBLIC_SENTRY_DSN` | Crash reporting | [sentry.io](https://sentry.io) |

Restart with `npx expo start -c` after changing `.env` so the values are picked up.

> `EXPO_PUBLIC_*` variables are **baked into the client bundle** and readable by anyone
> who installs the build. The Supabase anon key is designed for that (row-level security
> is what protects the data); an LLM key is not — keep it behind the proxy. Put anything
> you must not publish in `.env.local`, which is gitignored.

## Project structure

```
src/
  app/          expo-router screens (file-based routes)
  features/     screen-level composition: record, list, stats, budget, assets, me, nav…
  components/   shared widgets + the ui/ primitives (Btn, Chip, Icon, Rows, SheetShell)
  domain/       pure logic — money, cycles, budgets, stats, bill parsing, insights…
  store/        Legend-State observable store + persistence and per-domain actions
  sync/         Supabase auth, sync engine, merge, push scheduler, conflict log
  ai/           prompt building, response normalization, client (no key on device)
  i18n/         zh/ and en/ JSON bundles
  theme/        design tokens + theme context
  util/         backup, crypto, pdf, share, haptics, analytics, sentry, widgets
modules/        notif-capture — Android notification-listener native module
plugins/        android-widget config plugin (Kotlin provider + layouts)
WidgetExtension/ iOS WidgetKit budget widget (Swift)
supabase/       SQL migrations, RLS audit, the ai-parse edge function
e2e/            Detox end-to-end tests
docs/           design specs and phase plans
```

`domain/` is deliberately free of React and platform APIs, which is why most of the test
suite can run in a plain Node environment.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Expo dev server |
| `npm run ios` / `npm run android` | Build and run the native app |
| `npm run web` | Run in the browser |
| `npm test` | Jest suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint via `expo lint` |
| `npm run storybook` | Component workbench on port 6006 |
| `npm run e2e:build:ios` / `npm run e2e:test:ios` | Detox on the iOS simulator |
| `npm run e2e:build:android` / `npm run e2e:test:android` | Detox on an Android emulator |

## Testing and quality

**663 tests across 69 suites**, alongside a clean `tsc --noEmit` and zero ESLint errors.
CI runs lint, typecheck and tests with coverage on every push and pull request, and
**fails the build under 70 % line coverage**.

```bash
npm test -- --coverage
```

Tests live in `__tests__/` directories next to the code they cover. Domain logic is
tested directly; the sync engine is tested against a faked Supabase client, so it is
exercised without any credentials configured.

## Building and releasing

Builds go through [EAS](https://docs.expo.dev/build/introduction/), so iOS builds do not
need a Mac. Full walkthrough, including store submission and OTA updates, in
[RELEASE.md](RELEASE.md).

```bash
eas build -p android --profile preview
```

Two GitHub workflows are wired up already:

- **[build-apk.yml](.github/workflows/build-apk.yml)** — builds an installable arm64 APK on every push to `main` and uploads it as an artifact.
- **[release.yml](.github/workflows/release.yml)** — on a `v*` tag, builds that same APK and publishes it as a GitHub Release. Store submission through EAS is the same workflow run by hand with `submit_to_stores` ticked, and needs an `EXPO_TOKEN` secret plus developer accounts.

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Expo SDK 56, React Native 0.85, React 19.2, React Compiler enabled |
| Routing | expo-router with typed routes |
| State | Legend-State observables + an explicit AsyncStorage hydrate/save loop |
| Language | TypeScript, `strict: true` |
| Backend (optional) | Supabase — Postgres, auth, realtime, edge functions |
| Testing | Jest + jest-expo, Detox, Storybook |
| Monitoring (optional) | Sentry |

## Documentation

| Document | Contents |
| --- | --- |
| [SYNC_SETUP.md](SYNC_SETUP.md) | Standing up Supabase: schema, migrations, email OTP, keys |
| [AI_SETUP.md](AI_SETUP.md) | The AI quick-entry proxy, and the direct-key alternative |
| [RELEASE.md](RELEASE.md) | EAS builds, store submission, OTA updates, pre-submit checklist |
| [DATA_MODEL_assets.md](DATA_MODEL_assets.md) | How accounts, assets, loans and net worth relate |
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
<sub>Built with <a href="https://expo.dev">Expo</a> 🌺</sub>
</div>
