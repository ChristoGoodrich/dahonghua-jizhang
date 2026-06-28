// Supabase client — created only when the project is configured via env vars.
// When unconfigured, the whole app keeps working in pure offline/local mode and
// nothing here touches the network. Set these in `.env` (see SYNC_SETUP.md):
//   EXPO_PUBLIC_SUPABASE_URL=...
//   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export function isSyncConfigured(): boolean {
  return !!URL && !!ANON;
}

export const supabase: SupabaseClient | null = isSyncConfigured()
  ? createClient(URL!, ANON!, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false, // RN has no URL-based session
      },
    })
  : null;
