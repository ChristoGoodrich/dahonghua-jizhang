# Multi-Currency: Historical Rates & FX Asset Pool

## [S1] Problem

The current multi-currency system has three gaps:
1. **No historical rates** — `updateRates()` only fetches latest rates; past entries may use wrong rates
2. **Rate not persisted** — the rate used at conversion time is lost; only `amt` (base) + `origAmt` (foreign) survive
3. **No FX asset pool** — pre-exchanged foreign currency has no dedicated tracking

## [S2] Solution Overview

Three independent layers, each adding value on its own:

| Layer | What | Value |
|-------|------|-------|
| **Historical rate fetch** | Frankfurter API for date-specific rates | Accurate past entries |
| **Per-entry rate storage** | New `rate` field on Entry | Rate immutability, audit trail |
| **FX asset pool** | New asset type for foreign cash | Pre-exchanged currency tracking |

## [S3] Data Model Changes

### Entry type (`domain/types.ts`)

```typescript
export interface Entry {
  // ... existing fields unchanged ...
  cur?: string;       // existing: original currency code
  origAmt?: number;   // existing: original amount in cur
  rate?: number;      // NEW: rate used (1 cur = N base). Undefined = used latest available
}
```

### FX Pool — implemented as Account kind

```typescript
// Extend Account kind (domain/types.ts)
export interface Account {
  id: string;
  name: string;
  nameEn?: string;
  balance: number;
  kind: 'cash' | 'credit' | 'prepaid' | 'fx';  // NEW: 'fx'
  // ... existing fields ...
  fxCode?: string;     // NEW: currency code for FX accounts (e.g. 'USD')
  fxRate?: number;     // NEW: weighted average purchase rate
}
```

## [S4] Rate Fetching — Frankfurter API

**Endpoint:**
```
GET https://api.frankfurter.app/{date}?from={base}&to={target}
```

- Free, no API key, covers 30+ currencies (ECB data)
- Historical: supports any date back to 1999
- Response: `{ "base": "CNY", "date": "2024-01-15", "rates": { "USD": 0.14 } }`
- Rate semantics: response gives "1 base = X target"; we store as "1 target = 1/X base" (inverted, matching current `rates` convention)

**Fallback chain:**
1. Try Frankfurter for the specific date
2. If date is today or very recent, try the existing `exchangerate-api.com` as backup
3. If all fail, use the latest cached rate from `store$.currencies.rates[code]` + show warning

**Caching:**
- Cache fetched rates in memory (Map<date+code, rate>) for the session
- No persistent cache needed — the rate is saved with the entry

## [S5] Entry Creation Flow (RecordSheet)

```
User picks foreign currency → types amount → taps Save
  → fetchHistoricalRate(entryDate, baseCurrency, foreignCurrency)
  → if success: store rate in entry, convert to base
  → if fail: use cached latest rate, show "rate approximate" warning
  → save entry with { amt, cur, origAmt, rate }
```

**UI changes:**
- Conversion preview shows the actual historical rate: "1 USD = 7.23 CNY (2024-01-15)"
- If rate is approximate (API failed), show a subtle warning icon

**DetailSheet display:**
- Show rate used: "汇率 1 USD = 7.23 CNY"
- For entries without stored rate: "汇率 (未记录)"

## [S6] FX Asset Pool

### Concept
When user buys foreign currency (换汇):
1. Create a **transfer** entry: CNY account → FX account
2. Record the purchase rate as `rate` on the entry
3. FX account `balance` increases (in foreign currency)
4. FX account `fxRate` updates (weighted average of all purchases)

When user spends from FX account:
1. User selects FX account as the "account"
2. The entry's `rate` is the FX account's weighted average rate
3. FX account balance decreases

### Implementation
- Extend `Account.kind` with `'fx'`
- Add `fxCode` and `fxRate` fields to Account
- In RecordSheet account picker, show FX accounts with their foreign currency balance
- In transfer form, allow CNY → FX transfers (购汇) and FX → CNY transfers (结汇)
- When saving an entry from an FX account, use the account's `fxRate` as the entry's `rate`

### Account Management UI
- In accounts.tsx, add "FX account" as a kind option
- When creating FX account, user picks the foreign currency code
- Show FX account balance in foreign currency with base currency equivalent

## [S7] Backward Compatibility

- Existing entries without `rate` field: keep as-is
- Show a subtle note in DetailSheet: "汇率 (未记录)" for entries without rate
- No data migration needed — `rate` is optional
- Existing `currencies.rates` continues to work as the "latest rates" cache

## [S8] API Integration Details

### New file: `src/domain/rates.ts`

```typescript
// Fetch historical rate from Frankfurter API
export async function fetchHistoricalRate(
  date: string,      // YYYY-MM-DD
  from: string,      // base currency code
  to: string         // target currency code
): Promise<number | null>;  // returns rate (1 to = N from) or null on failure

// Fetch with fallback chain
export async function getRateForDate(
  date: number,      // timestamp
  base: string,
  target: string,
  cachedRates: Record<string, number>  // from store$.currencies.rates
): Promise<{ rate: number; source: 'api' | 'cached'; date: string }>;
```

### Changes to existing files

| File | Change |
|------|--------|
| `domain/types.ts` | Add `rate?: number` to Entry, add `fxCode?`/`fxRate?` to Account |
| `store/ledger.ts` | Pass rate when creating entries |
| `features/record/RecordSheet.tsx` | Fetch rate on save, show in preview |
| `features/record/DetailSheet.tsx` | Display rate used |
| `app/accounts.tsx` | Support FX account creation |
| `domain/money.ts` | `toBase()` accepts optional rate override |
| `sync/rows.ts` | Map `rate` field to/from Supabase |
| `supabase/migrations/` | Add `rate` column to entries table |
| `i18n/index.ts` | Add rate-related strings |
