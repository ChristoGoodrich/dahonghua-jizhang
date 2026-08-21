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
| `domain/filter` | 162 | **Ported**, 2,014-case parity |
| `domain/budget`, `stats`, `trends`, `insight`, `recap`, `weekly`, `streak` | ~900 | Queued |
| `domain/billParse` → `bills` | 272 | **Ported**, 4,400-case parity — bar `decodeBillText` |
| `domain/encoding` + `gbkTable` | 65 + 24k cells | Deferred by choice — `encoding_rs`, not a hand-copied table (below) |
| `domain/billDedup` → `dedup` | 138 | **Ported**, 3,838-case parity |
| `theme/glass` | 204 | **Ported**, 1,281-case parity — the material's arithmetic, not its rendering |
| `domain/export` + `xlsxWrite` | ~230 | Queued — `rust_xlsxwriter` replaces the hand-rolled writer |
| `entry` + `ledger` + `store` (new) | ~120 of `store/state.ts` | **Ported** — owned state, stateful parity |
| `store/accounts` | 53 | **Ported**, folded into the same 1,338-scenario corpus |
| `store/currency` + `model` | 138 | **Ported** (bar the HTTP refresh), folded into the same corpus |
| `store/templates` + `tags` + `categories` → `catalog` | 83 | **Ported**, in the same corpus |
| `store/assets` → `networth` | 34 | **Ported**, in the same corpus |
| `store/reimburse` | 64 | **Ported**, in the same corpus |
| `domain/cats` | 47 | **Ported** into `catalog` |
| `domain/subscriptions` + `store/subscriptions` → `subs` | 109 | **Ported**, in the same corpus |
| `store/state` — transfers, bill import, budgets | ~90 | **Ported**, in the 3,678-scenario corpus |
| `store/state` — `buildBackup`, persistence, ids | ~120 | Deferred by choice / platform (below) |
| `store/inbox` → `inbox` | 212 | **Ported**, 305-case parity — the deciding half |
| `sync/*` | 778 | After store — `reqwest` + the Supabase REST API |
| UI (21 routes, 72 components) | 11,049 | Last — **Flutter decided**; Rust UI frameworks measured and set aside |

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

### 柔光玻璃, and why the material's arithmetic is core rather than UI

`src/theme/glass.ts` was ported next, out of the queue order, because of a
question the Dioxus probe raised: that prototype expressed the ambient pull as
CSS `color-mix`, which needs Chrome 111+, and Android's WebView updates through
a store many devices in China do not have.

The answer turned out not to be a fallback but a misplacement. The shipping
TypeScript never used `color-mix` — `mix`, `luminance` and `ambientPull` are
hand-written there and produce a finished `rgba(...)`. The prototype's CSS was a
shortcut I wrote, and the real fix is to put that arithmetic where every front
end can be handed the answer instead of asked to compute it. A Flutter or native
UI cannot evaluate `color-mix` either; all three can accept four numbers. With
the mix resolved in Rust the only CSS left is `backdrop-filter`, which has
shipped since Chrome 76.

`js_num` moved into `num.rs` for this. The wash is a *string* — `rgba(r, g, b,
a)` — so the alpha has to be spelled the way JavaScript spells it, and Rust's
`{}` never uses exponential notation while JavaScript switches at 1e-7.

### Two stdlib calls that do not mean the same thing

**`String.replace` with a string pattern replaces the first occurrence;
`str::replace` replaces all.** `parseHex` opens with `hex.replace('#', '')`, so
`##FFFFFF` keeps a hash in TypeScript, fails to parse, and comes out black —
while the Rust port stripped both and came out white. One corpus line, and the
same shape as the `Math.round` divergence that started this whole harness.

**`parseInt` reads a prefix; `from_str_radix` demands the whole string.**
`FFzzzz` is 255 in JavaScript and an error in Rust. That one the corpus did
*not* catch, because it had no such colours — it was found by reading the fix
for the first bug. The cases were added, and the injection now lands 26 times.

### An injection that is right to catch nothing

Twenty bugs were injected. Nineteen were caught, between 20 and 476 cases. Two
of those nineteen land on exactly one case each, and that is not thinness:
`resolveTier` has a four-combination domain and `touchLightColor` a
two-combination one, both fully enumerated, and the injections can only change
one case apiece.

The twentieth — swapping `js_round` for `f64::round` inside `mix` — changes
nothing, and that was checked rather than excused. The two rules differ only on
ties below zero, and `mix` cannot go below zero: `& 255` bounds each channel to
`[0, 255]`, the amount is clamped to `[0, 1]`, and a convex combination of two
values in a range stays in it. A sweep of every ten-thousandth over `[0, 255]`
finds zero disagreements. `js_round` stays for faithfulness, with the reasoning
written next to it.

### Two more bugs in the app, from one 162-line module

`domain/filter` is the smallest module ported so far and it carried two live
defects, both in the part users type into.

**The Chinese direction keywords never matched.** `parseSearchQuery` tested
`/\b(支出|花掉|expense|spent)\b/`. `\b` is defined against `\w`, which is
`[A-Za-z0-9_]` and holds no CJK character at all, so a boundary can never sit
beside 支. In a Chinese-language ledger, searching 支出 set no direction filter
and left the word in the text query, where it also matched nothing. The
boundaries now stay around the ASCII words, where they stop `expense` matching
inside `inexpensive`, and are dropped around the Chinese ones.

**Searching one day returned everything since that January.** The `YYYY-MM-DD`
branch captured the parts separately and built the *start* of its range from
group 1 alone — the year — so `new Date('2024T00:00:00')` gave January 1st.
The end was correct, which is why it looked plausible. Searching `2024-01-15`
returned seven months of entries.

### Two `new Date` parsers that disagree with each other

`filter.ts` uses both forms in one function, and they are not the same parser:

| | `new Date(y, m, d)` | `new Date('YYYY-MM-DD…')` |
| --- | --- | --- |
| Year 0–99 | 1900 + y | taken literally |
| Month 13 | rolls into next year | `Invalid Date` |
| Day 32 | rolls into next month | `Invalid Date` |
| Feb 29, common year | rolls to Mar 1 | **rolls to Mar 1** |

The last row is the one worth staring at. The date-time string grammar bounds
MM to 01–12 and DD to 01–31, so 32 is ungrammatical and rejected — but 29 is
inside the grammar, so it parses and *then* rolls. Strings validate the shape
and not the calendar.

The port had to reproduce both, in the same file, per branch: the month branch
builds from components and carries the two-digit-year rule, while the day and
range branches parse strings and reject out-of-grammar values.

### An off-by-one caught by a test I had written wrong

`weekday_monday_first` is 0 = Monday … 6 = Sunday. `now.getDay() || 7` is
1 = Monday … 7 = Sunday. The port used the first where the TypeScript meant the
second, which moves every week boundary by a day.

Worth noting how it surfaced: two unit tests failed, and my first instinct was
that the calendar helper was wrong — it is used by `month_grid` and `period`,
both parity-proven, so that would have been a much larger problem. Checking the
weekday against JavaScript rather than against my own assumption showed the
helper was right and my *test expectation* was wrong in exactly the same way the
code was. Both came from the same wrong belief, which is precisely the failure
mode unit tests cannot catch and the corpus can.

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

### Three fields the corpus was not looking at

Transfers, bill import and per-category budgets went in next — the three parts
of `state.ts` that are ledger operations rather than platform plumbing.

The first injection sweep came back with four zeros, and three of them had the
same cause: `note`, `src` and `ledger` were not in the harness's compared field
list. A bug that only touched them was invisible, and had been for every module
that wrote them. Adding the three turned "an imported row is not marked as
coming from a bill" from 0 detections into 29.

The fourth zero was the harness being unable to *express* the input. Its
conditional spreads were truthiness tests — `...(fee ? { fee: Number(fee) } :
{})` — so `fee: 0` and `ledger: ''` could not be passed at all, which is
precisely where the falsy-means-absent rule lives. A cell is now empty for "not
supplied" and `~` for "supplied as empty", and the two are different inputs.

The floor across fifteen injections is now 3, having been 0.

### The fourth divergence that was the harness again

Four cases failed on `1e-7` and `1e21`. `dump_ledger` hand-rolled its float
rendering and dropped the integral part correctly while missing all three ways
JavaScript's `String(n)` actually differs: negative zero prints unsigned, and
the switch to exponential notation happens at 1e21 and 1e-7. It now calls
`js_num`, the same function `glass.rs` needs for its `rgba(...)` strings.

That is the third time a formatting difference has read as a port divergence.
It is the last place it can: every dump now renders floats through one
function.

### What is deliberately not ported

`buildBackup` shapes the entire application state into a JSON payload, and most
of that state — language, theme, lock — has no representation in the core and
no reason to acquire one. Porting it now would mean modelling the whole
`AppState` in Rust in order to serialise it, which is the tail wagging the dog.
It waits until the core owns those fields for its own reasons, or it stays on
the platform side permanently.

`newId`, `loadPersisted*` and `startAutosave` are platform: random identity,
`AsyncStorage`, and a reactive subscription respectively.

### The capture inbox, and a harness that had to be written twice over

`store/inbox.ts` was the last of the store. What moved is the deciding half —
`alreadySeen` and the classification loop — while reading the native queue,
acknowledging it and persisting the result stay on the platform side.

That split is load-bearing rather than tidy. `drainInbox` acknowledges the
native queue **only after** the results are in the store, so a crash mid-drain
replays instead of losing a payment. Ordering like that is a property of the
caller, and pulling the I/O into the core would have buried it.

The TypeScript harness reproduces the classification loop rather than calling
`drainInbox`, and that is a real cost worth naming: the copy can drift from the
function it mirrors. It was accepted because the alternative is mocking a native
module, AsyncStorage and an AppState subscription in order to observe six lines
of branching — and a mock that elaborate is its own kind of drift, with none of
the visibility.

### A window that may be too wide but not too narrow

Two of fifteen injections changed nothing, and both are worth stating rather
than excusing.

`alreadySeen` filters the ledger to a time window around the batch. Removing
that filter entirely is caught by no case — correctly, because `isDuplicate`
re-checks the time distance itself. The filter is a **narrowing pass, not a
rule**: too wide costs only a longer `seen` list, while too narrow hides a row
the duplicate check would have matched. The three injections that *narrowed* it
were caught 14, 3 and 32 times.

The transfer guard is defensive in the same shape: `isDuplicate` compares
direction, and a capture is only ever an expense or an income, so an `xfer` key
could never match one.

### 102 cases was not enough

The first sweep caught thirteen of fifteen, but with counts of 1 and 2 — a
corpus that finds a bug on one line is one edit away from finding it on none.
Crossing every entry attribute against eleven separations, and doing the same
against the confirm queue and against two-capture batches, took it from 102
cases to 305 and the floor from 1 to 3.

Two corpus bugs of my own on the way, both worth remembering. `~` was used as
both the record separator and the sentinel for "empty string", so a cell
containing one split its record into four; an empty field says "empty" without
needing a sentinel at all. And a fixture wrote 付款…收款方：星巴克 as a
"confident expense" — it parses as *income*, because 收款 matches the income
pattern and income is tested first. The parser was right and the fixture was
wrong.

## Phase 3 — the UI

**Decided: Flutter for the UI, Rust for everything under it.** This is the shape
Xiaomi shipped: HyperOS 3.1 removed the MIUI SDK from Weather and Gallery and
rebuilt them on Flutter with the logic underneath in Rust, and HyperOS 4 is
described as a full-stack Rust + Flutter toolchain. The decision here is to
match that rather than to be more Rust than Xiaomi is.

It reverses the previous entry, and the reversal is worth stating plainly. Two
Rust UI frameworks were prototyped and measured on the same Android emulator,
and the readings in `rust/proto/FINDINGS.md` still stand:

| | Slint | Dioxus |
| --- | --- | --- |
| Chinese IME, with composition | works | works, and the composing text reaches app state |
| 柔光玻璃 `full` tier | **no blur at all** | renders |
| Accessibility on Android | **0 of 8 nodes labelled** | 20 of 31, with real roles |

Dioxus won that comparison and would have been a workable answer. What it could
not offer is native rendering: on mobile it draws into a WebView, so the pixels
come from a web engine whose version, on Chinese devices without Play Store, is
not something the app controls. Slint renders natively and fails the other two
requirements outright. Flutter renders on its own engine and clears all three —
`BackdropFilter` with `ImageFilter.blur` for the material, `Semantics` for
accessibility, and a `TextField` with the composition support every Chinese
Flutter app already relies on.

**The cost, stated plainly:** the UI is Dart, not Rust. "Rust rewrite" now means
what it means at Xiaomi — the logic, the money, the calendar, the ledger, the
sync and the material's arithmetic are Rust; the widget tree is not. Anyone
expecting a single-language codebase should read that sentence twice, because
it is the whole trade.

**Nothing built so far is affected.** The 23 modules and 45,228 parity cases are
the Rust half of exactly this architecture. The boundary changes from a direct
call to an FFI call and nothing else — which is why the material's arithmetic
was moved into `glass.rs` before this decision was taken rather than after.

### What changes

| | Before | Now |
| --- | --- | --- |
| UI | `rsx!` in Rust | Dart widgets |
| Rendering | WebView | Impeller / Skia |
| Core boundary | direct call | `flutter_rust_bridge` over `dart:ffi` |
| Android build | `dx build` | `flutter build` + `cargo-ndk` |
| Web target | one component tree | Flutter web, or dropped |

`rust/proto/` stays as the record of how the Rust-UI question was settled. It is
not deleted: the measurements are what justify not revisiting it.

### Building for Android here

Whatever drives it, the Android build needs `TEMP` pointed somewhere AF_UNIX
sockets can be created — `%LOCALAPPDATA%\Temp` silently cannot on this machine,
and that is where the JDK puts the internal NIO pipe Gradle depends on.
FINDINGS.md carries the diagnosis. Flutter's Gradle build needs it too.

```bash
export TEMP='C:\Temp\dahonghua-build' TMP='C:\Temp\dahonghua-build'
```

## Phase 4 — the platform edges

The Flutter decision changes this section more than it changes any other. The
previous plan was to write roughly ten JNI bridges by hand against the Android
SDK, because a Rust UI framework brings no platform layer with it. Flutter does,
and most of these stop being work at all:

| Today | Under Flutter | Note |
| --- | --- | --- |
| `expo-local-authentication` | `local_auth` | |
| `expo-notifications` | `flutter_local_notifications` | schedules and channels both |
| `modules/notif-capture` | keep the Kotlin, rebind | `MethodChannel` instead of a Turbo Module |
| `plugins/android-widget` | keep the Kotlin, rebind | `home_widget` for the data hand-off |
| `expo-document-picker` / `expo-image-picker` | `file_picker` / `image_picker` | |
| `expo-print` (PDF) | `printing` + `pdf` | or keep it in Rust with `printpdf` |
| `expo-sharing` | `share_plus` | |
| `expo-file-system` | `path_provider` + `dart:io` | paths in Dart, contents in Rust |
| `AsyncStorage` | **`rusqlite`, Rust side** | the core owns the ledger, so it owns persistence |
| `expo-haptics` | `HapticFeedback`, in the SDK | no plugin needed |
| `expo-router` | `go_router` | |

Two of these are worth calling out rather than reading past.

**Persistence belongs to Rust, not to a Flutter plugin.** The core already owns
the ledger — that was Phase 2's decision — so it should own the bytes too.
`sqflite` would put the store back on the Dart side of the boundary and undo
that. `path_provider` supplies the directory; `rusqlite` does the rest.

**The two Kotlin modules survive the rewrite untouched.** `notif-capture` is a
`NotificationListenerService` and the widget is a `RemoteViews` provider; both
are Android components rather than React Native ones, and only their binding to
the app changes.

## Rules while both trees exist

- The TypeScript app stays shippable and green the entire time. It is the
  reference implementation, and it is what users are running.
- Nothing is deleted from `src/` until its Rust counterpart passes parity **and**
  is wired into a running build.
- Every ported module joins `npm run parity`. A module without a corpus is not
  done.
- `cargo clippy -- -D warnings` and `cargo fmt --check` gate CI alongside the
  existing lint/typecheck/test jobs.
