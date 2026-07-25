-- 大红花记账 / Red Blossom — store the exchange rate used at entry creation.
--
-- Optional numeric column. NULL means the entry used "latest available" rate
-- (or is in the user's base currency). When set, `origAmt * rate ≈ amt` holds.
-- Additive and sync-safe: no backfill needed.

alter table public.entries add column if not exists rate numeric;
