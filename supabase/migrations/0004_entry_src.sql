-- 大红花记账 / Red Blossom — record how an entry was captured.
--
-- Additive and sync-safe: one nullable text column. NULL means the entry was
-- typed by hand (every existing row), 'bill' an Alipay/WeChat CSV import,
-- 'notif' a payment notification captured on Android.
--
-- This is load-bearing, not cosmetic. billImport's dedup normally matches on
-- io|amount|day|note, but a notification's note ("星巴克") never equals the same
-- payment's CSV note ("星巴克咖啡(国贸店) · 消费"), so it relaxes the match to
-- io|amount|day for 'notif' entries. If the column did not round-trip through
-- sync, a second device would pull those entries back with src NULL and the
-- next CSV import would silently duplicate every auto-captured payment.
-- Run once (Supabase SQL editor or `supabase db push`).

alter table public.entries add column if not exists src text;

alter table public.entries drop constraint if exists entries_src_check;
alter table public.entries add constraint entries_src_check
  check (src is null or src in ('bill', 'notif'));
