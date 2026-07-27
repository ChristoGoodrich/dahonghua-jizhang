# Contributing to 大红花记账 · Red Blossom

Thanks for taking the time. This document covers how to set the project up, what a good
change looks like here, and how to get it merged.

[简体中文版](CONTRIBUTING.zh-CN.md)

## Ways to help

- **Report a bug** — [open an issue](https://github.com/ChristoGoodrich/dahonghua-jizhang/issues/new/choose) with the bug template. Steps to reproduce beat a description.
- **Suggest a feature** — use the feature template and say what problem it solves, not only what to build.
- **Improve the translations** — everything user-facing lives in `src/i18n/zh/` and `src/i18n/en/`; the two must stay in sync.
- **Send a pull request** — small and focused is much easier to review than large and sweeping.

For a security vulnerability, do **not** open an issue — see [SECURITY.md](SECURITY.md).

## Development setup

Requires Node.js 20+.

```bash
npm install
```

```bash
npx expo start
```

No environment variables are needed to develop: cloud sync, AI entry and crash reporting
all stay hidden until their keys are configured. See the [README](README.md#configuration)
if you want to switch them on.

**Expo SDK 56 has moved a lot of APIs.** Check the exact versioned docs at
<https://docs.expo.dev/versions/v56.0.0/> before reaching for an Expo API — older
tutorials and pre-56 answers are frequently wrong now.

## Before you push

All three must pass; CI runs the same three and additionally fails under 70 % line
coverage.

```bash
npm run lint && npm run typecheck && npm test
```

Coverage locally:

```bash
npm test -- --coverage
```

## Code conventions

- **TypeScript, `strict: true`.** No `any` in production code; if a type is genuinely unknowable, narrow it explicitly.
- **Keep `src/domain/` pure.** No React, no platform APIs, no network — that is what lets the majority of the suite run in a plain Node environment. Screens and hooks compose that logic; they don't reimplement it.
- **Import via the `@/` alias** (`@/domain/money`), not long relative chains.
- **Bilingual by default.** Any user-visible string goes into both `src/i18n/zh/*.json` and `src/i18n/en/*.json` under the same key — never hardcode text in a component.
- **Comments explain *why*.** The code already says what it does; a comment earns its place by recording the reason, the constraint or the edge case behind it.
- **Match the surrounding file** for naming, structure and comment density.

## Tests

- Tests live in a `__tests__/` directory beside the code under test, named `*.test.ts(x)`.
- Every bug fix should come with a test that fails before the fix.
- Domain logic is tested directly. Things that touch the network are tested against fakes — see `src/sync/__tests__/engine.test.ts` for the pattern.
- Detox end-to-end tests are in `e2e/`; add a `testID` when a flow needs to be reachable from one.

## Commits

The history follows [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add per-category budgets
fix: keep delete-undo from clobbering concurrent edits
refactor: split billImport.ts into billParse.ts and billDedup.ts
test: cover the subscription charge-id derivation
chore: bump expo to 56.0.12
docs: document the AI proxy contract
```

Write the subject in the imperative mood and keep it under ~72 characters. Explain the
reasoning in the body when the change isn't self-evident.

## Pull requests

1. Branch off `main` (`feat/…`, `fix/…`, `refactor/…`).
2. Keep the diff to one concern. Split unrelated cleanups into their own PR.
3. Fill in the PR template: what changed, why, how you verified it.
4. Include a screenshot or a short screen recording for anything visual.
5. Make sure lint, typecheck and tests are green — CI will check, but don't make it the first to find out.
6. Update the docs in the same PR when behaviour changes, and add a `CHANGELOG.md` entry for anything user-facing.

Review is a conversation, not a gate — expect questions, and ask your own.

## Code of Conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). Be decent to
each other.
