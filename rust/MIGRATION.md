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
| `domain/money` | 120 | **Ported**, 1,545-case parity |
| `domain/civil` (new) | — | **Added** — calendar arithmetic, the pure half of `dates.ts` |
| `domain/cycle` | 37 | **Ported**, 14,185-case parity, zero divergences |
| `domain/dates` | 33 | Split: `monthGrid` ported; `onDay`/`sameDay`/`daysAgo` are platform-boundary (see below) |
| `domain/period` | 130 | Windows **ported**, 12,108-case parity; entry filtering and labels deferred (below) |
| `domain/budget`, `stats`, `trends`, `insight`, `recap`, `weekly`, `streak` | ~900 | Queued |
| `domain/billParse` → `bills` | 272 | **Ported**, 4,400-case parity — bar `decodeBillText` |
| `domain/encoding` + `gbkTable` | 65 + 24k cells | Deferred by choice — `encoding_rs`, not a hand-copied table (below) |
| `domain/billDedup` → `dedup` | 138 | **Ported**, 3,838-case parity |
| `domain/export` + `xlsxWrite` | ~230 | Queued — `rust_xlsxwriter` replaces the hand-rolled writer |
| `entry` + `ledger` + `store` (new) | ~120 of `store/state.ts` | **Ported** — owned state, stateful parity |
| `store/accounts` | 53 | **Ported**, folded into the same 1,338-scenario corpus |
| `store/currency` + `model` | 138 | **Ported** (bar the HTTP refresh), folded into the same corpus |
| `store/templates` + `tags` + `categories` → `catalog` | 83 | **Ported**, in the same corpus |
| `store/assets` → `networth` | 34 | **Ported**, in the same corpus |
| `store/reimburse` | 64 | **Ported**, in the same corpus |
| `domain/cats` | 47 | **Ported** into `catalog` |
| `domain/subscriptions` + `store/subscriptions` → `subs` | 109 | **Ported**, in the same corpus |
| rest of `store/*` | ~536 | Next — inbox, backup/import |
| `sync/*` | 778 | After store — `reqwest` + the Supabase REST API |
| UI (21 routes, 72 components) | 11,049 | Last — **Dioxus decided**, both prototypes measured on device |

## Phase 1 — the domain crate (in progress)

`rust/core` is `no_std`-friendly in spirit: no I/O, no UI, no platform calls.
That is what lets one crate serve both targets — `cdylib` through JNI on
Android, `wasm32-unknown-unknown` through `wasm-bindgen` on web.

Port order follows the dependency graph: `num` → `money` → `dates` → everything
that builds on them. Each module lands with its ported tests **and** a parity
corpus in the same commit.

### What the harness has caught so far

Four divergences, none of which either side's own unit tests could have found:

1. **Tie-breaking, calculator.** `Math.round` breaks ties toward +∞; Rust's
   `f64::round` breaks them away from zero. `9-396-29.82÷12.0` → `-389.48` vs
   `-389.49`.
2. **Tie-breaking, formatter.** `Intl.NumberFormat` breaks ties *away from
   zero* — the opposite of `Math.round`. Both modes live in the same codebase,
   and `fmtShort` uses both in one expression: `Math.round` collapses to an
   integer, then `Intl` formats it. Port the raw value straight to the
   formatter and `-1234.5` renders `-1,235` where the app shows `-1,234`.
3. **What gets rounded.** `Intl` rounds the *decimal* representation, not the
   binary one: `2.605` is `2.60499…` as an f64 yet formats as `2.61`. Scaling by
   100 and rounding — the obvious port — gives `2.60`. `format_fixed` works on
   the shortest-round-trip digit string instead.
4. **Negative zero.** `-0.001` at two decimals rounds to nothing but kept its
   sign, so a `-0.3` balance rendered `￥-0`. Fixed in the TypeScript rather
   than ported forward, and both sides now strip the sign after rounding.

Two prerequisites also came out of porting `money`, both fixed in the
TypeScript first because there is no faithful port of non-determinism:

- `fmtNum`/`fmtShort` formatted with `toLocaleString(undefined, …)`, i.e. the
  *device's* locale. A German handset rendered `￥1.234.567,50` and an en-IN one
  `￥12,34,567.50`, whatever language the user had picked in a zh/en app. Now
  pinned to en-US grouping, which zh-CN matches.
- Three date call sites leaked the device locale the same way, while the rest of
  the codebase already passed `lang === 'zh' ? 'zh-CN' : 'en-US'`.

The harness compares strings, so it has to stringify the way JavaScript does or
it manufactures divergences that are not real — `String(-0)` is `"0"` in JS and
`"-0"` in Rust. See `js_string` in `dump_money.rs`.

### Does the harness actually have teeth?

Two modules in a row passed with zero divergences, which is either good news or
a corpus that is not looking anywhere. So it was checked: two plausible bugs
were injected into `period.rs` and the suites re-run.

| Injected change | Rust unit tests | Parity harness |
| --- | --- | --- |
| half-year split `< 6` → `<= 6` | caught | caught, 182 cases |
| `shift_cycle(anchor, …)` → `shift_cycle(start, …)` | passed | passed |

The second one is not a bug. `shift_cycle` re-derives the window from whatever
it is given, and the window start always lies inside the anchor's own window, so
both spellings derive the same window — across all 12,108 cases, overflowing
cycle starts included. The source comment now says that, having previously
warned about a trap that does not exist.

### Timezones, and a mechanism that was doing nothing

The harness carried a `tz` option for the date-dependent modules. It was inert,
in two separate ways, and both only surfaced when subscriptions needed real
epoch values:

* `execFileSync` was given the TZ through its `env` option, which does work —
  but not with `shell: true`, which Windows needs to resolve `npx`. So the
  child never saw it.
* Setting `process.env.TZ` inside the harness file does not help either:
  imports hoist above the assignment and ICU is initialised by then.

The option has been removed rather than repaired, because the comparison never
depended on it. Every date-dependent module renders **civil components** on
both sides — dates are constructed from local parts and read back as local
parts, so the zone cancels. Subscription charges are compared by the date they
were derived from rather than by their epoch value, which is the same line
`civil.rs` draws: the core owns which dates, the platform owns what they map to.

Removing it changed nothing, which is the evidence that it was never doing
anything. (An earlier note here claimed the cycle corpus had been verified
under `America/New_York`; that run inherited the machine's own zone —
Australia/Sydney, which also observes daylight saving, so the substance held,
but the claim as written was wrong.)

### Where local time stops being pure

`dates.ts` and `cycle.ts` do their maths on JavaScript `Date` objects in **local
time**: `new Date(y, m, d)` builds a local midnight, `getMonth()` reads a local
month. "Local time" is a question only the device can answer, and it answers
differently in October than in June wherever daylight saving applies. A crate
that compiles for both Android and wasm cannot own that.

So the port splits along that line. `civil.rs` holds calendar arithmetic on
plain y/m/d triples — leap years, month lengths, day numbers, weekday, the month
grid, and all of `cycle.ts`, which turned out to touch nothing but y/m/d.
Converting an epoch timestamp to and from local components stays outside the
crate, where the platform can answer it.

Two behaviours had to be inherited rather than designed, both load-bearing:
a cycle start of 0 means 1 (`cycleStart || 1`, and an unset setting arrives as
0), and a start day past the end of a month **overflows** rather than clamping,
because `new Date(y, 1, 31)` is 3 March. A cycle starting on the 31st runs from
1 March in a non-leap year, not from 28 February.

This is the first module to port with **zero divergences** across its corpus —
14,185 cases covering component overflow, leap years, century boundaries, every
start day 0–31, and both sides of every window edge. The corpus was additionally
run under `America/New_York`, where `cycleDays` sees 23- and 25-hour days across
a DST transition; it agrees there too, because the `Math.round` in that
millisecond division absorbs them and the Rust side counts civil days instead.

### The one dependency, and what it cost

`notif` is the only module that needed a crate: its whole job is pattern
matching over Chinese text. `regex-lite` was chosen over `regex` for size — the
wasm bundle ships over Chinese mobile data, which is why the release profile is
already `opt-level = "z"` — and it drops the Unicode tables and SIMD search that
matter for large haystacks, not for one notification.

Dropping those tables is exactly where the two engines part company, **in both
directions**:

* `\d` in JavaScript without the `u` flag is ASCII `[0-9]`. A Unicode-aware
  engine also matches full-width ０-９, which appear in real pushes — so
  inheriting the engine's opinion would parse amounts the app does not.
* `\s` runs the *other* way. JavaScript's includes U+00A0 and **U+3000, the
  ideographic space**, which is everywhere in Chinese text; `regex-lite`'s is
  ASCII-only.

Only the first was predicted. The second was found by the corpus, on a merchant
name that came back as `35元 返现` from the port and `35元` from the app. `JS_WS`
now spells out the ECMAScript definition and every pattern uses it.

That injection was caught in 2 of 1,075 cases at first — thin for a character
this common in the target language. Walking every whitespace variant through
every merchant pattern took it to 46 of 1,284.

### The port found a bug in the app, not just in the port

`computeDueCharges` advanced its cursor with `cursor.getTime() + 864e5` — twenty
four hours, not a calendar day. Those differ on a daylight-saving day, and on a
spring-forward transition the result lands at 01:00 rather than midnight.
`nextDueDate` then reads the following day as already begun, so a subscription
due the day *after* the transition loses the comparison against its own due date
and is pushed a whole month.

A subscription due on the 5th, in Sydney, skipped its October 2026 charge
outright. Silently — the cursor advances, nothing errors, the entry simply never
appears.

The TypeScript was fixed first, because there is nothing to port against
otherwise, and carries a regression test that fails against the old arithmetic.
Only the spring-forward case was ever broken; the fall-back test passes either
way and is kept for symmetry.

Re-injecting the bug was caught in 1 of 1,429 cases — a DST transition is two
days a year. Walking every charge day around ten real Sydney transitions, with
cursors on, before and a month behind each, took it to 11 of 1,789.

### Two more pieces of `new Date` that had to be reproduced

`billParse` was the first module to build a `Date` from *components* rather than
from a millisecond count, and the constructor turns out to carry two behaviours
that reading the TypeScript would not suggest.

**Years 0 through 99 mean 1900 through 1999.** `MakeFullYear` is still in the
spec, so `new Date(1, 0, 5)` is January 1901. The pattern demands a four-digit
year, which does not put this out of reach: `0099` is four digits, and
`10000-1-5` backtracks into `0000`. A corrupt row dated `0001-01-05` imports as
1901 in the app today. That is not a bug to fix — it is what users' data already
went through — so the port reproduces it.

**Time components carry into the date rather than clamping.** `MakeTime`
multiplies, so hour 24 is the next day at midnight and second 99 is a minute and
39 seconds later. The pattern's ceiling is 99 of each, about four days.

Both were found by the corpus, in 392 and 64 cases respectively, on the first
run. Neither had a failing Rust test beforehand, because both sides of that test
would have been written by the same person holding the same wrong belief.

The carry is wall-clock arithmetic, which is where this crate's boundary already
sits: if the resulting wall time does not exist — a zone that springs forward at
midnight — the platform resolves it when converting to an instant, as it does
for every other date the crate hands over.

### A corpus that missed one bug entirely

Twelve plausible bugs were injected into the bill parser. Ten were caught. Two
were not, and both were corpus defects rather than luck:

| Injected | Before | After |
| --- | --- | --- |
| a header row no longer needs an amount column | **0 cases** | 168 |
| income tested before expense | 2 cases | 162 |
| a doubled quote re-opens the field | 19 cases | 399 |

The zero is the instructive one. Every file in the corpus had either a real
header or no header at all, so a *loosened* header test had nothing to latch
onto — the corpus could not distinguish "requires three columns" from "requires
two". The fix was near-headers: rows carrying exactly two of the three required
columns, placed alone, above the real header, and below it. The lowest detection
count across all twelve is now 41.

Encoding is deliberately not ported. `decodeBillText` falls back to a 72 KB GBK
table that `scripts/gen-gbk-table.js` generates from the platform's own
`TextDecoder`, precisely so the fallback matches it. Hand-copying that table into
Rust would be the one way to get it wrong; the Rust answer is `encoding_rs`, or
the same generator emitting a Rust table. The TypeScript already splits at this
seam — bytes in one side, text out — and `parse_bills` starts from text.

### A second bug in the app: half a character

`composeNote` capped the note with `slice(0, 80)`. `slice` counts UTF-16 code
units, so when the 80th unit is the *first* half of a surrogate pair the cut
keeps it and drops the second. What is left is a lone surrogate — not a
character. It renders as tofu, and Postgres refuses it outright, so a merchant
name with an emoji straddling that boundary produced a note that would not sync.

Found the same way as the daylight-saving bug: the port would not agree with the
TypeScript, in 115 of 2,486 cases, and the TypeScript was the one that was
wrong. It now backs off a unit rather than splitting the pair, and carries a
test that fails against the old slice.

### Two things the harness said about itself

Rendering, first. Fourteen further divergences turned out to be the *harness*:
Rust's `{}` is always fixed-point and JavaScript switches to exponential at
1e21, so an amount of 1e21 read as a disagreement when the two sides held the
same number. Deleting the case would have hidden the question; both dump
examples now carry a `jnum` that formats the way `String(n)` does.

Then a bug of mine that the corpus nearly missed. The bucket key is
`amt.toFixed(2)`, and the port rounded before taking the sign off. `toFixed`
does the opposite, which matters twice: `(-0.001).toFixed(2)` is `"-0.00"`, a
signed zero string that rounding-first throws away, and ties round away from
zero on the *magnitude*, so `(-0.005).toFixed(2)` is `"-0.01"` where `js_round`
takes -0.5 up to -0. The corpus had no negative amounts at all, so it said
nothing; adding them caught the injection 36 times.

### Three injections that were right to catch nothing

Nineteen bugs were injected into the dedup. Sixteen were caught, between 27 and
893 cases each. The other three change no behaviour, and checking that was the
point rather than a way of excusing the zero:

* **A keyword hit for a key missing from the category set.** The guard cannot
  fire: every key in `EXP_KEYWORDS` is a base expense category and every key in
  `INC_KEYWORDS` is a base income one, and `allCats` always includes the base
  set. Dead code in the shipping TypeScript.
* **Transfers absorbing an imported row.** A transfer keys to `xfer|…` and every
  candidate is an expense or an income, so the bucket is never looked up. The
  guard is defensive, not load-bearing.
* **Negative zero in the key.** `js_round` is `(x + 0.5).floor()`, which turns
  -0 into +0 on the way through, so the special case that had been written for
  it could never run. Removed rather than left with a comment describing a
  situation that cannot arise.

## Phase 2 — state and sync

**Decided: the Rust core owns the ledger.** The alternative — keeping Rust a
pure function library and leaving the data in TypeScript — would have been
faster now and a cliff later. The FFI boundary currently carries a handful of
calls and is nearly free to reshape; once the UI is Rust too, reshaping it is
surgery.

`ledger.rs` is the first module that owns anything, and it changed what the
harness has to be.

### Injecting time and identity

`addEntry`/`updateEntry`/`removeEntry` each reach for `Date.now()` inside, and
`newId()` mixes a clock, a counter and `Math.random()`. Replay such a sequence
twice and you get different stamps and different ids — there is nothing to
compare.

So the Rust commands take `now` and `id` as arguments. That is not a style
preference; it is the precondition for holding stateful code to the same bar as
the pure modules. Id *generation* stays outside the crate for the same reason
epoch-to-local conversion does: it reads a clock and a random source.

The harness pins the TypeScript to match — `Date.now` is mocked, and ids are
normalised to insertion order (`e0`, `e1`, …) on both sides, references
included, so what gets compared is ledger semantics rather than id formats.

### A stateful corpus

A pure module's corpus maps one input to one answer. A ledger has no single
answer, it has a history, so each corpus line is a **command sequence** and what
is compared is the ledger left behind — every row, its stamps, and its whole
`field_ts` map.

The TypeScript half runs under jest rather than tsx, because `state.ts` imports
AsyncStorage and needs the module mocks. `jest.parity.config.js` exists only for
that; those files are kept out of `npm test`'s `testMatch` so they neither run
nor count there.

**Corpus density is not a detail.** The first cut was 519 scenarios, and
injecting a real bug — storing a zeroed refund counter as `0` instead of
clearing it, which is the `refund || undefined` subtlety in the TypeScript —
was caught in only 6 of them. Biasing the corpus toward the refund path took the
same injection to 99 of 919. A corpus that technically catches a bug and a
corpus that catches it loudly are different tools.

### What the stateful harness has caught

Extending the corpus to accounts immediately found two things that reading the
TypeScript had not:

1. **`addEntry` sets the current account.** Recording an entry against an
   account makes it the default for the next one, so the record sheet opens
   where you last spent. That behaviour belongs to neither `ledger.rs` (which
   owns entries) nor `accounts.rs` (which owns accounts), which is what
   `store.rs` exists for. Putting it in the replay harness instead would have
   hidden real behaviour in test code.

2. **`0` is a timestamp, not an absence.** `Ledger::add` used `ts == 0` as the
   sentinel for "stamp it now", but the TypeScript writes `e.ts ?? now`, and
   `??` falls back only on null or undefined. An entry dated at the epoch was
   silently re-dated. `ts` is now an explicit `Option<i64>` and the sentinel is
   gone.

Neither is exotic. Both are the kind of thing a hand-written test suite misses
because the author who wrote the code also writes the cases.

### A corpus can pass for the wrong reason

`set_base_currency` is the most dangerous operation in the app — it rewrites
every entry, balance, asset, loan, subscription, template and budget, or refuses
— so after it passed clean, three plausible bugs were injected to check the
corpus was actually looking:

| Injected | Caught |
| --- | --- |
| loan `repaid` left unconverted | 20 cases |
| the new base left in the rate table | 20 cases |
| **native-currency entries not round-tripping through `origAmt`** | **0 cases** |

The third is the subtlest rule in the module: an entry originally typed in the
incoming currency must come back as exactly what the user typed, not as its
converted amount divided back through a rate. It went uncaught because no
scenario in the corpus had an entry carrying `cur`/`origAmt` at all — the `add`
verb did not even have columns for them.

With those columns added and scenarios written around them, the same injection
is caught in 62 of 2,162 cases. A green corpus is evidence about the corpus
before it is evidence about the code.

Sync talks to Supabase over plain REST + a realtime websocket. `reqwest` and
`tokio-tungstenite` cover it; there is no official Supabase Rust client, and
`supabase-rs` community crates are thin wrappers not worth the dependency.

## Phase 3 — the UI

**Decided: Dioxus.** Both prototypes have now been measured on the same Android
emulator, and `rust/proto/FINDINGS.md` carries the readings. On the three risks
that were meant to settle this:

| | Slint | Dioxus |
| --- | --- | --- |
| Chinese IME, with composition | works | works, and the composing text reaches app state |
| 柔光玻璃 `full` tier | **no blur at all** | renders |
| Accessibility on Android | **0 of 8 nodes labelled** | 20 of 31, with real roles |

Slint fails two, and both are floors rather than polish: this same branch
labelled 42 files of icon-only controls, and a toolkit where those labels reach
nothing throws that away; the blur is the app's most visible surface. Dioxus's
component and signal model also maps close to line-for-line onto the React being
replaced, which matters when 11,049 lines move by hand.

**The cost, stated plainly:** Dioxus on Android renders into a WebView. The UI
is authored in Rust — `rsx!` and Rust event handlers, no HTML or TypeScript —
but the pixels come from a web engine. If the point of the rewrite is one Rust
codebase, that is delivered. If the point was to leave web rendering behind, it
is not, and Slint is the only candidate here that would — at the price of the
two requirements above. That trade is a product decision, and it is the one
thing here still worth re-confirming deliberately rather than by default.

A second, narrower cost: `color-mix` needs Chrome 111+, and Android WebView
updates through Play Store, which many devices in China do not have.
`glass.ts` already computes the ambient pull itself, so the resolved value gets
passed in rather than delegated to CSS. `backdrop-filter` has shipped since
Chrome 76 and needs no such care.

Alternatives, and why not:

- **Slint** — genuinely native rendering (Skia). Measured, and rejected on the
  table above rather than on taste.
- **egui** — immediate-mode. Excellent for tools, wrong for a consumer app with
  this much bespoke styling and animation.
- **Tauri v2** — Rust backend, but the UI stays HTML/TypeScript, which is not a
  Rust rewrite.

### Building for Android here

The Dioxus APK needs `TEMP` pointed somewhere AF_UNIX sockets can be created;
`%LOCALAPPDATA%\Temp` silently cannot on this machine, and that is what the JDK
uses for the internal NIO pipe Gradle depends on. FINDINGS.md has the diagnosis.

```bash
cd rust/proto/dioxus && TEMP='C:\Temp\dahonghua-build' TMP='C:\Temp\dahonghua-build' dx build --platform android --features mobile
```

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
