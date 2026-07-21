# Cloud sync setup (Supabase)

The app works **fully offline without any of this**. Follow these steps only when
you want a cloud account + real-time multi-device sync. Until configured, the
"云同步 / Cloud sync" screen just says it's not set up, and nothing touches the network.

## 1. Create a Supabase project
1. Go to <https://supabase.com> → create a free project.
2. Wait for it to finish provisioning.

## 2. Create the database schema
1. In the Supabase dashboard open **SQL Editor → New query**.
2. Paste the contents of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) and **Run**.
   - This creates `profiles` + `entries`, row-level security (each user only sees
     their own rows), `updated_at` triggers, and adds both tables to the realtime publication.
3. Run every later migration in [`supabase/migrations/`](supabase/migrations) the same way,
   **in filename order** (`0002_transfers.sql`, `0003_field_ts.sql`, `0004_entry_src.sql`, …).
   Each is additive and safe to re-run. Skipping one doesn't fail loudly — the client
   just loses that column's data on every sync round-trip.

## 3. Turn on email code sign-in
1. **Authentication → Providers → Email**: make sure Email is enabled.
2. **Authentication → Providers → Email → "Confirm email"**: you can leave the default;
   the app uses the 6-digit **OTP code** flow (`signInWithOtp` / `verifyOtp`).

## 4. Get your keys
**Project Settings → API**, copy:
- **Project URL**
- **anon public** key

## 5. Add them to the app
Create a file `.env` in `dahonghua-app/` (copy from `.env.example`):

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

Restart the dev server (`npx expo start -c` to clear the cache so the env vars are picked up).

## 6. Sign in
Open the app → **⚙︎ Settings → 云同步 / Cloud sync** → enter your email → get the code →
sign in. Repeat on a second device with the same email to sync between them.

---

### Notes
- The `anon` key is safe to ship in the client; **row-level security** is what protects data.
- Passcode/biometric lock settings are **never** uploaded.
- Deletions sync via a soft-delete tombstone (`deleted_at`), so removing an entry on one
  device removes it on the others.
