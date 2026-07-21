# Changelog — usability pass + full audit (2026-07-21)

Two pieces of work: a usability pass on the recording flow, then a full-app audit.
**403 tests / 52 suites green, `tsc --noEmit` clean, eslint 0 errors.**

The audit is worth calling out separately: it started from a completely green tree —
typecheck, lint and 350 tests all passing — and still found 23 behavioral defects.
None of them were the kind a type system or a linter can see. Several were silently
losing data.

## Recording flow

- **Backdating** — a new `DateField` in the record sheet with 今天/昨天/前天 quick
  chips plus a picker, so an entry no longer has to mean "now".
- **再记一笔** — duplicate an existing entry from the detail sheet into a fresh one
  dated today, and **再记** saves without closing the sheet so a run of similar
  entries can be typed in one sitting.
- **Learned note chips** — the most-used notes for the selected category, ranked by
  frequency then recency, offered as tappable chips. No configuration.
- **Calendar backfill** — tapping a day in the calendar opens the sheet pre-dated to
  that day.
- **Archiving** — accounts and ledgers can be archived: they vanish from the
  new-entry pickers but keep their history and balance. The default account can't be
  archived (it is the fallback every orphaned entry migrates to).
- **Balance privacy** — an eye toggle masks amounts on the summary card and the
  asset/account screens for shoulder-surfing situations.
- **GBK bill import without a native module** — Alipay/WeChat CSV exports are
  GBK-encoded; decoding now falls back to a generated pure-JS table
  (`scripts/gen-gbk-table.js`), so import works in Expo Go.

## Data integrity (audit)

- **ID collisions on bulk inserts** — `newId()` was `Date.now()` plus 4 base36
  characters: about 1.7M of space *within a single millisecond*. A 1000-row bill
  import reliably minted duplicate ids, and duplicates silently collapse into one
  row on the next sync upsert (`onConflict: user_id,id`). Now counter-based.
- **Config changes were never uploaded** — the sync engine subscribed only to
  `store$.data` and `store$.settings`, but the config blob it pushes also carries
  accounts, assets, loans, subs, templates, tags, currencies, customCats, subcats,
  curLedger and lang. Creating an account and nothing else never reached the cloud.
  It subscribes at the store root now, and a new `profiles` realtime channel means
  another device's config edits arrive without a restart.
- **Restores were half-applied** — `importV7` replaced the ledger with *any* array
  that parsed (`{"data":[1,2,3]}` destroyed it), kept the backup's own `updatedAt`
  (v7 web exports have none, so restored rows sat below the push watermark and never
  synced), and reinstated only six settings fields — daily/weekly budgets, budget
  mode, garden goal, archived ledgers and privacy toggles were all silently reset.
  Rows are validated and malformed ones reported; the full Settings object is
  restored; both callers snapshot the ledger before the destructive replace.
- **Duplicate subscription charges across devices** — `hydrate()` runs
  `runSubscriptions()` at boot, racing the initial cloud pull, so a second device
  charged from its own stale cursor. Charge ids are now derived from
  (subscription, charge instant) so concurrent devices converge on one row.
- **Switching base currency corrupted every amount** — `Entry.amt` is *denominated*
  in the base currency, but the switch only relabeled it, so a CNY→USD change
  reinterpreted a ¥10,000 balance as $10,000. It now converts entries, balances,
  assets, loans, subs, templates and budgets, re-anchors the rate table, and refuses
  when no rate is available.
- **Two swallowed sync errors** — `pushConfig` never checked its upsert error, so a
  failed upload counted as success: status stayed "synced", no retry queued.
  `syncConfig` ignored its read error, and since a failed read is indistinguishable
  from "no config yet", a new device would push its defaults over an existing
  account's config. Both throw now.

## Features that only looked wired

- **Auto-backup was a no-op** — the settings screen has offered a toggle and a
  daily/weekly frequency since the feature shipped, but nothing ever read either
  value; `createBackup()` was reachable only from the manual button. Now runs at
  boot, honouring the toggle, the interval, and `maxBackups` (previously ignored in
  favour of a hardcoded 10).
- **Analytics recorded nothing** — `loadAnalytics()` was never called, so `loaded`
  stayed false and `trackEvent()` returned on its first line. Every event dropped.
- **Removed** the offline queue (`enqueueChange` had zero callers, so the engine
  branch consuming it was dead — offline already works via AsyncStorage plus the
  `updatedAt` watermark) and the unreferenced `Family*` types.

## Interaction and security

- **The save button failed silently** — a zero amount, an incomplete transfer or a
  currency with no rate produced no write and no message. Every rejection now names
  its reason.
- **The biometric lock failed open** — any exception from `authenticateAsync`
  unlocked the app, and some Android devices throw after repeated failed attempts.
  It also never re-locked, so one unlock held for the whole process lifetime. Now it
  stays closed on error and re-locks when the app leaves the foreground.
- **Undo-after-delete clobbered concurrent work** — it replayed a whole-array
  snapshot, rolling back anything added or synced in during the undo window. It now
  restores only the affected rows, by id.
- **Destructive dialog mislabelled** — the restore confirmation's *cancel* button
  read 删除这笔 ("Delete entry").
- **No fetch had a deadline** — the AI and exchange-rate calls could hang forever,
  leaving the quick-entry field spinning. Both use an `AbortController`.

## Performance

- `acctBalance` rescans the whole ledger per account, and the accounts screen, the
  assets screen and `netWorthParts` all called it in a loop — O(accounts × entries)
  per render. A batch `acctBalances()` does one pass; `acctBalance` delegates to it
  so the two cannot drift.
- `noteSuggestions()` scans the whole ledger and ran unmemoized on every record-sheet
  render, i.e. on every keypress of the amount keypad.
- Search filtered every entry on every keystroke; the input stays instant but the
  filter runs on a trailing value.
- In `EntryList`, `acctName` was rebuilt each render, invalidating the row callback
  and re-rendering every visible row on any parent state change; `Badge` was a
  component declared in the render body, so React remounted the badge subtree
  instead of updating it.

## Tests

- **Sync orchestration (`src/sync/__tests__/engine.test.ts`)** — `engine.ts` had no
  test file, and with no Supabase credentials configured locally it had never
  executed *at all*. 28 tests now cover it against a faked client: pull/merge/push
  ordering, cloud-config adoption, the device lock never crossing the wire, both
  realtime channels and their user filters, config-only changes actually scheduling
  a push (one case per synced key), the echo-suppression guard, stale and malformed
  realtime payloads, sign-out teardown, and the unconfigured no-op path. Writing it
  is what surfaced the two swallowed errors above.
- Regression tests for the id collisions (5000 draws in a tight loop), subscription
  charge dedupe, backup import validation/stamping/settings restore, `runAutoBackup`
  scheduling, and batch-vs-single balance agreement.
- **Fixed a Jest teardown leak** — `RecordSheet.test.tsx` never unmounted its
  renderers. Once the component became an `observer` that turned fatal: it stays
  subscribed, and the next test's store mutation re-renders the abandoned tree after
  the environment is gone, killing the worker.

### Note for deployers

No new migrations. `supabase/migrations/0003_field_ts.sql` is still the latest and
must be applied before shipping a field-level-merge build.

---

# Changelog — UX overhaul (2026-07-13)

Full-flow UI/UX pass focused on visual efficiency and operation logic.
**329 tests / 48 suites green, `tsc --noEmit` clean, eslint 0 errors; net −409 lines
and two runtime dependencies removed.**

## Visual efficiency

- **Home puts the ledger first** — on a 375×812 phone the entry list used to start
  *below* the bottom nav (8 fixed blocks stacked above it). The summary card, budget
  line, insight banner, ledger filter and template chips are now the list's own
  scrollable header (`EntryList` gained a `header` prop), so the first screen shows
  real entries and everything above scrolls away.
- **Compact budget card** — the 4-row 10px forecast table (duplicated/confusing
  numbers) shrank to one progress line + today line; the full forecast moved to the
  budget screen, which the card now opens on tap (chevron affordance).
- **Header decluttered** — 4 icon buttons → 2 (search toggle, settings). Language
  switch lives in Settings; insights/report entries moved into the stats tab.
- **Stats trend chart rewritten** in the app's own hand-rolled SVG voice — the old
  `react-native-chart-kit` line chart locked its width at module load (overflowed
  the viewport), ignored the period selector and spammed web warnings. Now titled
  "近 7 天走势", responsive, dependency-free.

## Operation logic

- **Global search** — the search icon opens a pinned bar; queries now span *all*
  months (was: current cycle only), with the summary header yielding space during
  a search. `/` shortcut preserved on web.
- **Removed three fake/broken entry paths** — the home quick-entry row hardcoded
  every entry to the 餐饮 category (data corruption); the voice and camera buttons
  in the record sheet were non-functional placeholder shells (mic listened 3s and
  dropped the result; photo OCR silently discarded). The real AI text entry stays,
  now a single compact row so categories are visible the moment the sheet opens.
- **Record sheet actions in one row** — [存为模板 | 贴朵花] (edit mode: [删除 | 保存]).
- **Settings grouped into 6 section cards** — 预算与周期 / 个性化 / 钱包与资产 /
  记账工具 / 数据与安全 / 其他 (was a flat 20-row list).
- **Analysis entries consolidated** — the stats tab gained a "更多分析" footer
  (AI 洞察 / 月度报告 / 本月回顾); the double month-navigator on the stats tab is
  gone; the calendar tab gained its own month nav row.
- **Tappable notices** — the budget card opens the budget screen; the credit-card
  due banner opens that account's history.
- **Credit-card statement semantics fixed** — payments made after the statement
  close now pay down the bill first (bank semantics): the banner shows the true
  remaining 待还, `billedDue + unbilled === currentDebt`, and a fully repaid bill
  drops its reminder (previously the full billed amount showed forever). Covered
  by 5 new tests.

## Plumbing

- Web boot params `?tab=` `?sheet=1` `?noanim=1` (`src/util/boot.ts`) — deep links
  for the web build and hooks for headless screenshot verification.
- `Flower`/`CategoryDonut` use SVG `transform` strings instead of `rotation`/`origin`
  props, killing the `transform-origin` React DOM warning on web.
- Removed deps: `react-native-chart-kit`, `expo-image-picker` (both orphaned).

---

# Changelog — code-review improvement pass

A round of improvements addressing all 19 items from the code review. Every batch
kept the suite green and the types clean; **no new runtime dependencies were added**.
Final state: **182 tests / 26 suites, `tsc --noEmit` clean.**

## Correctness / data safety

- **Currency symbol (#16)** — money formatting now follows the user's base currency
  instead of a hardcoded per-language symbol. `setDisplaySymbol()` in `domain/money.ts`
  is wired to `store$.currencies.base`; added `fmtNum()` and replaced fragile
  `fmt(...).slice(1)` call sites that broke on multi-char symbols (`A$`, `HK$`).
- **Delete undo (#8)** — deleting an entry now shows an undo toast (snapshots the
  data before the tombstone and restores it verbatim on undo). `Toast` gained an
  optional action button.
- **Sync retry (#2)** — the push path used to advance its watermark *before* the
  push, silently dropping changes on failure. Fixed so the watermark only advances
  on success, plus exponential-backoff retry and a manual `retrySync()`.
- **Merge convergence + field-level merge (#3)** — equal-`updatedAt` conflicts used
  to diverge forever; added a deterministic content tiebreaker so all devices
  converge. Then added true **field-level merge**: `Entry.fieldTs` records per-field
  last-write times (stamped by `updateEntry`), and `mergeById` merges field-by-field
  when both sides carry `fieldTs` — concurrent edits to *different* fields are both
  preserved (tombstone still wins for deletes). DB column added in
  `supabase/migrations/0003_field_ts.sql` (**must be applied**).
- **Backup migration chain (#14)** — `migrate/importV7.ts` gained
  `CURRENT_BACKUP_VERSION` + a `MIGRATIONS` map + `migrateBackup()` that walks any
  older backup forward before applying; versionless files treated as v7.
- **Type safety (#5)** — `LockGate` invalid `'750' as any` font weight → `'700'`.

## UX

- **Read-only entry detail (#9)** — tapping a row opens a new read-only `DetailSheet`
  (full breakdown: account, subcategory, tags, reimbursement, refund, foreign amount…)
  with edit/delete actions, instead of jumping straight into the edit form.
- **Richer stats (#10)** — added a "Top spending" list (tappable → detail) and a
  locale-labelled "by weekday" chart, driven by the existing period selector
  (`topEntries` / `byWeekday` in `domain/stats.ts`).
- **Configurable garden goal (#11)** — the monthly flower goal is now a setting with
  inline +/- steppers (was hardcoded to 28).
- **Richer search (#6)** — amount comparators (`>100`, `>=`, `<`, `<=`, `=`) and
  tag/ledger matching; placeholder updated to hint the syntax.
- **Budget input (#7)** — writes on `onEndEditing` instead of every keystroke.

## Privacy

- **AI category privacy (#13)** — new `settings.aiShareCategories` toggle (default on).
  When off, only built-in category names are sent to the AI parser; custom category
  names stay on device (the reply is still resolved against the full list locally).

## Architecture / maintainability

- **Store split (#1)** — the 466-line `store/ledger.ts` was split by domain
  (`state`, `accounts`, `assets`, `categories`, `subscriptions`, `templates`, `tags`,
  `currency`, `reimburse`); `ledger.ts` is now a barrel + boot composition root, so
  every existing `@/store/ledger` import is unchanged.
- **RecordSheet split (#4)** — the 627-line sheet was broken into `AIQuickEntry`,
  `CurrencyRow`, `TransferForm`, and `CategoryPicker`.
- **Sync push scheduler (#19)** — the debounced-push + backoff-retry + watermark state
  machine was extracted into an injectable `sync/pushScheduler.ts`, unit-tested under
  fake timers (the engine just wires store + Supabase into it).

## Performance

- **Split persistence (#15, storage-split option)** — entries and config now persist
  under separate AsyncStorage keys (`dhh_entries_v1` / `dhh_config_v1`) with
  independent debounced saves, so a config-only change no longer re-serializes the
  whole (potentially thousands-long) entries array. The legacy `dhh_state_v1` blob is
  migrated forward on first load. *(A full per-row expo-sqlite store is the natural
  next step for very large datasets; deferred as it needs a native dev build to
  verify.)*

## Tests

- **Component tests (#18)** — added with zero new deps via the already-present
  `react-test-renderer`: `EntryList` (grouping, totals, empty state, tap callbacks)
  and `LockGate` (auth success/failure/no-enrollment flows).
- Also added unit tests for the new domain/sync logic: field-level merge, push
  scheduler, backup migration, search comparators, weekday/top-spend stats, split
  persistence, and per-field-timestamp stamping.

### Note for deployers

Apply `supabase/migrations/0003_field_ts.sql` before shipping the field-level-merge
build — the entries upsert writes a `field_ts` column that must exist.
