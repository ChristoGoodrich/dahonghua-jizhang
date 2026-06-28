-- 大红花记账 / Red Blossom — initial cloud schema (Phase 3 sync)
--
-- Run this in the Supabase SQL editor (or `supabase db push`) once per project.
-- Design: the ledger lives in a row-per-entry table so two devices merge cleanly
-- by `updated_at`; the smaller config blobs (settings, accounts, categories, …)
-- live as one JSON document per user (personal use → last-write-wins is fine).
-- Secrets (passcode/biometric) are NEVER stored in the cloud.

-- ---------- profiles: one config document per user ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- entries: the ledger (row per transaction) ----------
create table if not exists public.entries (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  ts bigint not null,
  io text not null check (io in ('exp', 'inc')),
  cat text not null,
  subcat text,
  amt numeric not null,
  cur text,
  orig_amt numeric,
  note text,
  acct text,
  tags text[],
  ledger text,
  rb text check (rb in ('pending', 'done')),
  rb_amt numeric,
  refund numeric,
  refund_of text,
  from_sub boolean,
  deleted_at bigint,            -- soft delete so other devices learn of removals
  updated_at bigint not null,   -- client epoch-ms; the merge tiebreaker (last write wins)
  primary key (user_id, id)
);

create index if not exists entries_user_updated_idx
  on public.entries (user_id, updated_at);

-- ---------- keep updated_at fresh on every write ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- profiles.updated_at is server-authoritative (single per-user config doc).
-- entries.updated_at is client-authoritative (the merge tiebreaker), so it has
-- no trigger — the app always sends the row's logical updated_at.
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before insert or update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------- row level security: each user sees only their own data ----------
alter table public.profiles enable row level security;
alter table public.entries  enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own entries" on public.entries;
create policy "own entries" on public.entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- realtime: stream changes to subscribed devices ----------
alter publication supabase_realtime add table public.entries;
alter publication supabase_realtime add table public.profiles;
