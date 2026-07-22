import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, AppState } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { observer } from '@legendapp/state/react';
import { store$ } from '@/store/ledger';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from './Flower';
import { I18N } from '@/i18n';

/** Gates app content behind device biometric/passcode auth when the lock is on.
 *  Where auth is unavailable (web, no enrolled biometrics) it unlocks gracefully. */
export const LockGate = observer(function LockGate({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const s = I18N[store$.lang.get()];
  const locked = !!store$.settings.lock.get();
  const [unlocked, setUnlocked] = useState(false);
  const [failed, setFailed] = useState('');
  // the system biometric prompt backgrounds the app on iOS; without this the
  // re-lock listener below would fire mid-authentication and fight the prompt
  const authing = useRef(false);
  // Monotonic attempt id. Android's BiometricPrompt can be torn down by the OS
  // without ever invoking its callback, leaving authenticateAsync pending
  // forever; a stale attempt that does eventually settle must not be able to
  // unlock the app or clear a newer attempt's in-flight flag.
  const attempt = useRef(0);
  // Distinguishes a real trip through the background from the brief 'inactive'
  // that iOS reports while its own auth prompt is on screen.
  const wasBackgrounded = useRef(false);

  /**
   * Run device authentication.
   *
   * `restart` supersedes an attempt that is already in flight instead of
   * bailing out. Without it a hung prompt latched `authing` on forever and
   * every later tap on Unlock returned early and did nothing — the button was
   * dead, with no feedback, until the process was restarted.
   */
  const runAuth = useCallback(async (restart = false) => {
    if (Platform.OS === 'web') {
      setUnlocked(true);
      return;
    }
    if (authing.current) {
      if (!restart) return;
      // Android-only; elsewhere it throws UnavailabilityError, which is fine —
      // the superseded attempt is ignored by its id either way.
      await LocalAuthentication.cancelAuthenticate().catch(() => {});
    }
    const id = ++attempt.current;
    const current = () => id === attempt.current;
    authing.current = true;
    setFailed('');
    try {
      const has = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!current()) return;
      // no biometrics/passcode configured at all — there is nothing to check
      // against, so gating here would lock the user out of their own data
      if (!has || !enrolled) {
        setUnlocked(true);
        return;
      }
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: s.lockPrompt });
      if (!current()) return; // a newer attempt owns the outcome
      if (res.success) setUnlocked(true);
      // a failure or cancel deliberately leaves the gate closed; say so, because
      // a silent no-op reads as a broken button
      else setFailed(s.lockFailed);
    } catch {
      // Previously this unlocked. An exception here means auth could not be
      // performed — the one case where staying locked matters most — and some
      // Android devices throw after repeated failed attempts, which turned the
      // lock into a formality. Stay locked and let the user retry.
      if (current()) setFailed(s.lockUnavailable);
    } finally {
      if (current()) authing.current = false;
    }
  }, [s.lockPrompt, s.lockFailed, s.lockUnavailable]);

  // Prompt on mount (and when the lock is switched on). Return from the
  // background is driven by the listener below — keying this on `unlocked`
  // instead fired the prompt at the moment the app *left* the foreground,
  // because re-locking flips `unlocked` to false, so the one automatic attempt
  // was spent on an activity that was already going away.
  useEffect(() => {
    if (locked && !unlocked) runAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / lock-toggle only, by design
  }, [locked]);

  // Re-lock when the app leaves the foreground. Without this the gate was
  // launch-only: one unlock held for the whole process lifetime, so anyone
  // picking the phone up from the app switcher walked straight in.
  useEffect(() => {
    if (!locked) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        const stale = wasBackgrounded.current;
        wasBackgrounded.current = false;
        // Only a real trip through the background invalidates an in-flight
        // prompt. Restarting on every 'active' would double-prompt on iOS,
        // where the system's own dialog reports 'inactive' then 'active'
        // before authenticateAsync settles.
        if (!unlocked) runAuth(stale);
        return;
      }
      if (next === 'background') wasBackgrounded.current = true;
      if (!authing.current) setUnlocked(false);
    });
    return () => sub.remove();
  }, [locked, unlocked, runAuth]);

  // Render the app always (keeps the router navigator mounted) and cover it
  // with an opaque overlay while locked.
  return (
    <View style={{ flex: 1 }}>
      {children}
      {locked && !unlocked && (
        <View style={[styles.overlay, { backgroundColor: t.paper }]}>
          <Flower size={64} center="yen" petal={t.hibiscus} stroke={t.hibiscusDeep} />
          <Text style={[styles.title, { color: t.ink }]}>{s.lockTitle}</Text>
          {!!failed && <Text style={[styles.failed, { color: t.hibiscusDeep }]}>{failed}</Text>}
          <Pressable style={[styles.btn, { backgroundColor: t.hibiscus }]} onPress={() => runAuth(true)}>
            <Text style={styles.btnText}>{failed ? s.lockRetry : s.lockUnlock}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, elevation: 100, alignItems: 'center', justifyContent: 'center', gap: 18 },
  title: { fontSize: 18, fontWeight: '700' },
  failed: { fontSize: 13, marginTop: -8 },
  btn: { borderRadius: 24, paddingVertical: 12, paddingHorizontal: 28 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
