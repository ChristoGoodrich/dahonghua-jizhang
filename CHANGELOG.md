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
