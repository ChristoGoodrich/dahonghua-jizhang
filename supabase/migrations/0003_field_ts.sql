-- 大红花记账 / Red Blossom — add per-field timestamps for field-level merge.
--
-- Additive and sync-safe: one nullable jsonb column mapping field name -> the
-- epoch-ms it was last edited. Written by the client's updateEntry and consumed
-- by mergeById so concurrent edits to *different* fields of the same entry are
-- both preserved (instead of whole-row last-write-wins losing one side).
-- Existing rows stay NULL and fall back to whole-row LWW. Run once
-- (Supabase SQL editor or `supabase db push`).

alter table public.entries add column if not exists field_ts jsonb;
