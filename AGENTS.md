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
    npm run rust:test     850 tests
    npm run rust:clippy   -D warnings
    npm run bridge:clippy the bridge is a separate cargo project
    npm run tests:check   all_test.dart is not stale
    npm run apk           the release APKs, one per architecture

    cd flutter_app
    flutter test integration_test/all_test.dart    755 tests, ~7 min
    flutter test integration_test/<one>_test.dart  while working on one screen

The suite is one entrypoint on purpose: per file it was 36 APK builds and about
twenty minutes. Add a test file and re-run `node scripts/gen-all-tests.js`.

## Shipping a build

`npm run apk`, not `flutter build apk`. The plain command makes a **universal**
APK — 67MB, of which 63MB is three copies of the same two native libraries, one
architecture of which any given phone ever loads. Split, the arm64 build that
goes on the phone is 25MB.

The reason it is a script and not a flag is the versionCode. Flutter offsets it
per architecture, so the arm64 split is **2001** where the universal build is
**1**, and Android will not install a lower versionCode over a higher one.
Once a split APK is on a phone a universal one can no longer update it — it
fails with a parse error, and the way out is an uninstall, which on a
debug-signed build takes the ledger with it. So the choice is made once and
kept, and the script deletes any stale `app-release.apk` so the wrong file
cannot be sent by accident.

**`app-debug.apk` in that same folder is not a phone build.** `flutter test`
leaves it there, built for the emulator it ran on, and after a clean it is the
only APK in the folder. It was sent, and it crashed on launch: Flutter packed
its engine for x86_64 alone but let a plugin's library through for all three,
so an arm64 phone accepted the file and then found no engine it could load.
`build.gradle.kts` now narrows `abiFilters` to the build's `target-platform`,
so that file is refused at install instead — but the one to send is still the
one the script names.

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

**The config had the same hole, and nobody looked.** It was written only when
`dirty_config` was set, and four setters set it — the currency table, the
current account, accounts, sync. The theme, the budget, templates, tags,
assets, loans, subscriptions, reminders, the language and the lock did not, so
every one of them came back as a default on the next launch unless something
that did mark was changed after it. The one persistence test that touched the
lock checked a snapshot, which held it, rather than a restart, which did not.

So the save no longer trusts the mark. It snapshots the config — one small row
— and compares it with `written_config`, what the disk holds; a difference is
written whatever marked it or did not. A setter added next year cannot forget,
because it is not asked. `persistence_test`'s "every setting survives a
restart" goes through a real save and reopen for each, and clears the three
settings `store.reset()` does not (theme, lock, reminders) by hand — without
that, the group could not fail for them.

## Drawing the chrome

`core::glass` owns the material's arithmetic and `lib/glass.dart` draws it.
Two pieces, and the second is easy to get wrong:

`Glass` is a surface — blur, wash, vibrancy, rim, grain. `GlassScrim` is the
**ground it stands on**: 渐进模糊, a blur that ramps from nothing to deep so
content dissolves into the chrome instead of being clipped by it. Nothing this
app draws on has a progressive blur, so it is built out of six nested clipped
`BackdropFilter`s. **Blurs compose by variance** — σ=3 then σ=4 is σ=5, not 7 —
so the per-band sigma is `core::glass::scrim_bands`, not `sigma / bands`.
Dividing evenly ramps as √k and puts the whole transition in the top two bands.

**And every band fades in.** A clipped band starts at full strength, so the
blur jumps at its edge in one pixel row, and across text that is a line —
sharp above, soft below, six times down the ramp. It shipped like that, it was
reported as "一层一层的", and no test noticed, because every number in it was
right. Each band now paints a `ScrimBandMask` into its own backdrop layer with
`BlendMode.dstIn`: nothing at its `top`, full strength at its `full`, where
the next band starts. The sigmas say how deep; the masks say gradually.

**And the bands share one capture.** A backdrop blur reads what is already on
the screen, and on a phone's GPU that read is a break in the render pass —
everything so far written out so it can be sampled back. Six nested bands were
six of those per scrim; a tab has two scrims, a bar and a lens, and a route
transition draws two screens. So each scrim keys its bands to one
`BackdropKey` and they blur one capture, and a band applies `depth` — the blur
seen through it — instead of `sigma`, the step it adds when nested. The masks
make the two the same picture, and the tour is how that was checked: the
emulator cannot measure it (below), so it was looked at.

The ramp lives in the `fade` at the shallow end and holds full depth beyond it.
A scrim is sized to the chrome it belongs to plus that fade, and for a header
with a hard bottom edge it is sized to the header alone — otherwise the
transition lands below the bar and blurs rows nobody has scrolled near. A
header also ramps over `header_ramp`, not `fade`: with 72dp of ramp in a
~105dp header the bar's title stood over text blurred to σ≈3, still legible.
The bottom bar's ground starts `foot` (28dp) above the bar and ramps to the
bar's middle (`foot_ramp`): at `fade` it reached most of a bar-height up the
list, and the report was that the blur came up too high.

Screens do not assemble this themselves. **The four tabs use
`TitledScaffold`**: a 26px title at the start of the bar and the actions at its
end, on one row — 大红花记账 and its three buttons side by side. They used to
disagree (20px app-bar titles on two tabs, 26px in-list titles on the other
two); the first fix put a large title under a bar of actions, with a small copy
fading in when it scrolled away, and that spent a row on a word. `shell_test`
holds all four to one row, the actions beside the title. **Pushed screens use
`ScrimScaffold`**, the same transparent bar and scrim with a back arrow and a
small title.

In both cases **the body pads its own top** by `headerInset`, and a titled
body puts `b.header` — the subtitle, if there is one — first; that cannot be done from outside, because padding
wrapped around a scrollable moves the viewport rather than its contents, and a
viewport that starts below the header has nothing running under it.

Two things follow from a body that runs behind a header, and both bit:

* **The header absorbs taps in its own strip.** That is right — chrome
  absorbs, here and in every app on the phone — but `scrollUntilVisible` stops
  at "inside the viewport", which now includes "under the title bar". Tests
  press things through `scrollAndTap` in `integration_test/scroll.dart`, which
  measures the target's *own* screen's bar: all four tabs live in an
  `IndexedStack`, so a bare `find.byType(AppBar)` matches four.
* **A transparent app bar picks the wrong status-bar icons.** `AppBar` derives
  `systemOverlayStyle` from its own background, and `Colors.transparent` reads
  as dark, so it asks for white icons on cream paper. `systemOverlay` in
  `theme.dart` answers from the palette instead, and every bar declares it.

**Look at it before and after.** `integration_test/tour.dart` seeds a month
somebody might keep and screenshots all nineteen screens in both rooms, as real
surface captures — so the glass renders — into `build/tour/`:

    flutter drive --driver=test_driver/tour.dart --target=integration_test/tour.dart -d <device>

It found a net-worth card whose numbers were invisible in 夜间模式, which no
test had looked at because no test had looked at anything in the dark. It
tours 大红花 unless told otherwise; `--dart-define=TOUR_FLOWER=forest` (or any
other flower) tours that one, and 森林 is the one to look at — see below.

## Pressing things

`Tap` is the app's press feedback: an ink veil on a filled surface, a dim on a
bare glyph. Sixty-four Material widgets were not going through it, so the app
had two press languages — the veil on its own rows and Material's expanding
ripple on every button, icon button and list tile.

That is fixed in `appTheme()` rather than at sixty-four call sites:
`splashFactory: NoSplash`, the same ink at the same alpha as `Tap`'s as a
`ButtonStyle` overlay, and the same again as `highlightColor` for `ListTile`
and any bare `InkWell`, which read the ambient theme instead of a button
style. A widget added next year gets it without being told — and `theme_test`
holds the numbers, because nothing else would notice them going.

**A delete asks first**, and says which row: `confirmDelete` in `toast.dart`,
on the swipe, on the ⋯ menu and on the selection bar. A swipe is the cheapest
gesture in the list and the one most often made on the way to scrolling.

**The notices are capsules**, the phone's own shape — a small pill low on the
screen, the flower, a few words, the action at the end — rather than a
Material slab across the width. Not the system's `Toast` itself: since
Android 11 a toast carries text and nothing else, and 撤销 is the reason 已删除
is said. `showToast` draws it on a transparent floating snackbar, which is what
already knows where the bottom bar is and keeps a notice alive across a pop.

The tour's new delete shots found the bug these had been hiding. **The shell
recreates the list on every change**, so the 撤销 in a notice belongs to a list
that is gone by the time it is pressed: it put the row back and then called
`setState` on a disposed state, every time, in every build. Every test of it
showed the list on its own, where nothing recreates anything. A callback that
outlives its screen checks `mounted`, and `shell_test` presses 撤销 in the
shell.

## Saying "too much"

The flower is the accent, and for years it was also the warning: an overspent
budget, a balance below zero, "比上月同期多", a missing permission, a delete.
In 大红花 those are the same red. In 森林 the flower is green — the leaf's
green, which is what this app says "in" and "on track" with — so the tour
showed a card ¥3,120 in debt, a budget ¥24 over and the month's salary all in
one colour. 茉莉 is the same green-grey, and 海洋's blue does not warn at all.

`palette.warn` / `warnDeep` is the warning, and `core::theme::warn` decides
it: a warm flower warns in itself, a cool one borrows 大红花's red. It is a
rule on the hue rather than a table, so a flower added later is answered for,
and the core test states the property — no warning within 90° of the leaf.
**Paint the accent with `hibiscus` and the alarm with `warn`.** If you are
choosing between them, ask whether the thing would still be right in green.

The same screenshot found 明细's summary slab painting 花掉 and 进账 in the
deep tones at night — about 2.4:1 on a dark slab, and in 森林 both green. The
slab is dark in both rooms, so its tones lift toward the light colour in both,
and its numbers follow the rows: spent in ink, in in the leaf. `home_test`
holds every flower in both rooms to 4.5:1, and the pair apart by lightness —
which is also what a reader who cannot tell red from green has to go on.

## Moving the chrome

`core::liquid` is the same arrangement one step further out: `glass` says what
the material looks like standing still, `liquid` says what it does when a
finger pushes it. The selected-tab indicator is a lens with a position of its
own — not a value derived from `active`, which can only ever teleport between
four places.

Three rules live there because all three are easy to write differently:

* **Stretch conserves area.** `scale_y = 1 / scale_x`. A lens that stretched
  without thinning is a lens that grew, and growth reads as a scale animation
  rather than as momentum.
* **The shadow trails.** Signed against the direction of travel. This is the
  whole of "可拖动的阴影" — a tint with no shadow is a hole, and a shadow that
  moves *with* the object is a shadow painted on it.
* **A flick lands where it was heading**, not on the nearest tab: `x + v *
  fling`, then the tab under that.

The lens fills its tab — icon and label, the bar's height less an inset. It
was a 46×30 pill behind the icon, which lit part of the icon and none of the
label. And `Segmented` — 记一笔's 支出/收入/转账, 统计's windows — has the same
thumb: it follows a finger, lights the segment under it, springs and
stretches by the same rules, and chooses **once, on release**, not once per
segment crossed: 统计 reads the ledger again for each answer.

And a test note that cost an hour: **`TestGesture.moveBy` stamps every event
`Duration.zero`**, so a hand-built flick reports a velocity of zero however it
is spaced with `pump`. Use `tester.fling` and `tester.drag`. `pumpWidget`
twice in one test also reuses the element and therefore the lens's position —
give the two trees different keys.

## Changing the store under a screen

"The screens 我的 opens stutter" was measured before anything was changed, with
`integration_test/perf.dart` in profile mode (`--no-dds`, or it cannot reach
the VM service). Two findings, and the first is a warning:

* **The emulator's raster times are the emulator's.** They moved from 18ms to
  45ms between identical runs and barely at all with every blur in the app
  switched off. Only build times — the UI thread — were worth reading there.
  GPU work has to be judged on a phone, or reasoned about, as the shared
  capture above was.
* **The build side was the shell.** Every change a pushed screen reported
  bumped one version that keyed all four tabs, so all four read the whole
  ledger again — 89ms at 3,000 entries, under the finger of whoever was using
  设置 — and every config change rebuilt `ThemeData` and with it every widget.

So `_invalidate` recreates **the tab under the route now** (it is what the
route reveals, and 明细 must have the entry the sheet just saved) and the other
three **one a frame, after the route's exit animation has finished** — a
refresh in the first frame of going back is what made going back stutter.
The root rebuilds only when the flower, the room or the language moved.
Tabs that are not showing do not tick. And `LedgerDays` keeps every live entry
and its day until `store.revision()` moves, which every write access does:
seven screens began by fetching and converting the whole ledger, and most of
the time nothing had been written since the last one had.

At 3,000 entries the worst frame opening or closing a screen from 我的 went
from 20–58ms to 4–10ms, and a setting changed with 设置 open from 132ms to
16ms. Run it again before believing a change to any of this is free.

## Looking things up

`Ledger::get` is a linear scan over `entries`. That is fine once; twelve call
sites in the bridge called it **once per id in a list that was itself the whole
ledger**, which is O(n²). At 5,000 rows `list_items` alone took 218ms — on
every record, every delete and every keystroke in the search box — and 统计,
预算, 报销, 报表, 结算单, 导出 and 搜索 all had the same shape.

`api::store::by_id` builds the map once and hands out constant-time lookups.
If you are about to write `ledger.get(id)` inside a loop over ids, take that
instead. It uses `or_insert` rather than `collect` so a duplicated id resolves
to the same row the scan would have found — first, not last.

The sweep missed one. `rows_of` in `api/stats.rs` did the same thing with
`iter().find` instead of `get`, so a search for `ledger.get` did not find it,
and 统计's trend took 1.6s at 8,000 rows. Search for the shape — a lookup by
id inside a loop over ids — not for one spelling of it.

`scale_test.dart` holds it, with a clock, and the header there explains why a
timing assertion is the right tool for once: a quadratic list and a linear one
return byte-identical answers, so no correctness test can tell them apart.

**Duplicate ids are not coherent, and that predates `by_id`.** `Ledger::add`
pushes without checking, so a ledger can hold two rows with one id. Rust
resolves them first-wins (`get`, `by_id`); the entry list draws from a Dart map
literal, which is last-wins. Tap a duplicated row and the sheet opens the
other copy. Nothing creates duplicates on purpose, and `get` already returns
tombstones — this is a core-level question pinned by goldens, not a bridge
fix. Written down so the next person does not rediscover it through a test
that passes when a millisecond happens to tick.

## Where the ledger can go

Off the phone only when somebody sends it. 备份 writes snapshots **inside the
app's own storage**, where an uninstall takes them — and installing a properly
signed build over a debug-signed one requires exactly that uninstall — so every
snapshot has 导出, which hands it to the share sheet. 同步 writes a document.

Android's Auto Backup is the exception that used to exist silently.
`allowBackup` defaults to on, which uploaded the ledger to the user's cloud
backup while the manifest claimed nothing left the device unless someone sent
it. `res/xml/data_extraction_rules.xml` turns cloud backup off and leaves
device-to-device transfer on (API 31+); `backup_rules.xml` turns both off below
that, where they were one mechanism. If you add a data directory, it is
already excluded — each domain is listed rather than trusting `root` to cover
its children.

## What the port dropped

The rewrite ported every screen, and the screenshot tour is how a missing
*control* turns up rather than a missing screen. 记一笔 had no date field: every
entry was stamped "now", so a taxi forgotten yesterday could only be recorded
as today's, and a ledger that files yesterday's lunch under today has wrong day
totals. The form had carried a `ts` the whole time and `core::record` even had
a test for a pre-picked date — only the control was gone.

`lib/date_field.dart` is that control, rebuilt from `DateField.tsx` at
`rn-final`, with one change: it lives in the amount card rather than expanding
in place, because the sheet's fields already fill the space above the keypad
exactly. `core::record::day_name` decides which of 今天/昨天/前天/date a day
gets and `pickable` decides that the future is not one; composing an instant
on another day at the same time of day is the timezone's job and stays in
Dart.

统计 was the same gap on a larger scale. The port drew three of the shipping
screen's nine sections: totals, one polyline, one donut. `StatsView.tsx` also
had the entry count, every category rather than six, the last six windows,
the largest entries, weekday and time-of-day breakdowns, and this month
against the same days of the last. The core had the arithmetic for all of it
and the corpus pinned it; what was missing was the bridge and the drawing.
`api::stats::stats_page` is now one call for the whole screen, and
`lib/charts.dart` scales a box and chooses colours.

Three decisions the screen used to make, or not make, now sit in the core:

* **The curve is `chart::smooth`, monotone cubic.** The obvious curve
  (Catmull-Rom) overshoots, so a day of nothing between two big days dips
  below the axis and the chart shows negative spending. The tests check the
  property directly: every control point stays inside its segment's range.
* **`period::trend_axis` decides what a window's chart covers.** A window
  still under way stops at today, a day is charted as the week up to it
  (one point is not a trend), and half-years and years go weekly. The first of
  these used to be `_clampToToday` in Dart.
* **`stats::verdict` decides between "more", "less" and "about the same"**
  (5%). That was in the shipping view, where the corpus never recorded it.

明细 had lost its head the same way: `LedgerContent.tsx` put `SummaryCard`,
`BudgetPot` and `InsightBanner` above the rows, and the port kept only the
rows. `api::home` is one call for the three; the cycle is chosen there, from
the setting, so the head and 统计 cannot disagree about when this month began.
`budget::pot_mood` says whether the flower is fresh, wary or wilted (80% and
100%, the shipping card's thresholds), and `budget::lead_tier` that it follows
the cycle's pot, or today's when that is the only one set. The eye — 隐藏金额,
`hideAmounts` in the config as it was in the shipping settings — hides the
totals on 明细, 资产 and 账户 through one function, `lib/amounts.dart`, and
leaves the rows alone.

Its second face was gone too: a toggle turned the rows into the month
(`CalendarView.tsx`). `core::calendar` is that grid — the cycle's days, the
Monday-first blanks, what each spent, which are ahead of today — and one
addition, `heat`, which shades a day by the **square root** of its share of
the biggest day. Shaded in proportion, a rent day is the only day that shows;
the root keeps the order and lets the lunches be told apart. The calendar's
state lives in the route's `PageStorage`, because the shell rebuilds 明细
after every save and 补记这天 is a save made from the calendar.

预算 had lost its forecast: `BudgetForecast.tsx` said 日均, 月末预计 and
每天还能花 under the cycle's card. `core::budget::forecast` is that, with the
judgement ("on track" is landing at or under the cap) where both screens can
reach it, and `pace_chart` adds what the shipping card never had — the spent
line against the line that lands exactly on the cap, and the dashes from today
to where the pace so far is heading, on one scale so the projection cannot run
off the top.

And a recorded entry used to be rewarded: a dozen small flowers out of the +
button (`PetalBurst.tsx`), and the templates sat above the rows as one-press
chips (`TemplateChips.tsx`). `core::burst` is the burst's shape, seeded, with
the shipping `mulberry32` ported bit for bit — its reference values are taken
from Node running the JavaScript, because the first set was recalled and one
of three was wrong. A test that looks for the flowers mid-flight is a test of
the emulator's frame times, so `burst_test` counts `PetalBurst.planted`.

Worth checking the rest of `rn-final` the same way when something feels thin.

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
