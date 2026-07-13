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
