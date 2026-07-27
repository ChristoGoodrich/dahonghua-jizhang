# Multi-Currency: Historical Rates & FX Asset Pool

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable accurate multi-currency accounting by fetching historical exchange rates, storing rates per-entry, and supporting FX asset pools for pre-exchanged currency.

**Architecture:** Three layers: (1) Frankfurter API for historical rates, (2) `rate` field on Entry for immutability, (3) `fx` Account kind for pre-exchanged currency. Each layer is independently valuable.

**Tech Stack:** React Native (Expo), Legend-State, TypeScript, Frankfurter API (free, no key)

## Global Constraints

- Rate semantics: `rate` = 1 foreign currency unit = N base currency units (matches existing `rates` convention)
- `amt` always stored in base currency (existing invariant)
- `rate` field is optional — undefined means "used latest cached rate" (backward compat)
- Frankfurter API base URL: `https://api.frankfurter.app`
- Existing `exchangerate-api.com` continues as fallback for latest rates
- All new i18n strings in both `zh` and `en`

---

### Task 1: Add `rate` field to Entry type and sync layer

**Covers:** [S3, S7]

**Files:**
- Modify: `src/domain/types.ts` — add `rate?: number` to Entry
- Modify: `src/sync/rows.ts` — map `rate` to/from Supabase
- Modify: `supabase/migrations/` — add `rate` column (new migration file)
- Test: `src/domain/__tests__/money.test.ts` — verify rate-aware conversion

**Interfaces:**
- Produces: `Entry.rate?: number` available for all downstream tasks

- [ ] **Step 1: Add `rate` field to Entry interface**

In `src/domain/types.ts`, add after `origAmt`:

```typescript
rate?: number;      // rate used at save time (1 cur = N base). Undefined = used latest available
```

- [ ] **Step 2: Add `rate` column to Supabase migration**

Create `supabase/migrations/0002_add_entry_rate.sql`:

```sql
-- Add rate column to entries table for per-entry exchange rate storage
ALTER TABLE entries ADD COLUMN rate numeric;
```

- [ ] **Step 3: Update sync mapping**

In `src/sync/rows.ts`, find the `entryToRow` function and add after `orig_amt`:

```typescript
rate: e.rate ?? null,
```

Find the `rowToEntry` function and add after the `orig_amt` mapping:

```typescript
if (r.rate != null) e.rate = r.rate;
```

- [ ] **Step 4: Run existing tests to verify no breakage**

Run: `npm test`
Expected: All 59 test suites pass (same as before)

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts src/sync/rows.ts supabase/migrations/0002_add_entry_rate.sql
git commit -m "feat: add rate field to Entry type and sync layer"
```

---

### Task 2: Create `domain/rates.ts` — Frankfurter API integration

**Covers:** [S4]

**Files:**
- Create: `src/domain/rates.ts` — rate fetching with fallback
- Test: `src/domain/__tests__/rates.test.ts` — unit tests with mocked fetch

**Interfaces:**
- Consumes: `store$.currencies.rates` (cached latest rates)
- Produces: `fetchHistoricalRate()`, `getRateForDate()` for Task 3

- [ ] **Step 1: Write failing tests**

Create `src/domain/__tests__/rates.test.ts`:

```typescript
import { fetchHistoricalRate, getRateForDate } from '../rates';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('fetchHistoricalRate', () => {
  it('returns inverted rate on success', async () => {
    // Frankfurter returns 1 FROM = X TO; we want 1 TO = 1/X FROM
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ base: 'CNY', date: '2024-01-15', rates: { USD: 0.14 } }),
    });
    const rate = await fetchHistoricalRate('2024-01-15', 'CNY', 'USD');
    expect(rate).toBeCloseTo(1 / 0.14, 4); // ~7.14
  });

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'));
    const rate = await fetchHistoricalRate('2024-01-15', 'CNY', 'USD');
    expect(rate).toBeNull();
  });

  it('returns null on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const rate = await fetchHistoricalRate('2024-01-15', 'CNY', 'USD');
    expect(rate).toBeNull();
  });

  it('returns null for same currency', async () => {
    const rate = await fetchHistoricalRate('2024-01-15', 'CNY', 'CNY');
    expect(rate).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('getRateForDate', () => {
  it('uses API rate when available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ base: 'CNY', date: '2024-01-15', rates: { USD: 0.14 } }),
    });
    const result = await getRateForDate(
      new Date('2024-01-15').getTime(),
      'CNY', 'USD', { USD: 7.0 },
    );
    expect(result.rate).toBeCloseTo(1 / 0.14, 4);
    expect(result.source).toBe('api');
    expect(result.date).toBe('2024-01-15');
  });

  it('falls back to cached rate when API fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'));
    const result = await getRateForDate(
      new Date('2024-01-15').getTime(),
      'CNY', 'USD', { USD: 7.0 },
    );
    expect(result.rate).toBe(7.0);
    expect(result.source).toBe('cached');
  });

  it('returns null when both API and cache fail', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'));
    const result = await getRateForDate(
      new Date('2024-01-15').getTime(),
      'CNY', 'XYZ', {},
    );
    expect(result.rate).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="rates"`
Expected: FAIL — "Cannot find module '../rates'"

- [ ] **Step 3: Implement `domain/rates.ts`**

Create `src/domain/rates.ts`:

```typescript
/** Fetch historical exchange rate from Frankfurter API (ECB data). */
export async function fetchHistoricalRate(
  date: string,    // YYYY-MM-DD
  from: string,    // base currency code
  to: string,      // target currency code
): Promise<number | null> {
  if (from === to) return null;
  try {
    const url = `https://api.frankfurter.app/${date}?from=${from}&to=${to}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.rates?.[to];
    if (!raw || raw <= 0 || !isFinite(raw)) return null;
    // API returns 1 FROM = X TO; invert to get 1 TO = N FROM (our convention)
    return +(1 / raw).toFixed(6);
  } catch {
    return null;
  }
}

/** Get rate for a date with fallback to cached rates. */
export async function getRateForDate(
  timestamp: number,
  base: string,
  target: string,
  cachedRates: Record<string, number>,
): Promise<{ rate: number | null; source: 'api' | 'cached'; date: string }> {
  if (base === target) return { rate: 1, source: 'cached', date: '' };
  const d = new Date(timestamp);
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const apiRate = await fetchHistoricalRate(dateStr, base, target);
  if (apiRate != null) {
    return { rate: apiRate, source: 'api', date: dateStr };
  }

  const cached = cachedRates[target];
  if (cached != null && cached > 0) {
    return { rate: cached, source: 'cached', date: dateStr };
  }

  return { rate: null, source: 'cached', date: dateStr };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="rates"`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/rates.ts src/domain/__tests__/rates.test.ts
git commit -m "feat: add Frankfurter API historical rate fetching"
```

---

### Task 3: Update RecordSheet to fetch and store rates

**Covers:** [S5]

**Files:**
- Modify: `src/features/record/RecordSheet.tsx` — fetch rate on save, store in entry
- Modify: `src/store/ledger.ts` — pass rate to addEntry/updateEntry/addTransfer
- Modify: `src/domain/money.ts` — `toBase()` accepts optional rate override

**Interfaces:**
- Consumes: `getRateForDate()` from Task 2, `Entry.rate` from Task 1
- Produces: Entries saved with `rate` field populated

- [ ] **Step 1: Update `toBase()` to accept optional rate**

In `src/domain/money.ts`, update `toBase`:

```typescript
export function toBase(amt: number, code: string | undefined, currencies: Currencies, overrideRate?: number): number {
  const base = currencies.base || 'CNY';
  if (!code || code === base) return amt;
  // Use override rate if provided (from per-entry rate or FX pool)
  if (overrideRate != null && overrideRate > 0) return amt * overrideRate;
  const r = currencies.rates?.[code];
  return r ? amt * r : amt;
}
```

- [ ] **Step 2: Update RecordSheet save flow**

In `src/features/record/RecordSheet.tsx`, add import at top:

```typescript
import { getRateForDate } from '@/domain/rates';
```

Add state for rate fetching:

```typescript
const [rateLoading, setRateLoading] = useState(false);
const [rateSource, setRateSource] = useState<'api' | 'cached' | null>(null);
```

Update the `writeEntry()` function. Find the line:

```typescript
const storeAmt = toBase(value, cur, currencies);
```

Replace with:

```typescript
const rateResult = rateRef.current;
const storeAmt = toBase(value, cur, currencies, rateResult?.rate ?? undefined);
```

Add a ref to store the fetched rate:

```typescript
const rateRef = useRef<{ rate: number | null; source: string; date: string } | null>(null);
```

Update `save()` and `saveNext()` to fetch rate before writing. Replace the `save()` function:

```typescript
async function save() {
  const err = validationError();
  if (err) {
    setFlash({ msg: err, err: true });
    setAttempted(true);
    return;
  }
  // Fetch historical rate for foreign currency entries
  if (cur !== base && cur) {
    setRateLoading(true);
    const entryTs = ts ?? Date.now();
    const result = await getRateForDate(entryTs, base, cur, currencies.rates || {});
    rateRef.current = result;
    setRateSource(result.source);
    setRateLoading(false);
    if (result.rate == null) {
      setFlash({ msg: s.errNoRate.replace('%s', cur), err: true });
      return;
    }
  } else {
    rateRef.current = null;
  }
  if (writeEntry() === null) return;
  onSaved(!editId);
  onClose();
}
```

Similarly update `saveNext()`:

```typescript
async function saveNext() {
  const err = validationError();
  if (err) {
    setFlash({ msg: err, err: true });
    setAttempted(true);
    return;
  }
  if (cur !== base && cur) {
    setRateLoading(true);
    const entryTs = ts ?? Date.now();
    const result = await getRateForDate(entryTs, base, cur, currencies.rates || {});
    rateRef.current = result;
    setRateSource(result.source);
    setRateLoading(false);
    if (result.rate == null) {
      setFlash({ msg: s.errNoRate.replace('%s', cur), err: true });
      return;
    }
  } else {
    rateRef.current = null;
  }
  const value = writeEntry();
  if (value === null) return;
  onSaved(true, true);
  setAmt('');
  setNote('');
  setSubcat('');
  setFee('');
  setDiscount('');
  setFlash({ msg: s.savedNext.replace('%s', curSymbol(cur) + value.toFixed(2)) });
}
```

- [ ] **Step 3: Update `writeEntry()` to include rate**

In `writeEntry()`, find the extra object and add rate:

```typescript
const extra = {
  tags: sheetTags.length ? sheetTags : undefined,
  ledger: ledger || undefined,
  subcat: subcat || undefined,
  cur: foreign ? cur : undefined,
  origAmt: foreign ? value : undefined,
  rate: foreign ? (rateRef.current?.rate ?? undefined) : undefined,
};
```

- [ ] **Step 4: Show rate info in conversion preview**

Update the `converted` variable to show the fetched rate when available:

```typescript
const converted =
  cur !== base && !!evalExpr(amt)
    ? rateRef.current?.rate
      ? s.curConvertedWithRate
          .replace('%s', curSymbol(base) + toBase(evalExpr(amt), cur, currencies, rateRef.current.rate).toFixed(2))
          .replace('%r', `1 ${cur} = ${rateRef.current.rate.toFixed(4)} ${base}`)
      : s.curConverted.replace('%s', curSymbol(base) + toBase(evalExpr(amt), cur, currencies).toFixed(2))
    : undefined;
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/domain/money.ts src/features/record/RecordSheet.tsx
git commit -m "feat: fetch historical rates on save and store in entries"
```

---

### Task 4: Update DetailSheet to display stored rate

**Covers:** [S5, S7]

**Files:**
- Modify: `src/features/record/DetailSheet.tsx` — show rate info

**Interfaces:**
- Consumes: `Entry.rate` from Task 1

- [ ] **Step 1: Add rate display to DetailSheet**

In `src/features/record/DetailSheet.tsx`, find the Row for `dtOrig`:

```typescript
{d.cur && d.origAmt != null && <Row label={s.dtOrig} value={`${d.origAmt} ${d.cur}`} />}
```

Add after it:

```typescript
{d.cur && d.rate != null && (
  <Row label={s.dtRate} value={`1 ${d.cur} = ${d.rate.toFixed(4)} ${lang === 'zh' ? '主币' : 'base'}`} />
)}
{d.cur && d.origAmt != null && d.rate == null && (
  <Row label={s.dtRate} value={s.dtRateUnknown} />
)}
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/features/record/DetailSheet.tsx
git commit -m "feat: display exchange rate in entry detail view"
```

---

### Task 5: Add FX account kind

**Covers:** [S6]

**Files:**
- Modify: `src/domain/types.ts` — add `'fx'` to Account.kind, add `fxCode?`, `fxRate?`
- Modify: `src/store/ledger.ts` — update addAccount to support FX
- Modify: `src/app/accounts.tsx` — UI for creating FX accounts

**Interfaces:**
- Produces: `Account.kind: 'fx'`, `Account.fxCode`, `Account.fxRate` for Task 6

- [ ] **Step 1: Update Account type**

In `src/domain/types.ts`, find the Account interface and update:

```typescript
kind: 'cash' | 'credit' | 'prepaid' | 'fx';
```

Add new optional fields:

```typescript
fxCode?: string;     // currency code for FX accounts (e.g. 'USD')
fxRate?: number;     // weighted average purchase rate
```

- [ ] **Step 2: Update addAccount function**

In `src/store/ledger.ts` (or wherever `addAccount` is defined), update the function signature to accept FX parameters:

```typescript
export function addAccount(
  name: string,
  balance: number,
  kind: 'cash' | 'credit' | 'prepaid' | 'fx',
  opts?: { statementDay?: number; dueDay?: number; fxCode?: string; fxRate?: number },
) {
  // ... existing logic ...
  const acct: Account = {
    id: uid(),
    name,
    balance,
    kind,
    statementDay: opts?.statementDay,
    dueDay: opts?.dueDay,
    fxCode: opts?.fxCode,
    fxRate: opts?.fxRate,
  };
  // ... push to store ...
}
```

- [ ] **Step 3: Update accounts UI**

In `src/app/accounts.tsx`, update the kinds array:

```typescript
const kinds: { k: 'cash' | 'credit' | 'prepaid' | 'fx'; label: string }[] = [
  { k: 'cash', label: s.acctKindCash },
  { k: 'credit', label: s.acctKindCredit },
  { k: 'prepaid', label: s.acctKindPrepaid },
  { k: 'fx', label: s.acctKindFx },
];
```

Add FX-specific form fields when kind is 'fx':

```typescript
{kind === 'fx' && (
  <>
    <Text style={[styles.label, { color: t.inkSoft }]}>{s.acctFxCode}</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {Object.keys(CUR_NAMES).filter(c => c !== base).map((c) => {
        const on = fxCode === c;
        return (
          <Pressable key={c} onPress={() => setFxCode(c)} style={[styles.chip, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}>
            <Text style={{ fontSize: 12.5, color: on ? t.hibiscus : t.inkSoft }}>{c}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  </>
)}
```

Update the `save()` function to pass FX parameters:

```typescript
function save() {
  if (!name.trim()) return;
  addAccount(name.trim(), parseFloat(bal.replace(/[^\d.]/g, '')) || 0, kind, {
    statementDay: clampDay(stmtDay),
    dueDay: clampDay(dueDay),
    fxCode: kind === 'fx' ? fxCode : undefined,
    fxRate: kind === 'fx' ? parseFloat(fxRate.replace(/[^\d.]/g, '')) || 0 : undefined,
  });
  // ... reset fields ...
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts src/store/ledger.ts src/app/accounts.tsx
git commit -m "feat: add FX account kind for pre-exchanged currency"
```

---

### Task 6: Add i18n strings

**Covers:** [S5, S6, S7]

**Files:**
- Modify: `src/i18n/index.ts` — add all new strings

**Interfaces:**
- Consumes: none
- Produces: all new i18n strings for other tasks

- [ ] **Step 1: Add new strings to the Strings interface**

In `src/i18n/index.ts`, add to the Strings interface:

```typescript
// Rate
dtRate: string; dtRateUnknown: string;
curConvertedWithRate: string; // %s = converted amount, %r = rate info
// FX accounts
acctKindFx: string;
acctFxCode: string;
acctFxHint: string;
```

- [ ] **Step 2: Add Chinese translations**

In the `zh` section:

```typescript
dtRate: '汇率', dtRateUnknown: '未记录',
curConvertedWithRate: '≈ %s (%r)',
acctKindFx: '外汇',
acctFxCode: '外币币种',
acctFxHint: '用于记录提前购汇的外币余额',
```

- [ ] **Step 3: Add English translations**

In the `en` section:

```typescript
dtRate: 'Rate', dtRateUnknown: 'Not recorded',
curConvertedWithRate: '≈ %s (%r)',
acctKindFx: 'FX',
acctFxCode: 'Foreign currency',
acctFxHint: 'Track pre-exchanged foreign currency balance',
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/i18n/index.ts
git commit -m "feat: add i18n strings for rate display and FX accounts"
```

---

### Task 7: Integration test and final verification

**Covers:** [S1-S7]

**Files:**
- Test: manual verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run linter**

Run: `npx eslint src/domain/rates.ts src/domain/types.ts src/features/record/RecordSheet.tsx src/features/record/DetailSheet.tsx src/app/accounts.tsx src/i18n/index.ts src/store/ledger.ts src/domain/money.ts src/sync/rows.ts`
Expected: No errors

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "fix: address lint/type issues in multi-currency feature"
```
