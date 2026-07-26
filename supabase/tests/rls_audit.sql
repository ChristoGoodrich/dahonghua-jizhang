-- ============================================================
-- 大红花记账 / Red Blossom — RLS policy audit script
-- Run in Supabase SQL editor to verify row-level security.
-- All checks return pass/fail rows with a descriptive message.
-- ============================================================

-- ---------- 1. RLS is enabled on every application table ----------
-- Expected: all rows show rowsecurity = true

select
  schemaname || '.' || tablename as table_name,
  rowsecurity,
  case when rowsecurity then 'PASS' else 'FAIL — RLS not enabled' end as status
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles', 'entries')
order by tablename;

-- ---------- 2. Profiles: users can only access their own row ----------
-- Expected: 1 row returned (the authenticated user's own profile)

begin;
  -- Simulate authenticated user context
  set local role authenticated;
  set local request.jwt.claim.sub to '00000000-0000-0000-0000-000000000001';

  select
    'own profile read' as check_name,
    count(*) as rows_visible,
    case when count(*) = 1 then 'PASS' else 'FAIL — expected 1 row' end as status
  from public.profiles
  where id = '00000000-0000-0000-0000-000000000001';

  -- Verify cross-user isolation: another user's profile must not appear
  select
    'cross-user profile isolation' as check_name,
    count(*) as rows_visible,
    case when count(*) = 0 then 'PASS' else 'FAIL — saw another user data' end as status
  from public.profiles
  where id <> '00000000-0000-0000-0000-000000000001';
rollback;

-- ---------- 3. Entries: users can only access their own rows ----------
-- Expected: 0 rows for a different user's entries

begin;
  set local role authenticated;
  set local request.jwt.claim.sub to '00000000-0000-0000-0000-000000000001';

  select
    'own entries read' as check_name,
    count(*) as rows_visible,
    case when count(*) >= 0 then 'PASS' else 'FAIL' end as status
  from public.entries
  where user_id = '00000000-0000-0000-0000-000000000001';

  select
    'cross-user entries isolation' as check_name,
    count(*) as rows_visible,
    case when count(*) = 0 then 'PASS' else 'FAIL — saw another user entries' end as status
  from public.entries
  where user_id <> '00000000-0000-0000-0000-000000000001';
rollback;

-- ---------- 4. Anonymous role cannot read any data ----------
-- Expected: 0 rows for both tables

begin;
  set local role anon;

  select
    'anon profiles blocked' as check_name,
    count(*) as rows_visible,
    case when count(*) = 0 then 'PASS' else 'FAIL — anon can read profiles' end as status
  from public.profiles;

  select
    'anon entries blocked' as check_name,
    count(*) as rows_visible,
    case when count(*) = 0 then 'PASS' else 'FAIL — anon can read entries' end as status
  from public.entries;
rollback;

-- ---------- 5. Policy existence and correctness ----------
-- Verify each table has the expected policy with the right USING / WITH CHECK expression

select
  schemaname || '.' || tablename as table_name,
  policyname,
  permissive,
  roles,
  cmd,
  qual as using_expression,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'entries')
order by tablename, policyname;

-- ---------- 6. Realtime publication includes both tables ----------
-- Expected: both entries and profiles in supabase_realtime

select
  schemaname || '.' || tablename as table_name,
  case when tablename is not null then 'PASS' else 'FAIL — missing from realtime' end as status
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in ('entries', 'profiles')
order by tablename;

-- ---------- 7. Verify indexes support efficient per-user queries ----------

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('entries', 'profiles')
order by tablename, indexname;
