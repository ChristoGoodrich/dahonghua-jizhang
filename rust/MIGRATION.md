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
| `domain/stats` | 231 | **Ported**, 1,318-case parity |
| `domain/trends` | 99 | **Ported**, 5,404-case parity — took a fix first |
| `domain/budget` | 64 | **Ported**, 4,210-case parity |
| `domain/networth` | 88 | **Ported**, in the 5,229-case statement corpus |
| `domain/statement` | 149 | **Ported**, 5,229-case parity |
| `domain/insight` | 98 | **Ported**, 4,618-case parity — copy stays in the UI |
| `domain/order` (new) | — | **Added** — the amount comparator, as a total order |
| `domain/recap` + `weekly` + `streak` | 101 | **Ported**, 4,829-case parity in one corpus |
| `domain/jsobj` (new) | — | **Added** — `Object.keys` ordering, once its third consumer appeared |
| `domain/jsstr` (new) | — | **Added** — `trim` and `\s`, which Rust spells differently |
| `domain/search` + `notes` + `archive` | 100 | **Ported**, 4,627-case parity in one corpus |
| `domain/rates` | 86 | **Ported** — the decisions, 4,496-case parity; the HTTP stays on the platform |
| `domain/emoji` | 72 | **Not ported by choice** — a UI asset table, which goes to Dart with the picker |
| `domain/billParse` → `bills` | 272 | **Ported**, 4,400-case parity — bar `decodeBillText` |
| `domain/encoding` + `gbkTable` | 65 + 24k cells | Deferred by choice — `encoding_rs`, not a hand-copied table (below) |
| `domain/billDedup` → `dedup` | 138 | **Ported**, 3,838-case parity |
| `theme/glass` | 204 | **Ported**, 1,281-case parity — the material's arithmetic, not its rendering |
| `domain/export` | 59 | **Ported**, 4,259-case parity on the CSV |
| `domain/xlsxWrite` | 210 | **Not ported** — ZIP and XML with no decisions in it; `rust_xlsxwriter` when a file has to be written |
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

### Three injections that were right to catch nothing, and one that was wrong

`domain/stats` split three ways. The pure aggregations and the two that need a
local weekday or hour are ported; `statTotals`, `sixMonthTrend` and `comparison`
are not, because they count elapsed days by dividing epoch milliseconds by
864e5 — twenty-four hours rather than a calendar day, which is exactly the shape
of the subscription bug — and that deserves its own increment rather than being
rushed in behind the easy half.

Eighteen injections. Three initially caught nothing, and the difference between
them is the point:

* **Starting `noon` at 10 changes no answer.** The ranges are scanned in order
  and `morning` (8–11) is tested first, so widening a later range *backwards* is
  invisible. A real property of the code, now written next to it.
* **Starting `night` at 20 changes no answer either.** Hour 19 then matches no
  range and falls through to the default — which is `night`. Also real.
* **"The category sort is unstable" was a bad injection.** `sort_by_key` is
  stable too, so it changed nothing about the thing it claimed to test. Replaced
  with a tie-break by name, which does.

The first two are worth keeping as documentation: an edit to these ranges is
only observable if it moves a boundary *forward* into the next range, or narrows
one that is not last.

### A corpus case the real code cannot be asked

Adding out-of-range hours to `byTimeOfDay` produced fourteen divergences, and
the port was right. `byTimeOfDay` reads `new Date(ts).getHours()`, and building
a timestamp with hour 24 rolls the *date* forward to 00:30 — so the value that
reaches the bucketing is 0, never 24. The fallback branch is only reachable by
calling `timeBucketOf` on its own, which the corpus already did.

A corpus can be wrong by asking a question the shipping code has no way of
being asked. Those cases moved rather than being deleted.

### The third daylight-saving bug, found by looking for it

The three cycle-shaped functions were held back from the previous increment
because they counted elapsed days as `ceil((min(now, end) - start) / 864e5)`,
and 864e5 is twenty-four hours rather than a calendar day. That is the shape of
the subscription bug, so the port started by measuring rather than by writing
Rust. Sydney's clocks go forward on 2026-10-04 and back on 2026-04-05:

```
elapsed on Oct 5 00:30   read 4, should be 5    under by one
elapsed on Apr 6 23:30   read 7, should be 6    over by one
```

`elapsed` divides the daily average, so one out early in a cycle changes it by
a third or a half.

The bucketing in `comparison` was worse, and not an edge case. `floor((ts -
rangeStart) / 864e5)` accumulates the lost hour, so after a spring-forward
*every* entry in the first hour of a day lands in the previous day's column —
for the rest of the cycle, not just at the transition. October 5th at 00:30 fell
in bucket 3 and October 6th at 00:30 in bucket 4.

`daysAgo` in `dates.ts` already had the correct shape — normalise both ends to
local midnight, then round, so a 23- or 25-hour day does not shift the count.
The fix exposes it as `daysBetween` and uses it. `cycleDays` had been safe all
along for the same reason: it rounds.

Three of the four TypeScript tests added with the fix fail against the old
arithmetic. The fourth is a no-transition control and passes either way.

### An injection caught by a crash rather than a diff

Thirty-three injections now. The one worth recording is `elapsed`'s floor of
one: removing it does not produce a wrong answer, it **aborts the process**.
`today` can be before the cycle start, which makes the day difference negative,
and `comparison` sizes an array with it — a negative `i64` cast to `usize` is a
capacity overflow.

The sweep reported that as "did not compile" for two rounds, which was wrong
twice over: it was a runtime panic, and it was a detection rather than a gap.
The script now retries once and prints the real error, because an infrastructure
failure that looks like a finding is worse than either.

### The fourth, fifth and sixth places 864e5 was called a day

The cycle-day fix came out of one pattern, so the next step was to grep for the
rest of it rather than wait for the next module to trip over it. Nine call
sites; three of them wrong.

`trends.ts` was the worst, and it is the one users would have seen. Every
bucket edge was `today - i * 864e5`, which produces three *different* faults
around a transition:

* Stepping back over a **23-hour day overshoots its midnight**, so the day is
  skipped entirely. A seven-day chart ending the 8th of October in Sydney drew
  the 1st, 2nd, 3rd, 5th, 6th, 7th and 8th — seven buckets covering eight days,
  with **the 4th missing from the axis**.
* Stepping back over a **25-hour day lands an hour late**, so every earlier
  bucket runs 01:00 to 01:00 and each day's first hour is filed under the day
  before — for the rest of the window, not just the one day.
* A week is not `7 * 864e5` either, so after a transition **every historical
  week began at 23:00 on the Sunday** while its label still read Monday.

`budget.tsx` rounded `(now - cycleStart) / 864e5`, and `now` carries a time of
day — so the daily-average divisor rounded up from midday and the figure jumped
by a third every afternoon. That one has nothing to do with daylight saving; it
was wrong every day of the year. It uses `stats`' `elapsedDaysIn` now.

`EntryList`'s "yesterday" was `Date.now() - 864e5`, which on the morning after
the clocks go forward is the day *before* yesterday — so the label sat on the
wrong group.

The other six were safe, and safe for one reason: they round, and both their
ends are already local midnights. They go through `daysBetween` anyway, so the
shape is gone from the tree and cannot be copied out of it again. `backup.ts`
and `rates.ts` keep 864e5 — those are throttle intervals, where twenty-four
hours is the intent rather than an approximation of a day.

### The tests for the previous fix were passing for the wrong reason

The four daylight-saving tests added with the cycle-day fix only meant anything
because this machine happens to sit in Australia/Sydney. In a zone with no
transition every day is twenty-four hours, the old arithmetic and the new one
agree, and all four would have passed **without testing anything** — on CI, on
a colleague's laptop, anywhere north of the equator in the wrong month.

Pinning `TZ` in the Jest config is the obvious fix and is not a reliable one:
this repo's Windows Node resolves no IANA zone name except `UTC`, and silently
falls back to the system zone for every other name. `TZ=Australia/Sydney` would
be a real guarantee on CI and a no-op on the machine the code is written on,
which is the worst of both.

So the tests ask the running zone where its own transitions are, and
`describeDst` skips with the zone named in the title where there are none. Under
`TZ=UTC` the block now reports `1 skipped` instead of four green assertions.

### A bug the port cannot express

The trends injection sweep has twenty-seven entries and none of them reproduces
the original bug, because **there is no way to write it**. `day_series` counts
in day numbers; a day number has no hours in it to be twenty-four of. The
nearest injections — off-by-one, wrong direction, wrong length — are all caught
on three thousand-odd lines each.

That is the strongest argument the migration has produced for the civil
representation so far. The TypeScript fix stops the bug; the port removes the
vocabulary.

The corpus does have teeth on this: restoring the old arithmetic in `trends.ts`
diverges on **731 of 5,404 cases**, and the diffs read exactly as described
above — a missing `2025-10-05`, and weekly labels a day early.

### Densifying a corpus that was agreeing too easily

The first trends sweep caught all twenty-seven injections, but four of them on
7, 16, 18 and 23 lines. A floor that low is luck, not coverage: it means the
corpus rarely built a case where the injected code could answer differently.

The cause was that entry days were drawn from the same pool as `today`, so most
entries fell outside the window being asked for and most buckets were empty.
Drawing entry days from a span around each case's own `today` — with one in
eight still drawn far away, to keep the out-of-window path covered — moved the
floor from 7 to 50 without changing the case count.

### `Object.keys` has an ordering rule, and a `BTreeMap` breaks it

`catBudgetRows` sorts by percentage, and `Array.prototype.sort` is stable, so
every tie is settled by whatever order `Object.keys` handed the caps over in.
Ties are not the edge case here — on the first day of a cycle **every** capped
category sits at exactly zero percent, so key order alone decides what the user
sees.

`Budgets.per_category` in the Rust store is a `BTreeMap`, which orders keys
lexicographically. JavaScript orders them by insertion. Those are different
lists, and the difference is on screen.

Worse, JavaScript's order is not simply insertion order. Keys that are *array
indices* — the canonical decimal spelling of an integer in `0 ..= 2^32 - 2` —
come out **first, in ascending numeric order**, ahead of everything and
regardless of when they went in. A custom category set named `1`, `2`, `10`
therefore lists before `food`, and `10` after `2` rather than before it. `01` is
not an index, because `String(1)` is `"1"`; nor is `-1`, `1.5`, or `4294967295`,
which is a length rather than an index.

The corpus found all of this on the first run: 376 divergences across 4,209
cases, before a line of it had been reasoned about. `cat_budget_rows` now takes
its caps as an ordered slice and applies the rule itself.

**Open item:** `store.rs` still holds `per_category` as a `BTreeMap`. Nothing
calls `cat_budget_rows` from the store yet, so nothing is wrong today — but the
injection that reorders caps lexicographically, exactly as a `BTreeMap` would,
diverges on **300 cases**. The map has to become insertion-ordered before those
two are wired together.

### Two injections that were wrong, in two different ways

Twenty-four injections; three initially caught nothing, and only one of those
was the corpus's fault.

`limit > 0.0` → `limit >= 0.0` caught nothing because **it changes no value**.
For a limit of zero both branches yield zero, and the only case that differs at
all is `-0.0`, which `String()` renders as `"0"` either way. The injection that
actually moves the threshold is one that discards small positive caps.

`unwrap_or(Equal)` → `unwrap_or(Greater)` on the sort comparator caught nothing
for a subtler reason: **`sort_by` only ever asks whether one element is less
than another.** Greater and Equal are the same answer to that question. This is
the same mistake as the earlier "unstable sort" injection against a stable
`sort_by_key` — a comparator injection has to return `Less` to move anything.

The third, a category key of `4294967295`, was a genuine corpus gap: no such key
was ever generated. Adding one to the pool catches it on 55 lines.

A fourth was merely thin — the injection stopping per-category spending from
accumulating was caught on 13 lines, because entries drawn freely from the
category pool rarely landed twice in the same *capped* category. Aiming 60% of
each case's entries at that case's own cap keys took it to 98.

### A cutoff the corpus never once reached

`statementSummary` values a card's balance at the moment its statement closed —
`23:59:59.999` on the close day, so an entry dated that day is billed. An
end-of-day *instant* is not something this crate can name without a timezone, so
the port compares calendar days instead, and `acct_balances` grew a second entry
point taking the cutoff as a predicate rather than an epoch. One
implementation, two callers; the alternative was two copies that drift.

Which left the epoch form — `d.ts <= asOf` — with **no corpus coverage at all**.
The dump only ever called the predicate form, so an injection flipping that `<=`
to `<` diverged on nothing. Thirty-four other injections were caught and this one
read as a clean zero, which is exactly what a gap looks like when you are not
checking.

The fix is not to model the timezone. Entries carry an extra opaque integer and
the corpus can ask for an integer cutoff, so both halves compare `d.ts <= n` over
plain numbers with no clock anywhere near it. The injection now diverges on 57
cases.

Worth stating the rule that fell out: **an injection that returns zero is a
question, not a result.** Three of the four zeros this migration has produced
were the injection being a no-op; this one was the code being unreachable.

### The four thin injections, and what made them thin

Thirty-five injections, all caught, but eight of them on fewer than fifteen
lines out of five thousand. Every one had the same cause — the corpus was
generating cases that could not tell the difference:

* Accounts were random `kind`s with random statement days, so most `summary`
  cases answered `none` before reaching any interesting branch. Making them real
  cards with in-range days 80% of the time fixed most of it.
* Entry dates were drawn uniformly, so one almost never landed **on** a close
  day — which is the only date that separates `<= close` from `< close`. Aiming
  70% of each case's entries within a few days of its own close took that
  injection from 6 to 22.
* Every id an entry could name was also an account, so "an entry on a deleted
  account creates one" was reached twice. Adding two ghost ids that are
  deliberately not accounts fixed it.
* `dueSoon`'s window is `<=`, and nothing was ever due in exactly `withinDays`
  days. Eight deliberate cases at the boundary took it from 4 to 7.

The floor is 4, on a transfer *out of* a card, after the close, carrying a fee,
on a case that asked for that card's summary — four conditions at once. A
deliberate case pins it rather than leaving it to the sampler.

### `Math.max` again

Three more places where `Math.max(0, x)` is not `x.max(0.0)`: `billedDue`,
`inflowBeyondBill` and `unbilled`, plus `loanRemaining` in `networth`.
JavaScript's `Math.max` **propagates** `NaN`; Rust's `f64::max` answers with the
other operand. Written correctly first this time — [`crate::stats`] had already
taught it — and the corpus confirms it would have caught the wrong version, on
69 cases.

### The harness was measuring the wrong JavaScript engine

`insight` ranks categories with `sort((a, b) => b[1] - a[1])`. That is not a
consistent comparator: one `NaN` amount makes it return `NaN`, and ECMA-262
then leaves the sort order **implementation-defined**. Not a footnote —

```
[10, NaN, 50, 20]  sorted descending in Node  →  10, NaN, 50, 20
[10, 20, 50, NaN]  sorted descending in Node  →  50, 20, 10, NaN
```

The first list comes back untouched, *including the pair that had nothing to do
with the NaN*. Move the NaN and the same comparator sorts properly.

The port diverged on three of 4,618 cases here, and the interesting part is that
neither answer was wrong. Rust's sort and V8's TimSort both honour a comparator
that says "NaN equals everything", and they reach different arrangements because
that claim is not transitive.

Which exposes something about the harness rather than about the port: **this app
ships on Hermes, and the TypeScript half of the harness runs on Node's V8.**
Wherever behaviour depends on an unspecified sort order, the corpus has been
pinning V8's answer — an answer the shipping app never gives. Two thousand green
cases either side of it say nothing about that.

The fix is not to reproduce V8. It is to stop depending on unspecified
behaviour: `src/domain/order.ts` holds `descByAmt`, a **total** order with
unusable amounts last, and `stats.byCategory`, `stats.topEntries`,
`catBudgetRows` and `insight` all use it. `num.rs` carries the same order on the
other side. A `NaN` amount is reachable — a malformed import, a conversion with
no rate, a hand-edited backup — and it should be boringly wrong in a fixed way
rather than differently wrong per device.

### Copy is not domain logic, and the corpus proves the transcription

`computeInsight` returns a localised sentence, which raised the first real
question about where the boundary sits. The answer taken: **everything that
decides which sentence** — the priority order, the thresholds, the rounding,
which category counts as biggest — is in the core and is parity-checked. The
words arrive as an `InsightCopy` argument. A table of Chinese and English
marketing sentences is not domain logic, and putting one in Rust would make
every copy tweak a Rust change.

Category *names* went the other way and live in `catalog`: they are data the
ledger is keyed by, not phrasing.

The corpus carries the sentences in two header lines, transcribed from
`insight.ts` and the phrase table. Duplicated text usually rots; this text
cannot, because it is what the two halves are compared on. A wrong transcription
fails the harness on the first case that uses it.

Substitution is one left-to-right pass with each marker consumed once, rather
than a chain of replacements. A chain would rewrite a value that itself contains
a marker — a user's own category named `%a` — where the template literal it
stands in for could not. The corpus now generates exactly that category.

### An injection parity structurally cannot reach

Thirty-one injections, and one stays at zero after the corpus was widened twice:
removing the "fill each marker once" guard. It cannot be reached, because **no
sentence in the real copy uses the same marker twice**, so no corpus line can
tell the two versions apart.

That is not a gap to paper over with a synthetic copy string — the harness's
whole value is that it compares the code that ships. The guard is covered by a
Rust unit test instead, and recorded here as the first behaviour deliberately
left outside the parity contract.

Three others started at zero and were fixed rather than excused: an empty
English account name could not be expressed (both parsers collapsed `""` to
absent, so the `nameEn || name` fallback was unreachable — now 47 cases), a
value containing a marker was never generated, and the `>= 100%` and `>= 80%`
thresholds were never landed on exactly.

### A guard that provably cannot fire

`weekly.ts` floors its days-left count with `Math.max(0, …)`. Removing that
floor in the Rust diverges on **nothing**, and after the last two increments the
reflex is to hunt for the corpus gap. There isn't one.

`end` is `start + 7` and `start` is `today` less its own weekday, so the
difference is always 1 through 7. The floor is unreachable by construction. It
stays — the TypeScript has the same guard and removing it on one side only would
be a difference for no reason — but it now carries a comment saying so, and a
Rust test that walks four whole weeks to prove it rather than spot-checking
three days.

Compare `elapsed`'s floor in `stats`, which looks identical and is load-bearing:
removing *that* one aborts the process on a capacity overflow. Two guards, same
shape, opposite answers, and only the sweep tells them apart.

### Two injections that were no-ops, again

Two of the three zeros in this sweep were the injection changing nothing:
`let mut n = 0` → `let mut n: usize = 0` is a type annotation, and
`n += 0; n += 1;` is `n += 1`. Both reported a clean zero that looked exactly
like a corpus gap.

That is now four separate occasions. The pattern is always the same shape — an
edit that *looks* like it alters behaviour but is a no-op under the language's
rules (a stable sort ignoring `Greater`, a comparison whose branches return the
same value, a type annotation). Writing an injection is writing a test, and a
test that cannot fail is worse than no test, because it is counted.

A third injection failed to compile rather than running:
`n.saturating_sub(1)` is `E0689`, because method resolution happens before the
return type pins `n`. The sweep printed the real error instead of silently
scoring it, which is the fix made two increments ago earning its keep.

### `Object.keys` ordering earned its own module

Three consumers now walk a user's per-category budget map and care which key
comes first: `catBudgetRows` because its sort is stable and a fresh cycle is all
ties, `insight` because it reports the *first* category over its cap, and
`recap` because it names the biggest spend. Three was the threshold set when the
rule was first written into `budget.rs`, so it moved to `jsobj.rs`.

`recap` also carried the same inconsistent comparator `insight` did —
`byCat[b] - byCat[a]` — and now uses `descByAmt` with it.

### Three impossible inputs in one corpus

`search`, `notes` and `archive` went in together and the corpus diverged on its
first run — 33 cases, then 6, then none. Every one of them was the *generator*
producing a shape the app cannot:

* `noteSuggestions` is typed `io: string` in TypeScript, so the corpus offered
  the `_` sentinel as a direction. Its one caller always passes an `IO`, and the
  Rust port takes the enum — `_` matched nothing on one side and defaulted to
  expense on the other.
* `Entry.io` is a **required** field and `catOf` takes an `IO`, so a search
  entry always has a direction. The corpus offered entries without one, which
  measured nothing but which fallback each side happened to pick.
* The `notes` corpus asked for a direction and category that its entries mostly
  did not have, so most cases answered with an empty list before reaching any
  interesting branch.

Worth separating from a real finding: a divergence is only evidence when the
input is one the app can actually produce. The fix each time was to narrow the
generator, and the third also lifted four injections off single-digit counts.

There is a pleasant consequence in the second case. `Entry::io` is
`Option<Io>` in this crate because bill parsing meets rows before they are
classified — but `matchesSearch` is downstream of that, and the type says so.
The same is true of `notes`: its recency tie-break needed a total order in
TypeScript because `ts` is a `number` and can be `NaN`, and needs none here
because `ts` is an `i64`. **The type rules out the bug the other language needs
a comparator to rule out.**

### Folding, measured rather than assumed

`matchesSearch` lowercases both sides of its comparison, and `to_lowercase` is
not obviously `String.prototype.toLowerCase`. Sixteen cases were checked before
a line was written — `İ` folding to `i` plus a combining dot, the Greek final
sigma in `ΑΣ` and `ΣΣ`, `ǅ`, `ẞ`, `ĲSSEL`, `A` plus ypogegrammeni. All sixteen
agree, code point for code point.

That is the same discipline that caught `trim`, applied before rather than
after. The difference in cost is the whole argument for it.

### A parser that had never been asked a hard question

`rates` needed `new Date('YYYY-MM-DDT00:00:00')`, which `filter` had already
reproduced, so the function moved to `civil.rs` rather than being written
twice. Its second caller found a defect in it immediately.

The grammar's digit counts are part of the grammar: V8 reads `2026-06-01` and
calls `2026-6-1`, `2026-06-1` and `02026-06-01` **Invalid Date** alike. The
port split on `-` and parsed whatever fell out, so it accepted all of them.

That had been true since the function was written and 2,014 filter cases never
noticed, because `filter`'s only caller is guarded by a regex that has already
demanded `[0-9]{4}-[0-9]{2}-[0-9]{2}`. The gap was real but unreachable —
until a second caller handed it a raw string.

### Three injections a boolean was hiding

Three parser injections — dropping the separator check, the digit check, and
the month bound — all diverged on **nothing**, and the reason was the corpus
shape rather than its contents. Every date reached the parser through
`is_recent`, which collapses the answer to a boolean, and a date that rolls out
of range (`2026-13-01` becoming January 2027) lands far outside a 48-hour
window either way. Both halves said `false` for different reasons and agreed.

Adding a `parse` kind that reports the parsed date itself took all three from
zero to 77. **A corpus that only observes a function through its consumer can
only see what the consumer did not throw away.**

A fourth injection — removing the length check — crashed instead of answering,
because `s[0..4]` on an empty string panics. That is a detection, and the same
shape as `stats`' `elapsed` floor: a guard that looks defensive and is
load-bearing.

### What `rates` gave back to the TypeScript

The decisions in `rates.ts` were interleaved with `fetch`, so none of them
could be checked without mocking a network — and the Rust port could not be
compared against them at all. They are three exported functions now
(`invertRate`, `isRecent`, `resolveRate`) and the async pair is transport.
All thirteen existing tests pass unchanged, so nothing shipped moved.

One thing the split made visible: `isRecent` is documented as "today or
yesterday in local time" and is not. It measures `|now − midnight(date)| < 48h`
from the current *instant* while dates sit at midnight, so the time of day
counts against a past date and in favour of a future one. **The day before
yesterday is never inside it; two days ahead almost always is.** Left as it
stands — the second source only serves live rates, so a generous window costs
one wasted request — but the comment now says what the code does.

### One module deliberately not ported

`domain/emoji` is 72 lines of which zero are logic: a table of 420 emoji in 14
groups for the category picker. Porting it would mean copying the table into
Rust so that Dart could copy it out again. It goes to the UI, like `gbkTable`
went to `encoding_rs`.

What it got instead was a look. `ALL_EMOJI`, documented as "a flat list for
defaults / fallbacks", was imported by nothing but its own test — the picker
reads `EMOJI_GROUPS`. It is gone, and the data checks it carried moved into the
test where they were doing the work. Twelve emoji appear in two groups each,
which is deliberate — a birthday cake belongs in both Food and Gifts — and is
now pinned by a test so a future deduplication has to argue with it.

### The export was dating every morning entry a day early

`toRows` built its date column with `new Date(d.ts).toISOString().slice(0, 10)`,
which is the **UTC** day. In Sydney every entry logged before ten in the morning
exported with **yesterday's** date; in Shanghai before eight; in New York it
goes the other way and evening entries dated tomorrow. Ten of every twenty-four
hours, on a ledger app where "coffee at 8am" is a normal row.

Grepping for the pattern found six more, all the same mistake:

* the date handed to the AI as `Today:`, in three prompt builders — so a lunch
  logged this morning got dated yesterday
* the date the exchange-rate lookup asks about, in three places in the record
  form — asking Frankfurter for yesterday's rate

One survivor is correct and stays: `exportedAt: new Date().toISOString()` in the
backup header is a full instant, not a day, and an instant is exactly what UTC
is for.

`localDateStr` in `dates.ts` replaces all seven. It also does not throw where
`toISOString` does: a `NaN` timestamp yields `NaN-NaN-NaN` rather than a
`RangeError` that would take a whole export down with it.

The corpus is emphatic about the size of this. Putting `toISOString` back
diverges on **2,959 of 4,259 cases**.

This is the third pattern found by grepping for a shape rather than waiting for
a module to trip over it: `/ 864e5` for a day, an inconsistent `a - b`
comparator, and now `toISOString().slice(0, 10)` for a local date. All three
were one-line habits repeated across files that no test disliked.

### A corpus with an invariant, and 33 cases that broke it

Each export row states both an epoch timestamp and the local day it falls on,
and they have to describe the **same moment** — the epoch is what the shipping
code sorts by and derives its date from, the day is what the core renders.
Hand-written cases that set `ts` to `100` while claiming a 2026 date diverged
on 33 lines, and the corpus was wrong rather than either implementation. The
deliberate cases are built through one constructor now, which computes both
from a single wall-clock moment.

A separate 2,225-case divergence was a genuine porting error, and a good one:
`to_rows` took a single flat slice of custom categories where `catOf` is handed
a `Record<IO, Category[]>` and picks the list matching the entry. A custom
*expense* category was answering for transfer rows. The signature takes a
`CustomCats` now.

### Two more no-op injections, and eight anchors that never landed

Twenty-two injections, all caught, floor 634. Two were written as no-ops first:
`Cell::Num` to `Cell::Text` renders identically through `as_str`, so it is
invisible to a CSV — the number/text distinction only exists in the XLSX — and
dropping `.filter(|n| !n.is_empty())` changes nothing because `Some("")` and
`None` both render empty. That is five occasions now.

Eight *other* injections silently reported "anchor not found", because the
anchors contained escape sequences and were written through a shell heredoc.
Building them with `String.raw` in a file written directly fixed all eight at
once. Worth naming as its own failure mode: **an injection whose anchor misses
is not scored at all**, so it looks like nothing rather than like a problem.

### `xlsxWrite` is not ported, deliberately

210 lines of ZIP central directories, CRC-32 and sheet XML, with no decision in
any of them — the columns and their contents are `toRows`, which is ported and
checked. `rust_xlsxwriter` is the answer if the Rust side ever writes the file
itself, and until then this is the same call as `rates` leaving its HTTP behind
and `emoji` leaving its table with the UI.

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
