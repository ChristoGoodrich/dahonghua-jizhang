// Pure Entry <-> Supabase row mapping (snake_case columns). Kept separate from
// the network engine so the round-trip can be unit-tested without Supabase.
import type { Entry, EntrySource, IO } from '@/domain/types';

export interface DbEntry {
  id: string;
  user_id: string;
  ts: number;
  io: IO;
  cat: string;
  subcat: string | null;
  amt: number;
  cur: string | null;
  orig_amt: number | null;
  rate: number | null;
  note: string | null;
  acct: string | null;
  acct_to: string | null;
  fee: number | null;
  discount: number | null;
  tags: string[] | null;
  ledger: string | null;
  rb: string | null;
  rb_amt: number | null;
  refund: number | null;
  refund_of: string | null;
  from_sub: boolean | null;
  src: string | null; // 'bill' | 'notif' | null (manual)
  deleted_at: number | null;
  updated_at: number; // client epoch-ms
  field_ts: Record<string, number> | null; // per-field last-write ms (field-level merge)
}

export function entryToRow(e: Entry, userId: string): DbEntry {
  return {
    id: e.id,
    user_id: userId,
    ts: e.ts,
    io: e.io,
    cat: e.cat,
    subcat: e.subcat ?? null,
    amt: e.amt,
    cur: e.cur ?? null,
    orig_amt: e.origAmt ?? null,
    rate: e.rate ?? null,
    note: e.note ?? null,
    acct: e.acct ?? null,
    acct_to: e.acctTo ?? null,
    fee: e.fee ?? null,
    discount: e.discount ?? null,
    tags: e.tags ?? null,
    ledger: e.ledger ?? null,
    rb: e.rb ?? null,
    rb_amt: e.rbAmt ?? null,
    refund: e.refund ?? null,
    refund_of: e.refundOf ?? null,
    from_sub: e.fromSub ?? null,
    src: e.src ?? null,
    deleted_at: e.deletedAt ?? null,
    updated_at: e.updatedAt ?? e.ts,
    field_ts: e.fieldTs ?? null,
  };
}

export function rowToEntry(r: DbEntry): Entry {
  const e: Entry = {
    id: r.id,
    ts: r.ts,
    io: r.io,
    cat: r.cat,
    amt: r.amt,
    updatedAt: r.updated_at,
  };
  if (r.subcat != null) e.subcat = r.subcat;
  if (r.cur != null) e.cur = r.cur;
  if (r.orig_amt != null) e.origAmt = r.orig_amt;
  if (r.rate != null) e.rate = r.rate;
  if (r.note != null) e.note = r.note;
  if (r.acct != null) e.acct = r.acct;
  if (r.acct_to != null) e.acctTo = r.acct_to;
  if (r.fee != null) e.fee = r.fee;
  if (r.discount != null) e.discount = r.discount;
  if (r.tags != null) e.tags = r.tags;
  if (r.ledger != null) e.ledger = r.ledger;
  if (r.rb != null) e.rb = r.rb as Entry['rb'];
  if (r.rb_amt != null) e.rbAmt = r.rb_amt;
  if (r.refund != null) e.refund = r.refund;
  if (r.refund_of != null) e.refundOf = r.refund_of;
  if (r.from_sub != null) e.fromSub = r.from_sub;
  if (r.src != null) e.src = r.src as EntrySource;
  if (r.deleted_at != null) e.deletedAt = r.deleted_at;
  if (r.field_ts != null) e.fieldTs = r.field_ts;
  return e;
}
