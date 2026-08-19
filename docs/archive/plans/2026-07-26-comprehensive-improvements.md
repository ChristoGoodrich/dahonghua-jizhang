# Comprehensive Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 14 improvements across testing, performance, architecture, UX, security, features, and developer experience for the 大红花记账 app.

**Architecture:** Each task is self-contained and independently testable. Tasks are grouped by domain but can be executed in any order within a group. The app uses Expo SDK 56, React Native 0.85, Legend-State, Supabase, and TypeScript 6.0.

**Tech Stack:** Expo, React Native, Legend-State, Supabase, TypeScript, Jest, Detox

## Global Constraints

- Expo SDK 56 — read https://docs.expo.dev/versions/v56.0.0/ before writing any code
- All domain logic in `src/domain/` must remain pure functions (no React, no I/O)
- All new tests must pass with `npm test`
- TypeScript strict mode — `npm run typecheck` must pass
- i18n: all user-facing strings must have both `zh` and `en` translations
- Accessibility: all interactive elements need `accessibilityLabel`
- No new native dependencies without explicit approval

---

## Group A: Code Architecture

### Task 1: Split RecordSheet.tsx into Sub-Components

**Covers:** RecordSheet component decomposition

**Files:**
- Modify: `src/features/record/RecordSheet.tsx`
- Create: `src/features/record/hooks/useRecordForm.ts`
- Create: `src/features/record/RecordHeader.tsx`
- Create: `src/features/record/RecordAmount.tsx`
- Create: `src/features/record/RecordActions.tsx`
- Test: `src/features/record/__tests__/RecordSheet.test.tsx` (update existing)

**Interfaces:**
- `useRecordForm(props)` returns all form state and handlers (io, cat, amt, note, acct, etc.)
- `RecordHeader` renders IO toggle + grip bar
- `RecordAmount` renders amount display + currency selector + math preview
- `RecordActions` renders template/again/delete/save buttons

- [ ] **Step 1: Create `useRecordForm` hook**

Extract all state declarations (lines 57-93), effects (lines 96-131), and handlers (lines 141-435) into a custom hook:

```typescript
// src/features/record/hooks/useRecordForm.ts
import { useState, useEffect, useMemo } from 'react';
import { Animated } from 'react-native';
// ... all imports from RecordSheet

export interface RecordFormProps {
  visible: boolean;
  editId?: string;
  initialTs?: number;
  dupeId?: string;
  lang: Lang;
  customCats: Category[];
  onClose: () => void;
  onSaved?: () => void;
  onTemplateSaved?: () => void;
  onDeleted?: (entry: Entry, refunds: Entry[]) => void;
}

export function useRecordForm(props: RecordFormProps) {
  // All 25+ useState hooks
  // All useEffect hooks (flash auto-dismiss, rate fetch)
  // All handlers (runAI, handleReceiptCapture, pickIO, onKey, validationError, writeEntry, save, saveNext, saveAsTemplate, toggleTag, del)
  // All derived values (accent, noteSugg, converted)
  // Return all state + handlers
}
```

- [ ] **Step 2: Create `RecordHeader` component**

```typescript
// src/features/record/RecordHeader.tsx
// Lines 479-503 from RecordSheet: grip bar + IO toggle
export function RecordHeader({ io, onPickIO, accent }: {
  io: IOType;
  onPickIO: (t: IOType) => void;
  accent: string;
}) { ... }
```

- [ ] **Step 3: Create `RecordAmount` component**

```typescript
// src/features/record/RecordAmount.tsx
// Lines 505-556 from RecordSheet: amount display + currency + math preview
export function RecordAmount({ amt, cur, flash, converted, onCurChange }: { ... }) { ... }
```

- [ ] **Step 4: Create `RecordActions` component**

```typescript
// src/features/record/RecordActions.tsx
// Lines 649-667 from RecordSheet: template/again/delete/save buttons
export function RecordActions({ editId, saving, onSave, onSaveNext, onSaveTemplate, onDelete }: { ... }) { ... }
```

- [ ] **Step 5: Refactor RecordSheet to use sub-components**

Replace the extracted sections in `RecordSheet.tsx` with the new hook and components. The file should drop from ~723 lines to ~300 lines.

- [ ] **Step 6: Run tests to verify no regressions**

Run: `npm test -- --testPathPattern=RecordSheet`
Expected: All existing tests pass

- [ ] **Step 7: Commit**

```bash
git add src/features/record/
git commit -m "refactor: split RecordSheet into sub-components and useRecordForm hook"
```

---

### Task 2: Modularize i18n

**Covers:** i18n string modularization

**Files:**
- Create: `src/i18n/zh/record.json`
- Create: `src/i18n/zh/budget.json`
- Create: `src/i18n/zh/stats.json`
- Create: `src/i18n/zh/settings.json`
- Create: `src/i18n/zh/accounts.json`
- Create: `src/i18n/zh/sync.json`
- Create: `src/i18n/en/record.json`
- Create: `src/i18n/en/budget.json`
- Create: `src/i18n/en/stats.json`
- Create: `src/i18n/en/settings.json`
- Create: `src/i18n/en/accounts.json`
- Create: `src/i18n/en/sync.json`
- Modify: `src/i18n/index.ts`

**Interfaces:**
- `t(key, lang)` function signature unchanged — all callers continue working
- Translation keys remain flat (no nesting) for simplicity

- [ ] **Step 1: Split translations into module files**

Group the ~250+ keys by domain. Each JSON file contains a flat key-value map:

```json
// src/i18n/zh/record.json
{
  "exp": "支出",
  "inc": "收入",
  "xfer": "转账",
  "note": "备注",
  "noteSugg": "常用备注",
  "save": "保存",
  "saveAgain": "再记一笔",
  "delete": "删除",
  "template": "存为模板",
  "errAmount": "请输入金额",
  "errXferTo": "请选择转入账户",
  "errXferSame": "转出和转入账户不能相同",
  "errNoRate": "请先获取汇率"
}
```

- [ ] **Step 2: Update `src/i18n/index.ts` to merge modules**

```typescript
import zhRecord from './zh/record.json';
import zhBudget from './zh/budget.json';
// ... etc
import enRecord from './en/record.json';
import enBudget from './en/budget.json';
// ... etc

const zh = { ...zhRecord, ...zhBudget, ...zhStats, ...zhSettings, ...zhAccounts, ...zhSync };
const en = { ...enRecord, ...enBudget, ...enStats, ...enSettings, ...enAccounts, ...enSync };
```

- [ ] **Step 3: Run typecheck to verify all keys still resolve**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/i18n/
git commit -m "refactor: modularize i18n translations into domain-specific JSON files"
```

---

## Group B: Performance

### Task 3: Large Data Volume Performance — Indexed Entry Lookup

**Covers:** Performance optimization for large entry counts

**Files:**
- Modify: `src/store/state.ts`
- Modify: `src/domain/stats.ts`
- Modify: `src/domain/budget.ts`
- Create: `src/store/indexes.ts`
- Test: `src/store/__tests__/indexes.test.ts`

**Interfaces:**
- `entriesByMonth$` — observable Map<string, Entry[]> keyed by `YYYY-MM`
- `entriesByAccount$` — observable Map<string, Entry[]> keyed by account ID
- Indexes update automatically when `store$.data` changes

- [ ] **Step 1: Write failing test for index builder**

```typescript
// src/store/__tests__/indexes.test.ts
import { buildMonthIndex, buildAccountIndex } from '../indexes';
import { Entry } from '../../domain/types';

describe('entry indexes', () => {
  const entries: Entry[] = [
    { id: '1', ts: new Date('2026-01-15').getTime(), io: 'exp', cat: 'food', amt: 35, acct: 'default', updatedAt: 1 },
    { id: '2', ts: new Date('2026-01-20').getTime(), io: 'exp', cat: 'food', amt: 50, acct: 'default', updatedAt: 2 },
    { id: '3', ts: new Date('2026-02-10').getTime(), io: 'inc', cat: 'salary', amt: 5000, acct: 'bank', updatedAt: 3 },
  ];

  it('groups entries by month', () => {
    const idx = buildMonthIndex(entries);
    expect(idx.get('2026-01')).toHaveLength(2);
    expect(idx.get('2026-02')).toHaveLength(1);
  });

  it('groups entries by account', () => {
    const idx = buildAccountIndex(entries);
    expect(idx.get('default')).toHaveLength(2);
    expect(idx.get('bank')).toHaveLength(1);
  });

  it('excludes tombstoned entries', () => {
    const withDeleted = [...entries, { id: '4', ts: Date.now(), io: 'exp' as const, cat: 'food', amt: 10, acct: 'default', updatedAt: 4, deletedAt: 999 }];
    const idx = buildMonthIndex(withDeleted);
    expect(idx.get('2026-01')).toHaveLength(2); // deleted entry excluded
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=indexes`
Expected: FAIL — `buildMonthIndex` not found

- [ ] **Step 3: Implement index builders**

```typescript
// src/store/indexes.ts
import { Entry } from '../domain/types';

export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function buildMonthIndex(entries: Entry[]): Map<string, Entry[]> {
  const map = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.deletedAt) continue;
    const key = monthKey(e.ts);
    const arr = map.get(key);
    if (arr) arr.push(e);
    else map.set(key, [e]);
  }
  return map;
}

export function buildAccountIndex(entries: Entry[]): Map<string, Entry[]> {
  const map = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.deletedAt) continue;
    const arr = map.get(e.acct);
    if (arr) arr.push(e);
    else map.set(e.acct, [e]);
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=indexes`
Expected: PASS

- [ ] **Step 5: Wire indexes into store as derived observables**

```typescript
// In src/store/state.ts, add after store$ definition:
import { buildMonthIndex, buildAccountIndex } from './indexes';

export const entriesByMonth$ = observable<Map<string, Entry[]>>(new Map());
export const entriesByAccount$ = observable<Map<string, Entry[]>>(new Map());

// In hydrate() or after data loads:
store$.data.onChange((data) => {
  entriesByMonth$.set(buildMonthIndex(data));
  entriesByAccount$.set(buildAccountIndex(data));
});
```

- [ ] **Step 6: Update stats.ts to use month index**

Replace linear scans over all entries with index lookups where month filtering is needed.

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/store/indexes.ts src/store/__tests__/indexes.test.ts src/store/state.ts src/domain/stats.ts
git commit -m "perf: add month and account indexes for large entry sets"
```

---

### Task 4: Startup Performance — Lazy Hydration

**Covers:** Startup performance optimization

**Files:**
- Modify: `src/store/state.ts`
- Modify: `src/app/_layout.tsx`
- Test: `src/store/__tests__/persistence.test.ts` (update)

**Interfaces:**
- `hydrateCurrentMonth()` — loads only current month entries first
- `hydrateFull()` — loads all entries (called after UI is interactive)

- [ ] **Step 1: Write failing test for partial hydration**

```typescript
// Add to src/store/__tests__/persistence.test.ts
it('hydrates current month first, then full data', async () => {
  // Mock AsyncStorage with entries spanning 3 months
  const entries = [
    { id: '1', ts: new Date('2026-05-15').getTime(), io: 'exp', cat: 'food', amt: 10, acct: 'default', updatedAt: 1 },
    { id: '2', ts: new Date('2026-06-15').getTime(), io: 'exp', cat: 'food', amt: 20, acct: 'default', updatedAt: 2 },
    { id: '3', ts: new Date('2026-07-15').getTime(), io: 'exp', cat: 'food', amt: 30, acct: 'default', updatedAt: 3 },
  ];
  // ... setup AsyncStorage mock
  await hydrateCurrentMonth();
  expect(store$.data.get()).toHaveLength(1); // only July
  await hydrateFull();
  expect(store$.data.get()).toHaveLength(3); // all
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=persistence`
Expected: FAIL

- [ ] **Step 3: Implement split hydration**

```typescript
// In src/store/state.ts
export async function hydrateCurrentMonth(): Promise<void> {
  const raw = await AsyncStorage.getItem('dhh_entries_v1');
  if (!raw) return;
  const all: Entry[] = JSON.parse(raw);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const current = all.filter(e => e.ts >= monthStart && !e.deletedAt);
  store$.data.set(current);
}

export async function hydrateFull(): Promise<void> {
  const raw = await AsyncStorage.getItem('dhh_entries_v1');
  if (!raw) return;
  store$.data.set(JSON.parse(raw));
}
```

- [ ] **Step 4: Update `_layout.tsx` to use split hydration**

Call `hydrateCurrentMonth()` first, render UI, then call `hydrateFull()` after a short delay or on idle.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/store/state.ts src/app/_layout.tsx src/store/__tests__/persistence.test.ts
git commit -m "perf: lazy hydration — load current month first, full data on idle"
```

---

## Group C: UX Improvements

### Task 5: Sync Status Visualization

**Covers:** Sync status indicator in UI

**Files:**
- Modify: `src/sync/engine.ts` (export sync$)
- Create: `src/components/SyncIndicator.tsx`
- Modify: `src/features/nav/BottomNav.tsx` or `src/app/settings.tsx`
- Test: `src/components/__tests__/SyncIndicator.test.tsx`

**Interfaces:**
- `SyncIndicator` component reads `sync$` observable
- Shows: cloud-off icon (off), spinning cloud (syncing), cloud-check (synced), cloud-alert (error)
- Tapping error state calls `retrySync()`

- [ ] **Step 1: Write failing test**

```typescript
// src/components/__tests__/SyncIndicator.test.tsx
import { render } from '@testing-library/react-native';
import { SyncIndicator } from '../SyncIndicator';
import { sync$ } from '../../sync/engine';

describe('SyncIndicator', () => {
  it('shows off icon when sync is off', () => {
    sync$.set({ status: 'off', lastSync: 0 });
    const { getByTestId } = render(<SyncIndicator />);
    expect(getByTestId('sync-off')).toBeTruthy();
  });

  it('shows error icon with retry on error', () => {
    sync$.set({ status: 'error', lastSync: 0 });
    const { getByTestId } = render(<SyncIndicator />);
    expect(getByTestId('sync-error')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=SyncIndicator`
Expected: FAIL

- [ ] **Step 3: Implement SyncIndicator**

```typescript
// src/components/SyncIndicator.tsx
import React from 'react';
import { observer } from '@legendapp/state/react';
import { sync$, retrySync } from '../sync/engine';
import { Icon } from './ui/Icon';
import { Tap } from './ui/Tap';
import { useTheme } from '../theme/ThemeContext';

export const SyncIndicator = observer(function SyncIndicator() {
  const { status } = sync$.get();
  const t = useTheme();

  const iconMap = {
    off: { name: 'cloud' as const, color: t.textDim, testID: 'sync-off' },
    syncing: { name: 'cloud' as const, color: t.accent, testID: 'syncing' },
    synced: { name: 'cloud' as const, color: t.green, testID: 'sync-synced' },
    error: { name: 'cloud' as const, color: t.red, testID: 'sync-error' },
  };

  const { name, color, testID } = iconMap[status];

  return (
    <Tap
      testID={testID}
      onPress={status === 'error' ? retrySync : undefined}
      accessibilityLabel={status}
    >
      <Icon name={name} color={color} size={18} />
    </Tap>
  );
});
```

- [ ] **Step 4: Add to settings header**

Add `<SyncIndicator />` next to the settings screen header or in the main nav area.

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPattern=SyncIndicator`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/SyncIndicator.tsx src/components/__tests__/SyncIndicator.test.tsx src/app/settings.tsx
git commit -m "feat: add sync status indicator with error retry"
```

---

### Task 6: Error Recovery — Import Failure Details

**Covers:** Better error reporting for bill import

**Files:**
- Modify: `src/domain/billImport.ts`
- Modify: `src/app/import-bills.tsx`
- Test: `src/domain/__tests__/billImport.test.ts` (update)

**Interfaces:**
- `ImportResult` gains `errors: { row: number; reason: string }[]`
- UI shows failed rows with reasons in a scrollable list

- [ ] **Step 1: Write failing test for error details**

```typescript
// Add to src/domain/__tests__/billImport.test.ts
it('reports per-row errors with line numbers', () => {
  const csv = '日期,金额,商品说明\n2026-01-15,35,午餐\ninvalid-date,abc,坏数据\n2026-01-16,50,晚餐';
  const result = parseAlipayCSV(csv);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].row).toBe(3);
  expect(result.errors[0].reason).toContain('invalid');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=billImport`
Expected: FAIL

- [ ] **Step 3: Update `parseAlipayCSV` and `parseWechatCSV` to collect errors**

Add error collection array, catch per-row parsing failures, populate with row number and reason.

- [ ] **Step 4: Update import-bills.tsx to display errors**

Show a collapsible error list below the import summary when `result.errors.length > 0`.

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPattern=billImport`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/domain/billImport.ts src/domain/__tests__/billImport.test.ts src/app/import-bills.tsx
git commit -m "feat: show per-row error details in bill import"
```

---

### Task 7: Error Recovery — Sync Retry Button

**Covers:** Manual sync retry in UI

**Files:**
- Modify: `src/sync/engine.ts` (ensure `retrySync` is exported)
- Modify: `src/app/settings.tsx`
- Test: Covered by Task 5 tests

- [ ] **Step 1: Verify `retrySync` is exported from engine.ts**

Check that `retrySync()` calls `pusher.flushNow()` and is exported.

- [ ] **Step 2: Add retry button to settings sync section**

```typescript
// In settings.tsx, in the sync section:
{sync$.status.get() === 'error' && (
  <Btn label={t.retrySync} onPress={retrySync} variant="ghost" />
)}
```

- [ ] **Step 3: Add i18n key**

```json
// zh: "retrySync": "重新同步"
// en: "retrySync": "Retry Sync"
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/app/settings.tsx src/i18n/
git commit -m "feat: add manual sync retry button in settings"
```

---

### Task 8: Accessibility Audit

**Covers:** Systematic accessibility label coverage

**Files:**
- Modify: Various component files across `src/features/` and `src/components/`

**Interfaces:**
- Every interactive element must have `accessibilityLabel`
- Every `accessibilityLabel` must be localized (zh/en)

- [ ] **Step 1: Audit current accessibility coverage**

Run a grep for all `Pressable`, `TouchableOpacity`, `Tap`, `Btn`, `Chip`, `NavRow` usage and check which ones lack `accessibilityLabel`.

- [ ] **Step 2: Add missing accessibility labels**

For each component missing labels:
- Add `accessibilityLabel={t.someKey}` prop
- Add corresponding i18n keys for zh and en

Key areas to cover:
- `RecordSheet`: IO toggle tabs, save/again/delete buttons, category items
- `EntryList`: swipeable row actions (delete, mark)
- `BudgetProgress`: progress bar value
- `CalendarView`: day cells
- `StatsView`: chart segments
- `BottomNav`: tab items (check existing)

- [ ] **Step 3: Add accessibility i18n keys**

```json
// zh additions
"a11yExpTab": "支出标签",
"a11yIncTab": "收入标签",
"a11yXferTab": "转账标签",
"a11ySave": "保存记录",
"a11yDeleteEntry": "删除记录",
"a11yCategory": "分类: %s",
"a11yDay": "%d月%d日",
"a11yBudgetProgress": "预算已用%p%"

// en additions
"a11yExpTab": "Expense tab",
"a11yIncTab": "Income tab",
"a11yXferTab": "Transfer tab",
"a11ySave": "Save entry",
"a11yDeleteEntry": "Delete entry",
"a11yCategory": "Category: %s",
"a11yDay": "%d %s",
"a11yBudgetProgress": "Budget used %p%"
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/features/ src/components/ src/i18n/
git commit -m "feat: comprehensive accessibility labels across all interactive elements"
```

---

## Group D: Security

### Task 9: Supabase RLS Audit

**Covers:** RLS policy verification

**Files:**
- Create: `supabase/tests/rls_audit.sql`
- Modify: `supabase/migrations/` (if gaps found)

- [ ] **Step 1: Create RLS audit SQL script**

```sql
-- supabase/tests/rls_audit.sql
-- Run this against your Supabase project to verify RLS

-- 1. Verify RLS is enabled on all tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false;
-- Expected: 0 rows (all tables have RLS enabled)

-- 2. Verify users can only read own entries
-- (Run as user A, should return only user A's entries)
SET request.jwt.claims = '{"sub": "user-a-uuid"}';
SELECT count(*) FROM entries WHERE user_id != 'user-a-uuid';
-- Expected: 0

-- 3. Verify users can only read own profile
SET request.jwt.claims = '{"sub": "user-a-uuid"}';
SELECT count(*) FROM profiles WHERE user_id != 'user-a-uuid';
-- Expected: 0

-- 4. Verify realtime channel isolation
-- Check that the entries publication only includes the entries table
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

- [ ] **Step 2: Run audit against Supabase**

Execute the SQL against the project's Supabase instance and document results.

- [ ] **Step 3: Fix any gaps found**

If RLS is missing on any table or policies are too permissive, create a new migration.

- [ ] **Step 4: Commit**

```bash
git add supabase/
git commit -m "security: RLS audit script and policy fixes"
```

---

### Task 10: Backup Encryption

**Covers:** Encrypted backup support

**Files:**
- Modify: `src/util/backup.ts`
- Modify: `src/app/backup.tsx`
- Create: `src/util/crypto.ts`
- Test: `src/util/__tests__/crypto.test.ts`
- Test: `src/util/__tests__/backup.test.ts` (update)

**Interfaces:**
- `encryptBackup(data, password): string` — AES-GCM encryption
- `decryptBackup(encrypted, password): BackupData` — AES-GCM decryption
- Backup file extension changes to `.dhh.enc` when encrypted
- UI adds password input when "encrypted backup" toggle is on

- [ ] **Step 1: Write failing test for crypto module**

```typescript
// src/util/__tests__/crypto.test.ts
import { encryptBackup, decryptBackup } from '../crypto';

describe('backup encryption', () => {
  const testData = { version: 1, timestamp: Date.now(), entries: [{ id: '1' }], config: {} };

  it('encrypts and decrypts with correct password', async () => {
    const encrypted = await encryptBackup(JSON.stringify(testData), 'mypassword');
    expect(encrypted).not.toContain('"version"');
    const decrypted = await decryptBackup(encrypted, 'mypassword');
    expect(JSON.parse(decrypted)).toEqual(testData);
  });

  it('fails to decrypt with wrong password', async () => {
    const encrypted = await encryptBackup(JSON.stringify(testData), 'mypassword');
    await expect(decryptBackup(encrypted, 'wrongpassword')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=crypto`
Expected: FAIL

- [ ] **Step 3: Implement crypto module**

Use `expo-crypto` (already available in Expo SDK 56) for PBKDF2 key derivation and AES-GCM encryption:

```typescript
// src/util/crypto.ts
import * as Crypto from 'expo-crypto';

const ALGORITHM = 'AES-GCM';
const ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

export async function encryptBackup(data: string, password: string): Promise<string> {
  const salt = Crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = Crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);
  const encoded = new TextEncoder().encode(data);
  const encrypted = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);
  // Pack salt + iv + ciphertext as base64
  const packed = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  packed.set(salt, 0);
  packed.set(iv, salt.length);
  packed.set(new Uint8Array(encrypted), salt.length + iv.length);
  return btoa(String.fromCharCode(...packed));
}

export async function decryptBackup(encryptedB64: string, password: string): Promise<string> {
  const packed = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
  const salt = packed.slice(0, SALT_LENGTH);
  const iv = packed.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = packed.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=crypto`
Expected: PASS

- [ ] **Step 5: Update backup.ts to support encryption**

Add optional `password` parameter to `createBackup` and `restoreBackup`.

- [ ] **Step 6: Update backup.tsx UI**

Add toggle for encrypted backup + password input fields.

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/util/crypto.ts src/util/__tests__/crypto.test.ts src/util/backup.ts src/app/backup.tsx
git commit -m "feat: AES-GCM encrypted backup with password protection"
```

---

## Group E: Features

### Task 11: Excel Export

**Covers:** XLSX export capability

**Files:**
- Modify: `src/domain/export.ts`
- Modify: `src/app/settings.tsx` or wherever export is triggered
- Test: `src/domain/__tests__/export.test.ts` (update)

**Interfaces:**
- `entriesToXLSX(entries, accounts, customCats): Promise<Uint8Array>` — generates XLSX binary
- Uses `xlsx` library (SheetJS) — lightweight, no native deps

- [ ] **Step 1: Install xlsx dependency**

Run: `npm install xlsx`

- [ ] **Step 2: Write failing test**

```typescript
// Add to src/domain/__tests__/export.test.ts
import { entriesToXLSX } from '../export';

it('generates valid XLSX buffer', async () => {
  const entries: Entry[] = [
    { id: '1', ts: Date.now(), io: 'exp', cat: 'food', amt: 35, acct: 'default', note: 'lunch', updatedAt: 1 },
  ];
  const buffer = await entriesToXLSX(entries, [], []);
  expect(buffer).toBeInstanceOf(ArrayBuffer);
  expect(buffer.byteLength).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --testPathPattern=export`
Expected: FAIL

- [ ] **Step 4: Implement XLSX export**

```typescript
// Add to src/domain/export.ts
import * as XLSX from 'xlsx';

export async function entriesToXLSX(
  entries: Entry[],
  accounts: Account[],
  customCats: Category[]
): Promise<ArrayBuffer> {
  const live = entries.filter(e => !e.deletedAt).sort((a, b) => a.ts - b.ts);
  const data = live.map(e => ({
    '日期': new Date(e.ts).toISOString().slice(0, 10),
    '类型': e.io === 'exp' ? '支出' : e.io === 'inc' ? '收入' : '转账',
    '分类': catName(e.cat, customCats),
    '账户': acctName(e.acct, accounts),
    '金额': e.amt,
    '备注': e.note || '',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '账单');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}
```

- [ ] **Step 5: Add export button in UI**

Add "导出 Excel" button alongside existing CSV export.

- [ ] **Step 6: Run tests**

Run: `npm test -- --testPathPattern=export`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/domain/export.ts src/domain/__tests__/export.test.ts package.json
git commit -m "feat: Excel (.xlsx) export alongside existing CSV export"
```

---

### Task 12: Periodic Report Notifications

**Covers:** Weekly/monthly summary push notifications

**Files:**
- Modify: `src/util/reminder.ts`
- Modify: `src/app/settings.tsx`
- Test: `src/util/__tests__/reminder.test.ts` (update)

**Interfaces:**
- `scheduleWeeklyReport(lang)` — schedules Sunday evening summary notification
- `scheduleMonthlyReport(lang)` — schedules 1st-of-month summary notification
- Summary includes: total spending, top category, budget status

- [ ] **Step 1: Write failing test**

```typescript
// Add to src/util/__tests__/reminder.test.ts
it('schedules weekly report notification', async () => {
  const spy = jest.spyOn(Notifications, 'scheduleNotificationAsync');
  await scheduleWeeklyReport('zh');
  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({ title: expect.stringContaining('周报') }),
      trigger: expect.objectContaining({ weekday: 0 }), // Sunday
    })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=reminder`
Expected: FAIL

- [ ] **Step 3: Implement report scheduling**

```typescript
// Add to src/util/reminder.ts
export async function scheduleWeeklyReport(lang: Lang): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const Notifications = await import('expo-notifications');
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return false;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: lang === 'zh' ? '📊 本周账单周报' : '📊 Weekly Report',
      body: lang === 'zh' ? '点击查看本周消费详情' : 'Tap to view this week\'s spending',
    },
    trigger: { type: 'weekly', weekday: 0, hour: 20, minute: 0 },
  });
  return true;
}

export async function scheduleMonthlyReport(lang: Lang): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const Notifications = await import('expo-notifications');
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return false;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: lang === 'zh' ? '📊 月度账单报告' : '📊 Monthly Report',
      body: lang === 'zh' ? '点击查看上月消费总结' : 'Tap to view last month\'s summary',
    },
    trigger: { type: 'monthly', day: 1, hour: 9, minute: 0 },
  });
  return true;
}
```

- [ ] **Step 4: Add settings toggles**

Add "周报通知" and "月报通知" toggles in settings.

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPattern=reminder`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/util/reminder.ts src/util/__tests__/reminder.test.ts src/app/settings.tsx
git commit -m "feat: weekly and monthly report push notifications"
```

---

## Group F: Developer Experience

### Task 13: CI/CD Pipeline Enhancement

**Covers:** CI pipeline completeness

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Review current CI and add missing checks**

The current CI already runs lint, typecheck, test with coverage. Enhance with:
- PR comment with coverage summary
- Fail on coverage threshold drop

```yaml
# Add to ci.yml after test step:
- name: Coverage threshold
  run: |
    npx jest --coverage --coverageReporters='json-summary'
    COVERAGE=$(cat coverage/coverage-summary.json | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.total.lines.pct)")
    echo "Line coverage: $COVERAGE%"
    if (( $(echo "$COVERAGE < 70" | bc -l) )); then
      echo "Coverage below 70% threshold"
      exit 1
    fi
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add coverage threshold check to PR pipeline"
```

---

### Task 14: Storybook Setup

**Covers:** Component preview / visual development

**Files:**
- Create: `.storybook/main.ts`
- Create: `.storybook/preview.tsx`
- Create: `src/components/ui/Button.stories.tsx`
- Create: `src/components/ui/Chip.stories.tsx`
- Create: `src/components/ui/Icon.stories.tsx`
- Modify: `package.json` (add storybook scripts)

- [ ] **Step 1: Install Storybook for React Native**

Run: `npx storybook@latest init --type react_native`

- [ ] **Step 2: Configure Storybook**

```typescript
// .storybook/main.ts
module.exports = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-ondevice-controls'],
};
```

```typescript
// .storybook/preview.tsx
import { ThemeProvider } from '../src/theme/ThemeContext';
export const decorators = [
  (Story) => <ThemeProvider><Story /></ThemeProvider>,
];
```

- [ ] **Step 3: Create Button story**

```typescript
// src/components/ui/Button.stories.tsx
import { Btn } from './Btn';

export default {
  title: 'UI/Btn',
  component: Btn,
};

export const Primary = { args: { label: '保存', variant: 'primary' } };
export const Ghost = { args: { label: '取消', variant: 'ghost' } };
export const Quiet = { args: { label: '更多', variant: 'quiet' } };
export const Disabled = { args: { label: '保存', variant: 'primary', disabled: true } };
```

- [ ] **Step 4: Create Chip story**

```typescript
// src/components/ui/Chip.stories.tsx
import { Chip } from './Chip';

export default {
  title: 'UI/Chip',
  component: Chip,
};

export const Default = { args: { label: '餐饮' } };
export const Selected = { args: { label: '餐饮', on: true } };
export const Small = { args: { label: '交通', size: 'sm' } };
```

- [ ] **Step 5: Create Icon story**

```typescript
// src/components/ui/Icon.stories.tsx
import { Icon } from './Icon';

export default {
  title: 'UI/Icon',
  component: Icon,
  argTypes: { name: { control: 'select', options: ['search', 'close', 'plus', 'minus', 'trash', 'edit', 'check', 'swap', 'sun', 'moon'] } },
};

export const Default = { args: { name: 'search', size: 24 } };
```

- [ ] **Step 6: Add storybook scripts to package.json**

```json
"scripts": {
  "storybook": "storybook dev",
  "storybook:build": "storybook build"
}
```

- [ ] **Step 7: Run Storybook to verify**

Run: `npm run storybook`
Expected: Storybook dev server starts

- [ ] **Step 8: Commit**

```bash
git add .storybook/ src/components/ui/*.stories.tsx package.json
git commit -m "dev: add Storybook for component visual development"
```

---

## Execution Order

Recommended execution order for maximum efficiency:

1. **Tasks 1-2** (Architecture) — foundation for other changes
2. **Tasks 3-4** (Performance) — independent of architecture changes
3. **Tasks 5-8** (UX) — can parallel with performance
4. **Tasks 9-10** (Security) — independent
5. **Tasks 11-12** (Features) — independent
6. **Tasks 13-14** (DX) — can be done anytime

Total: 14 tasks, ~80 steps
