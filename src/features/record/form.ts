// What the record sheet decides, without the sheet.
//
// Extracted from useRecordForm.ts, which is 368 lines of hook with perhaps
// sixty of judgement threaded through it: what a fresh form starts as, what
// switching direction does to the other fields, why a form cannot be saved,
// what shape reaches the store, and which fields survive 再记.
//
// The same division the entry list took. What stays behind is state, effects,
// animation and i18n; what comes here is the deciding. One thing is deliberately
// *not* here: an error's wording. `validate` answers which rejection applies and
// the caller spells it, because a message is Intl and a rejection is not.

import { evalExpr } from '@/domain/calc';
import { toBase } from '@/domain/money';
import type { Currencies, Entry, IO } from '@/domain/types';

/** The fields a record sheet holds, as strings where the user types strings. */
export interface FormFields {
  io: IO;
  cat: string;
  /** The calculator expression, not a number. */
  amt: string;
  note: string;
  acct: string;
  acctTo: string;
  fee: string;
  discount: string;
  tags: string[];
  ledger: string;
  cur: string;
  subcat: string;
  /** When the entry happened; `null` means "now, whenever that turns out to be". */
  ts: number | null;
}

/** Why a form cannot be saved. Not a message — see the module note. */
export type Rejection =
  | { kind: 'amount' }
  | { kind: 'xferTo' }
  | { kind: 'xferSame' }
  | { kind: 'noRate'; cur: string };

/**
 * The reason this form cannot be saved, or `null` when it can.
 *
 * Every rejection has one: the save button used to do nothing at all on a zero
 * amount or a half-filled transfer, which reads as a broken button rather than
 * as a refusal.
 */
export function validate(f: FormFields, base: string, rates: Record<string, number>): Rejection | null {
  const value = evalExpr(f.amt);
  // `!value` catches an empty expression, a zero, and a NaN; `<= 0` catches the
  // negatives an expression like `5-9` can produce
  if (!value || value <= 0) return { kind: 'amount' };
  if (f.io === 'xfer') {
    if (!f.acctTo) return { kind: 'xferTo' };
    if (f.acct === f.acctTo) return { kind: 'xferSame' };
  }
  if (f.cur !== base && !rates[f.cur]) return { kind: 'noRate', cur: f.cur };
  return null;
}

/** Where a rate came from, which decides whether the user is warned. */
export type RateSource = 'api' | 'cached' | null;

/**
 * Whether a freshly fetched rate is really the cached one.
 *
 * Compared with a tolerance rather than for equality: the same rate arriving
 * from the network and from storage has been through a JSON round trip, and
 * `7.2` is not obliged to come back as the same double it went out as.
 */
export function rateSource(fetched: number | null, cached: number | undefined): RateSource {
  if (fetched == null) return null;
  return cached != null && Math.abs(fetched - cached) < 0.000001 ? 'cached' : 'api';
}

/** What the fields start as. `source` is the entry being edited or duplicated. */
export interface FormDefaults {
  base: string;
  acct: string;
  ledger: string;
  /** The first category of the `exp` direction, which a fresh form opens on. */
  firstExpCat: string;
  /** A pre-picked date for a new entry (calendar 补记这天), else null. */
  initialTs: number | null;
}

/**
 * The initial fields for a fresh, edited, or duplicated entry.
 *
 * `editing` distinguishes the two ways a source entry is used. Editing loads it
 * whole, date included. Duplicating copies its *fields* into a new entry and
 * leaves the date alone, so 再记一笔 lands today rather than re-dating itself
 * to whenever the original was.
 */
export function initialFields(
  source: Entry | undefined,
  editing: boolean,
  d: FormDefaults,
): FormFields {
  if (!source) {
    return {
      io: 'exp',
      cat: d.firstExpCat,
      amt: '',
      note: '',
      acct: d.acct,
      acctTo: '',
      fee: '',
      discount: '',
      tags: [],
      ledger: d.ledger,
      cur: d.base,
      subcat: '',
      ts: d.initialTs,
    };
  }
  return {
    io: source.io,
    cat: source.cat,
    // the ORIGINAL foreign amount, not the converted one — editing an entry
    // recorded as $10 should show 10, not 72
    amt: String(source.origAmt ?? source.amt),
    note: source.note ?? '',
    acct: source.acct ?? 'default',
    acctTo: source.acctTo ?? '',
    // truthy, not nullish: a fee of zero is no fee, and shows as an empty field
    fee: source.fee ? String(source.fee) : '',
    discount: source.discount ? String(source.discount) : '',
    tags: source.tags ?? [],
    ledger: source.ledger ?? '',
    cur: source.cur ?? d.base,
    subcat: source.subcat ?? '',
    ts: editing ? source.ts : d.initialTs,
  };
}

/**
 * The field changes that follow picking a direction.
 *
 * A transfer needs two accounts, so it takes the current one as `from` and the
 * first *other* visible account as `to` — leaving `to` empty when there is no
 * other, which `validate` then refuses rather than silently transferring to
 * nowhere. The subcategory clears either way: it belongs to a category that is
 * about to change.
 */
export function pickIo(
  next: IO,
  f: FormFields,
  visibleAccountIds: string[],
  currentAccount: string,
  firstCatOf: (io: IO) => string,
): Partial<FormFields> {
  if (next === 'xfer') {
    const from = f.acct || currentAccount;
    return {
      io: next,
      subcat: '',
      acct: from,
      acctTo: visibleAccountIds.find((id) => id !== from) ?? '',
    };
  }
  return { io: next, subcat: '', cat: firstCatOf(next) };
}

/**
 * Whether the date should be written at all on an edit.
 *
 * Only when the user actually re-dated the entry. Patching an untouched date
 * would stamp `fieldTs.ts` for a field nobody edited, and that stamp is what
 * the sync merge uses to decide whose version of the date wins — so an edit to
 * the note alone would start overruling another device's genuine re-dating.
 */
export function shouldPatchTs(originalTs: number | undefined, formTs: number | null): boolean {
  return formTs !== null && originalTs !== undefined && originalTs !== formTs;
}

/** The entry fields a save writes, for either a transfer or an ordinary entry. */
export type Draft =
  | { kind: 'xfer'; from: string; to: string; amt: number; fee: number; discount: number; note: string; ledger: string; ts: number | null }
  | { kind: 'entry'; io: IO; cat: string; amt: number; note: string; acct: string;
      tags?: string[]; ledger?: string; subcat?: string; cur?: string; origAmt?: number; rate?: number;
      ts: number | null };

/**
 * The shape that reaches the store, or `null` when the form is not saveable.
 *
 * Two things this does that a second implementation would get subtly wrong.
 * The amount is **always persisted in the base currency**, with the original
 * kept alongside — so a statement in one currency and a ledger in another stay
 * addable. And every optional numeric is truthy-tested rather than nullish, so
 * a fee of zero is absent rather than a stored zero; that is what the sync
 * merge and every reader already assume.
 */
export function draft(
  f: FormFields,
  base: string,
  currencies: Currencies,
  rateOverride?: number,
): Draft | null {
  const value = evalExpr(f.amt);
  if (!value || value <= 0) return null;
  const note = f.note.trim();

  if (f.io === 'xfer') {
    if (!f.acctTo || f.acct === f.acctTo) return null;
    return {
      kind: 'xfer',
      from: f.acct,
      to: f.acctTo,
      amt: value,
      fee: parseFloat(f.fee) || 0,
      discount: parseFloat(f.discount) || 0,
      note,
      ledger: f.ledger,
      ts: f.ts,
    };
  }

  const foreign = !!f.cur && f.cur !== base;
  const rate = rateOverride ?? (foreign ? currencies.rates?.[f.cur] : undefined);
  return {
    kind: 'entry',
    io: f.io,
    cat: f.cat,
    amt: toBase(value, f.cur, currencies, rate),
    note,
    acct: f.acct,
    tags: f.tags.length ? f.tags : undefined,
    ledger: f.ledger || undefined,
    subcat: f.subcat || undefined,
    cur: foreign ? f.cur : undefined,
    origAmt: foreign ? value : undefined,
    rate: foreign ? rate : undefined,
    ts: f.ts,
  };
}

/**
 * What clears after 再记, so the next entry of the same kind can be typed.
 *
 * Direction, category, account, currency, date, tags and ledger stay — they are
 * what "the same kind" means. The amount, the note and the subcategory are the
 * entry itself, and they go.
 */
export function afterSaveNext(f: FormFields): FormFields {
  return { ...f, amt: '', note: '', subcat: '', fee: '', discount: '' };
}
