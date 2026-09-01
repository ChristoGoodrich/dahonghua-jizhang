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
| `sync/merge` | 173 | **Ported**, 7,043-case parity — the heart of sync, and already pure |
| `domain/jsval` (new) | — | **Added** — a JSON value and `JSON.stringify`, because the serialisation *is* the comparison |
| `sync/rows` | 94 | **Ported**, 4,539-case parity — the wire shape, and the JSON on either side |
| `domain/jsval::parse` (new) | — | **Added** — the sync boundary is JSON in both directions |
| `sync/pushScheduler` + `engine` decisions + `conflictLog` → `sync` | 454 | **Ported**, 4,252-case parity — transport left on the platform |
| `sync/auth`, `sync/supabase` | 72 | **Not ported, and not replaced** — this build syncs through a file, with no server and no account |
| `features/list` grouping → `list` | 60 | **Ported**, 2,819-case parity — the first UI logic across |
| `features/record` form → `record` | 230 | **Ported**, 3,987-case parity — the record sheet's judgement |
| `features/stats` geometry → `chart` | 40 | **Ported**, 2,940-case parity — where a chart's points go |
| UI (21 routes, 72 components) | ~11,000 | **Flutter decided**; the decisions come out screen by screen, as above |

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

### The tiebreak could not see the difference it was breaking

`merge.ts` resolves an exact `updatedAt` tie by comparing serialised rows, "so
all devices converge instead of diverging forever". The serialisation was
`JSON.stringify(r, Object.keys(r).sort())`, which reads as "stringify with
sorted keys" and is not: the second argument is a **replacer**, and an array
replacer is a key *allowlist applied at every level*.

```
{ id, updatedAt, amt: 10, fieldTs: { amt: 7, note: 9 } }
  serialised to  {"amt":10,"fieldTs":{"amt":7},"id":…}
```

`fieldTs` came out filtered by the row's own top-level names, so a per-field
stamp for a field the row does not carry vanished from the comparison. An entry
that once had a note and no longer does is exactly that shape, and clearing an
optional field is an ordinary thing to do.

The consequence is not a wrong answer, it is **no answer**: two devices holding
different stamps each kept their own row and neither pushed, because the same
blind comparison decides both. The test added with the fix shows them diverging
forever. Sorting at every level instead; the string is only ever compared
locally and never transmitted, so a device on the old build and one on the new
still sync.

The corpus catches the old version on 33 of 4,423 cases.

### A JSON value, hand-written, because the serialisation is the comparison

`merge` compares whole rows by serialising them, so every escape and every
omission decides an outcome. `jsval.rs` is sixty lines of exactly what
`JSON.stringify` does — `NaN` and both infinities as `null`, `undefined`
omitted from an object but `null` inside an array, the five two-character
escapes and `\u00XX` for every other control, nothing escaped that JavaScript
does not escape.

`serde_json` would have been the reflex. The crate has one dependency, chosen
for size because the wasm bundle ships over mobile data, and what was needed
here was not a parser but a specific set of behaviours.

### JavaScript compares strings by UTF-16 code unit

Rust compares by code point, and the two disagree for **every** character
outside the BMP — a surrogate is `0xD800..=0xDFFF`, so JavaScript sorts an emoji
*below* `U+E000` where Rust sorts `U+1F600` above it. Three of five probe pairs
disagreed.

It only matters where a comparison decides an outcome rather than a display
order, and the tiebreak is exactly that. A note with an emoji in it is an
ordinary row. `js_str_cmp` in `jsstr.rs`, and an injection replacing it with
Rust's own ordering diverges on 13 cases.

### Six zeros, and why four of them cannot be otherwise

Twenty-nine injections. Six caught nothing, and for once most of them are
neither a gap nor a no-op:

* **Four are structural.** `NaN` and `Infinity` have no JSON syntax, so a
  corpus written as JSON cannot express a `NaN` tombstone or a `NaN` amount at
  all. The injections that only matter for those values therefore cannot be
  reached — and the same fact makes them unreachable in the app, whose sync path
  is also JSON. **They are untestable for exactly the reason they are
  unreachable**, which is a better answer than a gap.
* Two are no-ops by construction: rows are merged *by id*, so taking the id
  from either side is the same id; and a `NaN` `updatedAt` difference answers
  "not greater" whether it short-circuits or not, which is all the caller asks.

One injection reported "anchor not found" and was fixed rather than accepted —
an anchor containing a Rust `\"` escape, mangled on its way through a heredoc.
The lesson from last increment, arriving on schedule.

### The realtime path answered a question the pull had already answered

`pullAndMerge` runs `mergeById`, which does field-level merge when both sides
carry `fieldTs`: two devices editing *different* fields of one entry both keep
their edit. That is the whole design. The realtime handler in `engine.ts`
resolved the same conflict a different way — compare `updatedAt`, take the whole
newer row:

```js
} else if ((e.updatedAt ?? 0) > (local[idx].updatedAt ?? 0)) {
  copy[idx] = e;                        // the local note, and its stamp, gone
```

Edit a note here while offline; another device edits the amount later and
pushes; the message arrives and the note is gone. Not deferred to the next
pull — **gone**. The local `fieldTs.note` stamp was overwritten along with the
value, so the row no longer claims the edit ever happened, and a probe confirmed
the next pull finds nothing to merge and nothing to push. The two devices agree
on a row that neither of them wrote.

The fix is not to copy the merge into the handler but to make there be one:
`resolve()` now holds the two-tier decision and both paths call it. The realtime
entry point is `mergeOne`, not `mergeById(local, [row])` — the latter treats
every row the message did not mention as missing from the server and would
re-upload the whole ledger on every echo. `mergeOne` also reports whether the
result still needs pushing, and the watermark advances only when it does not:
a merge that kept something local is left to the scheduler and its backoff,
where before it was dropped between the two.

Every existing realtime test used legacy rows with no stamps, which is why a
path that ignored `fieldTs` passed all of them. The two new ones fail against
the old handler; the corpus catches it 1,779 times.

### The same id twice

A `merge_one` injection — swap `position` for `rposition` — caught nothing. The
corpus never repeats an id, because the generator draws each one once.
Investigating the gap turned up something the gap was hiding:

```
local = [{id:"a",updatedAt:1,amt:10}, {id:"a",updatedAt:2,amt:99}]

TypeScript   merged=[{...amt:99}]      new Map(...) keeps the LAST
Rust         merged=[{...amt:10}]      .find() takes the FIRST
```

`mergeById` indexes with `new Map(rows.map(r => [r.id, r]))`. A `Map` keeps the
last entry written for a key; `.find()` takes the first. Twenty-two corpora and
89,833 cases had never asked, because no generator had ever thought to repeat an
id.

It is reachable. `importV7` restores a **file**, and a file can say anything; it
filtered rows for validity and never checked ids. Two rows sharing an id make
the merge incoherent in a way neither half is wrong about — it resolves the pair
to one row and leaves the other in the list, so the ledger and the thing being
merged disagree about what is in it.

Both halves fixed: the port matches the `Map`, and the restore collapses
duplicates on the way in, keeping the last copy — which is the copy the merge's
own `Map` would have kept.

### Six zeros, and three anchors that had gone stale

Thirty-seven injections now. Six caught nothing and all six are accounted for:
four are the `NaN` family described above — untestable for exactly the reason
they are unreachable — and two are no-ops by construction (the merged row's id
comes from either side of a pair matched *by* id; the equal-stamp tie differs
only for `-0` against `0`, which serialise identically and so cross the wire
identically).

Three injections reported "anchor not found" — anchors that had gone stale when
`merge_row` was tidied in an earlier increment. They had been silently unscored
since. This is the failure mode named last time and it does not announce itself:
**an injection whose anchor misses reports as nothing, not as a problem.** Two
of them catch 233 and 225 cases now that they land.

### An empty map is not an absent map

`rows.ts` maps an entry to its database row and back. It looked like the least
interesting file in `sync/`, and the first parity run disagreed with the port on
**631 of 4,529 cases** — all of them the same thing, and all of them the port's
fault:

```
entry { fieldTs: {} }   TypeScript  field_ts: {}      Rust  field_ts: null
```

`Entry::field_ts` was a `BTreeMap`, so "no stamps" and "an empty stamp map" were
the same value. In the TypeScript they are not: `e.fieldTs ?? null` writes `{}`
for one and `null` for the other, and `field_ts` is a `jsonb` column that stores
both. The port was narrower than the column it wrote to.

It is now an `Option<BTreeMap<…>>`. The interesting part is why nothing had
caught it: the `ledger` corpus renders stamps with `Object.keys(e.fieldTs ?? {})`
on the TypeScript side, which prints an absent map and an empty one identically.
**The distinction was invisible to every corpus until a row had to cross the
wire.** Only one production line changed (`ledger::stamp`); everything else was
an assertion.

### What the schema settles, and what it does not

Three narrowings in this module. Two are provable, one had to be made true.

**`rb` and `src` read back as `None` when the column holds something else.** The
TypeScript casts (`r.rb as Entry['rb']`) and carries the value; the port has an
enum and cannot. That would matter if such a value existed — the port would
erase on the next push what the TypeScript preserved. It cannot exist:

```sql
rb  text check (rb in ('pending', 'done'))
src text check (src is null or src in ('bill', 'notif'))
```

**A fractional stamp** had no such guarantee. `field_ts` is `jsonb` and holds any
number; the port models a stamp as `i64` and truncates. A corpus line asking for
`{"amt": 1.5}` duly diverged. Rather than delete the line and call it
unreachable, the question was who can write one — and the answer is exactly one
function, `stampEntry`, whose `now` is a **parameter** any caller supplies. So
the invariant was not the code's, it was `Date.now()`'s. It is the code's now:

```ts
const t = Math.trunc(now);
```

with a test that fails if it ever stops holding, before sync starts quietly
disagreeing with itself across two languages. The same reasoning found a
reachable version of the problem in `importV7`, which restores a **file**:
`isValidEntry` asks only that `ts` be finite, and `ts`/`deleted_at`/`updated_at`
are `bigint` columns. `pushRows` upserts the whole dirty batch in one call and
throws on any error, so one row the server refuses fails the batch and the
scheduler retries it forever — **all sync stops because of one number**. Restore
now truncates on the way in.

### The corpus had been avoiding its most common escape

The `rows` sweep opened with six zeros clustered in the JSON reader, which was
the point of writing them: this is the first corpus whose *input* format is the
thing under test. Each one named a shape `JSON.stringify` does not produce, so
the corpus — generated with `JSON.stringify` — could not contain it:

* a repeated key (`JSON.parse` keeps the last value at the **first** position;
  appending would leave two and `Value::get` answers with the first — the same
  duplicate-key bug the merge had, one increment earlier)
* a `\uXXXX` escape for a character with a literal form
* **a newline**

The last one was self-inflicted. The generators avoid newlines so a case cannot
span two lines, and that caution was never checked: `JSON.stringify` escapes a
newline, so a value containing one puts **no** newline in the line. The reader's
single most common escape had no coverage because of a precaution that was not
necessary. Twelve hand-written lines closed all six; `\n` alone catches 1,856.

Two zeros remain and both are structural: JSON has no `NaN` syntax, and `amt` is
`not null`.

### A sweep is only as current as its reference

The first run of the repaired sweep reported 29 non-zero counts and two of them
looked wrong — small numbers where the reasoning said zero. They were: the
harness read its TypeScript reference from a file on disk, and the corpus had
been regenerated since. Every count in that run was for a corpus that no longer
existed, and nothing in the output said so.

The sweep now regenerates its own reference. Worth stating plainly, because it
is the same shape as the anchor problem: **the failure mode of a verification
tool is not a wrong answer, it is a plausible one.**

### `sync/` finishes, and two files turn out to be empty

The last 526 lines of `sync/` held perhaps forty lines of judgement between
them, and each was buried in enough I/O that none could be read on its own. All
three now sit in `sync.rs`, and — the point of the exercise — in three small
TypeScript modules that the shipping app itself uses:

| | was | is |
| --- | --- | --- |
| per-section config adoption | private to `engine.ts`, reachable only through a faked Supabase client | `sync/configMerge.ts` |
| the watermark rules | inline in `pushScheduler`, and **again** in the engine's `getDirty` | `dirtySince` / `advanceWatermark` / `nextDelay` |
| the conflict-log cap | inline in an `async` function that awaits AsyncStorage | `capLog` |

The watermark one is the same defect shape as the realtime merge, one increment
earlier: `(e.updatedAt ?? 0) > wm` was written once in the scheduler and once in
the engine, and the scheduler advanced past what *its* spelling considered
dirty. They agreed, but nothing made them agree. One `stampOf`, one `dirtySince`,
and the question cannot come up.

`sync/auth.ts` and `sync/supabase.ts` are listed as ported with nothing in them,
which is accurate rather than glib: strip the SDK calls and what remains is
`email.trim()`. That is [`jsstr::js_trim`] and not `str::trim`, for the reason
that module gives — a mail address pasted out of a file very often carries a
BOM, which JavaScript trims and Rust keeps.

### Two asymmetric defaults, and why they are not a typo

The per-section rule reads oddly and is right:

```ts
const r = rts[k] ?? 1;                    // the blob has no stamp for it
if (r <= (stamps[k] ?? 0)) continue;      // this device never edited it
```

A section this device never edited reads **0**; a section the blob has no stamp
for reads **1**. The gap between them is the whole legacy-blob story: a config
written before stamps existed carries none, so every one of its sections reads
1, which beats "never edited" (1 > 0) on a fresh device and loses to any real
edit (a `Date.now()` is enormous). Both defaults have a corpus line and both
have an injection; swapping either is caught 845 and 851 times.

One rule did change. `curLedger` was tested with `!== undefined` while every
other section used `!!cfg.x` — because `curLedger` is `''` when no ledger filter
is active, and a truthiness test made that value unadoptable. It was fixed as an
instance. `lang` and `curAccount` are also strings and were still on the truthy
test; neither can be empty today, which is the only reason there was one bug
rather than three. The rule is nullish for all thirteen now, which removes the
class and still refuses a `null` section from a legacy blob — that would
otherwise be written into the store as-is.

### A fixture that asserted the thing it was measuring

The sync sweep produced one zero and two injections that could not be scored at
all, and all three were the harness's fault rather than the corpus's:

* **`bump` had no corpus line.** An injection making the watermark *fall* caught
  nothing, because no case ever called it. A rule with no corpus line is not a
  rule the harness checks — it is a rule the harness has an opinion about.
* **An injection that would not compile.** `CONFIG_SECTIONS` is `[&str; 13]`, so
  deleting an element is a type error rather than a bug. Replaced with one that
  names a section twice and omits another: same defect, and it builds.
* **A `debug_assert!` in `dump_sync.rs`** checking that the conflict log never
  exceeds its cap. Injecting an off-by-one in the cap made the *fixture* panic,
  so the injection was reported as a build failure instead of as 2 divergences.
  The fixture must not assert what it is measuring; the assertion is a test's
  job, and there was already a test for it.

With those fixed, 31 injections and **no zeros** — the first sweep in this
migration where every injection lands.

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

### The first piece of UI logic, and the shape the rest will take

`EntryList.tsx` is 400 lines of rows, badges and swipe gestures with about sixty
lines of judgement threaded through it: sort the entries, bucket them into
calendar days, total each day, decide whether the day is called "today". That
judgement is not presentation, and it is not something to translate into Dart by
eye.

So it came out first, into `src/features/list/grouping.ts`, and then across into
`list.rs` with a 2,819-case corpus between them. **That is the pattern for the
remaining twenty screens**: extract the decisions into a module the shipping app
itself uses, port that, and let the widget tree be rewritten freely because
nothing load-bearing is left in it.

Two things stay on the platform, for reasons already settled:

* **The timezone.** An entry's calendar day needs a zone this crate does not
  own, so a row arrives already projected onto its day — the shape
  `trends::TrendRow` uses. The corpus carries `now` twice over, epoch-ms for the
  TypeScript and a calendar day for Rust, because the two halves genuinely need
  different things and neither should guess.
* **The day's printed name.** "8月26日 周三" is `toLocaleDateString`. What
  crosses is *which* of the three names applies.

### A regression that typechecking could not see

Moving the label decision out changed `group.label` from a printed string to one
of `'today' | 'yesterday' | 'date'`. The render still said `{item.label}`, so
the header read the literal word **"today"** — in a Chinese-first app.

`tsc` was content, because both are `string`. Every existing `EntryList` test
passed, because not one of them looked at the header text: they checked category
names, signed amounts, the day total, the empty state and the tap handlers. A
screen's most-read line of text had no test at all.

Two now, and they fail against the broken render. The general point is not about
this label: **a refactor that changes what a value *means* while keeping its
type is invisible to a typechecker, and only a test that reads the output can
see it.**

### Twenty-one injections, one zero, and two bad injections of mine

The zero is structural. "A repeated day opens a second group" caught nothing
because `day` is a function of `ts`, so after a descending sort a day cannot
reappear after a different one — checking only the last group is equivalent for
every input the sort can produce. A unit test covers the property directly, with
hand-built input in which the invariant is deliberately violated; the corpus
cannot, and should not pretend to.

Two injections were mine to fix rather than the corpus's:

* **`g.exp += r.amt` → `g.exp = r.amt + g.exp`** caught nothing, and could not:
  floating-point addition is *commutative*. Only associativity fails, so
  swapping operands is a no-op by construction. The property it was meant to
  pin — that the sum follows the visit order — is already carried by "the list
  sorts oldest first", which reorders those same additions and catches 2,066.
* **`chunks(0)` panics**, so an injection setting `columns` to take the packing
  path could only be observed to crash, never measured. Reformulated with a
  non-zero chunk size, it scores 205 — and the `> 1` guard it probes is
  load-bearing in both languages for different reasons: a panic here, a loop
  that never advances there.


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

### The ledger now lives in Rust, across the boundary

The architecture decision taken at the start of Phase 3 — *the Rust core owns
the state* — was until now a plan. It is running on a device.

`rust_bridge/src/api/store.rs` holds one `Mutex<Store>`. Dart writes through
commands and reads view models back; **it keeps no copy of the ledger**, so
there is nothing on that side to drift out of step and no logic there that could
disagree with the parity corpus. Seventeen integration tests on the emulator say
so, and they test *state* rather than functions: write through one call, read
back through another.

```
add_entry / update_entry / remove_entry / unremove_entry
add_transfer / import_bills / set_current_account
get_entry / live_entries / accounts / current_account / entry_count
list_items                       ← the day-grouped list, ready for a builder
load_entries / snapshot_entries  ← the platform owns the file, this owns the shape
```

Three rules the crate already followed are restated at that boundary, because it
is exactly where a caller is tempted to break them: **identity, the clock and the
timezone are all the platform's.** Every command that creates a row takes its id
and its `now` from Dart, and a calendar day arrives already computed. That is
what makes the ledger replayable, and it is why a 3,678-scenario corpus could
pin it in the first place.

Two details worth naming:

* **The lock is recovered, not propagated.** A panic inside one command poisons
  the `Mutex`; taking the value anyway means one bad row does not turn into an
  unusable ledger for the rest of the session.
* **A snapshot keeps tombstones.** They are how another device learns of a
  deletion, so a snapshot that dropped them would resurrect every deleted row on
  the next restore. There is a test that says exactly that.

The view types mirror `core::Entry` rather than re-exporting it, for the reason
`glass.rs` gave when it was the only module here: the core answers to the parity
corpus, and the moment an FFI attribute appears in it, it is answering to two
masters.

`NewEntry` is deliberately not `EntryView` minus a field. It has no `updatedAt`,
no tombstone and no id, because those are the store's to set — a caller that
could set them could write a row the sync merge cannot reason about.

### The first screen, and what is not in it

The entry list is drawn in Dart over the Rust ledger. What the file does *not*
contain is the point of it: no sort, no day bucketing, no per-day totals, no
"is this today", no rounding, no grouping separators, no category fallback.
Every one of those is a decision the core makes and the corpus pins. What is
left is rows, colours, taps and a scroll position — and that is what a widget
tree should be.

Two calls draw the whole screen. The ids and their local days go over once; the
grouped, totalled, labelled result comes back. Nothing is held on the Dart side
beyond a frame, so there is no second copy of the ledger to fall out of step.

Three bridge modules were needed and each earned its place rather than being
mirrored for symmetry:

* **`money`** — `fmt_num` is not `toFixed(2)` with commas. It reproduces
  `Intl.NumberFormat`'s grouping *and* JavaScript's rounding, which breaks ties
  toward +∞ where Rust's `f64::round` breaks them away from zero. That was the
  first divergence this harness ever found. Dart's `NumberFormat` would round
  differently again, and only on some locales.
* **`catalog`** — the category lookup falls back to the **last** category rather
  than to a generic "other", and a custom category that filled in one language
  falls back to the other. Neither is something a second implementation gets
  right by accident.
* **`store`** — the ledger itself, from the increment before.

### Two things the device said that the host could not

**A screen reader would have heard every row twice.** React Native's
`accessibilityLabel` on a touchable *replaces* the subtree's text; Flutter
*merges* sibling text into the node's label. So the row published
`餐饮, -35.50, 午饭` **and** the category, the amount and the note again after
it. The test that caught this failed with "found 0 widgets", which looked like a
missing label and was in fact a longer one — dumping the actual semantics tree
settled it in one run, where guessing would not have. `ExcludeSemantics` makes
the row say its one sentence, as the shipping row does.

**Material 3 paints its own chrome.** The default `NavigationBar` is lavender,
which against this palette's warm paper reads as a different application's
bottom bar. Visible in a screenshot, invisible to every test — worth saying
plainly, because a Flutter rewrite inherits Material's opinions unless each one
is overridden on purpose.

A third came free: changing `main.dart` from "the record sheet is home" to a two
tab shell broke the two prototype tests that pumped the shell to reach it, since
an `IndexedStack` keeps the unselected tab offstage. They now pump the record
sheet directly, which is what they were always about.

### The record sheet's judgement, and a save that saved twice

`useRecordForm.ts` is 368 lines of hook with about sixty of judgement threaded
through it: what a fresh form starts as, what switching direction does to the
other fields, why a form cannot be saved, what shape reaches the store, which
fields survive 再记. Extracted into `form.ts`, ported to `record.rs`, 3,987
cases between them.

Reading it closely turned up a shipping bug that had nothing to do with the
port. `save()` fetches a rate, writes the entry, and then:

```js
if (source === 'cached' && cur !== base) {
  setFlash({ msg: s.rateCached, err: true });
  return;                                  // no onSaved, no onClose
}
```

Record in a foreign currency with the rate endpoint unreachable and a cached
rate present, and the sheet **stays open showing what reads as an error over an
entry that has already been saved**. Press save again — the reasonable thing to
do when a form shows an error and does not close — and `addEntry` runs a second
time with a fresh id. Two rows, and nothing on screen to say the first one
worked.

The rate being stale says nothing about whether the save worked. The notice now
travels out through `onSaved`, which reaches a toast that outlives the closing
sheet, and it replaces the celebration rather than arriving underneath it.

### One rejection, spelled by the caller

`validate` answers *which* refusal applies rather than what to say about it —
`Rejection::NoRate(cur)`, not "no rate for USD". The same line the entry list
draws for a day's name: **a message is Intl and belongs to the platform, a
refusal is not.** It also means the Flutter sheet and the React Native one can
disagree about wording while agreeing exactly about what is refused.

The order matters and is now stated: the amount is checked first, so a form
wrong in two ways names the amount, because that is the field the user is
looking at.

### `parseFloat` is not `str::parse`, twice over

The fee and discount fields are free text, and the TypeScript reads them with
`parseFloat(x) || 0`. Two differences from Rust's parser, and the corpus found
the second one:

* **It reads a leading number and stops.** `"1.5kg"` is `1.5` where
  `"1.5kg".parse::<f64>()` is an error — so a fee of 1.5 against a fee of 0.
* **It accepts the literal `Infinity`.** The hand-written scanner reached for
  digits and signs and never for a word, so `"Infinity"` came out `0` where
  JavaScript gives `Infinity` — which `|| 0` then *keeps*, because an infinity
  is truthy. One corpus case, one divergence, and the fix is four lines.

### Two harness faults, one of them a repeat

The first parity run reported **86 divergences and 85 were the harness**. The
TypeScript renders `pickIo`'s partial with `?? '_'`, which replaces `null` and
`undefined` and leaves an empty string alone; the Rust half used a helper that
mapped empty to `_`. Same class as the `{:?}`-versus-`JSON.stringify` mismatch
from the export increment: **a formatting difference reported as a code
difference.**

The second was subtler and is a repeat of a lesson this migration has already
learned once. An injection storing an *empty* ledger instead of omitting it
caught nothing, because the renderer mapped both `undefined` and `''` to `_` —
so "absent" and "empty" were the same string on both sides. Exactly the
`field_ts: {}` against `null` distinction the rows corpus had to learn. The
draft renderer now quotes what is present and leaves `_` for what is not.

With both fixed and a zero-rate case added — the currency screen never writes
one, but `currencies` rides in the config blob and a restored backup is a file
that can say anything — the sweep runs **45 injections with no zeros and
nothing unscored**, the second time in this migration that every injection
lands.

### The record sheet, and what a screenshot found that the tests did not

The second Flutter screen, over `record.rs`. Same division as the entry list
and the same test of whether it held: `record_sheet.dart` has no idea what makes
a form invalid, what a fresh one starts as, what switching to a transfer does to
the account fields, or what shape reaches the ledger.

`save_form` is deliberately **one** call rather than validate-then-write. The
TypeScript split them and grew a path where the write happened and the caller
was told something that read like a failure; across this boundary a caller
cannot write without validating, and cannot be told "rejected" about a row that
exists.

Every keypress crosses too. That looks extravagant until you read `applyKey`:
what a second `.` does inside one number segment, what an operator does after an
operator, how a lone leading `0` is replaced rather than appended to. None of it
is obvious, all of it is the shipping app's, and a Dart approximation would be a
second implementation of a grammar.

**And then the screenshot.** Twenty tests passed, the sheet rendered, and the
amount panel read `=0`. The keypad I had written sent `'='`, and the shipping
keypad's equals key is named **`eq`** — so `applyKey` took `=` for a digit and
appended it. The operators were wrong the same way: `applyKey` matches on the
exact characters `+-×÷`, and a keypad sending `*` would have typed a `*` into
the amount.

Nothing caught this because nothing pressed those keys: every test typed digits
and `+`. The layout now matches `CalcKeypad.tsx` key for key — including `C`,
which I had left out entirely — and four new tests press each of the ones that
were wrong.

A second screenshot found a second thing: `请输入金额` still showing over a valid
`0.02`. The React Native sheet clears a flash on a timer because it is a modal
that comes and goes; this is a tab that stays, so **a complaint outlived the
thing it complained about**. It clears when the amount changes now, which is
better than a timer for a screen that does not close.

Both are the same lesson from the entry list's nav bar, restated: a test asks
the question you thought to ask. Looking at the screen asks the others.

### Fifteen lines of chart arithmetic, and a rounding bug in my own port

`TrendChart.tsx` says of itself that it is a "hand-rolled dual polyline in the
app's own chart voice… and no chart library". That was a deliberate choice and
it stays one — which means the mapping from values to coordinates is the app's
code rather than a dependency's, and answers to the corpus like everything else.

Forty lines, three guards, and every guard is one a rewrite drops:

* **`Math.max()` of nothing is `-Infinity`**, not zero. Filter a series out,
  ask for its maximum, and every point goes off the top of the box.
* **A single point has no span to divide by**, so `n - 1` is zero.
* **An all-zero series** would divide by a zero maximum.

Then the port's own bug. `polyline` rounds with `Number(x.toFixed(1))` and I
wrote `format!("{x:.1}")`, which is not the same function: **Rust's formatter
breaks an exact tie to even and `toFixed` breaks it away from zero.** `0.25` is
`0.2` there and `0.3` here. A unit test caught it — nine of ten passed — and
`money.rs` already had the rule, because `fmt_num` had solved it two hundred
lines earlier. It is `to_fixed_num` now, one definition, used by both.

### A corpus that could not see the bug the module exists to avoid

The sweep's first run: 24 injections, three zeros, and one of them was
**"rounding uses the Rust formatter"** — the exact defect I had just fixed.

The two rules agree on everything that is not an exact tie in binary, and no
generated coordinate happened to be one. So the corpus was passing for the same
reason the bug was easy to write. Searched for rather than guessed: with
`y = 89 − (v/max)·82`, `v=3, max=8` is exactly `58.25`. Ten such pairs now sit
in the corpus and the injection catches four cases.

The second zero was a **NaN in a drawn series**, and it is worth separating from
the NaN family the sync corpora meet. There, a NaN was unreachable *because* the
sync transport is itself JSON — the fact about the corpus was a fact about the
code. Here a chart series is summed from ledger amounts and can hold one
perfectly well; the corpus being JSON is an accident of the harness. So the
harness closed it: `"nan"` in an array is a NaN, on both sides. `Math.max`
propagates one and `f64::max` swallows it, which would have drawn a plausible
line over data the chart could not read.

The third is a genuine no-op. `toFixed` gives up at `1e21` and returns
`String(x)`; lowering that threshold changes nothing, because above `1e15` the
f64 spacing is at least 0.125 and a one-decimal round always lands back on the
same representable value. Checked rather than argued.

### Charts, with painters that do no arithmetic

The third screen, and the first non-text drawing. The point of it is what the
painters are *not* allowed to do: `chart_points` hands back coordinates in a
300×96 box and the painter scales that box to its canvas; `category_slices`
hands back a start and a fraction per arc. Neither painter knows what a maximum
is, what an empty series should do, or how a total divides.

That division earns more here than on the other screens. **A chart is the
easiest place in an app to be confidently wrong** — a line is drawn either way,
and nothing about a wrong one looks wrong. The tests check the numbers that
reach the painter rather than the pixels it makes of them, because the pixels
are one scale factor away from the numbers and the numbers are what a corpus
can pin.

Two calls do a screen: `daily_trend` for the buckets and `chart_points` for the
coordinates. Between them they carry the three guards `chart.rs` documents, and
each has a test on the device: an all-zero range answers a maximum of 1 rather
than dividing by zero, a series nobody draws does not set the scale, and the
tallest drawn value lands exactly on the top padding.

One thing the painter does decide, and says so: a `NaN` coordinate draws
nothing rather than a line. `Math.max` propagates a NaN by design — that is the
behaviour `chart_max` reproduces — and what should reach the screen when it does
is an absence, not a plausible shape.

### Persistence, and a screenshot that proved nothing

Rust owns the state and knows its shape; `persistence.dart` owns the file and
nothing else. Two files rather than one, matching the React Native build's two
AsyncStorage keys: renaming an account should not rewrite ten thousand entries,
and a write that fails halfway should not be able to take both with it.

Worth stating plainly, because a comment in the bridge overclaimed it and has
been corrected: the **shape** is shared, the **storage** is not. AsyncStorage on
Android is a SQLite database rather than a file, so a backup exported from one
build imports into the other, and neither can open the other's install. Moving
an existing one across is Phase 4 platform work that has not been done.

Then the part worth recording. The screen showed five entries after a
force-stop and a relaunch, which looked exactly like persistence working. It
was not: `_seedIfEmpty` runs on an empty ledger, so a launch that failed to
load its file **re-seeded the same five rows**. `ls` on the app directory
settled it — there were no files at all. A seed that is never written is
indistinguishable from a save that never happens, and only the second thing was
being tested.

The proof that replaced it: record 78 through the keypad, `am force-stop` with
no graceful shutdown, and read the file. `"amt":78` under a non-seed id.

### A lenient parser is the wrong parser for a file

`jsval::parse` is lenient by design — everything the sync path and the corpora
hand it has been through `JSON.stringify` once. A file is where that assumption
fails, and a test caught it: a truncated `entries.json` loaded as **one** entry
rather than none.

That is not a partial success. It is the first half of losing the rest, because
the next save writes the one back. So `parse_checked` refuses a document that is
not well-formed — a missing bracket, an unterminated string, trailing content —
and `load_entries` answers **-1** rather than a count.

The caller then does the thing that actually matters: **a file it could not read
is not written over.** Saving over it is the step that turns "unreadable" into
"gone", and while the flag is set the save is refused, so a user who backs the
file up or an update that can read it still can.

Writes go through a temporary file and a rename, which is atomic where a write
is not — otherwise the failure mode above would be one this build creates for
itself.

### Correcting the ledger

A ledger you cannot fix is worse than one you cannot chart, and until now the
Flutter build had no way to fix one. Two ways now, both through the same Rust
the record sheet already used.

**Swipe to delete**, which writes a tombstone rather than removing a row — the
row still syncs, and every display path filters it. The undo goes back through
`unremove_entry`, which is a *fresh stamped write* rather than a replay of the
old row: replaying it would restore an `updatedAt` below the push watermark, so
the undo would never reach the cloud and the next pull would delete the entry
again. That reasoning was already in `ledger.rs`; this is the first screen that
depends on it.

**Tap to edit**, which loads the source whole — date included, which is exactly
what separates it from 再记一笔. Saving patches in place rather than writing a
second row, and an untouched date is not restamped, because that stamp is what
the merge uses to decide whose version of the date wins.

An edit also does not clear the form the way 再记 does. There is no "next one of
the same kind" when the thing being typed already exists.

### An experiment whose setup destroys what it measures, twice

Last increment a seed masked a save that never happened. This increment the same
shape appeared again, from the other end.

After editing a row to 99 and force-stopping, the file on disk held five rows —
and the entry recorded before it was **gone**. That is a persistence app losing
data, so it was worth stopping for. It was not the app:

```
$ ls app_flutter/            → config.json, entries.json
$ flutter test integration_test/store_test.dart   → All tests passed
$ ls app_flutter/            → (no files)
```

**`flutter test` wipes the app's data directory when it installs.** Every piece
of device evidence about persistence therefore has to be gathered *before* a
test run, never after — and the earlier proof was: type 78, `am force-stop`,
read the file, find it there. That still stands, and so does the edit-to-99 that
survived its own force-stop.

Worth writing down because it is the second time in two increments that the
measurement disturbed the thing measured, in a way that looked like a result.

### Budgets, where the edges are the screen

The fourth screen, and the last one whose judgement was already in Rust waiting.
Its whole substance is three edges of one comparison, and each is the kind a
rewrite would smooth over:

* **A cap of zero is unset**, not "nothing allowed". Those want different
  screens — "未设上限 · 已花 ￥2,065.90", not a bar pinned at 100%.
* **A percentage over 100 is not clamped**, because being 138% of the way
  through a budget is the number worth saying. The *bar* is clamped, and that
  clamp lives in the drawing where it belongs; the arithmetic never sees it.
* **A cap that cannot be parsed reads as unset** rather than poisoning the tier
  — `limit > 0` is a comparison, and every comparison against `NaN` is false.

The settings had to come across with it, because `tier_status` is what decides
what a zero means and a second copy of those numbers in Dart is a second chance
to disagree. They persist in `config.json` alongside the accounts, and a
`cycleStart` outside 1..28 is clamped on the way in — the settings screen never
offers one, and a restored file can say anything.

### Thirteen tests, and the first tap crashed

The screen passed thirteen tests and then crashed on the device the moment
someone opened the cap dialog:

```
'_dependents.isEmpty': is not true
```

The `TextEditingController` was disposed at the `showDialog` call site, which
runs while the route is still animating out and the `TextField` still depends on
it. **Not one of the thirteen opened the dialog.** It is a widget of its own
now, owning and disposing its controller in `dispose()` where Flutter expects,
and four tests drive it — including the one that pumps all the way through the
exit animation, which is where the assert fired.

Third time in three increments that the device found what the tests did not,
and the pattern is consistent enough to name: **tests cover the paths you
thought of, and a screen has paths you only find by touching it.**

### Accounts, and a refusal that is nearly unreachable

The accounts screen is the fifth, and its arithmetic is the least visible so
far: a balance is an opening figure plus every entry that touched the account,
and a transfer contributes to two of them with four signs at once. None of that
is on this side. Two of its rules are enforced by *not drawing a button* —
`default` is neither deletable nor archivable, because it is what every orphaned
entry migrates to, and the core answers `false` to both.

The increment did not stop at the screen, because the screen had nothing to
show. Every entry was landing on `default`, and a transfer could not be saved at
all: `validate` refuses one with no destination and nothing on the record sheet
could name one. The picker is what makes the balances differ from each other,
so it belongs to this increment rather than a later one.

Then a test of mine expected `请选择转入账户` and got `已保存`. `pick_io` fills
the destination with the first visible account that is **not** the source, so
switching to 转账 already names one — the refusal is unreachable through the
sheet whenever a second account exists. It is reachable on a fresh install,
which has exactly one, and that is the case the test asserts now. The lesson is
not about transfers: **a rejection the core defines is not evidence the UI can
reach it**, and a test that asserts a refusal should say which state produces
it.

### A colour no test can see

Material 3 derives a colour scheme when none is given, and its default is
lavender. That produced the lavender navigation bar two increments ago, and this
time it produced a lavender `名称` label on a focused field — against warm paper,
in an app whose accent is amber. Thirty-one tests passed over it.

They could not have caught it. **A colour a widget does not set is not a colour
a widget test can read**: `expect(style.color, ...)` on a `Text` that inherits
its colour reads `null`, and the lavender only exists after the theme resolves
it during paint. The fix is in two places on purpose — the app now carries a
`ThemeData` for the seams a widget cannot set (selection handles, ripples, a
dialog's surface), and the dialog's fields spell their own label colours so they
are right under the bare `MaterialApp` a test builds. The test asserts the
second, which is the half a test can see.

Fourth increment running that the device found what the tests did not.

### The sync engine, and a corpus where both halves are interpreters

`sync/engine.ts` is 310 lines of which perhaps forty are decisions; the rest is
Supabase. The forty are now `engine.rs`: a state machine over `Event` returning
`Vec<Effect>`, which performs no I/O, reads no clock, and does not know what
Supabase is.

Every corpus before this one compares an **answer**. This module has none — it
decides an *order of operations against a server*. So both halves of the harness
are interpreters over one script: the TypeScript drives the shipping engine
through a faked Supabase client and jest's fake timers, and the Rust executes
its effects against an equivalent fake and a virtual clock. What is compared is
what a server would have seen — every upload in arrival order, every channel
opened and closed, every status the UI showed — plus the ledger, the section
stamps, and the value each config section holds. 2,600 scripts, zero divergence.

Three obligations fall on the caller that the module cannot enforce, and they
are written into its docs because the TypeScript enforces them only by accident
of ordering: sign-in means the local data is already loaded; writes made for
`ApplyConfig` must not come back as `LocalEdit`; the clock is the platform's.

### A push that a sign-out does not stop

Found in nineteen scripts that flushed and signed out in the same tick. A flush
is `async` and `cancel()` is not, so the awaits resolve after the sign-out and
go on to move the watermark, report a status — `synced` *after* `off` — and, on
a failure, arm a retry that `cancel()` had already run past. That retry then
fires while signed out and uploads with `activeUser!` null.

`pushScheduler.ts` now carries a generation counter, bumped by `cancel()`, and
the flush checks it after each await. The upload already sent cannot be unsent;
everything after it can be, and now is. Three regression tests.

### A realtime row schedules a push in two ways, and I modelled one

`if (push) pusher.schedule()` is written out. `store$.data.set(rows)` scheduling
through the root subscription is not written anywhere near it — `applyingRemote`
guards the config path but not this one. And the second only fires on a **real**
change: the store notifies on a change, not on a call, and `mergeOne` hands back
a fresh array whether or not it resolved to anything different. A device's own
echo therefore wakes nothing at all.

133 scripts said so. Both halves of that rule matter, and neither is visible
from the handler alone.

### Four faults in the harness before it could measure anything

The corpus was not worth trusting until each of these was fixed, and every one
of them looked like an engine divergence first:

* **The generator's PRNG was degenerate.** `seed * 1103515245` passes 2^53 in
  JavaScript, the low bits go to zero, and the sequence collapses — 603 distinct
  scripts out of 104,000 attempts, reported without complaint. `Math.imul` does
  the multiply in the 32 bits the algorithm actually lives in.
* **Timers leaked between corpus lines.** The whole corpus is one jest test, so
  `afterEach` never ran between lines: a debounce armed by line N fired inside
  line N+1, through the previous module instance, into the *new* fake client.
* **The fake did not remove channels.** `removeChannel` only logged, so the
  handler kept delivering after sign-out and a row arriving then landed in the
  ledger. Supabase does not do that; the fake was.
* **A seed after sign-in is not a seed.** The store's root subscription is live
  by then, so writing a row IS a local edit. Both halves now refuse the command
  rather than diverging for a reason that has nothing to do with the engine.

### A sweep that poisons the next sweep

Worth its own heading, because it silently invalidated a whole pass. A sweep
killed by a timeout never runs its `finally`, so it leaves its last injection in
the tree. **The next sweep captures that mutated file as "original"**, applies
its injections on top of it, and restores to it afterwards — every number it
reports measured against a bug it does not know about. That happened here; I
found it by hand-checking `sync.rs` and seeing *two* mutations at once.

The sweep now runs the 666 core tests before it starts and refuses to measure a
tree that cannot pass them, and it leaves `.sweepbak` copies so a kill is
recoverable. The tests are the right guard because they pin every rule the
injections touch.

The same pass turned up its sibling: an injected zero-delay retry re-arms itself
at the same virtual instant, and the interpreter looped until it asked for 48
GiB and died. **A crashed interpreter scores no detection** — the injection read
as "not caught" when it had in fact been caught catastrophically. The settle
loop is bounded at 200 firings now, and overflowing it emits a `LOOP` marker,
which scores as the divergence it is.

### Fifty injections, and the five zeros that were real

Forty-five caught. The five that were not are equivalences, and each has an
argument rather than an excuse:

| Injection | Why nothing changes |
| --- | --- |
| the pull seeds `newest` from the watermark | the outer `bump_by` is what keeps the watermark monotonic; the zero seed is inert |
| a success always reports a status change | setting an observable to the value it already holds notifies nobody, on either side |
| an empty remote blob is adopted | adopting `{}` adopts nothing — `present(k)` is false for every section |
| a blob with no stamps reads as stamped zero | `None` and an empty `Stamps` are indistinguishable through `and_then(…).unwrap_or(1)` |
| sign-out leaves the watermark up | a leftover can never exceed `max(local updatedAt)`, and the next pull raises it to exactly that — the ledger never shrinks |

The first of those corrected a comment of mine that claimed the seed mattered.
It does not, and the injection is how I found out.

Six more zeros were corpus gaps, and closing them is most of what the sweep was
worth:

* **The backoff's *value* was unobservable.** A 1.2-second settle and a
  70-second one both sit outside every interesting boundary, so 2s, 4s, 60s and
  64s all looked identical. `S3` (three seconds — fires a 2s retry, not a 4s
  one) and `S6` (sixty-two — fires the capped 60s, not an uncapped 64s) closed
  three zeros between them.
* **fail → succeed → fail was unreachable.** `OK` turned failure off
  permanently and nothing turned it back on, so no script could ask whether a
  success resets the backoff.
* **`ConfigFailed` was unreachable.** One `failPush` flag governed both halves
  of a flush, so "the rows landed, the config did not" — the branch the whole
  watermark rule exists for — never happened.
* **`ApplyConfig` was invisible.** Adoption was observable only through the
  stamp it set, so adopting a section whose remote stamp equalled the local one
  wrote nothing detectable, and neither did the difference between a nullish
  presence test and a truthy one. Both halves now dump what each section holds.
* **No row carried `fieldTs`.** This is the one that matters. Without per-field
  stamps, `merge_one` only ever takes the whole-row path, where a push is
  reported only when the *local* row wins — and then its stamp is already the
  higher one, so the watermark rule has nothing to decide. **The path this
  entire port exists to protect was not being reached.** `LF`/`TF` build a pair
  where ours stamps the note late and theirs stamps the amount late; merged,
  each side keeps what it edited last, and the result is a row the server has
  never seen — exactly when the watermark must not advance, or the push meant to
  carry it is filtered out by the very filter meant to find it.

One correction of a script rather than of the corpus: my test for "sign-out
clears the pending retry" signed back in while pushes were still failing, so the
second start-up failed at its config push and nothing after it scheduled
anything. **A script that never reaches the state it is testing reports zero,
and reports it in exactly the same shape as a genuine equivalence.**

### The import screen, and a fixture that had to be real GBK

Three ported modules meet at one screen: `encoding` decides whether the file is
UTF-8 or GBK, `bills` finds the header and reads the rows, `dedup` maps each row
to a category and works out which the ledger already holds. The bridge does the
orchestration `billImport.ts` does, because that orchestration is where the two
platform questions live.

**The ledger is read at the pick, not at `initState`.** The shipping screen
does the same — `store$.data.peek()` inside `pick()` — and the comment there
says why in six words. A row recorded while the file browser is open is a row
the dedup has to see, or the import writes it twice.

**The wall time in the file becomes an instant in Dart.** A candidate crosses
carrying six numbers and no opinion; `DateTime(y, mo, d, h, mi, s)` applies the
zone. A bill row reading 02:30 on a spring-forward morning is a wall time that
does not exist, and the platform is the only thing here entitled to say what it
means. This is the same cut the report screen took, and it is now the third
place it has come up.

The fixture is the part worth recording. Writing the 支付宝 export as a Dart
string would have tested nothing: the reason `encoding.rs` exists at all is that
微信 writes UTF-8 with a BOM and 支付宝 writes GBK, and a fixture that is UTF-8
either way cannot tell the two apart — it would pass with the GBK table deleted.
Dart has no GBK encoder, so the 332 bytes are spelled out as integers, generated
once from Python's codec. The test asserts 星巴克 comes back, which is a thing
mojibake cannot fake.

Custom categories are passed empty, and the code says so rather than leaving a
reader to wonder: this port has no custom-category editor yet. The core already
takes them and `map_category` already prefers a custom keyword over a built-in
one, so the day the editor lands the argument is the only change.

**What the screen shows that the shipping one also shows: the duplicates.** A
list that quietly dropped them would leave "18 rows" unexplained next to six
entries. "3 rows, 3 already recorded" is the sentence a user can act on.

### A defect the port declines to reproduce

Reminders are wired, and porting them turned up a bug in the shipping app that
this port deliberately does not carry across.

`scheduleCustomReminder` and `scheduleDailyReminder` both call
`cancelAllScheduledNotificationsAsync()` before scheduling — and only those two
do. So turning the daily reminder on silently cancels the weekly and the
monthly report. Whether a user has the reports they switched on depends on the
order they last touched three unrelated switches, and nothing anywhere says so.

The rule this project has followed is to reproduce faithfully, because a
difference nobody chose is a divergence and the corpus exists to catch exactly
that. This is the other case: not a decision that happens to look odd, but a
defect with nothing downstream depending on it. Every schedule has a stable id
now, and the platform cancels **by id**. Turning one on cannot touch another.

Two smaller things came out of the same decision. "Cancel all" is a claim over
notifications this app never posted, which is worth not making even when it
happens to be harmless. And the ids have to be stable across releases: a changed
id orphans whatever the OS already holds under the old one, leaving a
notification nothing in the app can cancel.

The injection that proves the tests see it took two attempts, and the first was
the interesting one. Cancelling everything *before* scheduling the daily leaves
the reports scheduled after it — the tests passed, and they were right to. The
real shape is cancel-all-then-schedule-only-the-daily, and that fails two tests.
An injection is a claim about the code; if it does not reproduce the defect it
names, a green run says nothing about either.

And a zero in between was not a zero at all: the emulator had gone, the run
reported "no devices", and `grep -c` on the log dutifully returned 0 failures.
The same trap as the `sed` ampersand earlier, and the same rule — a sweep has to
be in a position to make the claim before its result means anything.

### A component that was mostly not a component

`LockGate.tsx` is 137 lines of which perhaps twenty draw anything. The rest is
*when to prompt, when to open without asking, when to stay shut, and which
answer belongs to which attempt* — and every comment in it is a bug somebody
found. That made it the clearest case yet for the split this migration keeps
drawing: the decisions are `lock.rs`, and Dart asks the device, watches the
lifecycle and paints a cover.

Five rules came across, each with the cost of getting it wrong written next to
it:

* **An attempt has an id and a stale one may not speak.** Android's
  `BiometricPrompt` can be torn down by the OS without invoking its callback.
  An attempt that settles later must not open the app, and must not clear a
  newer attempt's in-flight flag.
* **Pressing unlock supersedes a prompt already up.** Bailing out instead left
  a hung prompt latching the flag on forever, and the button was dead with no
  feedback until the process restarted.
* **An error leaves the gate shut.** The first version unlocked. Some Android
  devices throw after repeated failures, which turned the lock into a
  formality.
* **Nothing enrolled means open.** There is nothing to check against and
  gating on it locks a user out of their own ledger.
* **Only a real trip through the background supersedes.** iOS reports
  `inactive` then `active` around its own dialog.

No parity corpus. The TypeScript half would have to be a React component driven
through a faked `expo-local-authentication` and a faked `AppState` — the shape
the engine harness took, and a large piece of work for a module whose rules are
each one sentence and each already written down in a comment. What it has
instead is 26 unit tests that state the rules in those words, and injections
that check they bite: making an error unlock fails one, removing the attempt
check fails another. Said plainly here because "31 corpora" should not be read
as covering this.

### Three tests that could not exist on a device

The lifecycle rules are the ones a device test cannot reach, and finding that
out cost three attempts.

`tester.binding.handleAppLifecycleStateChanged(paused)` does not *simulate* a
pause on a real device. It causes one: the engine stops the frame pipeline, the
driver loses the app it was driving, and the run hangs with the app alive and
silent. `pumpAndSettle` was the first suspect and was wrong — settling waits
for a frame that is not coming, but a plain `pump` hangs too, because the
problem is upstream of pumping.

So those three assertions live in the core, where a lifecycle is an enum rather
than an operating system. What the device file keeps is the part this side owns
— that each callback reaches the right event — and a comment saying why the
rest is not there.

One of the replacements was wrong on its first writing, in a way worth keeping:
I asserted that `inactive` never re-locks. It does. The rule is narrower —
`inactive` spares a prompt that is **actually up**, and with nothing being
answered, leaving the foreground is leaving the foreground. There are two tests
now, one for each side of that.

### The suite outgrew one run

At 28 files and 506 tests the integration suite takes twenty minutes, and it
started failing in a way that is not about the code: a file fails to load with
"Connection closed before test suite loaded", and once the run has gone on long
enough the last file is cut off mid-way with two dozen tests marked "did not
complete".

Each affected file passes on its own. `bridge_test` alone: 14 passed.
`export_test` and `accounts_test` together: 48 passed. Nothing was wrong with
them.

The cost of that is worse than the lost time. A suite that fails randomly is a
suite whose failures stop being read — the previous lesson in this file was
about exactly that, and it was about believing a timing test when the emulator
was the problem. So the suite runs in two halves now. Fourteen files each,
about ten minutes apiece, and a red result means something again.

### Seven flowers, and three places a correct palette can fail to arrive

`theme.rs` is the 31st corpus. `makeTheme` is colour arithmetic over a table of
constants, which sounds like the least likely thing in the app to diverge — and
is exactly why it was worth pinning, because two of its rules are easy to
"tidy" into something different:

* **The alpha is string concatenation.** `base.hibiscus + '14'` appends two hex
  digits to a six-digit colour. A caller that parsed the accent, applied an
  opacity and re-serialised would land on a different byte for some accents,
  and the two halves have to agree byte for byte or the corpus is worthless.
* **Dark mode replaces surfaces and keeps accents**, applied *after* the
  per-theme overrides rather than before. A dark sakura is sakura's accent on
  the shared dark paper, not sakura's own paper darkened.

The corpus is exhaustive rather than sampled: seven themes times two modes
times every field is 504 cases. Sampling a table of constants only tests the
sampler.

The Dart side is where the interesting part was. `palette` was a `const` read
in 444 places, and it is a **getter** now — which is what lets every one of
those call sites follow a theme change without any of them knowing a theme
exists. Three things had to line up, and each is a place a perfectly correct
palette fails to reach the screen:

1. The getter caches, so every caller of `setTheme` must `refreshPalette()`.
   There is a test that deliberately does *not* refresh and asserts the stale
   colour, because that is the failure mode the cache buys and it should be
   written down rather than discovered.
2. `MaterialApp.theme` is computed once, in a `StatelessWidget`. Without the
   root rebuilding, a dark app keeps light dialogs and light menus — every
   widget this app does not paint itself, including the switch the setting is
   toggled with. `App` is stateful now for that one reason.
3. `ColorScheme.fromSeed` needs `brightness` told, not inferred. Without it
   Material derives light defaults from the seed and a dark room gets black
   text on a dark card.

One test is worth more than the rest: every flower, in both rooms, must keep
enough luminance between paper and ink to be read. It is the only assertion
here that would catch a swap in the constants themselves, which the corpus
cannot — the corpus proves both languages agree, not that the answer is usable.

### The palette had been wrong the whole time

Wiring it broke five tests, and the reason is the point of having done it.

The hand-written Dart palette did not match the design tokens. Its `hibiscus`
was `#B83A48`, which is the TypeScript's **hibiscusDeep**; every accent was one
shade too dark. `stamen` was `#E0A93C`, which is the *daisy* theme's accent
rather than the shared amber `#E8A838`. Both greens were different values
outright, and `paperWarm` was off by a shade.

Nothing was broken by it. Nothing crashed, no number was wrong, and no test
could catch it, because until today there was no source of truth on this side
to compare against — the palette *was* the source of truth, and a hand-copied
one cannot disagree with itself.

The five tests that failed were the ones asserting a **literal colour**. They
assert `palette.hibiscus` now, which is both correct and the only spelling that
survives a theme: a test naming `Color(0xFFB83A48)` was a second copy of the
palette, and it went stale the moment the first one was fixed.

And a third duplicate turned up in the same neighbourhood. `parseRgba` was
defined in both `main.dart` and `theme.dart`, and they had drifted:
`theme.dart`'s returns black for a string with fewer than three numbers, while
`main.dart`'s indexes `n[0]` unguarded and throws. Being in the same library as
its callers, the unguarded one is the one that ran. It is deleted.

That is three duplicates in this project now — `inbox`, `subs`, `parseRgba` —
and all three had the same signature: written twice, agreeing for a while, then
diverging in the copy nothing was watching. The rule that catches them is not a
review habit but a question that can be asked of the tree: *what is defined
more than once, and which copy do the tests actually reach?*

### The rate a date deserves, and the picker that had to exist first

`rates` is wired, which empties the audit list of feature modules. It is the
first thing in this port to touch the network at all: `INTERNET` was not in the
manifest until now, and the only thing that ever leaves the phone is a currency
pair and a date.

The split is the one `rates.rs` already described. HTTP, a fifteen-second
timeout and a failed request collapsing to "no answer" are Dart's. Which source
to believe, in what order, whether a number is usable, and how to invert "1 base
= X target" into the store's "1 foreign = N base" are all the core's. A screen
that could reorder the sources would be a second place for the policy to live.

Then the increment stopped, because the feature was unreachable. The record
sheet has a `cur` field on its form and **no way to set it** — no currency
picker, anywhere. Fetching a rate for an entry that can only ever be in the
base currency is `statementDay: null` again: a wire run to a switch nobody
installed. So the picker came first, and it appears only when a second currency
is tracked, because a row of one chip is not a choice.

Two decisions worth keeping:

**A fetched rate is not a stale rate.** `staleRate` now means `source == 'cache'`
and nothing else. Marking a rate fetched for the entry's own day as stale would
teach a user to ignore the notice, and the notice is the only thing standing
between them and a silently wrong conversion.

**A failed fetch saves the row.** No signal, a captive portal, an API that is
down — `resolve` falls through to the cache and the notice says so, which is
exactly the behaviour this screen had before there was any fetching. Losing an
entry to a bad network would be a worse bug than the one being fixed.

The tests inject the fetcher. Two public APIs cannot be a test dependency: a
suite that fails because a rate service is down is a suite people learn to
ignore.

### The corpus was testing a file the app did not run

The audit found one more thing, and it is the worst-shaped defect in the
project so far.

`subs.rs` and `subscriptions.rs` were **two ports of the same TypeScript
file**. Same functions, written twice, six months apart in project time. The
bridge called `subs`. The parity harness — `dump_subs.rs` — called
`subscriptions`. So the sentence this whole migration rests on, *"the Rust
agrees with the shipping app across 119,779 cases"*, was true of a module no
user could reach, while the module that actually ran was compared against
nothing.

They had already drifted, in exactly the place the earlier port had left a
comment about:

```
// `sub.lastCharged ?? encode(cursor)` — nullish, not truthy. The cursor
// above uses `if (sub.lastCharged)` and so treats an empty string as
// missing, but this one keeps it. Two different truthiness tests on the
// same field, three lines apart; conflating them is what the corpus caught.
```

`subs.rs` — the shipped one — conflated them. The corpus could not see it,
because the corpus was reading the other file.

Traced through the bridge, the divergence turns out to be unreachable: the only
path that returns the seeded cursor is the one where nothing fired, and
`subs_apply` returns early on an empty charge list before it writes. So this
was not a bug users had. It was a bug users were one refactor away from, with
the safety net pointed at the wrong trapeze.

There is one module now. `subs.rs` gained `cursor_of`, `due_charges`,
`allowed_charges` and `charge_id` with the corpus-tested semantics, `apply_cap`
delegates to `allowed_charges` so the cap has one implementation, and
`seed_cursor` holds the nullish rule in one place with the comment on it.
`subscriptions.rs` is deleted and `dump_subs.rs` points at `subs`.

The corpus passes: 1,789 cases, unchanged. That run is the whole point — it
converts "the shipped module is untested" into "the shipped module is proven",
and it is the reason to repoint the harness rather than to keep both.

Five new unit tests pin the two truthiness rules, which neither port had ever
tested directly. Re-injecting the conflation fails two of them.

### The last one off the list, and why it was unreachable

`statement` is wired, which finishes the audit. 492 lines of credit-card cycle
arithmetic — 出账日, 还款日, 本期待还, 未出账, 溢缴款 — that nothing could reach,
for a reason worth naming precisely.

The `Account` model has carried `statement_day` and `due_day` since it was
ported. The bridge passes them. The accounts screen's new-account dialog wrote:

    statementDay: null,
    dueDay: null,

unconditionally. So the fields existed, the arithmetic existed, the corpus
passed, and no user could ever configure a cycle. Nothing was broken; a wire was
never run. That is what the whole audit was looking for, and it is invisible to
every kind of test that asks whether a function is correct.

Three decisions in the wiring:

**Unset has to be reachable.** Tapping the chosen day again clears it — a card
whose cycle was set by mistake needs a way back, and the core reads "no
statement day" as a real state rather than as a default.

**A card with no cycle shows nothing, not zeroes.** A row reading 本期待还 ￥0
looks like a card that is paid off, which is the opposite of "we do not know".

**The due banner is at the top, and keeps overdue cards in it.** The same facts
are on each card's own row, but a row halfway down a list is not a reminder —
and a reminder that disappears once it is late disappears exactly when it
starts to matter. `due_soon` sorts by days remaining, so negative counts
come first without any extra rule.

### A screen where three numbers disagreed and nothing said so

`period` is wired, and wiring it exposed what the stats screen had actually
been doing. The window picker said 7 / 30 / 90 days and drove the **chart**.
The totals above it and the donut below it read the whole ledger — every entry
ever recorded. Three numbers on one screen, about three different spans, none
of them labelled.

Nothing was wrong in any one place. `overview(ids)` and `category_slices(ids)`
take the ids they are given and had been given all of them, which is what those
functions are for. The bug was that nobody had ever chosen what the screen was
about.

It is about a window now: day, week, month, half-year, year, with a label
saying which one and arrows to step it. `month` is the accounting cycle rather
than the calendar month, so a ledger turning over on the 15th gets the 15th to
the 14th here as well — the cycle start comes from the store rather than from
the caller, because it is a setting the user has already made and a screen
passing its own would be a second place for it to be wrong.

Two decisions in the wiring worth keeping written down:

**The trend counts back from the window's end, not from today.** Otherwise
stepping to last month moves the totals and leaves the chart where it was.

**Except in the window we are still inside, where it stops at today.** A chart
running to the end of the current month ends in a flat tail of days that have
not happened, and a flat tail reads as spending having stopped. A window
entirely in the future is left alone: there is nothing to clamp to, and a
negative span is worse than an empty chart.

The labels stay in Dart. `period.rs` says why and it has not changed: rendering
a month name is ICU text, the same reason `curOf` stayed behind in `money.rs`.

### A BOM cannot cross as a Dart string

The CSV export is wired, and it found a boundary rule worth writing down.

`to_csv` starts the document with U+FEFF, and the core says why: without it
Excel guesses a code page and every Chinese category name comes out as
mojibake. The first version of the bridge returned a `String`, and the BOM
arrived gone. Dart's `Utf8Decoder` **strips a leading BOM**, and
flutter_rust_bridge decodes every string with it — so a BOM is not something a
Dart `String` can carry across this boundary at all, no matter what Rust wrote.

The fix is not to re-add it in Dart, which would split one decision across two
languages and leave the core's comment describing something that no longer
happens. The export returns `Vec<u8>`. An export is a file, and a file is
bytes; the string was the wrong shape before the BOM ever came up.

The test had the same bug as the code and for the same reason. Asserting
`csv().codeUnitAt(0) == 0xFEFF` on decoded text can never pass — and, worse, an
assertion written the other way round would have passed with the BOM deleted.
It checks the first three bytes now.

XLSX stays unported, as `export.rs` said it would: `writeXlsx` is 210 lines of
ZIP and XML with no decisions in it, and the core carries one dependency. CSV
opens in Excel, which is what the BOM is for.

### Two more off the list, and a rule better than the one I tested for

`streak` and `notes` are wired. Both are small, both had a slot waiting —
`MeScreen` has taken a `streak` parameter since it was written and `main.dart`
had never passed one, so the line simply never rendered.

The streak test I wrote first was wrong, and the code's rule is the better one.
I asserted that a ledger last written yesterday has no streak: the count is
days ending today, so nothing running now. The core says otherwise, and says
why — **today not being logged yet does not break the streak**, because
otherwise opening the app in the morning shows a zero for a streak that is
still running. Nothing yesterday either and it really is over.

That is a product decision sitting in a port, and the only reason it survived
the port is that it was written down where the person re-testing it would read
it. The test now states the rule instead of contradicting it.

Note hints are offered, never imposed. A category recorded for the first time
has no history and shows nothing, which is the ordinary state rather than a
gap — so there is no empty row, and a test says so.

The suite caught a wart in them that the feature's own tests did not. Opening
the sheet to EDIT an entry noted 午饭 offered 午饭 back as a chip: an entry's own
note is usually the most-used note for its category, so the sheet opened
offering the row back to itself, and tapping it would have done nothing.
`edit_test` found it by counting two widgets where it expected one — a test
about something else entirely, which is the argument for running the whole
suite rather than the file you just touched. The hints now drop whatever is
already in the box, and ask for five so that dropping one still leaves four.

### An audit of what was ported and never reached

Having written `inbox` twice, the obvious next question was how many other
modules the bridge had never touched. Fifteen, of which most are internal
helpers (`jsstr`, `jsobj`, `keywords`) or the sync trio kept on purpose. The
rest are whole features, ported and unreachable:

| module | what it is |
| --- | --- |
| `search` | free-text search plus `>100` / `<=50` amount operators |
| `filter` | filtering, and reading a date range out of a search box |
| `export` | the rows an export is made of, and the CSV they render to |
| `statement` | the credit-card cycle: 出账日, 还款日, 本期待还 |
| `streak` | the consecutive-day logging streak |
| `notes` | note suggestions learned from history |
| `period` | day / week / month / half-year / year windows |

The list is the remaining work, in a form that cannot be argued with. `search`
and `filter` are wired now; the others are named here so the next increment
does not have to rediscover them.

### The search seam, and an injection that found the test I had not written

A query can name a *range*, and a range is not something the core may resolve.
`parse_search_query` splits 上周 支出 星巴克 into a civil range, a direction and
the text that is left; Dart turns the civil pair into the epoch bounds the
filter compares against, because midnight last Monday is a question about the
device's zone. That is the same cut the report screen and the import screen
took, and it is now the fourth.

The screen says back what it understood. Without that the query language is
invisible: a user who types 上周 and gets four rows cannot tell whether the word
was read as a date or matched as text against a note.

Nineteen tests, and the injection sweep found the missing one. Removing the
date bounds *in Dart* — `fromMs: null` — was caught by nothing. The range tests
called the bridge directly with explicit bounds, and the screen test asserted
only that the readback rendered. So the one seam the file exists to protect was
the one thing not tested through the screen: a UI that draws the label and then
forgets to pass the bounds looked completely correct. There is now a test that
types a date and checks a row actually left the list.

It uses 今天 rather than 上周, deliberately. An entry recorded during the test is
today by construction, so there is no hour of the week at which it means
something else.

### I rewrote a module the core already had

`inbox.rs` was ported long before the capture screen was — `drain`,
`already_seen`, `Inbox::absorb`, `Inbox::confirm_pending`, under an
inbox-corpus of its own. I did not look, and wrote all four again by hand in
the bridge and in Dart. They agreed with the core, which is the least
reassuring possible outcome: the hand-written pair was not tested against
`inbox.ts` and would have drifted the first time either was touched.

The whole thing now delegates. The bridge holds the `Inbox`, converts shapes,
and does the ledger write the core deliberately leaves to its caller; the
duplicate `already_seen` and the hand-rolled candidate loop are gone, and
`inbox.dart` lost its own copies of `PendingItem`, `UnparsedItem` and their
JSON. What is left in Dart is exactly the three things the core cannot do —
read the native queue, write the file, acknowledge the queue — and the order
between them, which is the design.

Two more consequences worth having:

The pending list is no longer mirrored on both sides. `Inbox.pending` is a
getter that asks Rust, because a second copy of a list is a second thing that
can be wrong. And the unparsed bound is asked for rather than restated, so the
test that checks it is checking the core's bound and not a copy.

The lesson is not "read the source first", which everybody already believes.
It is that a duplicate that AGREES is the expensive kind. A wrong one fails a
test on the day it is written; a right one waits until someone changes the
tested copy, and then only the untested copy is wrong.

### A test that could not tell "saved" from "never written"

The injection sweep that caught the duplication caught something smaller and
sharper on the way. `inbox_blob` made to return `{}` failed one test where it
should have failed two: "a discarded payment stays discarded across a restart"
reopened the inbox and asserted the pending list was EMPTY — which is exactly
what a file that was never written also produces.

It discards one of two payments now, and asserts the other one is still there.
An assertion that a thing is absent can only ever be evidence when something
else is present.

### Auto-capture, and two tests that asserted the wrong field

The notification listener came across nearly verbatim — `NotifCaptureService`
and `NotifStore` are the shipping Kotlin with the package renamed, because
there was nothing wrong with them and rewriting working native code to feel
productive is how a port acquires bugs it did not inherit. The Expo module
became a `MethodChannel`, method for method, so the two read side by side.

The line the shipping build drew is the one that matters and it is kept exactly:
the listener is deliberately dumb. Whitelist, three text fields, write the row.
Everything that decides what a notification MEANS is in `notif.rs`, where 1,284
parity cases hold it, because a rule living in Kotlin costs a full rebuild to
change and cannot be tested.

The drain's order of operations is Dart's and is the whole design: the native
queue is acknowledged only after the results are in the ledger, so a crash
mid-drain replays instead of losing payments. A test now watches that order
from inside `markConsumed` — the ledger count at the moment of acknowledgement.
From the outside a drain that acknowledged first and then crashed looks
identical to one that never ran, so the ordering had to be observed where it
happens or not at all.

**The two dedup tests passed with the dedup deleted.** They asserted `posted`
and the ledger count. But a duplicate that escapes the dedup does not post — the
follow-up push for a payment carries no merchant, so it is not confident, so it
goes to the inbox to wait. `posted` stays 1 and the ledger stays 1, and both
tests go green over exactly the bug they exist to catch. They assert the whole
result now: nothing posted, nothing queued, nothing waiting.

The first injection that found this returned a zero for a different reason and
nearly got believed: `sed` expands a bare `&` in the replacement, so `false &&`
became `false <match><match>`, the crate did not compile, and a build failure
counts no detections. A zero from a sweep is a claim about the tests; it has to
be a claim the sweep was actually in a position to make.

### A walk over the hub that had quietly stopped walking

Adding one row to the 我的 hub broke a settings test, and the break was worth
more than the row. `me-settings` had dropped below the fold, and
`tester.tap` on a clipped row does not fail — it computes the row's centre,
which now lands on the tab bar, and taps that instead.

The neighbouring test is the part that matters. `lists nothing that goes
nowhere` walks every hub row and checks each reaches a screen, deliberately
written without a count so that adding a screen would not mean editing a test.
It was reading the built `InkWell`s — and a `ListView` does not build what is
off screen. So the walk had been covering one screenful and passing, over a
smaller fraction of the hub with every screen added, for four increments. It
did not fail when the hub grew. It just stopped looking.

Now it scrolls the list, collecting keys a screenful at a time, and it takes 22
seconds instead of 3 — which is roughly the ratio of what it was actually
checking. The count is still not asserted; one anchor is, that the walk's last
row is the hub's last row. That fails if the walk stops early and does not have
to be edited to add a screen.

Two smaller things fell out. `ensureVisible` rather than
`find.byType(Scrollable)`, because four tabs are alive in an `IndexedStack` at
once and the ambiguity is invisible from the screen. And a pop has to scroll
back to the top: the offset a row needed survives the route, so the heading the
test recognises the hub by was no longer built.

### Sync is out of scope, and what that leaves behind

The transport was never written and now will not be: cloud sync is cut from the
project. The Flutter half went with it — `sync.dart`, its bridge and its 21
integration tests were 1,125 lines wired to no screen, and dead code that nobody
can reach is worse than no code.

The **core** half stays: `engine.rs`, `sync.rs` and `merge.rs`, with 13,895
parity cases between them. That is not sentimentality about work already done.
They cost nothing at runtime, they are the most thoroughly verified thing in the
crate, and if a different backend ever turns up the hard half — the field-level
merge, the watermark, the order of operations — is already proven against the
shipping TypeScript rather than merely written.

`rows.rs` is not sync code at all, whatever its origin: `entry_to_value` and
`entry_from_value` are what persistence uses to write and read the ledger file.

One consequence worth naming, because it will look like an oversight later: the
ledger still stamps `fieldTs` on every field it writes. Those stamps exist for a
merge that no longer happens. They are kept because the ledger's stamping is one
mechanism — `Ledger::update` does not know why it is stamping — and because
removing them would invalidate the ledger corpus to save a few bytes per row.

### The first function the timezone rule had to cut in half

Every screen so far has taken calendar days as arguments: "the timezone is the
platform's" has meant Dart computes a day and hands it over. `run_subscriptions`
is the first port where that is not enough. It walks forward through dates it
discovers as it goes, and needs each one as an epoch — so the closure the core
takes for that cannot be supplied from Dart at all, because a `#[frb(sync)]`
function cannot call back into it.

So the sweep is two calls. `subs_pending` answers with dates, Dart converts each
to local midnight, `subs_commit` posts. Two things make the split safe rather
than merely convenient:

* **The cap is one implementation.** `apply_cap` came out of the sweep so both
  halves use it. Applied in only one of them, a fully-paid instalment fires once
  more on the way through.
* **`commit` recomputes the plan** from the same `starts` and `today` rather
  than trusting anything held between the calls. Two calls that must agree are
  safer when neither remembers the other, and a date with no epoch supplied is
  skipped rather than guessed at.

A fixed UTC offset would have avoided all of this and been wrong: the charges
being caught up may span a daylight-saving boundary, which is exactly why the
core takes a closure instead of an offset.

### A screen that has to be wrong about February

`next_due_date` overflows rather than clamping, because `new Date(y, m, 31)`
does. A subscription billed on the 31st charges on **3 March** in a non-leap
year, not on the 28th of February. The form clamps its input to 1..=28 so the
picker cannot produce one — but a restored backup can, and the port keeps the
overflow rather than quietly improving it.

The charge id is the other inherited oddity worth keeping: `sub_{id}_{ts}`,
derived rather than random. Boot runs the sweep while the first cloud pull is
still in flight, so a second device charges from its own stale cursor before it
learns the first already did. With random ids both rows survive the merge and
the user is billed twice; with a derived id they are the same row.

### `Number(s)` is not `str::parse`, three ways at once

The backup corpus was the smallest one written — four rules about filenames —
and it found more JavaScript semantics per case than any before it. All three
were mine, and all three were in one line: I read the timestamp out of
`backup_1700.json` with `parse::<i64>()`, where the TypeScript uses `Number(s)`.

* **`Number('')` is `0`.** Not an error, not `NaN`. So `backup_.json` is the
  *oldest* backup — it sorts last and is pruned first — while my version treated
  it as unorderable and put it at the end, to be pruned last. The two answers
  are opposites, and the wrong one keeps a nameless file forever while deleting
  a real backup.
* **`Number('12.5')` and `Number('1e+21')` parse.** An integer parse fails on
  both.
* **Rust's parser takes `inf`, `infinity`, `nan` and `NaN`;** JavaScript's takes
  none of them. `Number('nan')` is `NaN` because it is *unparseable*, not
  because it spells one.

1,096 divergences, down to 4, down to none. `num::js_number` joins `js_round`,
`js_num` and `js_max` on the list of things that look like a one-liner and are
not.

The last four were not made to go away by trimming the corpus. `backup_name`
took an `i64`, and the TypeScript takes a JS number and interpolates it — so
`backup_12.5.json` is a name it can produce. The signature is `f64` through
`js_num` now: the difference removed rather than hidden.

### A sort that was not a total order, again

`backups.sort((a, b) => b.time - a.time)` is fine until a name has no number in
it. Then `time` is `NaN`, the comparator returns `NaN`, and ECMA-262 leaves the
result implementation-defined from there — so a stray `backup_draft.json` in the
directory made the sort, and therefore the *prune*, arbitrary. A backup could be
deleted while a file named after nothing was kept.

This is the same failure `domain/order.ts` fixed for amounts and the same fix:
rank the unorderable value explicitly, at the end, where pruning reaches it only
after every real backup is safe. Applied to the TypeScript alongside the port,
so the two agree about a case neither had an answer for before.

### What encryption cost, and why it is not here

The shipping app encrypts backups with AES-256-GCM over a PBKDF2-SHA256 key.
Porting that would cost `dahonghua-core` three dependencies against the one it
has — and that one, `regex-lite`, was chosen for wasm size. A cipher is also not
a decision the ledger needs to own: the filename says whether a file is
encrypted, and what that means belongs to the platform.

So local snapshots are plain, and the screen says so rather than offering a
switch that does nothing. An encrypted snapshot restored from an older install
still *lists* — a row that silently vanished would read as data loss — with its
restore button disabled rather than absent.

### The emulator was the slow thing, and I blamed the tests

The integration suite went from 17 minutes to 38 over several increments. I put
it down to load, and on the strength of that widened the margins in a timing
test — which was the right change for the wrong reason.

The real answer arrived when a run failed with `Connection closed before test
suite loaded`: `dumpsys` could not reach its own services, `logcat` was hours
stale, and installing one APK took 57 seconds. The emulator had been degrading
for hours. A cold restart put the same suite back at 19 minutes and the backup
file at 8 seconds.

Worth naming because the misattribution was cheap only by luck: the test change
stands on its own. **A measurement that drifts is a fact about the instrument
until proven otherwise.**

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

## Phase 2, finished — persistence moves to Rust

The plan said `rusqlite` and the core owning the bytes. It took until now
because the JSON files worked, and a thing that works is the hardest kind of
thing to justify replacing.

What they could not do is write *part* of a ledger. Every change re-serialised
every entry and pushed the whole array back through the filesystem — fine at a
hundred entries, wrong at ten thousand, and it degrades gradually enough that
nobody notices the day it starts mattering. Everything else about them was
good: atomic through a temp file and a rename, debounced, and refusing to
overwrite a file they could not read.

### The crate is not `core`

`dahonghua-store` is a new workspace member depending on `dahonghua-core` and
`rusqlite`. It is deliberately not inside `core`, which still has exactly one
dependency.

The parity corpus is the reason. `core` is the crate whose every answer is
checked against the TypeScript, and a crate that can touch a disk is a crate
whose answers depend on one. Persistence is not domain logic; it goes on the
other side of that line, and `core` stays a pure function of its inputs.

`bundled` compiles SQLite from source for each Android ABI rather than linking
the platform's. Android ships its own libsqlite3, and using it would make the
storage format depend on which Android version the phone is running — the one
thing a ledger file must not depend on. It costs 2.7 MB in the arm64 library.

### The rows are documents

`entries` has five columns and one of them is the entry, as the app's own JSON.
Not twenty-five columns, which is what "we moved to SQLite" usually means.

The app does not query in SQL — `core::Ledger` holds the ledger in memory and
answers everything there, so a wide table buys queryability nothing asks for.
The encoding in `core::rows` is already the on-disk shape and already checked
against the TypeScript, so a backup from either build stays readable by the
other. And `Entry` grows: a wide table needs a schema migration every time a
field is added, written under time pressure against someone's only copy of
their data. What *is* a column is what gets ordered or searched — the id, the
timestamp, and the two sync stamps.

### Which rows get written, and the risk that carries

The bridge keeps a dirty set. A mutation that forgets to mark its rows saves
nothing, silently, and the loss only appears after a restart — so the rule is
that doubt resolves in one direction: any operation that can touch rows it was
not handed marks **everything**. A delete cascading to refunds, an account
removal reassigning entries, a base-currency change re-denominating the ledger,
any bulk import. Only operations whose blast radius the core reports exactly —
and `RemoveUndo` reports it exactly, which is what `child_ids` and
`refunded_id` are for — get a narrow mark.

The check that matters is not the dirty count. It is `restart()` in the tests:
save, drop everything in memory, reopen, and look for the change. Removing the
mark from `update_entry` fails two tests, and the one worth having is the
restart, because it is the one that demonstrates the data was actually lost.

### Two things this got wrong first

**The Android build went green having compiled nothing.** The function proving
the store was linked returned `SCHEMA_VERSION` — a `const`, inlined at the call
site, so the constant reached the APK while every line of SQLite was dead-
stripped behind it. The same shape as the release build's silent `logger.warn`:
a check that cannot fail is not a check. Opening a real connection and reading
the pragma back is a claim the linker cannot satisfy by inlining, and the arm64
library then contained SQLite 3.46.0 and 940 references to it.

**An empty legacy file became readable.** The JSON build refused an empty
`entries.json`, because that is what a write killed partway leaves behind and
not what "no entries" looks like. The migration lost that: an absent file and
an empty one both arrive in Rust as `""`. The distinction is file-shaped, so it
is drawn on the side that holds files.

### The old files are kept

Migration is one-time, marked in the database rather than by the files' absence,
and the JSON is **not deleted**. This is the first run of new storage code
against the only copy of someone's ledger; two files cost a few hundred
kilobytes and being wrong costs everything. A later release can remove them,
once this one has been run for a while by someone who would notice.

## Sync, without a server

The plan assumed Supabase, because that is what the React Native build uses.
It is not what this one uses: sync is a **file**, and the app never talks to
anything.

The app writes a document; you put it wherever your files already follow you —
a cloud folder, WebDAV, a USB stick — and the other device reads it, merges,
and writes it back. Carrying the file is the user's job, and the folder they
already sync is better at it than anything this app could build.

The consequence worth the section: `AndroidManifest.xml` has said since the
capture work that the only thing this app reaches the network for is an
exchange rate. That statement survives. A ledger can still end up in a cloud
folder — but because someone put it there, not because this app sent it. Every
other transport would have required editing that comment, and a claim about
where a person's money data goes is not a comment worth weakening.

### The hard part was already done

`merge_by_id` carries this, and it is the most heavily checked function in the
project: 7,043 parity cases, plus 4,539 for the wire shape it reads. Field-
level last-write-wins where both sides carry stamps, whole-row newest-wins
where they do not. Nothing about the merge is new. What is new is the envelope.

### What syncs

Entries, and accounts. Not the rest of the config.

Accounts merge as a **union by id** rather than through `merge_by_id`, because
an account carries no `updatedAt` and there is nothing to compare. Both sides
keep everything either had; on a collision the local copy stands. That never
loses an account and never leaves an entry pointing at one that does not exist
here — which is the failure that matters, since an entry names its account.

It does not carry a rename across. That is a real limit, it is the safe
direction to be wrong in, and fixing it needs the per-section stamps
`core::sync::adopt_sections` expects — which this build does not yet maintain.
The screen says so rather than leaving it to be discovered.

Rates, budgets, reminders, the theme and the lock do not sync at all. They are
per-device settings more often than not, and a whole-blob newest-wins would
silently drop whichever side wrote second.

### The order is the design

Merge, then write. Writing this device's copy over the file without merging
first is how the other device's entries disappear, and it is the only way to
lose data with this feature. So the screen numbers the steps, puts reading
first in the layout, says why in both languages — and a test asserts that the
merge button sits above the write button. A screen that led with "write the
file" would be a screen that suggested the destructive order.

### An injection found a missing test

Two injections. Making the merge take the document wholesale failed four tests,
including the two that represent real loss.

Dropping tombstones from the written document failed only **one** — and that
was the finding. The tests covered a deletion made on *this* device surviving a
document that still had the row, and never covered the other direction: the
other device deletes, this one still has it live. That is the direction a
tombstone actually has to travel. Without it in the document this device never
learns the row is gone, and the next write-back hands it back to them. With the
test added, the same injection fails two.

### What a file cannot do

Two devices writing the document at the same moment is a conflict the file
cannot resolve; a sync folder keeps both copies under different names. That is
survivable rather than fatal — the merge is idempotent and order-independent,
so merging both copies in either order converges. Worth knowing, not worth
preventing.

## Phase 5 — shipping it

Everything above is about whether the app is right. This is about whether it is
installable, which turns out to be a different question with its own set of
things that can be quietly wrong.

The Flutter scaffold ships defaults that work and are all incorrect: the app
installs as `flutter_app`, wearing Flutter's own icon, opening onto a white
rectangle, signed with the debug key. None of that fails a build. All of it
fails a user.

### Identity

`applicationId` moves from `com.dahonghua.flutter_app` to `com.dahonghua.app`,
which is what the React Native build already publishes as. This is the same
app — a rewrite of the inside — and shipping it under a second package name
would put two 大红花记账 icons on one home screen, each with half a ledger.

The `namespace` stays `com.dahonghua.flutter_app`, because that is where the
Kotlin actually lives. The two are allowed to differ and now do, so every
class name in the manifest is written out in full rather than as `.MainActivity`
— a relative name resolves against one of the two, and a reader should not have
to remember which.

There is a consequence and it is not small: **installing over the existing app
requires the key that app was signed with.** EAS holds it. Without it, Android
refuses the update on a signature mismatch and the path is uninstall, install,
and carry the ledger across in the JSON backup. That export was built for other
reasons and turns out to be the migration path too.

### The icon and the splash

Generated by `flutter_app/tool/gen_icons.py` from `assets/images/` — the same
files the React Native app uses. Pointing both at one source is how the icon
survives the rewrite instead of drifting.

No generator package. It is four images resized into five density buckets, and
a package that did it would still leave the numbers — 48dp legacy, 108dp
adaptive with 18dp of croppable bleed, 140dp splash mark — written down
somewhere. They are written down in the script, next to what they mean.

The splash colour is a resource with a `values-night` variant, so one
`launch_background.xml` covers both themes: the OS picks light paper or dark
ink before any of this app's code has run. The launcher icon deliberately does
*not* follow night mode — an icon that changed colour with the system theme
would stop being the thing users look for.

### Signing

`key.properties` is gitignored and this repository will never contain a
keystore. Absent one, the release build falls back to the debug key — and the
interesting part is how it says so.

The first attempt was `logger.warn`, which turned out to print nothing:
`flutter build apk` swallows Gradle's logger below `-v`, so the fallback was
silent in exactly the case it needed not to be. That is the trap the paragraph
was written about, reproduced by the paragraph's own fix.

So the build stamps the artifact instead: `versionNameSuffix = "-debugsigned"`,
which shows up in Android's own app info and in `aapt dump badging`. A warning
that travels with the APK still exists three months later on a phone; a line of
terminal scrollback does not. This matters because a debug-signed APK cannot be
updated by a properly signed one — the failure arrives long after the mistake
and does not look like signing.

`android/README.md` covers making the key, and the fact that losing it ends the
app's ability to update at all.

### What is deliberately not done

`isMinifyEnabled` is off. The Rust core holds the logic and what remains in
Dart is UI, so there is little to shrink and a real chance of R8 removing a
plugin class that only reflection can see. A stripped APK that crashes on one
screen is worse than a large one that does not.

iOS is not built. The user has no iOS device to test on, and shipping a binary
nobody has run is not shipping.

`debug` gets no `applicationIdSuffix`, which is a decision with a shelf life.
Today every build here is signed with the debug key, so the release APK and the
integration suite's debug APK replace each other cleanly. The day a real
keystore exists that stops being true — same package name, two signatures, and
the second install fails. The fix is one line, `applicationIdSuffix = ".debug"`,
and it is not written yet because it moves the package name the notification
listener is granted under, which would silently un-grant notification access on
every device the suite runs on. Worth doing deliberately, with the grant
re-checked, rather than as a footnote to a packaging commit.

## Rules while both trees exist

- The TypeScript app stays shippable and green the entire time. It is the
  reference implementation, and it is what users are running.
- Nothing is deleted from `src/` until its Rust counterpart passes parity **and**
  is wired into a running build.
- Every ported module joins `npm run parity`. A module without a corpus is not
  done.
- `cargo clippy -- -D warnings` and `cargo fmt --check` gate CI alongside the
  existing lint/typecheck/test jobs.
