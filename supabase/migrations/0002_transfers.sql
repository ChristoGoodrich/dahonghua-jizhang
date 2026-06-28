-- 大红花记账 / Red Blossom — add transfers (io='xfer') to the ledger.
--
-- Additive and sync-safe: widens the io check and adds three nullable columns
-- carrying a transfer's destination account and optional fee/discount. Existing
-- rows are unaffected. Run once (Supabase SQL editor or `supabase db push`).

alter table public.entries drop constraint if exists entries_io_check;
alter table public.entries add constraint entries_io_check
  check (io in ('exp', 'inc', 'xfer'));

alter table public.entries add column if not exists acct_to  text;    -- xfer: TO account
alter table public.entries add column if not exists fee      numeric; -- xfer: handling fee (from FROM)
alter table public.entries add column if not exists discount numeric; -- xfer: bonus (to TO)
