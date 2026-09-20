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
    npm run rust:test     796 tests
    npm run rust:clippy   -D warnings
    npm run bridge:clippy the bridge is a separate cargo project
    npm run tests:check   all_test.dart is not stale
    npm run apk           the release APKs, one per architecture

    cd flutter_app
    flutter test integration_test/all_test.dart    667 tests, ~5 min
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

The ramp lives in the `fade` at the shallow end and holds full depth beyond it.
A scrim is sized to the chrome it belongs to plus that fade, and for a header
with a hard bottom edge it is sized to the header alone — otherwise the
transition lands below the bar and blurs rows nobody has scrolled near.

Screens do not assemble this themselves. **The four tabs use
`TitledScaffold`**: a slim transparent bar holding only the actions, a large
28px title that scrolls with the content, and a small title that fades into
the bar once the large one has gone under — the HyperOS and iOS header, and
the one the reference screenshots show. They used to disagree (20px app-bar
titles on two tabs, 26px in-list titles on the other two), and `shell_test`
now holds them to one height. **Pushed screens use `ScrimScaffold`**, the same
transparent bar and scrim with a back arrow and a small title.

In both cases **the body pads its own top** by `headerInset`, and a titled
body puts `b.header` first; that cannot be done from outside, because padding
wrapped around a scrollable moves the viewport rather than its contents, and a
viewport that starts below the header has nothing running under it.

Two things follow from a body that runs behind a header, and both bit:

* **The header absorbs taps in its own strip.** That is right — chrome
  absorbs, here and in every app on the phone — but `scrollUntilVisible` stops
  at "inside the viewport", which now includes "under the title bar". Tests
  press things through `scrollAndTap` in `integration_test/scroll.dart`, which
  measures the target's *own* screen's bar: all four tabs live in an
  `IndexedStack`, so a bare `find.byType(AppBar)` matches four.

**Look at it before and after.** `integration_test/tour.dart` seeds a month
somebody might keep and screenshots all nineteen screens in both rooms, as real
surface captures — so the glass renders — into `build/tour/`:

    flutter drive --driver=test_driver/tour.dart --target=integration_test/tour.dart -d <device>

It found a net-worth card whose numbers were invisible in 夜间模式, which no
test had looked at because no test had looked at anything in the dark.
* **A transparent app bar picks the wrong status-bar icons.** `AppBar` derives
  `systemOverlayStyle` from its own background, and `Colors.transparent` reads
  as dark, so it asks for white icons on cream paper. `systemOverlay` in
  `theme.dart` answers from the palette instead, and every bar declares it.

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

And a test note that cost an hour: **`TestGesture.moveBy` stamps every event
`Duration.zero`**, so a hand-built flick reports a velocity of zero however it
is spaced with `pump`. Use `tester.fling` and `tester.drag`. `pumpWidget`
twice in one test also reuses the element and therefore the lens's position —
give the two trees different keys.

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
