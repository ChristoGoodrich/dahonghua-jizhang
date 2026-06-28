// Auth — email one-time-code sign-in over Supabase. All functions no-op safely
// when sync isn't configured, so the UI can call them unconditionally.
import { observable } from '@legendapp/state';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export const auth$ = observable<{ session: Session | null; email: string | null }>({
  session: null,
  email: null,
});

function apply(session: Session | null) {
  auth$.session.set(session);
  auth$.email.set(session?.user?.email ?? null);
}

/** Load any persisted session and subscribe to auth changes. Call once at boot. */
export async function initAuth(): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  apply(data.session);
  supabase.auth.onAuthStateChange((_event, session) => apply(session));
}

/** Email a 6-digit login code. Returns false if unconfigured or on error. */
export async function sendOtp(email: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
  return !error;
}

/** Verify the emailed code and establish a session. */
export async function verifyOtp(email: string, token: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'email' });
  return !error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export function isSignedIn(): boolean {
  return !!auth$.session.peek();
}
